/**
 * TMDB 代理的设备凭据（Electron 主进程）。
 *
 * 背景：随安装包分发的共享口令（`resources/tmdb-proxy.json` 的 appToken）能被任何人提取，
 * 因此它不适合长期充当访问凭据。这里把共享口令降级为「注册凭据」：
 * 首次需要访问代理时用它换取一对 deviceId/deviceToken，之后所有请求只带设备凭据。
 *
 * 由此得到的实际收益：
 *   - 服务端按设备记账与限流，单台设备出问题不会拖垮其他人；
 *   - 设备可被单独吊销（server/device-admin.mjs），无需给所有人重发客户端；
 *   - 服务端把共享口令限制成「仅注册」后（LEGACY_TOKEN_DATA_ACCESS=false），
 *     即使它继续泄露，也无法再直接取数据。
 *
 * 存储位置：`<userData>/tmdb-device.json`（按用户隔离，不随安装包分发）。
 * 注册失败不阻塞功能：本次请求回退到共享口令，并进入冷却期后再试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface ProxyEndpoint {
  url: string;
  appToken?: string;
}

export interface DeviceCredentials {
  deviceId: string;
  deviceToken: string;
  /** 记录注册时使用的代理地址；换了代理要重新注册。 */
  proxyUrl: string;
  registeredAt: string;
}

/** 注册失败后的冷却时间，避免离线时每个请求都去撞一次注册接口。 */
const REGISTRATION_RETRY_DELAY_MS = 10 * 60_000;
/** 设备注册与后续请求共用的超时。 */
const REQUEST_TIMEOUT_MS = 15_000;

const FILE_NAME = 'tmdb-device.json';

/** undefined = 尚未从磁盘读取；null = 已确认没有凭据。 */
let cached: DeviceCredentials | null | undefined;
let pendingRegistration: Promise<DeviceCredentials | null> | null = null;
let nextAttemptAt = 0;

function credentialsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function isCredentials(value: unknown): value is DeviceCredentials {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeviceCredentials>;
  return typeof candidate.deviceId === 'string' && candidate.deviceId.length > 0
    && typeof candidate.deviceToken === 'string' && candidate.deviceToken.length > 0
    && typeof candidate.proxyUrl === 'string';
}

export function readDeviceCredentials(): DeviceCredentials | null {
  if (cached !== undefined) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath(), 'utf-8'));
    cached = isCredentials(parsed) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

function writeDeviceCredentials(credentials: DeviceCredentials): void {
  const target = credentialsPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    // 0600：仅当前用户可读（Windows 上依赖 userData 目录自身的 ACL）
    fs.writeFileSync(tmp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
    cached = credentials;
  } catch (err) {
    console.warn('[tmdb] 无法保存设备凭据，本次会话内仍然可用:', (err as Error).message);
    cached = credentials;
  }
}

/** 吊销/失效后调用：清掉本地凭据，迫使下次访问重新注册。 */
export function forgetDeviceCredentials(): void {
  cached = null;
  nextAttemptAt = 0;
  try {
    fs.rmSync(credentialsPath(), { force: true });
  } catch {
    // 删除失败不影响内存态：下次 ensure 会重新注册并覆盖
  }
}

function deviceLabel(): string {
  try {
    return `${process.platform}-${app.getVersion()}`;
  } catch {
    return process.platform;
  }
}

function endpointFor(config: ProxyEndpoint, pathname: string): URL {
  return new URL(pathname, config.url.endsWith('/') ? config.url : `${config.url}/`);
}

async function register(config: ProxyEndpoint): Promise<DeviceCredentials | null> {
  const url = endpointFor(config, '/api/device/register');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.appToken) headers['x-app-token'] = config.appToken;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ label: deviceLabel() }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.warn(`[tmdb] 设备注册未成功（HTTP ${response.status}），本次回退到共享口令`);
    return null;
  }

  const body = await response.json().catch(() => null) as { deviceId?: unknown; deviceToken?: unknown } | null;
  if (typeof body?.deviceId !== 'string' || typeof body?.deviceToken !== 'string') {
    console.warn('[tmdb] 设备注册响应缺少 deviceId/deviceToken，本次回退到共享口令');
    return null;
  }

  const credentials: DeviceCredentials = {
    deviceId: body.deviceId,
    deviceToken: body.deviceToken,
    proxyUrl: config.url,
    registeredAt: new Date().toISOString(),
  };
  writeDeviceCredentials(credentials);
  console.log(`[tmdb] 已注册设备凭据 ${credentials.deviceId}`);
  return credentials;
}

/**
 * 取可用的设备凭据；没有就注册一次。
 * 失败时返回 null（调用方回退到共享口令），并在冷却期内不再重试。
 */
export async function ensureDeviceCredentials(config: ProxyEndpoint): Promise<DeviceCredentials | null> {
  const existing = readDeviceCredentials();
  if (existing && existing.proxyUrl === config.url) return existing;

  if (Date.now() < nextAttemptAt) return null;
  if (pendingRegistration) return pendingRegistration;

  pendingRegistration = (async () => {
    try {
      return await register(config);
    } catch (err) {
      console.warn('[tmdb] 设备注册失败，本次回退到共享口令:', (err as Error).message);
      return null;
    } finally {
      pendingRegistration = null;
      nextAttemptAt = Date.now() + REGISTRATION_RETRY_DELAY_MS;
    }
  })();
  return pendingRegistration;
}

/**
 * 组装鉴权请求头。
 * 有设备凭据时只发设备凭据——共享口令能不发就不发，避免它出现在更多日志与抓包里。
 */
export function authHeaders(config: ProxyEndpoint, credentials: DeviceCredentials | null): Record<string, string> {
  if (credentials) {
    return { 'x-device-id': credentials.deviceId, 'x-device-token': credentials.deviceToken };
  }
  return config.appToken ? { 'x-app-token': config.appToken } : {};
}

/**
 * 设备凭据库（零依赖）。
 *
 * 为什么需要它：共享口令（APP_TOKEN）随安装包分发，任何拿到安装包的人都能从
 * `resources/tmdb-proxy.json` 里读出它。因此它不适合长期充当「访问凭据」。
 *
 * 本模块把共享口令降级为「注册凭据」：客户端首次使用时用它换取一对
 * deviceId/deviceToken，之后所有请求都带设备凭据。由此得到三个好处：
 *   1. 服务端可以按设备记账与限流，滥用者不会拖垮其他客户端；
 *   2. 单个设备可被单独吊销，不需要给所有人重发客户端；
 *   3. 共享口令即使继续泄露，也能通过 LEGACY_TOKEN_DATA_ACCESS=false
 *      限制成「只能注册、不能取数据」，把损失控制在有限的注册配额内。
 *
 * 存储：`<stateDir>/devices.json`，写入用「临时文件 + rename」保证原子性，
 * 高频的 lastSeenAt 更新做 5 秒合并，避免每个请求都落盘。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** 定时安全比较（两个等长十六进制串）。 */
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createDeviceStore(options) {
  const {
    stateDir,
    maxDevices = 200,
    registerLimitPerHour = 10,
    registerLimitPerDay = 100,
    saveDelayMs = 5000,
  } = options;

  const filePath = path.join(stateDir, 'devices.json');

  /** @type {{ version: number, devices: Record<string, any> }} */
  let store = { version: 1, devices: {} };
  let writable = false;
  let saveTimer = null;

  const registerBuckets = new Map();
  let registerDayKey = '';
  let registerDayCount = 0;

  function save() {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, filePath);
      writable = true;
      return true;
    } catch (err) {
      writable = false;
      console.error(`[device] 写入设备库失败（注册会被禁用）：${err.message}`);
      return false;
    }
  }

  /** 合并高频的 lastSeenAt/requests 更新。 */
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  function load() {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.devices !== 'object' || parsed.devices === null) {
        throw new Error('设备库结构不合法');
      }
      store = { version: 1, devices: parsed.devices };
      writable = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[device] 读取 ${filePath} 失败，按空设备库启动：${err.message}`);
      }
      store = { version: 1, devices: {} };
      save(); // 顺便探测目录可写性
    }
    return store;
  }

  const count = () => Object.keys(store.devices).length;

  /**
   * 校验请求头里的设备凭据。未注册/不匹配返回 null。
   * 注意：这里不受「是否还允许注册」影响——关闭注册不应让已有设备失效。
   */
  function match(headers) {
    const deviceId = typeof headers['x-device-id'] === 'string' ? headers['x-device-id'].trim() : '';
    const deviceToken = typeof headers['x-device-token'] === 'string' ? headers['x-device-token'].trim() : '';
    if (!deviceId || !deviceToken) return null;
    const record = store.devices[deviceId];
    if (!record || typeof record.tokenHash !== 'string') return null;
    if (!safeEqualHex(record.tokenHash, sha256Hex(deviceToken))) return null;
    return { deviceId, record };
  }

  /** 累计该设备的调用量（内存内更新，落盘由 scheduleSave 合并）。 */
  function touch(deviceId) {
    const record = store.devices[deviceId];
    if (!record) return;
    record.lastSeenAt = new Date().toISOString();
    record.requests = Number(record.requests || 0) + 1;
    scheduleSave();
  }

  /** 返回 { status, body } 或 { status, error }。 */
  function register(label) {
    if (!writable) {
      return { status: 503, error: '服务器无法持久化设备凭据，请检查 STATE_DIRECTORY 权限' };
    }
    if (count() >= maxDevices) {
      return { status: 503, error: `设备数量已达上限（${maxDevices}），请先清理设备库` };
    }
    const deviceId = crypto.randomBytes(8).toString('hex');
    const deviceToken = crypto.randomBytes(32).toString('hex');
    store.devices[deviceId] = {
      tokenHash: sha256Hex(deviceToken),
      label: String(label || '').slice(0, 80),
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      requests: 0,
    };
    if (!save()) {
      delete store.devices[deviceId];
      return { status: 503, error: '服务器无法持久化设备凭据' };
    }
    return { status: 201, body: { deviceId, deviceToken } };
  }

  function revoke(deviceId) {
    if (!store.devices[deviceId]) return false;
    delete store.devices[deviceId];
    save();
    return true;
  }

  /** 清理长期未使用的设备（lastSeenAt 缺失时用 createdAt 判断）。 */
  function pruneNotSeenSince(cutoffIso) {
    const removed = [];
    for (const [deviceId, record] of Object.entries(store.devices)) {
      const seen = record.lastSeenAt || record.createdAt || '';
      if (seen && seen < cutoffIso) {
        delete store.devices[deviceId];
        removed.push(deviceId);
      }
    }
    if (removed.length) save();
    return removed;
  }

  function list() {
    return Object.entries(store.devices).map(([deviceId, record]) => ({
      deviceId,
      label: record.label || '',
      createdAt: record.createdAt || '',
      lastSeenAt: record.lastSeenAt || '',
      requests: Number(record.requests || 0),
    }));
  }

  /**
   * 注册接口的独立限流：按 IP 的小时配额 + 全局日配额。
   * 这样即使共享口令泄露，能注册出来的设备数也是有界的。
   */
  function isRegisterLimited(ip) {
    const now = Date.now();
    const hour = 60 * 60 * 1000;

    if (registerBuckets.size > 500) {
      for (const [key, bucket] of registerBuckets) {
        if (now - bucket.startedAt >= hour) registerBuckets.delete(key);
      }
    }

    const bucket = registerBuckets.get(ip);
    if (!bucket || now - bucket.startedAt >= hour) {
      registerBuckets.set(ip, { startedAt: now, count: 1 });
    } else {
      bucket.count++;
      if (bucket.count > registerLimitPerHour) return true;
    }

    const dayKey = new Date(now).toISOString().slice(0, 10);
    if (dayKey !== registerDayKey) {
      registerDayKey = dayKey;
      registerDayCount = 0;
    }
    registerDayCount++;
    return registerDayCount > registerLimitPerDay;
  }

  return {
    load,
    save,
    count,
    match,
    touch,
    register,
    revoke,
    pruneNotSeenSince,
    list,
    isRegisterLimited,
    get filePath() { return filePath; },
    get stateDir() { return stateDir; },
    get writable() { return writable; },
    get maxDevices() { return maxDevices; },
  };
}

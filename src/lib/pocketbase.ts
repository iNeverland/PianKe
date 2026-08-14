import PocketBase, { type RecordModel } from 'pocketbase';
import { getOfflineMedia, saveOfflineMedia } from './offlineCache';

export const POCKETBASE_URL = 'https://pb.astara.space';

/**
 * 所有业务数据都通过这个客户端访问。PocketBase 默认的 LocalAuthStore 会将
 * 用户会话保存在渲染进程的 localStorage 中，应用重启后仍可恢复登录状态。
 */
export const pocketbase = new PocketBase(POCKETBASE_URL);
// PocketBase 默认会取消同一路径的前一个请求。React 页面装载、刷新详情和图片
// URL 解析会合法地并发读取同一资源，默认行为会把其中一个误判为失败并显示给用户。
// 业务层已经对快照、文件 token 和媒体记录做了单飞/缓存，因此关闭 SDK 全局取消
// 不会导致重复请求失控。
pocketbase.autoCancellation(false);

export interface CloudUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

let avatarFileToken: { value: string; expiresAt: number } | null = null;
let avatarFileTokenRequest: Promise<void> | null = null;
const avatarObjectUrls = new Map<string, string>();
const avatarCacheRequests = new Map<string, Promise<void>>();

function avatarCacheKey(record: RecordModel): string {
  return `avatar:${String(record.avatar || '')}`;
}

function avatarObjectUrl(ownerId: string, avatar: string): string | null {
  return avatarObjectUrls.get(`${ownerId}:${avatar}`) || null;
}

function toCloudUser(record: RecordModel | null): CloudUser | null {
  if (!record) return null;
  const avatar = String(record.avatar || '');
  const cachedAvatarUrl = avatar ? avatarObjectUrl(record.id, avatar) : null;
  return {
    id: record.id,
    email: String(record.email || ''),
    displayName: String(record.displayName || ''),
    // users 是私有集合；文件 URL 必须附带短期 token，裸 <img> 请求不会携带
    // PocketBase 的 Authorization 请求头。
    // 本地 Blob 优先，重启与离线时可立即显示。缓存未命中才使用带临时令牌的云端地址。
    avatarUrl: cachedAvatarUrl || (avatar && avatarFileToken && avatarFileToken.expiresAt > Date.now()
      ? pocketbase.files.getURL(record, avatar, { thumb: '160x160', token: avatarFileToken.value })
      : null),
  };
}

export function getCloudUser(): CloudUser | null {
  if (!pocketbase.authStore.isValid) return null;
  return toCloudUser(pocketbase.authStore.record);
}

export async function refreshCloudUser(): Promise<CloudUser | null> {
  const record = pocketbase.authStore.record;
  if (!record) return null;
  const avatar = String(record.avatar || '');
  if (!avatar) return getCloudUser();

  // IndexedDB 读取通常只需毫秒级；命中后不再等待网络，令牌与云端文件在后台刷新。
  const cachedAvatar = await restoreCachedAvatar(record, avatar);
  if (cachedAvatar) {
    void cacheAvatarFromRemote(record, avatar);
    return getCloudUser();
  }

  await refreshAvatarFileToken();
  void cacheAvatarFromRemote(record, avatar);
  return getCloudUser();
}

async function restoreCachedAvatar(record: RecordModel, avatar: string): Promise<boolean> {
  const key = `${record.id}:${avatar}`;
  if (avatarObjectUrls.has(key)) return true;
  const blob = await getOfflineMedia(record.id, avatarCacheKey(record)).catch(() => null);
  if (!blob) return false;
  avatarObjectUrls.set(key, URL.createObjectURL(blob));
  return true;
}

async function cacheAvatarFromRemote(record: RecordModel, avatar: string): Promise<void> {
  const key = `${record.id}:${avatar}`;
  const pending = avatarCacheRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    await refreshAvatarFileToken();
    if (!avatarFileToken || pocketbase.authStore.record?.id !== record.id) return;
    const url = pocketbase.files.getURL(record, avatar, { thumb: '160x160', token: avatarFileToken.value });
    const response = await fetch(url);
    if (!response.ok) return;
    const blob = await response.blob();
    if (pocketbase.authStore.record?.id !== record.id) return;
    await saveOfflineMedia(record.id, avatarCacheKey(record), blob);
    const previous = avatarObjectUrls.get(key);
    if (previous) URL.revokeObjectURL(previous);
    avatarObjectUrls.set(key, URL.createObjectURL(blob));
  })().catch(() => {}).finally(() => {
    avatarCacheRequests.delete(key);
  });
  avatarCacheRequests.set(key, request);
  return request;
}

export function isCloudAuthenticated(): boolean {
  return pocketbase.authStore.isValid && Boolean(pocketbase.authStore.record?.id);
}

function isAuthenticationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const { status } = error as { status?: unknown };
  return status === 401 || status === 403;
}

/**
 * PocketBase 的 create/update/delete rule 被无效 JWT 拒绝时，在部分版本中会返回
 * 没有字段详情的 400。再次 authRefresh 能区分真实的表单校验失败和失效会话。
 */
export async function isInvalidCloudSessionAfterWriteFailure(error: unknown): Promise<boolean> {
  if (isAuthenticationFailure(error)) {
    logoutCloud();
    return true;
  }
  if (!error || typeof error !== 'object') return false;
  const { status, message } = error as { status?: unknown; message?: unknown };
  if (status !== 400 || !/^Failed to (create|update|delete) record\.$/.test(String(message || ''))) return false;
  try {
    await pocketbase.collection('users').authRefresh();
    return false;
  } catch (refreshError) {
    if (!isAuthenticationFailure(refreshError)) return false;
    logoutCloud();
    return true;
  }
}

async function validateCloudSession(): Promise<void> {
  if (!isCloudAuthenticated()) return;
  try {
    // 仅验证本地持久化的会话。网络故障会保留离线数据；认证被服务器拒绝时才清除令牌。
    await pocketbase.collection('users').authRefresh();
  } catch (error) {
    if (isAuthenticationFailure(error)) logoutCloud();
    throw error;
  }
}

async function refreshAvatarFileToken(): Promise<void> {
  const user = pocketbase.authStore.record;
  if (!user?.avatar) return;
  if (avatarFileToken && avatarFileToken.expiresAt > Date.now()) return;
  if (!avatarFileTokenRequest) {
    avatarFileTokenRequest = pocketbase.files.getToken()
      .then((value) => {
        avatarFileToken = { value, expiresAt: Date.now() + 4 * 60_000 };
      })
      .finally(() => {
        avatarFileTokenRequest = null;
      });
  }
  await avatarFileTokenRequest;
}

export async function loginCloud(email: string, password: string): Promise<CloudUser> {
  await pocketbase.collection('users').authWithPassword(email.trim(), password);
  await refreshAvatarFileToken();
  const record = pocketbase.authStore.record;
  if (record?.avatar) void cacheAvatarFromRemote(record, String(record.avatar));
  const user = getCloudUser();
  if (!user) throw new Error('登录状态未能保存，请重试');
  return user;
}

export async function requestRegisterCode(email: string): Promise<void> {
  await pocketbase.send('/api/pianke/auth/send-register-code', { method: 'POST', body: { email: email.trim() } });
}

export async function requestPasswordResetCode(email: string): Promise<void> {
  await pocketbase.send('/api/pianke/auth/send-password-reset-code', { method: 'POST', body: { email: email.trim() } });
}

export async function registerCloud(email: string, password: string, displayName: string, code: string): Promise<void> {
  const normalizedEmail = email.trim();
  await pocketbase.send('/api/pianke/auth/register', {
    method: 'POST',
    body: { email: normalizedEmail, password, displayName: displayName.trim(), code: code.trim() },
  });
  await loginCloud(normalizedEmail, password);
}

export async function resetCloudPassword(email: string, password: string, code: string): Promise<void> {
  await pocketbase.send('/api/pianke/auth/reset-password', {
    method: 'POST',
    body: { email: email.trim(), password, code: code.trim() },
  });
}

export function logoutCloud(): void {
  avatarFileToken = null;
  avatarFileTokenRequest = null;
  for (const url of avatarObjectUrls.values()) URL.revokeObjectURL(url);
  avatarObjectUrls.clear();
  avatarCacheRequests.clear();
  pocketbase.authStore.clear();
}

function syncCloudUser(record: RecordModel): CloudUser {
  pocketbase.authStore.save(pocketbase.authStore.token, record);
  const user = getCloudUser();
  if (!user) throw new Error('账号资料保存后未能同步');
  return user;
}

export async function updateCloudProfile(data: { displayName: string; avatar?: File | null }): Promise<CloudUser> {
  const user = getCloudUser();
  if (!user) throw new Error('登录已失效，请重新登录');
  const form = new FormData();
  form.append('displayName', data.displayName.trim());
  if (data.avatar instanceof File) form.append('avatar', data.avatar);
  if (data.avatar === null) form.append('avatar-', '');
  let record: RecordModel;
  try {
    record = await pocketbase.collection('users').update<RecordModel>(user.id, form);
  } catch (error) {
    if (await isInvalidCloudSessionAfterWriteFailure(error)) {
      throw new Error('登录状态已失效，请重新登录后重试');
    }
    throw error;
  }
  syncCloudUser(record);
  await refreshAvatarFileToken();
  if (record.avatar) void cacheAvatarFromRemote(record, String(record.avatar));
  const updatedUser = getCloudUser();
  if (!updatedUser) throw new Error('账号资料保存后未能同步');
  return updatedUser;
}

export async function requestPasswordChangeCode(): Promise<void> {
  await pocketbase.send('/api/pianke/auth/send-password-code', { method: 'POST' });
}

export async function changeCloudPassword(currentPassword: string, password: string, code: string): Promise<void> {
  const user = getCloudUser();
  if (!user) throw new Error('登录已失效，请重新登录');
  await pocketbase.send('/api/pianke/auth/change-password', {
    method: 'POST',
    body: { currentPassword, password, code: code.trim() },
  });
}

/** 监听登录状态；返回取消订阅函数。 */
export function subscribeCloudAuth(listener: (user: CloudUser | null) => void): () => void {
  // 已持久化的会话必须立即进入应用。头像文件 token 是可选增强，断网时不能让它
  // 阻塞 IndexedDB 快照恢复与首屏渲染。
  listener(getCloudUser());
  void validateCloudSession()
    .then(() => refreshCloudUser())
    .then((user) => listener(user))
    .catch(() => {});
  return pocketbase.authStore.onChange(() => {
    listener(getCloudUser());
    void refreshCloudUser().then((user) => listener(user)).catch(() => {});
  });
}

/**
 * 云端影视库的本地优先缓存。
 *
 * IndexedDB 比 localStorage 更适合保存完整 JSON 和 Blob；所有 key 都带账号 id，
 * 不会在同一台设备的不同账号之间混用数据或媒体文件。
 */
const DB_NAME = 'pianke-offline-cache';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const RECORD_STORE = 'records';
const MEDIA_STORE = 'media';

interface StoredValue<T> {
  key: string;
  ownerId: string;
  savedAt: number;
  value: T;
}

let databaseRequest: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databaseRequest) return databaseRequest;
  const request = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('无法打开本地离线缓存'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(MEDIA_STORE)) database.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
  }).catch((error): never => {
    databaseRequest = null;
    throw error;
  });
  databaseRequest = request;
  return request;
}

function key(ownerId: string, name: string): string {
  return `${ownerId}:${name}`;
}

async function getValue<T>(storeName: string, ownerId: string, name: string): Promise<T | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key(ownerId, name));
    request.onerror = () => reject(request.error || new Error('读取本地缓存失败'));
    request.onsuccess = () => resolve((request.result as StoredValue<T> | undefined)?.value ?? null);
  });
}

async function putValue<T>(storeName: string, ownerId: string, name: string, value: T): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put({
      key: key(ownerId, name), ownerId, savedAt: Date.now(), value,
    } satisfies StoredValue<T>);
    request.onerror = () => reject(request.error || new Error('写入本地缓存失败'));
    request.onsuccess = () => resolve();
  });
}

export function getOfflineSnapshot<T>(ownerId: string): Promise<T | null> {
  return getValue<T>(SNAPSHOT_STORE, ownerId, 'snapshot');
}

export function saveOfflineSnapshot<T>(ownerId: string, value: T): Promise<void> {
  return putValue(SNAPSHOT_STORE, ownerId, 'snapshot', value);
}

export function getOfflineRecord<T>(ownerId: string, name: string): Promise<T | null> {
  return getValue<T>(RECORD_STORE, ownerId, name);
}

export function saveOfflineRecord<T>(ownerId: string, name: string, value: T): Promise<void> {
  return putValue(RECORD_STORE, ownerId, name, value);
}

export function getOfflineMedia(ownerId: string, name: string): Promise<Blob | null> {
  return getValue<Blob>(MEDIA_STORE, ownerId, name);
}

export function saveOfflineMedia(ownerId: string, name: string, value: Blob): Promise<void> {
  return putValue(MEDIA_STORE, ownerId, name, value);
}

/**
 * 请求浏览器为用户已同步的影视库保留存储空间。该请求可能被系统拒绝，但不会影响
 * 正常缓存；Electron/Chromium 支持时可降低空间回收导致离线内容丢失的概率。
 */
export async function requestPersistentOfflineStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // 存储持久化只是增强能力，不能阻塞首屏或云端同步。
  }
}

/** 仅在用户主动登出时清理该账号的离线内容；避免切换账号占用长期空间。 */
export async function clearOfflineCache(ownerId: string): Promise<void> {
  const database = await openDatabase();
  await Promise.all([SNAPSHOT_STORE, RECORD_STORE, MEDIA_STORE].map((storeName) => new Promise<void>((resolve, reject) => {
    const store = database.transaction(storeName, 'readwrite').objectStore(storeName);
    const request = store.openCursor();
    request.onerror = () => reject(request.error || new Error('清理本地缓存失败'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      if ((cursor.value as StoredValue<unknown>).ownerId === ownerId) cursor.delete();
      cursor.continue();
    };
  })));
}

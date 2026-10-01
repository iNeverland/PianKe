/**
 * 进程内 LRU 缓存（零依赖）。
 *
 * 为什么要有上界：过期条目只在「被再次读取」时才删除，因此随机 query 能把缓存撑到
 * 无限大；而海报缓存里存的是 Buffer（单张上限 10MB），只限条数挡不住内存放大。
 *
 * 语义：
 *   - get 命中后把条目挪到队尾（Map 保持插入顺序，队首即最近最少使用）；
 *   - 超时按 ttlMs 判定，命中过期条目时顺手删除；
 *   - set 后按 maxEntries 与 maxBytes 双重回收，且永远不会淘汰刚写入的那一条
 *     （否则单个超过 maxBytes 的条目会导致刚写就丢）。
 */
export function createLruCache({ ttlMs, maxEntries, maxBytes, sizeOf = () => 0 }) {
  const entries = new Map();
  let bytes = 0;

  function drop(key) {
    const hit = entries.get(key);
    if (!hit) return;
    bytes -= hit.bytes;
    entries.delete(key);
  }

  function get(key) {
    const hit = entries.get(key);
    if (!hit) return null;
    if (Date.now() - hit.time > ttlMs) {
      drop(key);
      return null;
    }
    entries.delete(key);
    entries.set(key, hit);
    return hit.body;
  }

  function set(key, body) {
    drop(key);
    const entryBytes = Math.max(0, Number(sizeOf(body)) || 0);
    entries.set(key, { time: Date.now(), body, bytes: entryBytes });
    bytes += entryBytes;
    while (entries.size > maxEntries || bytes > maxBytes) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined || oldestKey === key) break;
      drop(oldestKey);
    }
  }

  return {
    get,
    set,
    clear() {
      entries.clear();
      bytes = 0;
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return bytes;
    },
  };
}

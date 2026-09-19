import { registerUpdateHandlers } from './modules/updater/handler.js';
import { registerTmdbHandlers } from './modules/tmdb/handler.js';

/**
 * 注册主进程 IPC 处理器。
 *
 * 业务数据（影视/日记/追剧/想看/统计）不在此列：云端（PocketBase）是唯一权威数据源，
 * 渲染进程直接经 src/lib/cloudApi.ts 访问，不再经过 IPC。这里只保留原生能力。
 */
export function registerAllHandlers(): void {
  registerTmdbHandlers();
  registerUpdateHandlers();
}

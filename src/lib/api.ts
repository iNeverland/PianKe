import { cloudApi } from './cloudApi';
import { platform } from '@/platform';
import type { Platform } from '@/platform';

/**
 * 渲染进程实际使用的原生能力集合。
 *
 * 业务数据（影视/日记/追剧/想看/统计）不在此列：云端是唯一权威数据源，且 App 在未
 * 登录时只渲染登录页（见 App.tsx），因此业务命名空间恒由 cloudApi 提供。
 */
type NativeApi = Pick<Platform, 'platform' | 'setTheme' | 'window' | 'updater' | 'tmdb'> &
  Pick<
    Platform,
    | 'onScreenshotTrigger'
    | 'registerShortcut'
    | 'unregisterShortcut'
    | 'showScreenToast'
    | 'getDesktopSources'
    | 'getPrimaryScreenSnapshot'
    | 'startCrop'
    | 'onScreenshotCropped'
  >;

const nativeApi: NativeApi = platform;

/**
 * 业务数据统一走 cloudApi（直连 PocketBase），原生能力统一走平台抽象层
 * （Electron 实现 / Capacitor 占位）。
 *
 * 这里刻意不用在运行时按登录态分发的 Proxy：未登录时 App 只渲染登录页，登录后
 * 业务命名空间必然由云端接管，任何本地回退分支都是不可达的死代码。用交叉类型
 * 静态地表达这一事实，写错属性会在类型检查阶段直接报错。
 */
const api: typeof cloudApi & NativeApi = new Proxy({} as typeof cloudApi & NativeApi, {
  get(_target, prop: string | symbol) {
    if (prop === 'then' || prop === 'toJSON') return undefined;
    if (prop in cloudApi) return cloudApi[prop as keyof typeof cloudApi];
    return nativeApi[prop as keyof NativeApi];
  },
});

export default api;

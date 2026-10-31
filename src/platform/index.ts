import type { Platform } from './types';
import { electronPlatform } from './electron';
import { webPlatform } from './web';

/**
 * 平台抽象层入口：桌面端使用 Electron 实现；纯浏览器预览使用 webPlatform 兜底。
 */
function detectPlatform(): Platform {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return electronPlatform;
  }
  return webPlatform;
}

export const platform: Platform = detectPlatform();

export type { Platform, PlatformWindow, PlatformUpdater, PlatformTmdb, ThemeMode } from './types';

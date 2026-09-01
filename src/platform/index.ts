import type { Platform } from './types';
import { electronPlatform } from './electron';
import { capacitorPlatform } from './capacitor';

/**
 * 平台抽象层入口：根据运行环境选择实现。
 *
 * - Electron：preload 注入 window.electronAPI，选 electronPlatform。
 * - Capacitor / Web：回退到 capacitorPlatform（第一阶段为占位实现）。
 *
 * 后续接入 Capacitor 后，可进一步用 window.Capacitor?.isNativePlatform?.() 区分
 * Android 原生与纯 Web。
 */
function detectPlatform(): Platform {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return electronPlatform;
  }
  return capacitorPlatform;
}

export const platform: Platform = detectPlatform();

export type { Platform, PlatformWindow, PlatformUpdater, PlatformTmdb, ThemeMode } from './types';

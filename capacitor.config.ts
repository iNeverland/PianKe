import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：Electron 桌面端之外，用同一套 React 前端构建产物（dist/）
 * 打包为 Android 应用。
 *
 * - appId：与 electron-builder.yml 的 appId（com.pianke.app）保持一致，正式稳定。
 * - webDir：复用现有 `npm run build`（tsc && vite build）产出的前端目录。
 * - 服务端（server/）与 Electron 主进程（electron/）不参与 Android 打包。
 */
const config: CapacitorConfig = {
  appId: 'com.pianke.app',
  appName: 'PianKe',
  webDir: 'dist',
};

export default config;

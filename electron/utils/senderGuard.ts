import type { IpcMainInvokeEvent, WebContents } from 'electron';

let mainWebContentsGetter: (() => WebContents | null) | null = null;

/** 在注册 IPC 处理器前设置主窗口引用；辅助窗口（裁剪/选片）单独按需校验。 */
export function setMainWebContentsGetter(getter: () => WebContents | null): void {
  mainWebContentsGetter = getter;
}

/**
 * 校验 IPC 调用来源。默认只接受主窗口；可传入额外的受信任窗口（如裁剪窗口、
 * 选片窗口）用于它们专属的通道。来源不合法的调用直接抛出，渲染进程会收到
 * rejected Promise，避免任意 webContents 触发敏感数据操作。
 */
export function assertTrustedSender(event: IpcMainInvokeEvent, extra?: WebContents | null): void {
  const main = mainWebContentsGetter?.() ?? null;
  if (event.sender === main) return;
  if (extra && event.sender === extra) return;

  const url = event.senderFrame?.url ?? 'unknown';
  throw new Error(`拒绝来自未信任窗口的 IPC 调用：${url}`);
}

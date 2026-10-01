import type { IpcMainInvokeEvent, WebContents } from 'electron';

let mainWebContentsGetter: (() => WebContents | null) | null = null;

/**
 * 主窗口「本应用自己的文档」地址（已去掉 hash）。
 *
 * 为什么需要它：preload 会在**每一次导航**后重新注入，所以外部页面同样能拿到
 * `window.electronAPI`。只比较 `event.sender === mainWindow.webContents` 是拦不住的
 * —— 导航之后页面换了，webContents 还是同一个。因此改为钉住首次加载完成时的
 * 文档地址，此后任何其它文档（哪怕是同一个 webContents）调用 IPC 都会被拒绝。
 *
 * SPA 的 hash 路由只改 hash，故比较时统一去掉 `#...`。
 */
let mainFrameDocumentUrl: string | null = null;

/** 在注册 IPC 处理器前设置主窗口引用；辅助窗口（裁剪/选片）单独按需校验。 */
export function setMainWebContentsGetter(getter: () => WebContents | null): void {
  mainWebContentsGetter = getter;
}

/**
 * 由主窗口在**首次** `did-finish-load` 时调用一次，钉住主文档地址。
 * 必须用 once 而不是 on：若每次加载完成都更新，被导航到的外部页面反而会把自己钉进去。
 */
export function pinMainFrameDocument(url: string | null | undefined): void {
  mainFrameDocumentUrl = withoutHash(url);
}

function withoutHash(url: string | null | undefined): string | null {
  if (!url) return null;
  const index = url.indexOf('#');
  return index === -1 ? url : url.slice(0, index);
}

/** 辅助窗口由主进程自己用 data: URL 创建（见 cropWindow/moviePickerWindow）。 */
function isAllowedAuxiliaryFrameUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('file:');
}

/**
 * 校验 IPC 调用来源。默认只接受主窗口；可传入额外的受信任窗口（如裁剪窗口、
 * 选片窗口）用于它们专属的通道。来源不合法的调用直接抛出，渲染进程会收到
 * rejected Promise，避免任意页面触发敏感操作（截屏、下载并安装更新等）。
 */
export function assertTrustedSender(event: IpcMainInvokeEvent, extra?: WebContents | null): void {
  const frame = event.senderFrame;
  const url = frame?.url ?? '';

  // 本应用没有任何需要 IPC 的子框架（iframe），一律拒绝：子框架的 URL 不受上面
  // 那条主文档规则约束，放行等于开了一个来源不明的入口。
  if (frame?.parent) {
    throw new Error(`拒绝来自子框架的 IPC 调用：${url}`);
  }

  const main = mainWebContentsGetter?.() ?? null;
  if (main && event.sender === main) {
    // 首次加载完成前还是 null：这一段窗口期内页面上只可能是我们自己的文档。
    if (mainFrameDocumentUrl !== null && withoutHash(url) !== mainFrameDocumentUrl) {
      throw new Error(`拒绝来自非受信页面的 IPC 调用：${url}`);
    }
    return;
  }

  if (extra && event.sender === extra) {
    if (!isAllowedAuxiliaryFrameUrl(url)) {
      throw new Error(`拒绝来自辅助窗口非受信页面的 IPC 调用：${url}`);
    }
    return;
  }

  throw new Error(`拒绝来自未信任窗口的 IPC 调用：${url || 'unknown'}`);
}

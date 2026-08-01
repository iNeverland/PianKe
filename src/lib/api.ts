// 等待 electronAPI 可用后调用
function getAPI(): typeof window.electronAPI {
  if (!window.electronAPI) {
    throw new Error('electronAPI 未就绪，请确认应用已正确启动');
  }
  return window.electronAPI;
}

// 创建代理，惰性访问 window.electronAPI
const api = new Proxy({} as typeof window.electronAPI, {
  get(_target, prop: string) {
    if (prop === 'then' || prop === 'toJSON') return undefined;
    const ea = window.electronAPI as unknown as Record<string, unknown> | undefined;
    if (!ea) return undefined;
    return ea[prop];
  },
});

export default api;

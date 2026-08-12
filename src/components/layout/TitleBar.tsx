import { useState, useEffect } from 'react';
import api from '@/lib/api';
import appLogo from '@/assets/brand/PianKe.svg';

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = api.platform === 'darwin';

  useEffect(() => {
    if (isMac) return;
    const win = api.window;
    if (!win) return;
    win.isMaximized?.().then(setIsMaximized);
    win.onMaximizeChange?.((v: boolean) => setIsMaximized(v));
  }, [isMac]);

  const handleMinimize = () => api.window?.minimize?.();
  const handleMaximize = () => api.window?.maximize?.();
  const handleClose = () => api.window?.close?.();

  return (
    <div className={`titlebar${isMac ? ' titlebar-mac' : ''}`}>
      <div className="titlebar-drag">
        <div className="titlebar-brand" aria-hidden="true">
          <img src={appLogo} alt="" />
          <span>片刻</span>
        </div>
      </div>
      {!isMac && (
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={handleMinimize} title="最小化" aria-label="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
            </svg>
          </button>
          <button className="titlebar-btn" onClick={handleMaximize} title={isMaximized ? '还原' : '最大化'} aria-label={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="3" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} title="关闭" aria-label="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

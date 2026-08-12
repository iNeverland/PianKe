import { useState, useRef, useEffect } from 'react';
import api from '@/lib/api';
import appLogo from '@/assets/brand/PianKe.svg';
import AppIcon from '@/components/common/AppIcon';
import { showToast } from '@/components/common/Toast';

interface WelcomeProps {
  onLibraryOpen: (name: string) => void;
}

export default function Welcome({ onLibraryOpen }: WelcomeProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 表单展开后自动聚焦输入框
  useEffect(() => {
    if (showCreate && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [showCreate]);

  const handleOpen = async () => {
    try {
      const info = await api.library.open();
      if (info) {
        const rootPath = await api.library.getPath();
        if (rootPath) {
          localStorage.setItem('film-log-library-path', rootPath);
        }
        onLibraryOpen(info.name);
        showToast('资源库已打开');
      }
    } catch (err: any) {
      showToast(err.message || '打开资源库失败');
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      showToast('请输入资源库名称');
      return;
    }
    try {
      const info = await api.library.create(createName.trim());
      if (info) {
        const rootPath = await api.library.getPath();
        if (rootPath) {
          localStorage.setItem('film-log-library-path', rootPath);
        }
        onLibraryOpen(info.name);
        showToast('资源库已创建');
      }
    } catch (err: any) {
      showToast(err.message || '创建资源库失败');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') {
      setShowCreate(false);
      setCreateName('');
    }
  };

  return (
    <div className="welcome-page">
      <div className="welcome-content">
        {/* Logo */}
        <div className="welcome-logo">
          <img src={appLogo} alt="PianKe" />
        </div>

        {/* 标题 */}
        <h1 className="welcome-title">PianKe</h1>
        <p className="welcome-subtitle">
          你的私人影院，记录每一次光影之旅
        </p>

        {/* 双卡片操作区 */}
        <div className="welcome-actions">
          <button className="action-card" onClick={handleOpen}>
            <div className="action-card-icon">
              <AppIcon name="folder" />
            </div>
            <div>
              <div className="action-card-title">打开已有资源库</div>
              <div className="action-card-desc">选择已创建的影片库文件夹</div>
            </div>
          </button>

          <button
            className="action-card"
            onClick={() => setShowCreate(true)}
          >
            <div className="action-card-icon">
              <AppIcon name="add" />
            </div>
            <div>
              <div className="action-card-title">创建新资源库</div>
              <div className="action-card-desc">新建一个全新的影片库</div>
            </div>
          </button>
        </div>

        {/* 创建表单展开区 */}
        <div className={`create-form-wrapper${showCreate ? ' open' : ''}`}>
          <div className="create-form-inner">
            <div className="create-form-title">创建新资源库</div>
            <label className="form-label">资源库名称</label>
            <input
              ref={inputRef}
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="我的影片库"
              className="form-input"
            />
            <p className="create-form-hint">
              点击创建后将弹出文件夹选择器，选择资源库的存储位置
            </p>
            <div className="create-form-actions">
              <button
                onClick={() => { setShowCreate(false); setCreateName(''); }}
                className="btn btn-secondary flex-1"
              >
                取消
              </button>
              <button onClick={handleCreate} className="btn btn-primary flex-1">
                选择位置并创建
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="welcome-footer">
        <span>v{__APP_VERSION__}</span>
        <span>数据完全属于你</span>
        <span>离线可用</span>
      </div>
    </div>
  );
}

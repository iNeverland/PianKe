import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showAdd?: boolean;
  addLoading?: boolean;
  children?: ReactNode;
}

export default function Header({ title, subtitle, showAdd = true, addLoading, children }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="app-header">
      <div className="header-greeting">
        {/* 页面主标题用 h1：应用内此前不存在 h1，标题大纲缺少根节点（WCAG 1.3.1 / 2.4.6 最佳实践） */}
        <h1>{title || 'Hello'}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {showAdd && (
          <button
            onClick={() => navigate('/movie/new')}
            className={`btn btn-primary btn-toolbar ml-4${addLoading ? ' loading' : ''}`}
            disabled={addLoading}
          >
            添加
          </button>
        )}
      </div>
    </header>
  );
}

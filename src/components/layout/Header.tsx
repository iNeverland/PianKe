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
        <h2>{title || 'Hello'}</h2>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="icon-sm">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            添加
          </button>
        )}
      </div>
    </header>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

interface AppShellProps {
  libraryName?: string;
}

export default function AppShell({}: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="window-drag-region" aria-hidden="true" />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

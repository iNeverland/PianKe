import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import appLogo from '@/assets/brand/PianKe.svg';
import defaultAvatar from '@/assets/brand/default-avatar.png';
import { getCloudUser, refreshCloudUser } from '@/lib/pocketbase';
import ProfileDialog from '@/pages/Profile';
import AppIcon from '@/components/common/AppIcon';

const navItems = [
  { path: '/', label: '首页', icon: <AppIcon name="home" /> },
  { path: '/diary', label: '日记', icon: <AppIcon name="diary" /> },
  { path: '/photos', label: '照片墙', icon: <AppIcon name="photo" /> },
  { path: '/watching', label: '追剧', icon: <AppIcon name="watching" /> },
  { path: '/watchlist', label: '想看', icon: <AppIcon name="watchlist" /> },
  { path: '/stats', label: '统计', icon: <AppIcon name="stats" /> },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(getCloudUser);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    void refreshCloudUser().then(setUser).catch(() => {});
  }, []);

  function openProfile() {
    // 个人中心只依赖已经保存在本地会话中的资料。过去这里会等待头像临时令牌的
    // 网络请求，弱网或离线时导致点击后数秒没有反馈；先显示弹窗，头像随后更新。
    setProfileOpen(true);
    void refreshCloudUser().then(setUser).catch(() => setUser(getCloudUser()));
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-capsule">
        <img src={appLogo} alt="PianKe" className="sidebar-logo" />
        <div className="sidebar-divider" />
        {navItems.map((item) => {
          const isActive = item.path === '/' ? location.pathname === '/' || location.pathname.startsWith('/movie/') : location.pathname === item.path;
          return (
            <button key={item.path} onClick={() => navigate(item.path)} className={`nav-item${isActive ? ' active' : ''}`} aria-label={item.label}>
              {item.icon}
              <span className="nav-tooltip">{item.label}</span>
            </button>
          );
        })}
        <div className="sidebar-divider" />
        <button onClick={() => navigate('/settings')} className={`nav-item${location.pathname === '/settings' ? ' active' : ''}`} aria-label="设置">
          <AppIcon name="settings" />
          <span className="nav-tooltip">设置</span>
        </button>
      </div>
      <button onClick={openProfile} className={`sidebar-profile-entry${profileOpen ? ' active' : ''}`} aria-label="个人中心">
        <img src={user?.avatarUrl || defaultAvatar} alt="" />
        <span className="nav-tooltip">个人中心</span>
      </button>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} onProfileChange={() => setUser(getCloudUser())} />
    </aside>
  );
}

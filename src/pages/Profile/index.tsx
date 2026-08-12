import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Modal from '@/components/common/Modal';
import { showToast } from '@/components/common/Toast';
import defaultAvatar from '@/assets/brand/default-avatar.png';
import { changeCloudPassword, getCloudUser, logoutCloud, updateCloudProfile } from '@/lib/pocketbase';
import AppIcon from '@/components/common/AppIcon';

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { message?: string; data?: Record<string, { message?: string }> } }).response;
    const details = response?.data ? Object.values(response.data)[0]?.message : undefined;
    return details || response?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onProfileChange: () => void;
}

export default function ProfileDialog({ open, onClose, onProfileChange }: ProfileDialogProps) {
  const user = getCloudUser();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl || '');
  const [avatarFile, setAvatarFile] = useState<File | null | undefined>(undefined);
  const [savingProfile, setSavingProfile] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => () => {
    if (avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    if (!open || !user) return;
    setDisplayName(user.displayName || '');
    setAvatarPreview(user.avatarUrl || '');
    setAvatarFile(undefined);
  }, [open, user?.avatarUrl, user?.displayName]);

  if (!user) return null;

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('头像仅支持 JPG、PNG 或 WebP 图片');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('头像文件不能超过 5 MB');
      event.target.value = '';
      return;
    }
    if (avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarFile(file);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await updateCloudProfile({ displayName, avatar: avatarFile });
      setAvatarFile(undefined);
      onProfileChange();
      showToast('个人资料已保存');
    } catch (error) {
      showToast(messageOf(error, '保存个人资料失败'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;
    if (newPassword.length < 8) {
      showToast('新密码至少需要 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await changeCloudPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
      showToast('密码已修改');
    } catch (error) {
      showToast(messageOf(error, '密码修改失败，请检查当前密码'));
    } finally {
      setSavingPassword(false);
    }
  }

  function logout() {
    if (window.confirm('确定要退出当前账号吗？')) {
      logoutCloud();
      onClose();
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} width="540px" contentClassName="profile-modal-content">
      <div className="profile-dialog-shell">
        <div className="profile-dialog-header">
          <h2 className="profile-dialog-title">个人中心</h2>
          <button className="profile-dialog-close" type="button" onClick={onClose} aria-label="关闭个人中心">
            <AppIcon name="close" />
          </button>
        </div>
        <div className="profile-dialog-content">
        <form className="profile-panel" onSubmit={saveProfile}>
          <div className="profile-panel-heading">
            <h3>个人资料</h3>
          </div>
          <div className="profile-avatar-row">
            <img className="profile-avatar" src={avatarPreview || defaultAvatar} alt="当前头像" />
            <div>
              <label className="btn btn-secondary btn-sm cursor-pointer">
                更换头像
                <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectAvatar} />
              </label>
              <p className="profile-help">JPG、PNG 或 WebP，最大 5 MB</p>
              {avatarFile !== undefined && avatarPreview && (
                <button className="profile-reset-avatar" type="button" onClick={() => { if (avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview); setAvatarPreview(user.avatarUrl || ''); setAvatarFile(undefined); }}>
                  取消本次更换
                </button>
              )}
            </div>
          </div>
          <label className="profile-field">
            <span>昵称</span>
            <input className="form-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="输入你的昵称" maxLength={100} autoComplete="name" />
          </label>
          <label className="profile-field">
            <span>邮箱</span>
            <input className="form-input" value={user.email} readOnly aria-readonly="true" />
          </label>
          <div className="profile-actions"><button className="btn btn-primary" type="submit" disabled={savingProfile}>{savingProfile ? '保存中…' : '保存资料'}</button></div>
        </form>

        <section className="profile-panel profile-security-panel">
          <div className="profile-panel-heading"><h3>账号与安全</h3></div>
          <div className="profile-action-row"><div><strong>登录密码</strong><p>定期修改密码能更好地保护你的观影记录。</p></div><button className="btn btn-secondary btn-sm" onClick={() => setPasswordOpen(true)}>修改密码</button></div>
          <div className="profile-action-row profile-logout-row"><div><strong>退出登录</strong><p>退出后，本机将不再保留此账号的登录状态。</p></div><button className="btn btn-ghost btn-sm text-red-500" onClick={logout}>退出登录</button></div>
        </section>
        </div>
      </div>
      </Modal>

      <Modal open={passwordOpen} onClose={() => { if (!savingPassword) setPasswordOpen(false); }} title="修改密码" width="440px">
        <form className="profile-password-form" onSubmit={savePassword}>
          <label className="profile-field"><span>当前密码</span><input className="form-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label className="profile-field"><span>新密码</span><input className="form-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <label className="profile-field"><span>确认新密码</span><input className="form-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <div className="profile-modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setPasswordOpen(false)} disabled={savingPassword}>取消</button><button className="btn btn-primary" type="submit" disabled={savingPassword}>{savingPassword ? '修改中…' : '确认修改'}</button></div>
        </form>
      </Modal>
    </>
  );
}

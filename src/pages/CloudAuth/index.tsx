import { useState, type FormEvent } from 'react';
import appLogo from '@/assets/brand/PianKe.svg';
import { loginCloud, registerCloud } from '@/lib/pocketbase';

export default function CloudAuth() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }
    setSubmitting(true);
    try {
      if (isRegistering) {
        await registerCloud(email, password, displayName);
      } else {
        await loginCloud(email, password);
      }
    } catch (err: any) {
      const message = err?.response?.message || err?.message || '操作失败，请稍后重试';
      setError(message === 'Failed to authenticate.' ? '邮箱或密码错误' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-logo"><img src={appLogo} alt="PianKe" /></div>
        <h1 className="welcome-title">PianKe</h1>
        <p className="welcome-subtitle">登录后，你的影视记录将安全同步到私人云端</p>
        <form className="w-full max-w-[360px] mt-8 space-y-3" onSubmit={submit}>
          {isRegistering && (
            <input className="form-input w-full" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="昵称（可选）" autoComplete="name" />
          )}
          <input className="form-input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoComplete="email" required autoFocus />
          <input className="form-input w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码（至少 8 位）" autoComplete={isRegistering ? 'new-password' : 'current-password'} required minLength={8} />
          {error && <p className="text-xs text-red-500 text-left px-1">{error}</p>}
          <button className="btn btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? '请稍候…' : isRegistering ? '创建账号并进入' : '登录并进入'}
          </button>
        </form>
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => { setIsRegistering((value) => !value); setError(''); }}>
          {isRegistering ? '已有账号？去登录' : '没有账号？创建一个'}
        </button>
      </div>
      <div className="welcome-footer"><span>数据由你专属账号隔离</span><span>HTTPS 加密传输</span></div>
    </main>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import appLogo from '@/assets/brand/PianKe.svg';
import PasswordInput from '@/components/common/PasswordInput';
import { loginCloud, registerCloud, requestPasswordResetCode, requestRegisterCode, resetCloudPassword } from '@/lib/pocketbase';

type AuthMode = 'login' | 'register' | 'reset';

export default function CloudAuth() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const isRegistering = mode === 'register';
  const isResetting = mode === 'reset';

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }
    if (isResetting && password !== passwordConfirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      if (isRegistering) {
        await registerCloud(email, password, displayName, code);
      } else if (isResetting) {
        await resetCloudPassword(email, password, code);
        await loginCloud(email, password);
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

  async function sendCode() {
    if (sendingCode || codeCooldown > 0) return;
    if (!email.trim()) { setError('请先输入邮箱'); return; }
    setSendingCode(true);
    setError('');
    try {
      if (isResetting) await requestPasswordResetCode(email);
      else await requestRegisterCode(email);
      setCodeCooldown(30);
      setError(isResetting ? '如该邮箱已注册，验证码已发送，请查收邮箱' : '验证码已发送，请查收邮箱');
    } catch (err: any) {
      setError(err?.response?.message || err?.message || '验证码发送失败，请稍后重试');
    } finally {
      setSendingCode(false);
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
          {(isRegistering || isResetting) && (
            <div className="flex gap-2">
              <input className="form-input min-w-0 flex-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="邮箱验证码" autoComplete="one-time-code" required />
              <button className="btn btn-secondary whitespace-nowrap" type="button" onClick={sendCode} disabled={sendingCode || codeCooldown > 0}>{sendingCode ? '发送中…' : codeCooldown > 0 ? `${codeCooldown} 秒后重发` : '获取验证码'}</button>
            </div>
          )}
          <PasswordInput value={password} onChange={setPassword} placeholder={isResetting ? '新密码（至少 8 位）' : '密码（至少 8 位）'} autoComplete={isRegistering || isResetting ? 'new-password' : 'current-password'} required minLength={8} className="w-full" />
          {isResetting && (
            <PasswordInput value={passwordConfirm} onChange={setPasswordConfirm} placeholder="确认新密码" autoComplete="new-password" required minLength={8} className="w-full" />
          )}
          {error && <p className="text-xs text-red-500 text-left px-1">{error}</p>}
          <button className="btn btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? '请稍候…' : isRegistering ? '创建账号并进入' : isResetting ? '重置密码并登录' : '登录并进入'}
          </button>
        </form>
        <div className="mt-3 flex justify-center gap-2">
          {mode !== 'login' && <button className="btn btn-ghost btn-sm" onClick={() => { setMode('login'); setError(''); setCode(''); setPassword(''); setPasswordConfirm(''); }}>返回登录</button>}
          {mode === 'login' && <button className="btn btn-ghost btn-sm" onClick={() => { setMode('reset'); setError(''); setCode(''); setPassword(''); }}>忘记密码？</button>}
          {mode !== 'register' && <button className="btn btn-ghost btn-sm" onClick={() => { setMode('register'); setError(''); setCode(''); setPassword(''); setPasswordConfirm(''); }}>创建账号</button>}
        </div>
      </div>
      <div className="welcome-footer"><span>数据由你专属账号隔离</span><span>HTTPS 加密传输</span></div>
    </main>
  );
}

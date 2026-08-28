import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password);
      navigate((loc.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setBusy(false);
    }
  };

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
  };

  return (
    <div className="wrap auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <span className="dots"><span></span><span></span></span>
          觉等死了再睡 <small>한글단어</small>
        </div>
        <h1>{mode === 'login' ? '欢迎回来' : '创建账号'}</h1>
        <p className="auth-sub">
          {mode === 'login' ? '登录后继续你的韩语学习之旅' : '注册后学习进度与错词本独立保存'}
        </p>
        <input
          className="auth-input"
          placeholder="用户名（1-20 位中英文/数字）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          className="auth-input"
          type="password"
          placeholder={mode === 'register' ? '密码（至少 6 位）' : '密码'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {error && <div className="auth-err">{error}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录'}
        </button>
        <div className="auth-switch">
          {mode === 'login' ? (
            <>
              还没有账号？
              <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                去注册
              </button>
            </>
          ) : (
            <>
              已有账号？
              <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                去登录
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

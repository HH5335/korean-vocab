import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, authStore } from './api';
import type { AuthUser } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  /** 启动时校验 token 中 */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(authStore.getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authStore.getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((me) => {
        authStore.setAuth(authStore.getToken()!, me);
        setUser(me);
      })
      .catch(() => authStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password);
    authStore.setAuth(res.token, res.user);
    setUser(res.user);
  };

  const register = async (username: string, password: string) => {
    const res = await api.register(username, password);
    authStore.setAuth(res.token, res.user);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* 忽略退出接口错误，本地照常清除 */
    }
    authStore.clear();
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, loading, login, register, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

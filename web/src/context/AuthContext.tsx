import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import type { AuthUser } from '../api/types';

interface AuthContextValue {
  user: AuthUser | null;
  /** true enquanto consulta /api/auth/me no carregamento inicial. */
  loading: boolean;
  /** Incrementa a cada troca de conta (sinal para recarregar config/layout). */
  version: number;
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'Erro inesperado.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await api.me();
        if (active) setUser(status.user ?? null);
      } catch {
        /* sem sessão: segue anônimo */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    try {
      const result = await api.register(username, password);
      setUser(result.user);
      setVersion((v) => v + 1);
    } catch (err) {
      throw new Error(messageOf(err));
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const result = await api.login(username, password);
      setUser(result.user);
      setVersion((v) => v + 1);
    } catch (err) {
      throw new Error(messageOf(err));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* logout é idempotente */
    }
    setUser(null);
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, version, register, login, logout }),
    [user, loading, version, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return context;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import type { Dashboard } from '../api/types';
import { useRefreshInterval, useLayout } from './LayoutContext';

interface DashboardContextValue {
  data: Dashboard | null;
  loading: boolean;
  /** true quando está recarregando com dados já em tela. */
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'Erro inesperado ao carregar os dados.';
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const intervalSeconds = useRefreshInterval();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const result = await api.getDashboard();
      if (!mounted.current) return;
      setData(result);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (!mounted.current) return;
      setError(errorMessage(err));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh: pausado quando a aba está oculta.
  useEffect(() => {
    const milliseconds = Math.max(10, intervalSeconds) * 1000;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, milliseconds);
    return () => window.clearInterval(timer);
  }, [intervalSeconds, refresh]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      const age = lastUpdatedAt == null ? Number.POSITIVE_INFINITY : Date.now() - lastUpdatedAt;
      if (age >= intervalSeconds * 1000) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [intervalSeconds, lastUpdatedAt, refresh]);

  // "Tempo Real": placar atualizado a cada 20s enquanto o time está jogando
  // (60s parado, para perceber o início de um novo jogo sem pesar no servidor).
  const hasLiveMatch = Boolean(data?.live_match);
  const dashboardReady = data != null;
  useEffect(() => {
    if (!dashboardReady) return;
    const milliseconds = hasLiveMatch ? 20_000 : 60_000;
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const match = await api.getLiveMatch();
        if (cancelled || !mounted.current) return;
        setData((prev) => (prev ? { ...prev, live_match: match } : prev));
      } catch {
        /* silencioso: o dashboard mantém o último estado conhecido do jogo */
      }
    };
    const timer = window.setInterval(() => void poll(), milliseconds);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dashboardReady, hasLiveMatch]);

  const value = useMemo<DashboardContextValue>(
    () => ({ data, loading, refreshing, error, lastUpdatedAt, refresh }),
    [data, loading, refreshing, error, lastUpdatedAt, refresh],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error('useDashboard precisa estar dentro de <DashboardProvider>');
  return context;
}

/** Time do config (usado pelo header antes do dashboard carregar). */
export function useTeam() {
  const { config } = useLayout();
  const { data } = useDashboard();
  return data?.team ?? config.team;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePref } from '../api/types';
import { FALLBACK_PRIMARY, applyThemeTokens, teamThemeTokens } from '../lib/color';

export const THEME_STORAGE_KEY = 'ondejoga.theme';
export const ACCENT_STORAGE_KEY = 'ondejoga.accent';
export const DEFAULT_ACCENT = '#0093EC';

export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Preferência do usuário: system | light | dark. */
  pref: ThemePref;
  /** Tema efetivamente aplicado no `<html data-theme>`. */
  resolved: ResolvedTheme;
  setPref: (pref: ThemePref) => void;
  /** Cor do accent efetivamente em uso (manual ou derivada do time). */
  accent: string;
  setAccent: (accent: string) => void;
  /** Accent escolhido manualmente, se houver. */
  manualAccent: string | null;
  clearAccent: () => void;
  /** Cor primária do time selecionado (dera o tema automaticamente). */
  teamColor: string;
  setTeamColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function readStoredPref(): ThemePref | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
  } catch {
    return null;
  }
}

export function readStoredAccent(): string | null {
  try {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readStoredPref() ?? 'system');
  const [manualAccent, setManualAccent] = useState<string | null>(() => readStoredAccent());
  const [teamColor, setTeamColorState] = useState<string>(DEFAULT_ACCENT);
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Acompanha a preferência do sistema quando o tema é "system".
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme =
    pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  // Accent efetivo: escolha manual > cor do time.
  const accent = manualAccent ?? teamThemeTokens(teamColor, resolved).accent;

  useEffect(() => {
    const root = document.documentElement;
    // O tema inteiro deriva da cor do time (claro e escuro).
    applyThemeTokens(root, teamThemeTokens(teamColor, resolved), resolved);
    // Accent manual sobrepõe o derivado.
    root.style.setProperty('--accent', accent);
  }, [teamColor, resolved, accent]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* sem localStorage */
    }
  }, []);

  const setAccent = useCallback((next: string) => {
    setManualAccent(next);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      /* sem localStorage */
    }
  }, []);

  const clearAccent = useCallback(() => {
    setManualAccent(null);
    try {
      window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      /* sem localStorage */
    }
  }, []);

  const setTeamColor = useCallback((color: string) => {
    setTeamColorState(color || FALLBACK_PRIMARY);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      pref,
      resolved,
      setPref,
      accent,
      setAccent,
      manualAccent,
      clearAccent,
      teamColor,
      setTeamColor,
    }),
    [pref, resolved, setPref, accent, setAccent, manualAccent, clearAccent, teamColor, setTeamColor],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme precisa estar dentro de <ThemeProvider>');
  return context;
}

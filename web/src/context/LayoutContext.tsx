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
import type { AppConfig, Layout, ThemePref, WidgetSize } from '../api/types';
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '../lib/format';
import type { Notice } from '../components/ui/Toast';
import { useAuth } from './AuthContext';
import { readStoredAccent, readStoredPref, useTheme } from './ThemeContext';

/** Accent "automático": segue a cor do time. */
export const ACCENT_AUTO = 'auto';

const FALLBACK_CONFIG: AppConfig = {
  team: { name: 'OndeJoga' },
  timezone: DEFAULT_TIMEZONE,
  locale: DEFAULT_LOCALE,
  refresh_interval_seconds: 300,
};

/** Mantém os widgets ordenados por `order` e renumera de 0..n-1. */
export function normalizeLayout(layout: Layout): Layout {
  const widgets = layout.widgets
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((widget, index) => ({ ...widget, order: index }));
  return { ...layout, widgets };
}

interface LayoutContextValue {
  config: AppConfig;
  loading: boolean;
  error: string | null;
  /** Layout salvo no servidor. */
  saved: Layout | null;
  /** Rascunho local (aplicações otimistas do drawer "Personalizar"). */
  draft: Layout | null;
  dirty: boolean;
  saving: boolean;
  notice: Notice | null;
  clearNotice: () => void;
  retry: () => void;
  setWidgetVisible: (id: string, visible: boolean) => void;
  setWidgetTitle: (id: string, title: string) => void;
  setWidgetSize: (id: string, size: WidgetSize) => void;
  setWidgetOption: (id: string, key: string, value: unknown) => void;
  moveWidget: (id: string, delta: number) => void;
  reorderWidgets: (fromIndex: number, toIndex: number) => void;
  setThemeDefault: (pref: ThemePref) => void;
  setAccent: (color: string) => void;
  setRefreshInterval: (seconds: number) => void;
  save: () => Promise<boolean>;
  reset: () => Promise<boolean>;
  revert: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'Erro inesperado.';
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const { setPref, setAccent, clearAccent, setTeamColor } = useTheme();
  const { version: authVersion } = useAuth();
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [saved, setSaved] = useState<Layout | null>(null);
  const [draft, setDraft] = useState<Layout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Só adota o tema/accent do servidor quando o usuário ainda não escolheu um localmente.
  const adoptServerTheme = useRef(readStoredPref() === null && readStoredAccent() === null);

  /** `auto` (ou vazio) => accent segue a cor do time; senão usa o escolhido. */
  const applyAccent = useCallback(
    (accent: string | null | undefined) => {
      if (!accent || accent === ACCENT_AUTO) clearAccent();
      else setAccent(accent);
    },
    [clearAccent, setAccent],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const [layoutResult, configResult] = await Promise.allSettled([api.getLayout(), api.getConfig()]);
      if (!active) return;
      if (configResult.status === 'fulfilled') setConfig(configResult.value);
      if (layoutResult.status === 'fulfilled') {
        const layout = normalizeLayout(layoutResult.value);
        setSaved(layout);
        setDraft(layout);
        setError(null);
        if (adoptServerTheme.current) {
          if (layout.theme?.default) setPref(layout.theme.default);
          applyAccent(layout.theme?.accent);
        }
      } else {
        setError(errorMessage(layoutResult.reason));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // `authVersion` troca a conta => recarrega o escopo dela.
  }, [reloadToken, authVersion, setPref, applyAccent]);

  // O tema da aplicação acompanha a cor do time selecionado (claro e escuro).
  useEffect(() => {
    const primary = config?.team?.primary_color;
    if (primary) setTeamColor(primary);
  }, [config, setTeamColor]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const updateDraft = useCallback(
    (mutate: (layout: Layout) => Layout) => {
      setDraft((current) => (current ? normalizeLayout(mutate(current)) : current));
    },
    [],
  );

  const updateWidget = useCallback(
    (id: string, patch: (widget: Layout['widgets'][number]) => Layout['widgets'][number]) => {
      updateDraft((layout) => ({
        ...layout,
        widgets: layout.widgets.map((widget) => (widget.id === id ? patch(widget) : widget)),
      }));
    },
    [updateDraft],
  );

  const setWidgetVisible = useCallback(
    (id: string, visible: boolean) => updateWidget(id, (w) => ({ ...w, visible })),
    [updateWidget],
  );

  const setWidgetTitle = useCallback(
    (id: string, title: string) => updateWidget(id, (w) => ({ ...w, title })),
    [updateWidget],
  );

  const setWidgetSize = useCallback(
    (id: string, size: WidgetSize) => updateWidget(id, (w) => ({ ...w, size })),
    [updateWidget],
  );

  const setWidgetOption = useCallback(
    (id: string, key: string, value: unknown) =>
      updateWidget(id, (w) => ({ ...w, options: { ...w.options, [key]: value } })),
    [updateWidget],
  );

  const setThemeDefault = useCallback(
    (next: ThemePref) => updateDraft((layout) => ({ ...layout, theme: { ...layout.theme, default: next } })),
    [updateDraft],
  );

  const setDraftAccent = useCallback(
    (color: string) => updateDraft((layout) => ({ ...layout, theme: { ...layout.theme, accent: color } })),
    [updateDraft],
  );

  const setRefreshInterval = useCallback(
    (seconds: number) =>
      updateDraft((layout) => ({
        ...layout,
        refresh_interval_seconds: Number.isFinite(seconds) ? Math.max(10, seconds) : 300,
      })),
    [updateDraft],
  );

  const moveWidget = useCallback(
    (id: string, delta: number) => {
      updateDraft((layout) => {
        const widgets = layout.widgets.slice();
        const index = widgets.findIndex((widget) => widget.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= widgets.length) return layout;
        const [moved] = widgets.splice(index, 1);
        widgets.splice(target, 0, moved);
        return { ...layout, widgets: widgets.map((widget, i) => ({ ...widget, order: i })) };
      });
    },
    [updateDraft],
  );

  const reorderWidgets = useCallback(
    (fromIndex: number, toIndex: number) => {
      updateDraft((layout) => {
        const widgets = layout.widgets.slice();
        if (
          fromIndex < 0 ||
          fromIndex >= widgets.length ||
          toIndex < 0 ||
          toIndex >= widgets.length ||
          fromIndex === toIndex
        ) {
          return layout;
        }
        const [moved] = widgets.splice(fromIndex, 1);
        widgets.splice(toIndex, 0, moved);
        return { ...layout, widgets: widgets.map((widget, i) => ({ ...widget, order: i })) };
      });
    },
    [updateDraft],
  );

  const applyThemeLive = useCallback(
    (layout: Layout) => {
      if (layout.theme?.default) setPref(layout.theme.default);
      applyAccent(layout.theme?.accent);
    },
    [setPref, applyAccent],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    const payload: Layout = normalizeLayout(draft);
    try {
      const response = await api.putLayout(payload);
      const next = normalizeLayout(response?.widgets ? response : payload);
      setSaved(next);
      setDraft(next);
      setNotice({ tone: 'success', message: 'Personalização salva com sucesso.' });
      return true;
    } catch (err) {
      setNotice({ tone: 'error', message: `Falha ao salvar: ${errorMessage(err)}` });
      if (saved) {
        setDraft(saved);
        applyThemeLive(saved);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, saved, applyThemeLive]);

  const reset = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const layout = normalizeLayout(await api.resetLayout());
      setSaved(layout);
      setDraft(layout);
      applyThemeLive(layout);
      setNotice({ tone: 'success', message: 'Layout restaurado para o padrão.' });
      return true;
    } catch (err) {
      setNotice({ tone: 'error', message: `Falha ao restaurar: ${errorMessage(err)}` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [applyThemeLive]);

  const revert = useCallback(() => {
    if (!saved) return;
    setDraft(saved);
    applyThemeLive(saved);
    setNotice({ tone: 'info', message: 'Alterações descartadas.' });
  }, [saved, applyThemeLive]);

  const dirty = useMemo(() => {
    if (!draft || !saved) return false;
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }, [draft, saved]);

  const value = useMemo<LayoutContextValue>(
    () => ({
      config,
      loading,
      error,
      saved,
      draft,
      dirty,
      saving,
      notice,
      clearNotice,
      retry,
      setWidgetVisible,
      setWidgetTitle,
      setWidgetSize,
      setWidgetOption,
      moveWidget,
      reorderWidgets,
      setThemeDefault,
      setAccent: setDraftAccent,
      setRefreshInterval,
      save,
      reset,
      revert,
    }),
    [
      config,
      loading,
      error,
      saved,
      draft,
      dirty,
      saving,
      notice,
      clearNotice,
      retry,
      setWidgetVisible,
      setWidgetTitle,
      setWidgetSize,
      setWidgetOption,
      moveWidget,
      reorderWidgets,
      setThemeDefault,
      setDraftAccent,
      setRefreshInterval,
      save,
      reset,
      revert,
    ],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) throw new Error('useLayout precisa estar dentro de <LayoutProvider>');
  return context;
}

/** Intervalo efetivo de atualização: layout > config > 300s. */
export function useRefreshInterval(): number {
  const { draft, config } = useLayout();
  return draft?.refresh_interval_seconds ?? config.refresh_interval_seconds ?? 300;
}

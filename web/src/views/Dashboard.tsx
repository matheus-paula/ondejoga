import { useState, type CSSProperties, type ReactElement } from 'react';
import { DashboardProvider, useDashboard } from '../context/DashboardContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { Header } from '../components/layout/Header';
import { WidgetGrid } from '../components/layout/WidgetGrid';
import { SettingsDrawer } from '../components/layout/SettingsDrawer';
import { BootScreen, WelcomeGate } from '../components/layout/WelcomeGate';
import { ErrorPanel, SkeletonGrid } from '../components/ui/States';
import { Toast } from '../components/ui/Toast';

function DashboardContent({
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
}: {
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  const { config, draft, loading: layoutLoading, error: layoutError, retry: retryLayout, notice, clearNotice } =
    useLayout();
  const { data, loading: dashLoading, refreshing, error: dashError, refresh } = useDashboard();

  const team = data?.team ?? config.team;
  const style = { '--team-color': team.primary_color ?? 'var(--accent)' } as CSSProperties;

  let content: ReactElement;
  if (layoutLoading || (dashLoading && !data)) {
    content = <SkeletonGrid />;
  } else if (layoutError && !draft) {
    content = (
      <ErrorPanel
        title="Não foi possível carregar o painel"
        message={layoutError}
        onRetry={retryLayout}
      />
    );
  } else if (dashError && !data) {
    content = (
      <ErrorPanel
        title="Não foi possível carregar os dados"
        message={dashError}
        onRetry={() => void refresh()}
      />
    );
  } else {
    content = <WidgetGrid />;
  }

  return (
    <div className="app" style={style}>
      <Header onOpenSettings={onOpenSettings} />
      <main id="conteudo" className={`container${refreshing ? ' is-refreshing' : ''}`}>
        {content}
      </main>
      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} />
      <Toast notice={notice} onClose={clearNotice} />
    </div>
  );
}

export function DashboardView() {
  const { user, loading } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sem sessão confirmada ainda: só aguarda.
  if (loading) return <BootScreen />;

  // Sem conta não há painel e nem time padrão: orienta a criar/entrar.
  if (!user) return <WelcomeGate />;

  return (
    <DashboardProvider>
      <DashboardContent
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
      />
    </DashboardProvider>
  );
}

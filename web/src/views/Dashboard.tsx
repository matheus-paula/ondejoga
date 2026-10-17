import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { DashboardProvider, useDashboard } from '../context/DashboardContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { Header } from '../components/layout/Header';
import { WidgetGrid } from '../components/layout/WidgetGrid';
import { AuthModal } from '../components/layout/AuthModal';
import { BootScreen, WelcomeGate } from '../components/layout/WelcomeGate';
import { ErrorPanel, SkeletonGrid } from '../components/ui/States';
import { Toast } from '../components/ui/Toast';

function DashboardContent() {
  const { config, draft, loading: layoutLoading, error: layoutError, retry: retryLayout, notice, clearNotice } =
    useLayout();
  const { data, loading: dashLoading, refreshing, error: dashError, refresh } = useDashboard();

  const team = data?.team ?? config.team;
  const style = { '--team-color': team.primary_color ?? 'var(--accent)' } as CSSProperties;

  let content: ReactElement;
  if (layoutLoading || (dashLoading && !data)) {
    // Quando só falta o dashboard, o layout já define o formato da grade —
    // passa para o esqueleto repetir o que vai aparecer.
    content = <SkeletonGrid widgets={draft?.widgets} />;
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
    <div className="flex flex-1 flex-col" style={style}>
      <Header />
      <main
        id="conteudo"
        className={
          refreshing
            ? 'mx-auto w-[min(1240px,100%-32px)] flex-1 pt-[22px] pb-12 opacity-[0.82] transition-opacity'
            : 'mx-auto w-[min(1240px,100%-32px)] flex-1 pt-[22px] pb-12'
        }
      >
        {content}
      </main>
      <Toast notice={notice} onClose={clearNotice} />
    </div>
  );
}

/**
 * Tela do painel: portão sem conta, onboarding de time e o painel em si.
 *
 * O modal de conta mora aqui (e não no portão) porque, depois do registro, o
 * portão some e o modal precisa **continuar aberto** no passo obrigatório de
 * escolher o time.
 */
export function DashboardView() {
  const { user, loading, version: authVersion } = useAuth();
  const { config, loading: configLoading, loadedVersion, retry: retryLayout } = useLayout();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  // Evita o "flash" do portão enquanto a config recarrega após escolher o time.
  const [teamChosen, setTeamChosen] = useState(false);
  // Remonta o provider => refaz o dashboard com o time novo.
  const [teamVersion, setTeamVersion] = useState(0);

  // Troca de conta (entrar/sair) zera a memória da escolha desta sessão.
  useEffect(() => {
    setTeamChosen(false);
  }, [authVersion]);

  // Identidade estável: o AuthModal usa `onClose` nos deps do efeito que reseta
  // o passo ao abrir — um callback novo a cada render faria o passo de time
  // voltar para o formulário logo depois do registro.
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  // Sem sessão confirmada ainda: só aguarda.
  if (loading) return <BootScreen />;

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const handleTeamSet = () => {
    setTeamChosen(true);
    setTeamVersion((version) => version + 1);
    retryLayout(); // recarrega a config: `owned` passa a true
  };

  // A config atual só vale se for da conta da sessão (no F5 o primeiro load é
  // anônimo; o AuthContext bumpa `version` quando a sessão é resolvida).
  const scopeReady = !configLoading && loadedVersion === authVersion;
  // Conta nova/trocada com config ainda carregando: não decide nada ainda.
  const waitingScope = Boolean(user) && !teamChosen && !scopeReady;
  // Conta logada sem time escolhido (registro interrompido ou conta antiga):
  // o portão `teamOnly` cobra a escolha **antes** de montar o painel.
  const needsTeam = Boolean(user) && !teamChosen && scopeReady && config.owned === false;
  // O portão só fala sozinho quando o modal de conta não está aberto.
  const gateOpen = needsTeam && !authOpen;

  return (
    <>
      {!user ? (
        <WelcomeGate onOpenAuth={openAuth} />
      ) : waitingScope || needsTeam ? (
        // escopo carregando ou ainda sem time: não busca dados de um time que
        // ninguém escolheu
        <BootScreen />
      ) : (
        <DashboardProvider key={teamVersion}>
          <DashboardContent />
        </DashboardProvider>
      )}

      <AuthModal
        open={authOpen || gateOpen}
        teamOnly={gateOpen}
        initialMode={authMode}
        onClose={closeAuth}
        onTeamSet={handleTeamSet}
      />
    </>
  );
}

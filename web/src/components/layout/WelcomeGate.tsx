import { Icon, type IconName } from '../ui/Icon';

type Mode = 'login' | 'register';

const HIGHLIGHTS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'trophy',
    title: 'Só o seu time',
    text: 'Próximo jogo, último resultado, tabelas, estatísticas e notícias do time que você escolher.',
  },
  {
    icon: 'layoutGrid',
    title: 'Painel seu',
    text: 'Cada conta guarda o próprio layout, cores, tema e fontes de dados — nada é compartilhado.',
  },
  {
    icon: 'newspaper',
    title: 'Sempre atualizado',
    text: 'Jogos, placares e classificações puxados automaticamente das fontes configuradas.',
  },
];

/**
 * Portão de boas-vindas: aparece quando **ninguém** está logado.
 *
 * Sem conta não há time padrão nem painel — o visitante é orientado a criar
 * uma conta (ou entrar) antes de qualquer coisa. O modal de conta fica com o
 * `DashboardView` (ele precisa sobreviver ao registro para cobrar o time).
 */
export function WelcomeGate({ onOpenAuth }: { onOpenAuth: (mode: Mode) => void }) {
  const openAuth = (next: Mode) => onOpenAuth(next);

  return (
    <div className="welcome" data-testid="welcome-gate">
      <div className="welcome-panel">
        <p className="welcome-brand">
          <Icon name="trophy" size={20} />
          OndeJoga
        </p>

        <h1 className="welcome-title">Crie a sua conta para começar</h1>
        <p className="welcome-lead">
          O OndeJoga monta um painel completo em torno do <strong>seu</strong> time. Para isso,
          precisamos de uma conta: é ela que guarda o time escolhido, o layout, o tema e as fontes
          de dados — tudo privado, só seu.
        </p>

        <ul className="welcome-highlights">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title}>
              <span className="welcome-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn btn--primary btn--large"
            data-testid="welcome-register"
            onClick={() => openAuth('register')}
          >
            <Icon name="userPlus" size={16} />
            Criar conta
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--large"
            data-testid="welcome-login"
            onClick={() => openAuth('login')}
          >
            <Icon name="logIn" size={16} />
            Já tenho conta
          </button>
        </div>

        <p className="welcome-note muted">
          Sua conta fica somente neste servidor — nenhuma terceira parte envolvida.
        </p>
      </div>
    </div>
  );
}

/** Tela de carregamento enquanto a sessão é verificada. */
export function BootScreen() {
  return (
    <div className="welcome welcome--boot" data-testid="boot-screen" aria-busy="true">
      <p className="welcome-brand">
        <Icon name="trophy" size={20} />
        OndeJoga
      </p>
      <p className="muted">Verificando sessão…</p>
    </div>
  );
}

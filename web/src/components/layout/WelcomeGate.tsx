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

/* Tela cheia, com o fundo sendo a cor do tema e um halo do acento saindo de
   cima. O halo é `background` (não `background-image`) porque o `var(--bg)`
   vai na mesma declaração, como última camada. */
const SCREEN =
  'grid place-items-center px-5 py-8 bg-no-repeat ' +
  '[background:radial-gradient(1100px_520px_at_50%_-10%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_70%),var(--bg)]';

const PANEL =
  'w-[min(680px,100%)] rounded-2xl border border-line bg-surface ' +
  'p-[clamp(24px,5vw,44px)] text-center shadow-[0_24px_60px_rgb(0_0_0/0.16)]';

const HIGHLIGHT =
  'flex items-start gap-3 rounded-[12px] border border-line bg-surface-2 px-3.5 py-3';

const HIGHLIGHT_ICON =
  'flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full ' +
  'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent';

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
    <div className={`min-h-dvh ${SCREEN}`} data-testid="welcome-gate">
      <div className={PANEL}>
        <p className="inline-flex items-center gap-2 text-[1.05rem] font-extrabold tracking-[0.02em] text-accent">
          <Icon name="trophy" size={20} />
          OndeJoga
        </p>

        <h1 className="mt-[14px] mb-[10px] text-[clamp(1.5rem,4vw,2.1rem)] leading-[1.15]">
          Crie a sua conta para começar
        </h1>
        <p className="mx-auto max-w-[54ch] leading-[1.6] text-muted">
          O OndeJoga monta um painel completo em torno do <strong>seu</strong> time. Para isso,
          precisamos de uma conta: é ela que guarda o time escolhido, o layout, o tema e as fontes
          de dados — tudo privado, só seu.
        </p>

        <ul className="my-[26px] grid list-none gap-3 p-0 text-left">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title} className={HIGHLIGHT}>
              <span className={HIGHLIGHT_ICON}>
                <Icon name={item.icon} size={18} />
              </span>
              {/* Grade de 3px só para separar o título da descrição. */}
              <span className="grid gap-[3px]">
                <strong className="text-[0.95rem]">{item.title}</strong>
                <span className="text-[0.88rem] leading-[1.45] text-muted">{item.text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap justify-center gap-3">
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

        <p className="mt-[18px] text-[0.82rem] text-muted">
          Sua conta fica somente neste servidor — nenhuma terceira parte envolvida.
        </p>
      </div>
    </div>
  );
}

/** Tela de carregamento enquanto a sessão é verificada. */
export function BootScreen() {
  return (
    <div
      className={`min-h-dvh content-center gap-2.5 ${SCREEN}`}
      data-testid="boot-screen"
      aria-busy="true"
    >
      <p className="inline-flex items-center gap-2 text-[1.05rem] font-extrabold tracking-[0.02em] text-accent">
        <Icon name="trophy" size={20} />
        OndeJoga
      </p>
      <p className="text-muted">Verificando sessão…</p>
    </div>
  );
}

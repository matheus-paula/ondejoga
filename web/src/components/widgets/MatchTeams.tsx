import type { MatchTeam } from '../../api/types';

/* ------------------------------------------------------------------------ */
/* Chrome comum aos cartões de jogo (Tempo Real, Último Jogo, Próximo Jogo).  */
/* São as mesmas peças nos três, então moram aqui junto da linha dos times.   */

/** Linha de topo: competição de um lado, selo do resultado do outro. */
export const MATCH_TOP = 'flex flex-wrap items-center justify-between gap-2.5';

/** Competição + rodada, sempre acompanhada do escudo pequeno. */
export const COMPETITION =
  'flex items-center gap-2 text-muted text-[0.88rem] font-semibold';
export const ROUND = 'text-ink';

/** Lista de detalhes (data, horário, local) em pares dt/dd. */
export const META = 'm-0 flex flex-wrap gap-x-[22px] gap-y-2.5';
export const META_DT = 'text-[0.74rem] uppercase tracking-[0.07em] text-muted';
/** `dd` tem margem lateral por padrão no navegador; zero aqui. */
export const META_DD = 'm-0 font-semibold';


/**
 * Escudo padrão dos cartões de jogo: 44px em todos os widgets.
 *
 * Sem imagem cai no placeholder circular — o mesmo espaço, para a linha do
 * jogo não pular quando a fonte não devolve o arquivo.
 */
export function Crest({ team, lazy = false }: { team: MatchTeam; lazy?: boolean }) {
  return team.logo ? (
    <img
      src={team.logo}
      alt=""
      width={44}
      height={44}
      data-testid="team-crest"
      className="h-11 w-11 flex-none object-contain"
      loading={lazy ? 'lazy' : undefined}
    />
  ) : (
    <span
      data-testid="team-crest"
      aria-hidden="true"
      className="inline-block h-11 w-11 rounded-full border border-line bg-surface-2"
    />
  );
}

/**
 * Linha padronizada dos jogos: `[escudo] Mando  2 × 0  Afora [escudo]`.
 *
 * Usada por "Próximo Jogo", "Último Jogo" e "Tempo Real" — mesmo tamanho de
 * escudo e o placar sempre ao lado do "×" (nunca junto ao nome do clube).
 */
export function MatchTeams({
  home,
  away,
  showScore = false,
}: {
  home: MatchTeam;
  away: MatchTeam;
  /** Exibe o placar colado ao "×" (usado em "Último Jogo" e "Tempo Real"). */
  showScore?: boolean;
}) {
  const hasScore = showScore && (home.score != null || away.score != null);
  return (
    <div
      data-testid="match-teams"
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Crest team={home} />
        <span data-testid="team-name" className="font-bold text-[1.02rem] [overflow-wrap:anywhere]">
          {home.name}
        </span>
      </div>

      <div data-testid="match-score" className="inline-flex items-center justify-center gap-2">
        {hasScore ? (
          <strong data-testid="score-value" className="text-[1.9rem] font-extrabold tabular-nums leading-none">
            {home.score ?? '–'}
          </strong>
        ) : null}
        <span className="text-[1.5rem] text-muted">
          <span aria-hidden="true">×</span>
          <span className="sr-only">contra</span>
        </span>
        {hasScore ? (
          <strong data-testid="score-value" className="text-[1.9rem] font-extrabold tabular-nums leading-none">
            {away.score ?? '–'}
          </strong>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
        <span data-testid="team-name" className="font-bold text-[1.02rem] [overflow-wrap:anywhere]">
          {away.name}
        </span>
        <Crest team={away} lazy />
      </div>
    </div>
  );
}

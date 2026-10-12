import type { MatchTeam } from '../../api/types';

/** Escudo padrão dos cartões de jogo (44px em todos os widgets). */
export function Crest({ team, lazy = false }: { team: MatchTeam; lazy?: boolean }) {
  return team.logo ? (
    <img
      src={team.logo}
      alt=""
      width={44}
      height={44}
      className="match-team-crest"
      loading={lazy ? 'lazy' : undefined}
    />
  ) : (
    <span className="match-team-crest match-team-crest--placeholder" aria-hidden="true" />
  );
}

interface MatchTeamsProps {
  home: MatchTeam;
  away: MatchTeam;
  /** Exibe o placar colado ao "×" (usado em "Último Jogo" e "Tempo Real"). */
  showScore?: boolean;
  className?: string;
}

/**
 * Linha padronizada dos jogos: `[escudo] Mando  2 × 0  Afora [escudo]`.
 *
 * Usada por "Próximo Jogo", "Último Jogo" e "Tempo Real" — mesmo tamanho de
 * escudo e o placar sempre ao lado do "×" (nunca junto ao nome do clube).
 */
export function MatchTeams({ home, away, showScore = false, className }: MatchTeamsProps) {
  const hasScore = showScore && (home.score != null || away.score != null);
  return (
    <div className={className ? `match-teams ${className}` : 'match-teams'}>
      <div className="match-team match-team--left">
        <Crest team={home} />
        <span className="match-team-name">{home.name}</span>
      </div>
      <div className="match-score">
        {hasScore ? (
          <strong className="match-score-value">{home.score ?? '–'}</strong>
        ) : null}
        <span className="match-vs">
          <span aria-hidden="true">×</span>
          <span className="sr-only">contra</span>
        </span>
        {hasScore ? (
          <strong className="match-score-value">{away.score ?? '–'}</strong>
        ) : null}
      </div>
      <div className="match-team match-team--right">
        <span className="match-team-name">{away.name}</span>
        <Crest team={away} lazy />
      </div>
    </div>
  );
}

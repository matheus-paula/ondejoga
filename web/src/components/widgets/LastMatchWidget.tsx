import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { MatchTeams } from './MatchTeams';
import { formatDateTime, RESULT_LABEL, resultFromOurPerspective } from '../../lib/format';
import type { WidgetProps } from './types';

/** Widget "Último Jogo": placar final, competição, data, local e selo V/E/D. */
export function LastMatchWidget({ widget, data, config }: WidgetProps) {
  const match = data.last_match ?? null;
  const { locale, timezone } = config;
  const result = match ? resultFromOurPerspective(match.home, match.away, data.team) : null;

  return (
    <WidgetShell title={widget.title || 'Último Jogo'} className="last-match">
      {!match ? (
        <EmptyState message="Nenhum jogo finalizado encontrado." />
      ) : (
        <>
          <div className="last-match-topline">
            <p className="match-competition">
              {match.competition?.logo ? (
                <img src={match.competition.logo} alt="" width={18} height={18} />
              ) : null}
              <span>
                {match.competition?.name ?? 'Competição a definir'}
                {match.round ? <span className="match-round"> · Rodada {match.round}</span> : null}
              </span>
            </p>
            {result ? (
              <span className={`result-badge result-badge--${result.toLowerCase()}`}>
                {RESULT_LABEL[result]}
              </span>
            ) : null}
          </div>

          <MatchTeams home={match.home} away={match.away} showScore />
          <p className="last-match-caption">Placar final</p>

          <dl className="match-meta">
            <div className="match-meta-item">
              <dt>Data</dt>
              <dd>
                <time dateTime={match.finished_at ?? undefined}>
                  {formatDateTime(match.finished_at, locale, timezone)}
                </time>
              </dd>
            </div>
            <div className="match-meta-item">
              <dt>Local</dt>
              <dd>
                {match.venue?.name
                  ? [match.venue.name, match.venue.city].filter(Boolean).join(' · ')
                  : 'Estádio a definir'}
              </dd>
            </div>
          </dl>
        </>
      )}
    </WidgetShell>
  );
}

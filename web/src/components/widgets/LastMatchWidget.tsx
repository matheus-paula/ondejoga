import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { MatchTeams, MATCH_TOP, COMPETITION, ROUND, META, META_DT, META_DD } from './MatchTeams';
import { formatDateTime, RESULT_LABEL, resultFromOurPerspective } from '../../lib/format';
import type { WidgetProps } from './types';

/** Tom do selo V/E/D. O empate é o único com borda — era assim no original. */
const RESULT_TONE: Record<string, string> = {
  v: 'text-success bg-success-soft',
  e: 'text-muted bg-surface-2 border border-line',
  d: 'text-danger bg-danger-soft',
};

/** Widget "Último Jogo": placar final, competição, data, local e selo V/E/D. */
export function LastMatchWidget({ widget, data, config }: WidgetProps) {
  const match = data.last_match ?? null;
  const { locale, timezone } = config;
  const result = match ? resultFromOurPerspective(match.home, match.away, data.team) : null;

  return (
    <WidgetShell title={widget.title || 'Último Jogo'} widget="last-match">
      {!match ? (
        <EmptyState message="Nenhum jogo finalizado encontrado." />
      ) : (
        <>
          <div className={MATCH_TOP}>
            <p className={COMPETITION}>
              {match.competition?.logo ? (
                <img src={match.competition.logo} alt="" width={18} height={18} />
              ) : null}
              <span>
                {match.competition?.name ?? 'Competição a definir'}
                {match.round ? <span className={ROUND}> · Rodada {match.round}</span> : null}
              </span>
            </p>
            {result ? (
              <span
                className={`rounded-full px-3 py-1 text-[0.78rem] font-extrabold uppercase tracking-[0.05em] ${RESULT_TONE[result.toLowerCase()] ?? ''}`}
              >
                {RESULT_LABEL[result]}
              </span>
            ) : null}
          </div>

          <MatchTeams home={match.home} away={match.away} showScore />
          <p className="text-center text-[0.8rem] uppercase tracking-[0.07em] text-muted">
            Placar final
          </p>

          <dl className={META}>
            <div>
              <dt className={META_DT}>Data</dt>
              <dd className={META_DD}>
                <time dateTime={match.finished_at ?? undefined}>
                  {formatDateTime(match.finished_at, locale, timezone)}
                </time>
              </dd>
            </div>
            <div>
              <dt className={META_DT}>Local</dt>
              <dd className={META_DD}>
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

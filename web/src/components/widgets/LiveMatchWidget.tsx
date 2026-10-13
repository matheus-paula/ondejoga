import { WidgetShell } from './WidgetShell';
import { MatchTeams, MATCH_TOP, COMPETITION, ROUND } from './MatchTeams';
import { optBool } from '../../lib/widgetOptions';
import type { WidgetProps } from './types';

/**
 * Widget "Tempo Real": aparece apenas enquanto o time está em campo.
 *
 * O `WidgetGrid` o remove quando não há `data.live_match`; aqui devolvemos
 * `null` por segurança — o jogo pode terminar entre um refresh e outro.
 */
export function LiveMatchWidget({ widget, data }: WidgetProps) {
  const match = data.live_match ?? null;
  if (!match) return null;

  const showStatus = optBool(widget.options, 'show_status', true);
  const showVenue = optBool(widget.options, 'show_venue', true);

  return (
    <WidgetShell title={widget.title || 'Tempo Real'} widget="live-match">
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
        <span
          data-testid="live-badge"
          className="inline-flex items-center gap-[7px] rounded-full bg-danger-soft px-3 py-1 text-[0.76rem] font-extrabold uppercase tracking-[0.06em] text-danger"
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current animate-live-pulse" />
          Ao vivo
        </span>
      </div>

      <MatchTeams home={match.home} away={match.away} showScore />

      {showStatus && match.status ? (
        <p data-testid="live-status" className="text-center font-extrabold text-danger">
          {match.status}
        </p>
      ) : null}

      {showVenue && match.venue?.name ? (
        <p data-testid="live-venue" className="text-center text-[0.85rem] text-muted">
          {[match.venue.name, match.venue.city].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </WidgetShell>
  );
}

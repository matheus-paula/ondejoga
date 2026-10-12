import { WidgetShell } from './WidgetShell';
import { MatchTeams } from './MatchTeams';
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
    <WidgetShell title={widget.title || 'Tempo Real'} className="live-match">
      <div className="live-topline">
        <p className="match-competition">
          {match.competition?.logo ? (
            <img src={match.competition.logo} alt="" width={18} height={18} />
          ) : null}
          <span>
            {match.competition?.name ?? 'Competição a definir'}
            {match.round ? <span className="match-round"> · Rodada {match.round}</span> : null}
          </span>
        </p>
        <span className="live-badge" data-testid="live-badge">
          <span className="live-dot" aria-hidden="true" />
          Ao vivo
        </span>
      </div>

      <MatchTeams home={match.home} away={match.away} showScore />

      {showStatus && match.status ? <p className="live-status">{match.status}</p> : null}

      {showVenue && match.venue?.name ? (
        <p className="live-venue">
          {[match.venue.name, match.venue.city].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </WidgetShell>
  );
}

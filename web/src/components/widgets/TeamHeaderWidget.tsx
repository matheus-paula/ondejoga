import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { ordinalPosition } from '../../lib/format';
import type { WidgetProps } from './types';

/** Cartão "hero" do time: escudo, nome, cidade e posição na competição principal. */
export function TeamHeaderWidget({ widget, data, config }: WidgetProps) {
  const team = data.team ?? config.team;
  const season = data.stats?.season ?? null;
  const location = [team.city, team.state].filter(Boolean).join(' · ');

  return (
    <WidgetShell title={widget.title} className="team-hero">
      <div className="team-hero-inner">
        {team.logo ? (
          <img
            className="team-hero-crest"
            src={team.logo}
            alt={`Escudo do ${team.name}`}
            width={80}
            height={80}
          />
        ) : (
          <span className="team-hero-crest team-hero-crest--placeholder" aria-hidden="true" />
        )}
        <div className="team-hero-info">
          <h3 className="team-hero-name">{team.name}</h3>
          {location ? <p className="team-hero-city">{location}</p> : null}
          {season ? (
            <p className="team-hero-record">
              <strong>{ordinalPosition(season.position)}</strong> lugar
              {season.competition ? <> em {season.competition}</> : null} ·{' '}
              <strong>
                {season.points} ponto{season.points === 1 ? '' : 's'}
              </strong>{' '}
              em {season.played} jogo{season.played === 1 ? '' : 's'}
            </p>
          ) : (
            <EmptyState message="Sem dados da temporada no momento." />
          )}
        </div>
      </div>
    </WidgetShell>
  );
}

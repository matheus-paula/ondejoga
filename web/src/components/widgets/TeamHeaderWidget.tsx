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
    <WidgetShell title={widget.title} widget="team-hero">
      <div className="flex items-center gap-[18px]">
        {team.logo ? (
          <img
            className="h-20 w-20 flex-none object-contain"
            src={team.logo}
            alt={`Escudo do ${team.name}`}
            width={80}
            height={80}
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-20 w-20 flex-none rounded-full bg-accent opacity-85"
          />
        )}
        <div>
          <h3 className="text-[1.5rem] font-extrabold">{team.name}</h3>
          {location ? <p className="text-muted">{location}</p> : null}
          {season ? (
            <p data-testid="team-record" className="mt-1.5">
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

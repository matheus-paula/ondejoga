import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { BarChart, buildMetrics, RecentForm, STATS_GRID, STATS_CELL, STATS_SUBTITLE, SCORERS_TABLE } from './StatsWidget';
import { ordinalPosition } from '../../lib/format';
import { optBool, optStringArray } from '../../lib/widgetOptions';
import type { Stats } from '../../api/types';
import type { WidgetProps } from './types';

const SCORER_HEAD =
  'px-2 py-[7px] border-b border-line text-right text-muted text-[0.74rem] uppercase';
const SCORER_CELL = 'px-2 py-[7px] border-b border-line text-right';

/**
 * Widget "Meu Time": identidade do clube + todas as estatísticas.
 *
 * Substitui os antigos widgets `team_header` e `stats` (que continuam
 * funcionando em layouts antigos), reunidos num cartão só.
 *
 * Os blocos de estatística vêm prontos do `StatsWidget` — o cartão "Meu Time"
 * é o mesmo conteúdo, só que com o cabeçalho do clube no topo.
 */
export function MyTeamWidget({ widget, data, config }: WidgetProps) {
  const team = data.team ?? config.team;
  const stats = data.stats ?? null;
  const location = [team.city, team.state].filter(Boolean).join(' · ');
  const showChart = optBool(widget.options, 'show_chart', true);
  const showTopScorers = optBool(widget.options, 'show_top_scorers', true);
  const selected = optStringArray(widget.options, 'metrics');

  const season = stats?.season ?? null;
  const hasStats = Boolean(stats);
  const metrics = hasStats
    ? buildMetrics(stats as Stats).filter(
        (metric) => selected.length === 0 || selected.includes(metric.key),
      )
    : [];
  const scored = stats?.goals_scored ?? season?.goals_for ?? 0;
  const conceded = stats?.goals_conceded ?? season?.goals_against ?? 0;
  const recent = (stats?.recent_form ?? []).slice(0, 10);
  const scorers = stats?.top_scorers ?? [];

  return (
    <WidgetShell title={widget.title || 'Meu Time'} widget="my-team">
      {/* Filete separando a identidade do clube das estatísticas embaixo. */}
      <div className="flex items-center gap-[18px] border-b border-line pb-[14px] mb-[14px]">
        {team.logo ? (
          <img
            className="h-16 w-16 flex-none object-contain"
            src={team.logo}
            alt={`Escudo do ${team.name}`}
            width={72}
            height={72}
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-16 w-16 flex-none rounded-full bg-accent opacity-85"
          />
        )}
        <div className="min-w-0">
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
          ) : null}
        </div>
      </div>

      {!hasStats && !season ? (
        <EmptyState message="Sem estatísticas disponíveis." />
      ) : (
        <>
          {metrics.length > 0 ? (
            <dl className={`${STATS_GRID} mb-1`}>
              {metrics.map((metric) => (
                <div className={STATS_CELL} key={metric.key}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {showChart ? (
            <>
              <h3 className={`${STATS_SUBTITLE} mt-[18px]`}>Gols na temporada</h3>
              <BarChart scored={scored} conceded={conceded} />
            </>
          ) : null}

          {recent.length > 0 ? (
            <>
              <h3 className={`${STATS_SUBTITLE} mt-[18px]`}>Forma recente</h3>
              <RecentForm entries={recent} />
            </>
          ) : null}

          {showTopScorers && scorers.length > 0 ? (
            <>
              <h3 className={`${STATS_SUBTITLE} mt-[18px]`}>Artilheiros</h3>
              <table data-testid="scorers-table" className={SCORERS_TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={SCORER_HEAD}>
                      Jogador
                    </th>
                    <th scope="col" title="Gols" className={SCORER_HEAD}>
                      G
                    </th>
                    <th scope="col" title="Assistências" className={SCORER_HEAD}>
                      A
                    </th>
                    <th scope="col" title="Jogos" className={SCORER_HEAD}>
                      J
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scorers.map((scorer) => (
                    <tr key={scorer.name}>
                      <th scope="row" className={SCORER_CELL}>
                        {scorer.name}
                      </th>
                      <td className={SCORER_CELL}>{scorer.goals}</td>
                      <td className={SCORER_CELL}>{scorer.assists ?? 0}</td>
                      <td className={SCORER_CELL}>{scorer.matches ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {!season && metrics.length === 0 && recent.length === 0 && scorers.length === 0 ? (
            <p className="text-muted">Sem dados da temporada no momento.</p>
          ) : null}
        </>
      )}
    </WidgetShell>
  );
}

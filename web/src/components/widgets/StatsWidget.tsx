import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { formLetter, ordinalPosition, percent, RESULT_LABEL } from '../../lib/format';
import { optBool, optStringArray, type StatsMetricKey } from '../../lib/widgetOptions';
import type { Stats } from '../../api/types';
import type { WidgetProps } from './types';

interface Metric {
  key: StatsMetricKey;
  label: string;
  value: string;
}

/** Métricas calculadas a partir das estatísticas da temporada. */
export function buildMetrics(stats: Stats): Metric[] {
  const season = stats.season ?? null;
  if (!season) return [];
  const played = season.played ?? 0;
  const winRate = played > 0 ? season.points / (played * 3) : 0;
  const avgGoals =
    stats.avg_goals_scored != null
      ? stats.avg_goals_scored
      : played > 0
        ? season.goals_for / played
        : 0;
  const metrics: Metric[] = [
    { key: 'position', label: 'Posição', value: ordinalPosition(season.position) },
    { key: 'points', label: 'Pontos', value: String(season.points) },
    { key: 'played', label: 'Jogos', value: String(played) },
    {
      key: 'record',
      label: 'V-E-D',
      value: `${season.won}-${season.drawn}-${season.lost}`,
    },
    { key: 'goals_for', label: 'Gols marcados', value: String(season.goals_for) },
    { key: 'goals_against', label: 'Gols sofridos', value: String(season.goals_against) },
    {
      key: 'goal_difference',
      label: 'Saldo de gols',
      value: `${season.goal_difference > 0 ? '+' : ''}${season.goal_difference}`,
    },
    { key: 'win_rate', label: 'Aproveitamento', value: percent(winRate) },
    { key: 'avg_goals', label: 'Média de gols', value: avgGoals.toFixed(2) },
    { key: 'clean_sheets', label: 'Sem sofrer gol', value: String(stats.clean_sheets ?? 0) },
  ];
  return metrics;
}

/** Barras comparando gols marcados x sofridos. */
export function BarChart({ scored, conceded }: { scored: number; conceded: number }) {
  const max = Math.max(scored, conceded, 1);
  return (
    <div
      className="goals-chart"
      role="img"
      aria-label={`Gráfico de gols: marcados ${scored}, sofridos ${conceded}.`}
    >
      <div className="chart-row">
        <span className="chart-label">Marcados</span>
        <span className="chart-track">
          <span
            className="chart-fill chart-fill--for"
            style={{ width: `${Math.round((scored / max) * 100)}%` }}
          />
        </span>
        <span className="chart-value">{scored}</span>
      </div>
      <div className="chart-row">
        <span className="chart-label">Sofridos</span>
        <span className="chart-track">
          <span
            className="chart-fill chart-fill--against"
            style={{ width: `${Math.round((conceded / max) * 100)}%` }}
          />
        </span>
        <span className="chart-value">{conceded}</span>
      </div>
    </div>
  );
}

/** Widget "Estatísticas": métricas da temporada, gráfico de gols, forma recente e artilheiros. */
export function StatsWidget({ widget, data }: WidgetProps) {
  const stats = data.stats ?? null;
  const selected = optStringArray(widget.options, 'metrics');
  const showTopScorers = optBool(widget.options, 'show_top_scorers', true);

  if (!stats) {
    return (
      <WidgetShell title={widget.title || 'Estatísticas'} className="stats">
        <EmptyState message="Sem estatísticas disponíveis." />
      </WidgetShell>
    );
  }

  const metrics = buildMetrics(stats).filter(
    (metric) => selected.length === 0 || selected.includes(metric.key),
  );
  const scored = stats.goals_scored ?? stats.season?.goals_for ?? 0;
  const conceded = stats.goals_conceded ?? stats.season?.goals_against ?? 0;
  const recent = (stats.recent_form ?? []).slice(0, 10);
  const scorers = stats.top_scorers ?? [];

  return (
    <WidgetShell title={widget.title || 'Estatísticas'} className="stats">
      {metrics.length > 0 ? (
        <dl className="stats-grid">
          {metrics.map((metric) => (
            <div className="stats-cell" key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <h3 className="stats-subtitle">Gols na temporada</h3>
      <BarChart scored={scored} conceded={conceded} />

      {recent.length > 0 ? (
        <>
          <h3 className="stats-subtitle">Forma recente</h3>
          <ul className="recent-form">
            {recent.map((entry) => {
              const result = formLetter(entry.result ?? '');
              return (
                <li
                  key={entry.id}
                  className={`recent-chip${result ? ` recent-chip--${result.toLowerCase()}` : ' recent-chip--unknown'}`}
                  title={`${entry.opponent ?? 'Adversário'}${entry.score ? ` ${entry.score}` : ''}${result ? ` — ${RESULT_LABEL[result]}` : ''}`}
                >
                  <span className="recent-chip-result">{result ?? '?'}</span>
                  {entry.score ? <span className="recent-chip-score">{entry.score}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {showTopScorers && scorers.length > 0 ? (
        <>
          <h3 className="stats-subtitle">Artilheiros</h3>
          <table className="scorers-table">
            <thead>
              <tr>
                <th scope="col">Jogador</th>
                <th scope="col" title="Gols">
                  G
                </th>
                <th scope="col" title="Assistências">
                  A
                </th>
                <th scope="col" title="Jogos">
                  J
                </th>
              </tr>
            </thead>
            <tbody>
              {scorers.map((scorer) => (
                <tr key={scorer.name}>
                  <th scope="row">{scorer.name}</th>
                  <td>{scorer.goals}</td>
                  <td>{scorer.assists ?? 0}</td>
                  <td>{scorer.matches ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </WidgetShell>
  );
}

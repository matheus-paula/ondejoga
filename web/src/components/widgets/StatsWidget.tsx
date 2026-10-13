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

/** Cabeçalho e célula da tabela de artilheiros (compartilhados por linha e coluna). */
const SCORER_HEAD =
  'px-2 py-[7px] border-b border-line text-right text-muted text-[0.74rem] uppercase';
const SCORER_CELL = 'px-2 py-[7px] border-b border-line text-right';

/** Bloco de estatística: rótulo em cima, valor grande embaixo. */
export const STATS_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5 m-0';
export const STATS_CELL =
  'bg-surface-2 border border-line rounded-ctl p-2.5 text-center ' +
  '[&_dt]:text-muted [&_dt]:text-[0.72rem] [&_dt]:uppercase [&_dt]:tracking-[0.05em] ' +
  '[&_dd]:mt-1 [&_dd]:text-[1.3rem] [&_dd]:font-extrabold [&_dd]:tabular-nums';
/** Título de seção dentro do cartão de estatísticas. */
export const STATS_SUBTITLE = 'text-[0.85rem] uppercase tracking-[0.06em] text-muted';
/** Tabela de artilheiros: o descendente cobre `thead` e a última linha, que
    fica sem borda para a tabela não terminar em fio solto. */
export const SCORERS_TABLE =
  'w-full border-collapse text-[0.88rem] ' +
  '[&_thead_th]:text-muted [&_thead_th]:text-[0.74rem] [&_thead_th]:uppercase ' +
  '[&_tbody_tr:last-child>*]:border-b-0 ' +
  '[&_th:first-child]:text-left [&_td:first-child]:text-left';

/** Barras comparando gols marcados x sofridos. */
export function BarChart({ scored, conceded }: { scored: number; conceded: number }) {
  const max = Math.max(scored, conceded, 1);
  return (
    <div
      className="flex flex-col gap-2"
      role="img"
      aria-label={`Gráfico de gols: marcados ${scored}, sofridos ${conceded}.`}
    >
      {(
        [
          ['Marcados', scored, 'bg-accent'],
          ['Sofridos', conceded, 'bg-[#cf4438]'],
        ] as const
      ).map(([label, value, tone]) => (
        <div
          key={label}
          className="grid grid-cols-[84px_1fr_40px] items-center gap-2.5 text-[0.85rem]"
        >
          <span>{label}</span>
          <span className="h-3.5 overflow-hidden rounded-full border border-line bg-surface-2">
            <span
              className={`block h-full rounded-full transition-[width] ${tone}`}
              style={{ width: `${Math.round((value / max) * 100)}%` }}
            />
          </span>
          <span className="text-right font-bold tabular-nums">{value}</span>
        </div>
      ))}
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
      <WidgetShell title={widget.title || 'Estatísticas'} widget="stats">
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
    <WidgetShell title={widget.title || 'Estatísticas'} widget="stats">
      {metrics.length > 0 ? (
        <dl className={STATS_GRID}>
          {metrics.map((metric) => (
            <div className={STATS_CELL} key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <h3 className={STATS_SUBTITLE}>Gols na temporada</h3>
      <BarChart scored={scored} conceded={conceded} />

      {recent.length > 0 ? (
        <>
          <h3 className={STATS_SUBTITLE}>Forma recente</h3>
          <RecentForm entries={recent} />
        </>
      ) : null}

      {showTopScorers && scorers.length > 0 ? (
        <>
          <h3 className={STATS_SUBTITLE}>Artilheiros</h3>
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
    </WidgetShell>
  );
}

/** Últimos N jogos em bolinhas coloridas (V verde, E cinza, D vermelho). */
export function RecentForm({ entries }: { entries: NonNullable<Stats['recent_form']> }) {
  const TONE: Record<string, string> = {
    v: 'bg-[#1c9c6d]',
    e: 'bg-[#8a94a6]',
    d: 'bg-[#cf4438]',
  };
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {entries.map((entry) => {
        const result = formLetter(entry.result ?? '');
        // O tom e a cor do texto andam juntos: `text-white` e `text-muted` na
        // mesma tag brigariam pela ordem do CSS, não pela ordem da classe.
        const tone = !result
          ? 'bg-line text-muted'
          : `${TONE[result.toLowerCase()] ?? 'bg-muted'} text-white`;
        return (
          <li
            key={entry.id}
            className={`inline-flex cursor-help items-center gap-1.5 rounded-lg px-2 py-1 text-[0.78rem] font-extrabold ${tone}`}
            title={`${entry.opponent ?? 'Adversário'}${entry.score ? ` ${entry.score}` : ''}${result ? ` — ${RESULT_LABEL[result]}` : ''}`}
          >
            <span>{result ?? '?'}</span>
            {entry.score ? <span className="font-semibold opacity-90">{entry.score}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

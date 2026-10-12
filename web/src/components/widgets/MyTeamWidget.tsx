import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { BarChart, buildMetrics } from './StatsWidget';
import { formLetter, ordinalPosition, RESULT_LABEL } from '../../lib/format';
import { optBool, optStringArray } from '../../lib/widgetOptions';
import type { Stats } from '../../api/types';
import type { WidgetProps } from './types';

/**
 * Widget "Meu Time": identidade do clube + todas as estatísticas.
 *
 * Substitui os antigos widgets `team_header` e `stats` (que continuam
 * funcionando em layouts antigos), reunidos num cartão só.
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
    <WidgetShell title={widget.title || 'Meu Time'} className="stats my-team">
      <div className="team-hero-inner">
        {team.logo ? (
          <img
            className="team-hero-crest"
            src={team.logo}
            alt={`Escudo do ${team.name}`}
            width={72}
            height={72}
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
          ) : null}
        </div>
      </div>

      {!hasStats && !season ? (
        <EmptyState message="Sem estatísticas disponíveis." />
      ) : (
        <>
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

          {showChart ? (
            <>
              <h3 className="stats-subtitle">Gols na temporada</h3>
              <BarChart scored={scored} conceded={conceded} />
            </>
          ) : null}

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

          {!season && metrics.length === 0 && recent.length === 0 && scorers.length === 0 ? (
            <p className="muted">Sem dados da temporada no momento.</p>
          ) : null}
        </>
      )}
    </WidgetShell>
  );
}

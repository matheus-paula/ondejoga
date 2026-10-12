import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { formLetter, formatShortDate, RESULT_LABEL } from '../../lib/format';
import { optNumber } from '../../lib/widgetOptions';
import type { WidgetProps } from './types';

/** Widget "Últimos resultados": linha do tempo dos últimos N jogos. */
export function FormWidget({ widget, data, config }: WidgetProps) {
  const limit = optNumber(widget.options, 'limit', 5);
  const entries = (data.stats?.recent_form ?? []).slice(0, limit);

  return (
    <WidgetShell title={widget.title || 'Últimos Resultados'} className="form-widget">
      {entries.length === 0 ? (
        <EmptyState message="Sem resultados recentes disponíveis." />
      ) : (
        <ol className="form-timeline">
          {entries.map((entry) => {
            const result = formLetter(entry.result ?? '');
            return (
              <li key={entry.id} className="form-timeline-item">
                <span
                  className={`form-chip${result ? ` form-chip--${result.toLowerCase()}` : ' form-chip--unknown'}`}
                >
                  {result ?? '?'}
                </span>
                <span className="form-opponent">
                  <span className="form-venue" aria-hidden="true">
                    {entry.venue === 'home' ? 'C' : entry.venue === 'away' ? 'F' : '·'}
                  </span>
                  {entry.opponent ?? 'Adversário'}
                  <span className="sr-only">
                    {result ? ` — ${RESULT_LABEL[result].toLowerCase()}` : ''}
                  </span>
                </span>
                <span className="form-score">{entry.score ?? '—'}</span>
                <span className="form-date">
                  {entry.date
                    ? formatShortDate(
                        entry.date.length === 10 ? `${entry.date}T12:00:00Z` : entry.date,
                        config.locale,
                        config.timezone,
                      )
                    : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </WidgetShell>
  );
}

import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { formLetter, formatShortDate, RESULT_LABEL } from '../../lib/format';
import { optNumber } from '../../lib/widgetOptions';
import type { WidgetProps } from './types';

/** Bolinha de resultado. Tom e texto juntos: na mesma tag eles brigariam pelo CSS. */
const CHIP_TONE: Record<string, string> = {
  v: 'bg-[#1c9c6d] text-white',
  e: 'bg-[#8a94a6] text-white',
  d: 'bg-[#cf4438] text-white',
};

/** Widget "Últimos resultados": linha do tempo dos últimos N jogos. */
export function FormWidget({ widget, data, config }: WidgetProps) {
  const limit = optNumber(widget.options, 'limit', 5);
  const entries = (data.stats?.recent_form ?? []).slice(0, limit);

  return (
    <WidgetShell title={widget.title || 'Últimos Resultados'} widget="form-widget">
      {entries.length === 0 ? (
        <EmptyState message="Sem resultados recentes disponíveis." />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {entries.map((entry) => {
            const result = formLetter(entry.result ?? '');
            const tone = result
              ? CHIP_TONE[result.toLowerCase()] ?? 'bg-muted text-white'
              : 'bg-line text-muted';
            return (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 rounded-ctl border border-line bg-surface-2 px-2.5 py-2"
              >
                <span
                  className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-[0.75rem] font-extrabold ${tone}`}
                >
                  {result ?? '?'}
                </span>
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                  <span aria-hidden="true" className="mr-1.5 text-[0.78rem] text-muted">
                    {entry.venue === 'home' ? 'C' : entry.venue === 'away' ? 'F' : '·'}
                  </span>
                  {entry.opponent ?? 'Adversário'}
                  <span className="sr-only">
                    {result ? ` — ${RESULT_LABEL[result].toLowerCase()}` : ''}
                  </span>
                </span>
                <span className="font-extrabold tabular-nums">{entry.score ?? '—'}</span>
                <span className="whitespace-nowrap text-[0.8rem] text-muted">
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

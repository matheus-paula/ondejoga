import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { MatchTeams, COMPETITION, ROUND, META, META_DT, META_DD } from './MatchTeams';
import { countdownLabel, formatTime, formatDate } from '../../lib/format';
import { optBool } from '../../lib/widgetOptions';
import type { Broadcast } from '../../api/types';
import type { WidgetProps } from './types';

function BroadcastChips({ broadcasts }: { broadcasts: Broadcast[] | null | undefined }) {
  const items = broadcasts ?? [];
  if (items.length === 0) {
    // Sem transmissão confirmada não há o que mostrar: a seção inteira some
    // em vez de exibir "A definir" como se fosse um dado pendente.
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.8rem] uppercase tracking-[0.06em] text-muted">Onde assistir</span>
      {items.map((broadcast, index) => (
        <span key={`${broadcast.name}-${index}`} className="chip">
          {broadcast.name}
        </span>
      ))}
    </div>
  );
}

function Countdown({ kickoff }: { kickoff: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const label = countdownLabel(kickoff, now);
  if (!label) return null;
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full bg-accent/12 px-3 py-[5px] font-bold text-accent">
      <span aria-hidden="true">⏱</span>
      <span>{label}</span>
    </p>
  );
}

/** Widget "Próximo Jogo": competição, times, data/hora, local, contagem regressiva e transmissões. */
export function NextMatchWidget({ widget, data, config }: WidgetProps) {
  const match = data.next_match ?? null;
  const showBroadcasts = optBool(widget.options, 'show_broadcasts', true);
  const showCountdown = optBool(widget.options, 'show_countdown', true);
  const { locale, timezone } = config;

  return (
    <WidgetShell title={widget.title || 'Próximo Jogo'} widget="next-match">
      {!match ? (
        <EmptyState message="Nenhum próximo jogo disponível." />
      ) : (
        <>
          <p className={COMPETITION}>
            {match.competition?.logo ? (
              <img src={match.competition.logo} alt="" width={18} height={18} />
            ) : null}
            <span>
              {match.competition?.name ?? 'Competição a definir'}
              {match.round ? <span className={ROUND}> · Rodada {match.round}</span> : null}
            </span>
          </p>

          <MatchTeams home={match.home} away={match.away} />

          <dl className={META}>
            <div>
              <dt className={META_DT}>Data</dt>
              <dd className={META_DD}>
                <time dateTime={match.kickoff ?? undefined}>
                  {formatDate(match.kickoff, locale, timezone, { dateStyle: 'long' })}
                </time>
              </dd>
            </div>
            <div>
              <dt className={META_DT}>Horário</dt>
              <dd className={META_DD}>{formatTime(match.kickoff, locale, timezone)}</dd>
            </div>
            <div>
              <dt className={META_DT}>Local</dt>
              <dd className={META_DD}>
                {match.venue?.name
                  ? [match.venue.name, match.venue.city].filter(Boolean).join(' · ')
                  : 'Estádio a definir'}
              </dd>
            </div>
          </dl>

          {showCountdown ? <Countdown kickoff={match.kickoff} /> : null}
          {showBroadcasts ? <BroadcastChips broadcasts={match.broadcasts} /> : null}
        </>
      )}
    </WidgetShell>
  );
}

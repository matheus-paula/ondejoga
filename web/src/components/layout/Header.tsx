import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import { updatedAgoLabel } from '../../lib/format';
import { AccountMenu } from './AccountMenu';
import { SourceStatusBadge } from './SourceStatusBadge';

function UpdatedAgo({ timestamp }: { timestamp: number | null }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const label = updatedAgoLabel(timestamp);
  if (!label) return null;
  return (
    <span className="whitespace-nowrap text-[0.8rem] text-muted" role="status">
      {label}
    </span>
  );
}

/**
 * Cabeçalho do painel: só a identidade do time.
 *
 * O modal de conta vive no `DashboardView` (precisa sobreviver ao registro
 * para cobrar o time) e as ações da conta — Configurações e Sair — cabem no
 * `AccountMenu`, aberto pelo ícone de usuário. O tema não é mais atalho daqui:
 * ele mora em Configurações → Aparência.
 *
 * A faixa colorida embaixo é o time (`--team-color`, definido no `style`
 * inline), por isso a sombra é uma inset de 3px e não uma borda.
 */
export function Header() {
  const { config } = useLayout();
  const { data, lastUpdatedAt } = useDashboard();
  const team = data?.team ?? config.team;
  const location = [team.city, team.state].filter(Boolean).join(' · ');
  const style = { '--team-color': team.primary_color ?? 'var(--accent)' } as CSSProperties;

  return (
    <header
      data-testid="app-header"
      style={style}
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface py-3 px-[max(16px,calc((100%-1240px)/2+16px))] shadow-[inset_0_-3px_0_0_var(--team-color,var(--accent))]"
    >
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="flex min-w-0 items-center gap-3">
        {team.logo ? (
          <img
            src={team.logo}
            alt=""
            width={46}
            height={46}
            className="h-[46px] w-[46px] flex-none object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-[46px] w-[46px] rounded-full bg-[var(--team-color,var(--accent))] opacity-85"
          />
        )}
        <div>
          <p className="text-[1.15rem] font-extrabold tracking-[-0.01em]">{team.name}</p>
          {location ? <p className="text-[0.85rem] text-muted">{location}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SourceStatusBadge sources={data?.meta?.sources} />
        <UpdatedAgo timestamp={lastUpdatedAt} />
        <AccountMenu />
      </div>
    </header>
  );
}

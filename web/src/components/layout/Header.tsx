import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import { updatedAgoLabel } from '../../lib/format';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from '../ui/ThemeToggle';
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
    <span className="updated-ago" role="status">
      {label}
    </span>
  );
}

/** Abre a tela de Configurações (rota interna `#/configuracoes`). */
function openSettings() {
  window.location.hash = '#/configuracoes';
}

/**
 * Cabeçalho do painel. O modal de conta vive no `DashboardView` (precisa
 * sobreviver ao registro para cobrar o time), então aqui só fica o atalho para
 * Configurações — que agora é uma tela cheia, não uma gaveta.
 */
export function Header() {
  const { config } = useLayout();
  const { data, lastUpdatedAt } = useDashboard();
  const { user, logout } = useAuth();
  const team = data?.team ?? config.team;
  const location = [team.city, team.state].filter(Boolean).join(' · ');
  const style = { '--team-color': team.primary_color ?? 'var(--accent)' } as CSSProperties;

  return (
    <header className="app-header" style={style}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="app-brand">
        {team.logo ? (
          <img src={team.logo} alt="" className="app-crest" width={46} height={46} />
        ) : (
          <span className="app-crest app-crest--placeholder" aria-hidden="true" />
        )}
        <div className="app-brand-text">
          <p className="app-name">{team.name}</p>
          {location ? <p className="app-subtitle">{location}</p> : null}
        </div>
      </div>
      <div className="app-header-actions">
        <SourceStatusBadge sources={data?.meta?.sources} />
        <UpdatedAgo timestamp={lastUpdatedAt} />
        <ThemeToggle />
        {user ? (
          <span className="account-chip" title="Conta conectada">
            <Icon name="user" size={15} />
            <span className="account-name">{user.username}</span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => void logout()}
            >
              <Icon name="logOut" size={15} />
              Sair
            </button>
          </span>
        ) : null}
        {/* Só faz sentido para quem tem conta (cada um tem o próprio layout). */}
        {user ? (
          <button type="button" className="btn btn--primary" onClick={openSettings}>
            <Icon name="settings" size={15} />
            Configurar
          </button>
        ) : null}
      </div>
    </header>
  );
}

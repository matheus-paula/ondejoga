import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import { updatedAgoLabel } from '../../lib/format';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from '../ui/ThemeToggle';
import { AuthModal } from './AuthModal';
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

interface HeaderProps {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: HeaderProps) {
  const { config } = useLayout();
  const { data, lastUpdatedAt } = useDashboard();
  const { user, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
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
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setAuthOpen(true)}>
            <Icon name="logIn" size={15} />
            Entrar
          </button>
        )}
        {/* Configurações só fazem sentido para quem tem conta (cada um tem o
            próprio layout). Visitante cai no onboarding de criação de conta. */}
        {user ? (
          <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
            <Icon name="settings" size={15} />
            Configurar
          </button>
        ) : null}
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}

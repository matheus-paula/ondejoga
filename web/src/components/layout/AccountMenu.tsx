import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../ui/Icon';

/** Abre a tela de Configurações (rota interna `#/configuracoes`). */
function openSettings() {
  window.location.hash = '#/configuracoes';
}

/**
 * Menu da conta no cabeçalho.
 *
 * O ícone de usuário abre um popup com os dois caminhos de quem está logado:
 * Configurações e Sair. O tema ficou de fora daqui de propósito — ele mora em
 * Configurações → Aparência, e não cabe num cabeçalho que é só identidade do
 * time.
 *
 * Mesmo desenho do popover de status das fontes: relativo ao botão, fecha com
 * Escape ou clicando fora.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="btn btn--avatar aria-expanded:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Conta de ${user.username}`}
        title={user.username}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="user" size={16} />
      </button>

      {open ? (
        <div
          className="popover w-[min(220px,80vw)] p-2.5"
          role="menu"
          aria-label="Conta"
        >
          <h2 className="popover-title">{user.username}</h2>
          <ul className="popover-list">
            <li>
              <button
                type="button"
                role="menuitem"
                className="popover-action"
                onClick={() => {
                  setOpen(false);
                  openSettings();
                }}
              >
                <Icon name="settings" size={15} />
                Configurações
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                className="popover-action"
                onClick={() => {
                  setOpen(false);
                  void logout();
                }}
              >
                <Icon name="logOut" size={15} />
                Sair
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

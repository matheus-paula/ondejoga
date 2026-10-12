import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../ui/Icon';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Aba inicial do modal ("register" para o onboarding de quem não tem conta). */
  initialMode?: Mode;
}

type Mode = 'login' | 'register';

/**
 * Modal simples de conta: entrar ou criar.
 *
 * É renderizado num portal em `document.body` — dentro do `<header>` ele
 * herdaria o stacking context do cabeçalho e ficaria **atrás** do fundo
 * semitransparente, travando o clique em "Criar conta".
 *
 * Cada usuário fica com o próprio time e as próprias configurações (fontes,
 * layout, tema).
 */
export function AuthModal({ open, onClose, initialMode = 'login' }: AuthModalProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    setMode(initialMode);
    setError(null);
    // foco inicial no primeiro campo
    const timer = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, initialMode, onClose]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password);
      setPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="auth-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        ref={dialogRef}
      >
        <header className="drawer-header">
          <h2 id="auth-title">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Fechar"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <form className="auth-form" onSubmit={submit}>
          <p className="drawer-hint">
            {mode === 'login'
              ? 'Entre para ver o seu time e as suas configurações.'
              : 'Crie uma conta para monitorar o seu time. Cada conta tem time, layout e fontes próprios.'}
          </p>

          <label className="field">
            <span>Usuário</span>
            <input
              ref={firstFieldRef}
              type="text"
              autoComplete="username"
              value={username}
              minLength={3}
              maxLength={40}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              minLength={6}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="auth-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? (
                'Aguarde…'
              ) : mode === 'login' ? (
                <>
                  <Icon name="logIn" size={15} />
                  Entrar
                </>
              ) : (
                <>
                  <Icon name="userPlus" size={15} />
                  Criar conta
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setMode((current) => (current === 'login' ? 'register' : 'login'));
                setError(null);
              }}
            >
              <Icon name={mode === 'login' ? 'userPlus' : 'logIn'} size={15} />
              {mode === 'login' ? 'Criar uma conta' : 'Já tenho conta'}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}

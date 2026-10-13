import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import type { AppConfig } from '../../api/types';
import { Icon } from '../ui/Icon';
import { TeamPicker } from '../ui/TeamPicker';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Aba inicial do modal ("register" para o onboarding de quem não tem conta). */
  initialMode?: Mode;
  /**
   * Abre direto no passo de escolher o time, sem formulário e **sem** como
   * fechar (portão para conta que ainda não escolheu o time).
   */
  teamOnly?: boolean;
  /** Chamado quando o time é escolhido e salvo (ponto de recarregar a UI). */
  onTeamSet?: (config: AppConfig) => void;
}

type Mode = 'login' | 'register';
/** `team` = passo obrigatório depois do registro (e do portão de onboarding). */
type Step = 'form' | 'team';

/**
 * Modal de conta: entrar, criar **e escolher o time**.
 *
 * É renderizado num portal em `document.body` — dentro do `<header>` ele
 * herdaria o stacking context do cabeçalho e ficaria **atrás** do fundo
 * semitransparente, travando o clique em "Criar conta".
 *
 * Depois de criar a conta o modal não fecha: ele avança para a busca de time,
 * que é obrigatória (sem fechar, sem Escape e sem clicar fora). O portão de
 * onboarding usa o mesmo modal em modo `teamOnly` para contas antigas que
 * ainda não escolheram o time.
 */
export function AuthModal({
  open,
  onClose,
  initialMode = 'login',
  teamOnly = false,
  onTeamSet,
}: AuthModalProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>(teamOnly ? 'team' : 'form');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const forcedTeam = teamOnly || step === 'team';

  useEffect(() => {
    if (!open) return undefined;
    setMode(initialMode);
    setStep(teamOnly ? 'team' : 'form');
    setError(null);
    // foco inicial no primeiro campo (só existe no passo de formulário)
    const timer = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      // no passo de time não há Escape: a escolha é obrigatória
      if (event.key === 'Escape' && !teamOnly) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, initialMode, onClose, teamOnly]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
        setPassword('');
        onClose();
      } else {
        // Cria a conta e já parte para a escolha do time (obrigatória).
        await register(username.trim(), password);
        setPassword('');
        setStep('team');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setBusy(false);
    }
  };

  const handleTeamSet = (config: AppConfig) => {
    onTeamSet?.(config);
    // Só fecha quem chegou aqui pelo formulário; o portão (`teamOnly`) fica
    // aberto até a UI recarregar com o time novo.
    if (!teamOnly) onClose();
  };

  return createPortal(
    <>
      {/* o fundo fecha o modal, exceto no passo obrigatório de escolher o time */}
      <div
        data-testid="auth-backdrop"
        className="fixed inset-0 z-[95] animate-fade-in bg-[rgba(9,13,20,0.55)]"
        onClick={teamOnly ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        className="fixed top-1/2 left-1/2 z-[96] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_20px_45px_rgba(0,0,0,0.25)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        ref={dialogRef}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-4">
          <h2 id="auth-title">
            {forcedTeam ? 'Qual é o seu time?' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </h2>
          {forcedTeam ? null : (
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Fechar"
              onClick={onClose}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </header>

        {forcedTeam ? (
          <div>
            <p className="mb-3 mt-0 text-[0.84rem] leading-[1.5] text-muted">
              Escolha o time que você quer acompanhar. Ele vira o padrão do seu painel
              e pode ser trocado depois em Configurações → Time.
            </p>
            <TeamPicker onSaved={handleTeamSet} autoFocus savingLabel="Salvando o time…" />
          </div>
        ) : (
          <form className="flex flex-col gap-3.5 p-[18px]" onSubmit={submit}>
            <p className="mb-3 mt-0 text-[0.84rem] leading-[1.5] text-muted">
              {mode === 'login'
                ? 'Entre para ver o seu time e as suas configurações.'
                : 'Crie uma conta para monitorar o seu time. Cada conta tem time, layout e fontes próprios.'}
            </p>

            {/* Rótulo e dica vêm apagados no modal: quem está aqui é para logar,
                não para preencher um formulário. */}
            <label className="field text-[0.88rem] text-muted">
              <span>Usuário</span>
              <input
                className="control bg-surface-2 py-[9px]"
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

            <label className="field text-[0.88rem] text-muted">
              <span>Senha</span>
              <input
                className="control bg-surface-2 py-[9px]"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                minLength={6}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error ? (
              <p className="m-0 text-[0.86rem] text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
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
        )}
      </div>
    </>,
    document.body,
  );
}

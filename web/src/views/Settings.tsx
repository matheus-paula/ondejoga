import { useCallback, useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { AppConfig, ResetFileResult, RestoreItem } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useTheme } from '../context/ThemeContext';
import { ACCENT_AUTO } from '../context/LayoutContext';
import { AccountMenu } from '../components/layout/AccountMenu';
import { WidgetListEditor } from '../components/layout/WidgetListEditor';
import { TeamPicker } from '../components/ui/TeamPicker';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { Icon } from '../components/ui/Icon';
import { Toast, type Notice } from '../components/ui/Toast';

/** Volta para o painel (rota interna `#/`). */
function goDashboard() {
  window.location.hash = '#/';
}

/**
 * Cabeçalho da tela de Configurações. Não reusa o do painel porque este roda
 * fora do `DashboardProvider` (sem dados de jogo para mostrar).
 */
function SettingsHeader() {
  const { config } = useLayout();
  const teamColor = config.team.primary_color ?? 'var(--accent)';
  const style = { '--team-color': teamColor } as CSSProperties;

  return (
    <header
      style={style}
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface py-3 px-[max(16px,calc((100%-1240px)/2+16px))] shadow-[inset_0_-3px_0_0_var(--team-color,var(--accent))]"
    >
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="flex min-w-0 items-center gap-3">
        <Icon name="settings" size={22} />
        <div>
          <p className="text-[1.15rem] font-extrabold tracking-[-0.01em]">OndeJoga</p>
          <p className="text-[0.85rem] text-muted">Configurações</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn--primary" onClick={goDashboard}>
          <Icon name="chevronLeft" size={15} />
          Voltar ao painel
        </button>
        {/* O mesmo menu de conta do painel: um ícone, um popup, os mesmos itens. */}
        <AccountMenu />
      </div>
    </header>
  );
}

function errorOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return 'Erro inesperado.';
}

/* -------------------------------------------------------------------------- */
/* Seção: Conta — usuário, senha e reset                                       */
/* -------------------------------------------------------------------------- */
function AccountSection() {
  const { user, refresh, setUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetFile, setResetFile] = useState<ResetFileResult | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setNotice({ tone: 'error', message: 'A confirmação de senha não confere.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const payload: { current_password: string; username?: string; new_password?: string } = {
        current_password: currentPassword,
      };
      const trimmedUser = newUsername.trim();
      if (trimmedUser && trimmedUser !== user?.username) payload.username = trimmedUser;
      if (newPassword) payload.new_password = newPassword;
      const { user: updated } = await api.updateProfile(payload);
      setUser(updated);
      setCurrentPassword('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice({ tone: 'success', message: 'Conta atualizada com sucesso.' });
      await refresh();
    } catch (err) {
      setNotice({ tone: 'error', message: `Falha ao atualizar: ${errorOf(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const generateResetFile = async () => {
    setShowResetConfirm(false);
    setResetBusy(true);
    setNotice(null);
    try {
      const result = await api.resetPasswordFile();
      setResetFile(result);
      setNotice({
        tone: 'success',
        message: `Arquivo ${result.file} gravado na raiz do projeto. Sua senha agora é a temporária.`,
      });
      await refresh();
    } catch (err) {
      setNotice({ tone: 'error', message: `Falha ao gerar: ${errorOf(err)}` });
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-account-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-account-title">Conta</h2>
      <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
        Conectada como <strong>{user?.username}</strong>. Cada conta guarda o próprio time,
        layout e fontes de dados.
      </p>

      <form className="grid gap-4" onSubmit={(e) => void handleProfile(e)}>
        {/* `sm:grid-cols-2` vem do Tailwind; o grid base fica em settings.css. */}
        <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-2">
          <label className="field">
            <span>Novo usuário</span>
            <input
              className="control"
              type="text"
              autoComplete="username"
              maxLength={40}
              placeholder={user?.username}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Senha atual (obrigatória)</span>
            <input
              className="control"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Nova senha (opcional)</span>
            <input
              className="control"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Confirmar nova senha</span>
            <input
              className="control"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !currentPassword || (!newUsername.trim() && !newPassword)}
          >
            <Icon name="check" size={15} />
            {busy ? 'Aguarde…' : 'Salvar conta'}
          </button>
        </div>
      </form>

      {notice ? <Toast notice={notice} onClose={() => setNotice(null)} /> : null}

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 text-[0.95rem] [font-weight:650]">Esqueci a senha</h3>
        <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
          Gera uma senha temporária e grava em <code className="rounded-[6px] border border-line bg-surface-2 px-[5px] py-px text-[0.8em]">RESET-&lt;usuario&gt;.txt</code> na raiz do
          projeto (o volume montado pelo Docker). Use-a para entrar e depois troque a senha aqui.
          Os outros acessos são encerrados.
        </p>

        {showResetConfirm ? (
          <div className="mt-2 rounded-ctl border border-warn bg-warn-soft p-3" role="group" aria-label="Confirmar geração">
            <p className="mb-2.5 text-[0.875rem] text-ink">
              Isso vai trocar sua senha atual pela temporária e derrubar as outras sessões.
              Continuar?
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setShowResetConfirm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || resetBusy}
                onClick={() => void generateResetFile()}
              >
                <Icon name="refreshCw" size={15} />
                {busy ? 'Gerando…' : 'Sim, gerar arquivo'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => setShowResetConfirm(true)}
          >
            <Icon name="key" size={15} />
            Gerar senha temporária (arquivo de reset)
          </button>
        )}

        {resetFile ? (
          <div className="mt-3 rounded-ctl border border-success bg-success-soft p-3 text-[0.875rem]" role="status" data-testid="reset-file">
            <p className="mb-1">
              Arquivo gravado em <code className="rounded-[6px] border border-line bg-surface-2 px-[5px] py-px text-[0.8em]">{resetFile.path}</code>
            </p>
            <p>
              Usuário: <code className="rounded-[6px] border border-line bg-surface-2 px-[5px] py-px text-[0.8em]">{resetFile.username}</code> · Senha temporária:{' '}
              <code className="rounded-[6px] border border-line bg-surface-2 px-[5px] py-px text-[0.8em]" data-testid="temp-password">{resetFile.password}</code>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção: Time                                                                 */
/* -------------------------------------------------------------------------- */
function TeamSection({ onTeamSaved }: { onTeamSaved: (config: AppConfig) => void }) {
  const { config } = useLayout();
  const team = config.team;
  const ids = team.ids ?? {};
  const location = [team.city, team.state].filter(Boolean).join(' · ');

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-team-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-team-title">Time</h2>
      <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
        Escolha o time do painel. Ele vira o padrão da sua conta e pode ser trocado quando
        quiser — o painel se refaz com o time novo.
      </p>

      <div className="mb-4 flex items-center gap-3 rounded-ctl border border-line bg-surface-2 p-3">
        {team.logo ? (
          <img src={team.logo} alt="" className="h-[44px] w-[44px] flex-none object-contain" width={44} height={44} />
        ) : (
          <span className="inline-block h-[44px] w-[44px] rounded-full bg-line" aria-hidden="true" />
        )}
        <div>
          <p className="m-0 [font-weight:650]">{team.name}</p>
          {location ? <p className="mt-0.5 text-[0.8rem] text-muted">{location}</p> : null}
          <p className="mt-0.5 text-[0.8rem] text-muted">
            TheSportsDB: <code>{ids.thesportsdb || '—'}</code>
            {ids.espn ? (
              <>
                {' · '}
                ESPN: <code>{ids.espn}</code>
                {ids.espn_league ? <> ({ids.espn_league})</> : null}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <TeamPicker onSaved={onTeamSaved} confirmLabel="Trocar time" savingLabel="Trocando…" />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção: Aparência                                                            */
/* -------------------------------------------------------------------------- */
function AppearanceSection() {
  const layout = useLayout();
  const { accent, setAccent, clearAccent } = useTheme();
  const draftAccent = layout.draft?.theme?.accent;

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-appearance-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-appearance-title">Aparência</h2>
      <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
        O tema acompanha automaticamente a cor do time, nos modos claro e escuro. A cor de
        destaque é opcional.
      </p>

      <ThemeToggle onSelect={layout.setThemeDefault} />

      <div className="field field--inline">
        <label htmlFor="accent-color">Cor de destaque</label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[0.86rem] text-muted">
            <input
              type="radio"
              name="accent-mode"
              checked={!draftAccent || draftAccent === ACCENT_AUTO}
              onChange={() => {
                layout.setAccent(ACCENT_AUTO);
                clearAccent();
              }}
            />
            <span>Automática (cor do time)</span>
          </label>
          <input
            className="control-color"
            id="accent-color"
            type="color"
            value={accent}
            onChange={(event) => {
              setAccent(event.target.value);
              layout.setAccent(event.target.value);
            }}
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção: Atualização                                                          */
/* -------------------------------------------------------------------------- */
function RefreshSection() {
  const layout = useLayout();
  const seconds = layout.draft?.refresh_interval_seconds ?? 300;

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-refresh-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-refresh-title">Atualização</h2>
      <div className="field">
        <label htmlFor="refresh-interval">Intervalo de atualização (segundos)</label>
        <input
          className="control"
          id="refresh-interval"
          type="number"
          min={10}
          value={seconds}
          onChange={(event) => layout.setRefreshInterval(Number(event.target.value))}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção: Widgets                                                              */
/* -------------------------------------------------------------------------- */
function WidgetsSection() {
  const layout = useLayout();
  const { saving, dirty } = layout;

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-widgets-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-widgets-title">Widgets</h2>
      <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
        Mostre, oculte, renomeie e reordene os cards do painel. Arraste pelo ⠿ ou use as setas.
      </p>

      <WidgetListEditor />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => layout.revert()}
          disabled={!dirty}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => void layout.reset()}
        >
          Restaurar padrão
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || !dirty}
          onClick={() => void layout.save()}
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção: Manutenção (voltar ao padrão)                                        */
/* -------------------------------------------------------------------------- */
const RESTORE_OPTIONS: { id: RestoreItem; label: string; help: string }[] = [
  {
    id: 'sources',
    label: 'Fontes de API',
    help: 'Apaga as fontes de dados da sua conta e recria as originais (JogosTV, ESPN, TheSportsDB…). Resolve fonte remapeada, quebrada ou em loop de erro.',
  },
  {
    id: 'layout',
    label: 'Layout dos widgets',
    help: 'Volta os cards do painel à ordem, tamanho e visibilidade padrão.',
  },
  {
    id: 'config',
    label: 'Time e preferências',
    help: 'Zera tema, idioma, fuso, intervalo de atualização e o time escolhido. O painel volta a pedir a escolha do time.',
  },
];

function MaintenanceSection() {
  const { user } = useAuth();
  const layout = useLayout();
  const [items, setItems] = useState<RestoreItem[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Notice | null>(null);

  // Zerar configuração é operação de conta; sem login não existe o que zerar.
  if (!user) return null;

  const toggle = (id: RestoreItem) => {
    setError(null);
    setItems((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const restoreNow = async (event: FormEvent) => {
    event.preventDefault();
    if (!items.length || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.restoreSettings({ current_password: password, items });
      setPassword('');
      // Ação concluída: volta ao repouso. Deixar marcado seria deixar um botão
      // destrutivo armado para repetir sem querer.
      setItems([]);
      const restored = result.reset
        .map((id) => RESTORE_OPTIONS.find((option) => option.id === id)?.label ?? id)
        .join(', ');
      // Deixa visível que as fontes voltaram prontas, sem ninguém cadastrando nada.
      const sources = result.reset.includes('sources')
        ? ` ${result.sources_count} fontes de fábrica reinstaladas.`
        : '';
      setDone({ tone: 'success', message: `Restaurado: ${restored}.${sources}` });
      layout.retry(); // recarrega config e layout no escopo desta conta
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Não consegui restaurar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-restore-title">
      <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-restore-title">Manutenção</h2>
      <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
        Se algo no painel parou de funcionar, marque o que precisa voltar ao original. Conta,
        senha e sessão continuam valendo.
      </p>

      <form onSubmit={(event) => void restoreNow(event)}>
        <fieldset className="m-0 mb-4 grid gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[0.8125rem] font-semibold text-muted">O que restaurar</legend>
          {RESTORE_OPTIONS.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-start gap-2.5 rounded-ctl border border-line bg-surface-2 px-3 py-2.5 has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
              <input
                type="checkbox"
                className="mt-[3px] flex-none"
                checked={items.includes(option.id)}
                onChange={() => toggle(option.id)}
                disabled={busy}
              />
              <span className="grid gap-0.5">
                <span className="text-[0.875rem] text-ink">{option.label}</span>
                <span className="text-[0.8125rem] leading-[1.4] text-muted">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Sua senha atual</span>
          <input
            className="control"
            type="password"
            // Sem autofill de propósito: digitar a senha é a confirmação.
            autoComplete="off"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </label>

        {error ? (
          <p className="m-0 text-[0.86rem] text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn btn--danger"
            disabled={busy || !items.length || !password}
          >
            <Icon name="refreshCw" size={15} />
            {busy ? 'Restaurando…' : 'Restaurar selecionado'}
          </button>
        </div>
      </form>

      {done ? <Toast notice={done} onClose={() => setDone(null)} /> : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela                                                                        */
/* -------------------------------------------------------------------------- */
export function SettingsView() {
  const { user, loading } = useAuth();
  const {
    loading: layoutLoading,
    error: layoutError,
    retry,
    notice,
    clearNotice,
  } = useLayout();
  const [teamNotice, setTeamNotice] = useState<Notice | null>(null);

  // Time salvo => recarrega config (o nome/cor no cabeçalho acompanham).
  const handleTeamSaved = useCallback(
    (config: AppConfig) => {
      retry();
      setTeamNotice({ tone: 'success', message: `Time ${config.team.name} aplicado ao painel.` });
    },
    [retry],
  );

  if (loading) return null;

  return (
    <div className="flex flex-1 flex-col bg-bg" data-testid="settings-page">
      <SettingsHeader />

      <main id="conteudo" className="mx-auto max-w-[780px] flex-1 px-4 pt-6 pb-16">
        <h1 className="mb-1 text-[1.5rem] font-bold">Configurações</h1>

        {user ? null : (
          <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted" role="status">
            Conecte uma conta para editar suas configurações.
          </p>
        )}

        <AccountSection />
        <TeamSection onTeamSaved={handleTeamSaved} />
        <AppearanceSection />

        {layoutError && !layoutLoading ? (
          <p className="m-0 text-[0.86rem] text-danger" role="alert">
            {layoutError}{' '}
            <button type="button" className="btn btn--ghost btn--small" onClick={retry}>
              Tentar de novo
            </button>
          </p>
        ) : (
          <>
            <WidgetsSection />
            <RefreshSection />
          </>
        )}

        <section className="rounded-card border border-line bg-surface p-5 mt-5" aria-labelledby="settings-sources-title">
          <h2 className="mb-1 text-[1.05rem] [font-weight:650]" id="settings-sources-title">Fontes de dados</h2>
          <p className="mb-4 text-[0.875rem] leading-[1.5] text-muted">
            As APIs que abastecem o painel podem ser remapeadas se uma fonte morrer.
          </p>
          <a className="btn btn--ghost" href="#/admin">
            <Icon name="externalLink" size={15} />
            Gerenciar fontes
          </a>
        </section>

        <MaintenanceSection />
      </main>

      {teamNotice ? <Toast notice={teamNotice} onClose={() => setTeamNotice(null)} /> : null}
      {notice ? <Toast notice={notice} onClose={clearNotice} /> : null}
    </div>
  );
}

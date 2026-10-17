import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, ApiError } from '../api/client';
import type {
  AdminSource,
  AdminStatus,
  SourcePayload,
  SourceTestResult,
} from '../api/types';
import { AccountMenu } from '../components/layout/AccountMenu';
import { Icon } from '../components/ui/Icon';
import { Toast, type Notice } from '../components/ui/Toast';
import { Switch } from '../components/ui/Switch';
import { ErrorPanel, LoadingLabel } from '../components/ui/States';
import { SourceModal } from '../components/admin/SourceModal';
import { useLayout } from '../context/LayoutContext';
import {
  newSourceForm,
  sourceToForm,
  toPayload,
  type SourceForm,
} from '../components/admin/sourceForm';
import { capabilityLabel, kindLabel, statusLabel } from '../lib/labels';
import { formatDate, prettyJson } from '../lib/format';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'Erro inesperado.';
}

interface ModalState {
  mode: 'create' | 'edit';
  form: SourceForm;
}

/**
 * Cartão de seção do admin (Contagem, Fontes, Resultado do teste).
 * `gap-3.5` é o `gap: 14px` e `p-[18px]` o `padding: 18px` do CSS antigo.
 */
const SECTION = 'flex flex-col gap-3.5 rounded-card border border-line bg-surface p-[18px]';

/** Erro de fonte/capacidade: corpo pequeno, quebrando palavras longas. */
const STATUS_ERROR = 'text-[0.8rem] break-words text-danger';

/** Cabeçalho da tabela: régua, caixa alta e sem quebra de linha. */
const TH_HEAD =
  'border-b border-line px-2.5 py-2 text-left text-[0.76rem] uppercase tracking-[0.05em] whitespace-nowrap text-muted';

/** Célula do corpo com régua (todas, menos a última linha). */
const CELL = 'border-b border-line px-2.5 py-3 text-left align-top';

/** Célula da última linha — sem régua (era `tbody tr:last-child`). */
const CELL_LAST = 'px-2.5 py-3 text-left align-top';

function StatusSection({ status }: { status: AdminStatus | null }) {
  if (!status || status.capabilities.length === 0) return null;
  return (
    <section className={SECTION} aria-labelledby="status-title">
      <h2 className="text-[1.05rem]" id="status-title">Status por capacidade</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {status.capabilities.map((item) => (
          <article className="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-2 p-3" key={item.capability}>
            <h3 className="text-[0.95rem]">{capabilityLabel(item.capability)}</h3>
            <p>
              Fonte ativa:{' '}
              <strong>{item.active_source ?? 'nenhuma'}</strong>
              {item.status ? (
                <>
                  {' '}
                  <span className={`chip chip--status-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </>
              ) : null}
            </p>
            {item.error ? <p className={STATUS_ERROR}>{item.error}</p> : null}
            {item.last_success_at ? (
              <p className="text-muted">
                Último sucesso: {formatDate(item.last_success_at, 'pt-BR', 'America/Sao_Paulo', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            ) : null}
            {item.fallbacks_available && item.fallbacks_available.length > 0 ? (
              <p className="text-muted">
                Fallbacks: {item.fallbacks_available.map((f) => capabilityLabel(f)).join(', ')}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function TestResultPanel({ result }: { result: SourceTestResult }) {
  return (
    <section className={SECTION} aria-label="Resultado do teste">
      <h2 className="text-[1.05rem]">Resultado do teste</h2>
      <p>
        <span className={`chip chip--status-${result.ok ? 'ok' : 'error'}`}>
          {result.ok ? 'ok' : 'erro'}
        </span>{' '}
        <strong>HTTP {result.status_code ?? '—'}</strong> · {result.elapsed_ms ?? '—'} ms
      </p>
      {result.error ? <p className={STATUS_ERROR}>{result.error}</p> : null}
      {result.url ? (
        <p>
          <span className="text-muted">URL:</span> <code className="break-words">{result.url}</code>
        </p>
      ) : null}
      <details>
        <summary className="mt-2 cursor-pointer font-semibold">Resposta (amostra)</summary>
        <pre>{prettyJson(result.sample)}</pre>
      </details>
      <details>
        <summary className="mt-2 cursor-pointer font-semibold">Dados normalizados</summary>
        <pre>{prettyJson(result.normalized)}</pre>
      </details>
    </section>
  );
}

/** View de administração (hash `#/admin`): CRUD de fontes + status. */
export function Admin() {
  // Mesma faixa colorida do cabeçalho do painel: 3px de `--team-color` no pé.
  const { config } = useLayout();
  const style = { '--team-color': config.team.primary_color ?? 'var(--accent)' } as CSSProperties;
  const [sources, setSources] = useState<AdminSource[] | null>(null);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<SourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [list, adminStatus] = await Promise.all([
        api.listSources(),
        api.getAdminStatus().catch(() => null),
      ]);
      setSources(list);
      setStatus(adminStatus);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSubmit = async (payload: SourcePayload, id?: number): Promise<string | null> => {
    setSubmitting(true);
    try {
      if (id != null) {
        await api.updateSource(id, payload);
        setNotice({ tone: 'success', message: `Fonte "${payload.name}" atualizada.` });
      } else {
        await api.createSource(payload);
        setNotice({ tone: 'success', message: `Fonte "${payload.name}" criada.` });
      }
      setModal(null);
      await loadAll();
      return null;
    } catch (err) {
      return errorMessage(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestFromModal = async (payload: SourcePayload): Promise<SourceTestResult | null> => {
    try {
      return await api.testSource({
        source: payload,
        capability: payload.capabilities[0] ?? 'team',
      });
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
      return null;
    }
  };

  const handleToggle = async (source: AdminSource) => {
    setBusyId(source.id);
    try {
      await api.updateSource(source.id, toPayload({ ...source, enabled: !source.enabled }));
      setNotice({
        tone: 'success',
        message: `"${source.name}" ${source.enabled ? 'desabilitada' : 'habilitada'}.`,
      });
      await loadAll();
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (source: AdminSource) => {
    if (!window.confirm(`Excluir a fonte "${source.name}"?`)) return;
    setBusyId(source.id);
    try {
      await api.deleteSource(source.id);
      setNotice({ tone: 'success', message: `Fonte "${source.name}" excluída.` });
      await loadAll();
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (source: AdminSource) => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testSource({ id: source.id }));
    } catch (err) {
      setTestResult({ ok: false, error: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const openCreate = () => setModal({ mode: 'create', form: newSourceForm() });
  const openEdit = (source: AdminSource) =>
    setModal({ mode: 'edit', form: sourceToForm(source) });

  return (
    <div className="flex flex-1 flex-col">
      <header
        style={style}
        className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface py-3 px-[max(16px,calc((100%-1240px)/2+16px))] shadow-[inset_0_-3px_0_0_var(--team-color,var(--accent))]"
      >
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        <div className="flex min-w-0 items-center gap-3">
          <Icon name="slidersHorizontal" size={22} />
          <div>
            <p className="text-[1.15rem] font-extrabold tracking-[-0.01em]">OndeJoga</p>
            <p className="text-[0.85rem] text-muted">Administração</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a className="btn btn--primary" href="#/">
            <Icon name="chevronLeft" size={15} />
            Voltar ao painel
          </a>
          {/* O mesmo menu de conta do painel e de Configurações. */}
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto flex w-[min(1240px,100%_-_32px)] flex-1 flex-col gap-[26px] pt-[22px] pb-12" id="conteudo">
        <section className={SECTION} aria-labelledby="sources-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[1.05rem]" id="sources-title">Fontes</h2>
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              Nova fonte
            </button>
          </div>

          {loading ? <LoadingLabel text="Carregando fontes…" /> : null}

          {!loading && error ? (
            <ErrorPanel
              title="Não foi possível carregar as fontes"
              message={error}
              onRetry={() => void loadAll()}
            />
          ) : null}

          {!loading && !error && sources ? (
            sources.length === 0 ? (
              <p className="text-muted px-1 py-3.5">Nenhuma fonte cadastrada ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[0.9rem]">
                  <caption className="sr-only">Fontes de dados cadastradas</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH_HEAD}>Nome</th>
                      <th scope="col" className={TH_HEAD}>Tipo</th>
                      <th scope="col" className={TH_HEAD}>Prioridade</th>
                      <th scope="col" className={TH_HEAD}>Capacidades</th>
                      <th scope="col" className={TH_HEAD}>Habilitada</th>
                      <th scope="col" className={TH_HEAD}>Último status</th>
                      <th scope="col" className={TH_HEAD}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source, index) => {
                      const cell = index === sources.length - 1 ? CELL_LAST : CELL;
                      return (
                        <tr key={source.id} className="hover:bg-row-hover">
                          <th scope="row" className={cell}>
                            {source.name}
                          </th>
                          <td className={cell}>{kindLabel(source.kind)}</td>
                          <td className={cell}>{source.priority}</td>
                          <td className={cell}>
                            <span className="inline-flex max-w-[260px] flex-wrap gap-1">
                              {(source.capabilities ?? []).map((capability) => (
                                <span className="chip" key={capability}>
                                  {capability}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className={cell}>
                            <Switch
                              checked={source.enabled}
                              disabled={busyId === source.id}
                              onChange={() => void handleToggle(source)}
                              label={`Habilitar fonte ${source.name}`}
                            />
                          </td>
                          <td className={cell}>
                            <span className={`chip chip--status-${source.last_status ?? 'ok'}`}>
                              {statusLabel(source.last_status ?? '—')}
                            </span>
                            {source.last_error ? (
                              <small className={STATUS_ERROR} title={source.last_error}>
                                {' '}
                                {source.last_error}
                              </small>
                            ) : null}
                            {source.last_success_at ? (
                              <p className="text-muted">
                                ok em{' '}
                                {formatDate(source.last_success_at, 'pt-BR', 'America/Sao_Paulo', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </p>
                            ) : null}
                          </td>
                          <td className={cell}>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => openEdit(source)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn btn--small"
                                disabled={testing}
                                onClick={() => void handleTest(source)}
                              >
                                Testar
                              </button>
                              <button
                                type="button"
                                className="btn btn--small btn--danger"
                                disabled={busyId === source.id}
                                onClick={() => void handleDelete(source)}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </section>

        <StatusSection status={status} />

        {testResult ? <TestResultPanel result={testResult} /> : null}
        {testing ? <LoadingLabel text="Testando fonte…" /> : null}
      </main>

      {modal ? (
        <SourceModal
          mode={modal.mode}
          initial={modal.form}
          submitting={submitting}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
          onTest={handleTestFromModal}
        />
      ) : null}

      <Toast notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  AdminSource,
  AdminStatus,
  SourcePayload,
  SourceTestResult,
} from '../api/types';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { Toast, type Notice } from '../components/ui/Toast';
import { Switch } from '../components/ui/Switch';
import { ErrorPanel, LoadingLabel } from '../components/ui/States';
import { SourceModal } from '../components/admin/SourceModal';
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

function StatusSection({ status }: { status: AdminStatus | null }) {
  if (!status || status.capabilities.length === 0) return null;
  return (
    <section className="admin-section" aria-labelledby="status-title">
      <h2 id="status-title">Status por capacidade</h2>
      <div className="status-grid">
        {status.capabilities.map((item) => (
          <article className="status-card" key={item.capability}>
            <h3>{capabilityLabel(item.capability)}</h3>
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
            {item.error ? <p className="status-error">{item.error}</p> : null}
            {item.last_success_at ? (
              <p className="muted">
                Último sucesso: {formatDate(item.last_success_at, 'pt-BR', 'America/Sao_Paulo', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            ) : null}
            {item.fallbacks_available && item.fallbacks_available.length > 0 ? (
              <p className="muted">
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
    <section className="admin-section test-panel" aria-label="Resultado do teste">
      <h2>Resultado do teste</h2>
      <p>
        <span className={`chip chip--status-${result.ok ? 'ok' : 'error'}`}>
          {result.ok ? 'ok' : 'erro'}
        </span>{' '}
        <strong>HTTP {result.status_code ?? '—'}</strong> · {result.elapsed_ms ?? '—'} ms
      </p>
      {result.error ? <p className="status-error">{result.error}</p> : null}
      {result.url ? (
        <p>
          <span className="muted">URL:</span> <code>{result.url}</code>
        </p>
      ) : null}
      <details>
        <summary>Resposta (amostra)</summary>
        <pre>{prettyJson(result.sample)}</pre>
      </details>
      <details>
        <summary>Dados normalizados</summary>
        <pre>{prettyJson(result.normalized)}</pre>
      </details>
    </section>
  );
}

/** View de administração (hash `#/admin`): CRUD de fontes + status. */
export function Admin() {
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
    <div className="admin">
      <header className="admin-header">
        <div>
          <p className="admin-title">OndeJoga — Administração</p>
          <p className="admin-subtitle">Fontes de dados (APIs)</p>
        </div>
        <div className="admin-header-actions">
          <ThemeToggle />
          <a className="btn" href="#/">
            ← Voltar ao painel
          </a>
        </div>
      </header>

      <main className="container admin-main">
        <section className="admin-section" aria-labelledby="sources-title">
          <div className="admin-section-head">
            <h2 id="sources-title">Fontes</h2>
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
              <p className="empty-state">Nenhuma fonte cadastrada ainda.</p>
            ) : (
              <div className="table-scroll">
                <table className="admin-table">
                  <caption className="sr-only">Fontes de dados cadastradas</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Prioridade</th>
                      <th scope="col">Capacidades</th>
                      <th scope="col">Habilitada</th>
                      <th scope="col">Último status</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => (
                      <tr key={source.id}>
                        <th scope="row">{source.name}</th>
                        <td>{kindLabel(source.kind)}</td>
                        <td>{source.priority}</td>
                        <td>
                          <span className="capability-chips">
                            {(source.capabilities ?? []).map((capability) => (
                              <span className="chip" key={capability}>
                                {capability}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td>
                          <Switch
                            checked={source.enabled}
                            disabled={busyId === source.id}
                            onChange={() => void handleToggle(source)}
                            label={`Habilitar fonte ${source.name}`}
                          />
                        </td>
                        <td>
                          <span className={`chip chip--status-${source.last_status ?? 'ok'}`}>
                            {statusLabel(source.last_status ?? '—')}
                          </span>
                          {source.last_error ? (
                            <small className="status-error" title={source.last_error}>
                              {' '}
                              {source.last_error}
                            </small>
                          ) : null}
                          {source.last_success_at ? (
                            <p className="muted">
                              ok em{' '}
                              {formatDate(source.last_success_at, 'pt-BR', 'America/Sao_Paulo', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <div className="row-actions">
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
                    ))}
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

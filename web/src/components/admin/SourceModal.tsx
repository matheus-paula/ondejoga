import { useState, type FormEvent } from 'react';
import { CAPABILITIES, SOURCE_KINDS } from '../../api/types';
import type { SourceKind, SourcePayload, SourceTestResult } from '../../api/types';
import { Icon } from '../ui/Icon';
import { KIND_LABELS, capabilityLabel } from '../../lib/labels';
import { prettyJson } from '../../lib/format';
import {
  formToPayload,
  validateForm,
  type KvRow,
  type SourceForm,
} from './sourceForm';

interface ModalProps {
  mode: 'create' | 'edit';
  initial: SourceForm;
  submitting: boolean;
  onCancel: () => void;
  /** Retorna mensagem de erro (string) ou null em sucesso. */
  onSubmit: (payload: SourcePayload, id?: number) => Promise<string | null>;
  onTest: (payload: SourcePayload) => Promise<SourceTestResult | null>;
}

function KeyValueRows({
  legend,
  rows,
  onChange,
  keyOptions,
  keyPlaceholder,
  valuePlaceholder,
}: {
  legend: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  keyOptions?: readonly string[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const update = (index: number, patch: Partial<KvRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      {rows.length === 0 ? <p className="text-muted">Nenhum item.</p> : null}
      {rows.map((row, index) => (
        <div className="mb-2 grid grid-cols-[1fr_1.4fr_auto] gap-2" key={`${index}-${row.key}`}>
          {keyOptions ? (
            <select
              className="control"
              aria-label={`Chave de ${legend} (linha ${index + 1})`}
              value={row.key}
              onChange={(event) => update(index, { key: event.target.value })}
            >
              <option value="">— selecione —</option>
              {keyOptions.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="control"
              type="text"
              aria-label={`Chave de ${legend} (linha ${index + 1})`}
              placeholder={keyPlaceholder ?? 'chave'}
              value={row.key}
              onChange={(event) => update(index, { key: event.target.value })}
            />
          )}
          <input
            className="control"
            type="text"
            aria-label={`Valor de ${legend} (linha ${index + 1})`}
            placeholder={valuePlaceholder ?? 'valor'}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="btn btn--icon"
            aria-label={`Remover linha ${index + 1} de ${legend}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        <Icon name="plus" size={14} />
        Adicionar linha
      </button>
    </fieldset>
  );
}

/** Modal de criação/edição de fonte de dados. */
export function SourceModal({ mode, initial, submitting, onCancel, onSubmit, onTest }: ModalProps) {
  const [form, setForm] = useState<SourceForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<SourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const patch = (changes: Partial<SourceForm>) => setForm((current) => ({ ...current, ...changes }));

  const toggleCapability = (capability: string, on: boolean) => {
    patch({
      capabilities: on
        ? [...new Set([...form.capabilities, capability])]
        : form.capabilities.filter((item) => item !== capability),
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateForm(form);
    setErrors(validation);
    if (validation.length > 0) return;
    const message = await onSubmit(formToPayload(form), form.id);
    if (message) setErrors([message]);
  };

  const handleTest = async () => {
    const validation = validateForm(form);
    setErrors(validation);
    if (validation.length > 0) return;
    setTesting(true);
    setTestResult(await onTest(formToPayload(form)));
    setTesting(false);
  };

  const titleId = 'source-modal-title';

  return (
    <>
      <div
        className="fixed inset-0 z-[70] animate-fade-in bg-[rgba(9,13,20,0.5)]"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed inset-0 z-[85] flex items-center justify-center p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <form
          className="pointer-events-auto flex max-h-[calc(100vh-40px)] w-[min(760px,100%)] animate-slide-in-quick flex-col rounded-card border border-line bg-surface shadow-card"
          onSubmit={handleSubmit}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-4">
            <h2 id={titleId}>{mode === 'create' ? 'Nova fonte' : `Editar: ${initial.name}`}</h2>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Fechar formulário"
              onClick={onCancel}
            >
              <Icon name="x" size={16} />
            </button>
          </header>

          <div className="flex flex-col gap-4 overflow-y-auto p-[18px]">
            {errors.length > 0 ? (
              <div
                className="rounded-ctl border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-danger-soft p-3 text-danger"
                role="alert"
              >
                <p className="mb-1.5 font-bold">Corrija os problemas abaixo:</p>
                <ul className="m-0 pl-[18px]">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3.5">
              <div className="field">
                <label htmlFor="source-name">Nome</label>
                <input
                  className="control"
                  id="source-name"
                  type="text"
                  value={form.name}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="source-kind">Tipo</label>
                <select
                  className="control"
                  id="source-kind"
                  value={form.kind}
                  onChange={(event) => patch({ kind: event.target.value as SourceKind })}
                >
                  {SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind] ?? kind}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="source-priority">Prioridade (menor testa primeiro)</label>
                <input
                  className="control"
                  id="source-priority"
                  type="number"
                  min={0}
                  value={form.priority}
                  onChange={(event) => patch({ priority: Number(event.target.value) })}
                />
              </div>

              <div className="field field--check">
                <input
                  id="source-enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => patch({ enabled: event.target.checked })}
                />
                <label htmlFor="source-enabled">Habilitada</label>
              </div>

              <fieldset className="field col-span-full">
                <legend>Capacidades</legend>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5">
                  {CAPABILITIES.map((capability) => (
                    <label key={capability} className="flex items-center gap-1.5 font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={form.capabilities.includes(capability)}
                        onChange={(event) => toggleCapability(capability, event.target.checked)}
                      />
                      {capabilityLabel(capability)}
                      <code className="text-muted"> ({capability})</code>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="field col-span-full">
                <label htmlFor="source-base-url">URL base</label>
                <input
                  className="control"
                  id="source-base-url"
                  type="text"
                  placeholder="https://exemplo.com/api/{api_key}/"
                  value={form.base_url}
                  onChange={(event) => patch({ base_url: event.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="source-api-key">Chave de API</label>
                <input
                  className="control"
                  id="source-api-key"
                  type="password"
                  autoComplete="off"
                  value={form.api_key}
                  onChange={(event) => patch({ api_key: event.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="source-cache">Cache (segundos)</label>
                <input
                  className="control"
                  id="source-cache"
                  type="number"
                  min={0}
                  value={form.cache_ttl_seconds}
                  onChange={(event) => patch({ cache_ttl_seconds: Number(event.target.value) })}
                />
              </div>

              <div className="field">
                <label htmlFor="source-timeout">Timeout (segundos)</label>
                <input
                  className="control"
                  id="source-timeout"
                  type="number"
                  min={1}
                  value={form.timeout_seconds}
                  onChange={(event) => patch({ timeout_seconds: Number(event.target.value) })}
                />
              </div>

              <KeyValueRows
                legend="Cabeçalhos"
                rows={form.headers}
                onChange={(rows) => patch({ headers: rows })}
                keyPlaceholder="X-Api-Key"
                valuePlaceholder="valor"
              />

              <KeyValueRows
                legend="Endpoints"
                rows={form.endpoints}
                onChange={(rows) => patch({ endpoints: rows })}
                keyOptions={CAPABILITIES}
                valuePlaceholder="lookuptable.php?l={competition_id}&s={season}"
              />

              <div className="field col-span-full">
                <label htmlFor="source-mapping">Mapping (JSON)</label>
                <textarea
                  className="control control-area"
                  id="source-mapping"
                  rows={6}
                  spellCheck={false}
                  value={form.mappingText}
                  onChange={(event) => patch({ mappingText: event.target.value })}
                />
              </div>

              <div className="field col-span-full">
                <label htmlFor="source-notes">Observações</label>
                <textarea
                  className="control control-area"
                  id="source-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(event) => patch({ notes: event.target.value })}
                />
              </div>
            </div>

            {testResult ? (
              <section
                className="rounded-ctl border border-line bg-surface-2 p-3"
                aria-label="Resultado do teste (não salvo)"
              >
                <h3 className="mb-1.5">Teste (fonte não salva)</h3>
                <p>
                  <span className={`chip chip--status-${testResult.ok ? 'ok' : 'error'}`}>
                    {testResult.ok ? 'ok' : 'erro'}
                  </span>{' '}
                  HTTP {testResult.status_code ?? '—'} · {testResult.elapsed_ms ?? '—'} ms
                </p>
                <pre>{prettyJson(testResult.sample)}</pre>
              </section>
            ) : null}
          </div>

          <footer className="flex justify-end gap-2.5 border-t border-line px-[18px] py-3.5">
            <button type="button" className="btn" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn"
              disabled={testing || submitting}
              onClick={() => void handleTest()}
            >
              {testing ? 'Testando…' : 'Testar'}
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Salvando…' : 'Salvar'}
            </button>
          </footer>
        </form>
      </div>
    </>
  );
}

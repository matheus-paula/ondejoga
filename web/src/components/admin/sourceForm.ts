import type { AdminSource, SourceKind, SourcePayload } from '../../api/types';
import { CAPABILITIES } from '../../api/types';

export interface KvRow {
  key: string;
  value: string;
}

export interface SourceForm {
  id?: number;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  priority: number;
  capabilities: string[];
  base_url: string;
  api_key: string;
  headers: KvRow[];
  endpoints: KvRow[];
  mappingText: string;
  cache_ttl_seconds: number;
  timeout_seconds: number;
  notes: string;
}

export function recordToKv(record: Record<string, string> | null | undefined): KvRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function kvToRecord(rows: KvRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) result[key] = row.value;
  }
  return result;
}

export function newSourceForm(): SourceForm {
  return {
    name: '',
    kind: 'thesportsdb',
    enabled: true,
    priority: 10,
    capabilities: [],
    base_url: '',
    api_key: '',
    headers: [],
    endpoints: [],
    mappingText: '{}',
    cache_ttl_seconds: 600,
    timeout_seconds: 8,
    notes: '',
  };
}

export function sourceToForm(source: AdminSource): SourceForm {
  return {
    id: source.id,
    name: source.name ?? '',
    kind: source.kind,
    enabled: source.enabled,
    priority: source.priority ?? 0,
    capabilities: source.capabilities ?? [],
    base_url: source.base_url ?? '',
    api_key: source.api_key ?? '',
    headers: recordToKv(source.headers),
    endpoints: recordToKv(source.endpoints),
    mappingText: source.mapping ? JSON.stringify(source.mapping, null, 2) : '{}',
    cache_ttl_seconds: source.cache_ttl_seconds ?? 600,
    timeout_seconds: source.timeout_seconds ?? 8,
    notes: source.notes ?? '',
  };
}

/** Body de POST/PUT: mesmo formato, sem `id` e sem campos de status. */
export function toPayload(source: AdminSource): SourcePayload {
  const { id: _id, last_status, last_error, last_success_at, ...rest } = source;
  void _id;
  void last_status;
  void last_error;
  void last_success_at;
  return rest;
}

export function parseMapping(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('o conteúdo precisa ser um objeto JSON `{}`.');
  }
  return parsed as Record<string, unknown>;
}

export function formToPayload(form: SourceForm): SourcePayload {
  let mapping: Record<string, unknown> = {};
  try {
    mapping = parseMapping(form.mappingText) ?? {};
  } catch {
    mapping = {};
  }
  return {
    name: form.name.trim(),
    kind: form.kind,
    enabled: form.enabled,
    priority: form.priority,
    capabilities: form.capabilities,
    base_url: form.base_url.trim(),
    api_key: form.api_key,
    headers: kvToRecord(form.headers),
    endpoints: kvToRecord(form.endpoints),
    mapping,
    cache_ttl_seconds: form.cache_ttl_seconds,
    timeout_seconds: form.timeout_seconds,
    notes: form.notes,
  };
}

/** Validações espelhando as do contrato (POST/PUT de fontes). */
export function validateForm(form: SourceForm): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('Informe o nome da fonte.');
  if (form.capabilities.length === 0) errors.push('Selecione ao menos uma capacidade.');
  if (!Number.isFinite(form.priority) || form.priority < 0) {
    errors.push('A prioridade precisa ser um número ≥ 0.');
  }
  if (form.kind !== 'static_json' && !/^https?:\/\//i.test(form.base_url.trim())) {
    errors.push('A URL base precisa começar com http:// ou https://.');
  }
  for (const row of form.endpoints) {
    const key = row.key.trim();
    if (key && !(CAPABILITIES as readonly string[]).includes(key)) {
      errors.push(`Endpoint com chave inválida: "${key}". Use uma capacidade conhecida.`);
    }
  }
  try {
    parseMapping(form.mappingText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Mapping JSON inválido: ${message}`);
  }
  return errors;
}

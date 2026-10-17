import type {
  AdminSource,
  AdminStatus,
  AppConfig,
  AuthStatus,
  AuthUser,
  BuildInfo,
  Dashboard,
  Layout,
  LiveMatch,
  ResetFileResult,
  RestoreItem,
  RestoreResult,
  SessionPayload,
  SourcePayload,
  SourceTestRequest,
  SourceTestResult,
  TeamCandidate,
} from './types';

/** Erro HTTP normalizado: sempre temos `status` + `detail` legível. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(detail: string, status: number) {
    super(detail);
    this.name = 'ApiError';
    this.detail = detail;
    this.status = status;
  }
}

/** Extrai uma mensagem legível de um corpo de erro JSON qualquer (`{"detail": "..."}`). */
function extractDetail(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.detail === 'string' && record.detail.length > 0) return record.detail;
  if (typeof record.message === 'string' && record.message.length > 0) return record.message;
  if (Array.isArray(record.detail)) {
    const parts = record.detail
      .map((item) => extractDetail(item))
      .filter((item): item is string => item !== null);
    if (parts.length > 0) return parts.join('; ');
  }
  if (record.detail !== undefined) {
    try {
      return JSON.stringify(record.detail);
    } catch {
      return String(record.detail);
    }
  }
  return null;
}

async function toDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        return extractDetail(parsed) ?? text.slice(0, 300);
      } catch {
        return text.slice(0, 300);
      }
    }
  } catch {
    /* corpo ilegível */
  }
  return res.statusText ? `Erro ${res.status}: ${res.statusText}` : `Erro ${res.status}`;
}

/**
 * Token de sessão guardado no cliente.
 *
 * Existe porque o cookie `SameSite=Lax` não sobrevive dentro de um iframe de
 * outro site — o caso real é o OndeJoga embutido no Home Assistant: o
 * navegador não envia o cookie em requisição cross-site e o login "pegava" só
 * de fachada. Sem HTTPS não dá para trocar por `None; Secure`, então o mesmo
 * token via `Authorization: Bearer` é a reserva (`api/app/deps.py` aceita os
 * dois).
 */
const TOKEN_KEY = 'ondejoga_token';

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage inacessível => fica só no cookie
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sem storage: o cookie continua sendo o caminho */
  }
}

/** Requisição JSON base: lança `ApiError` normalizado em qualquer falha. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const token = getSessionToken();
  try {
    res = await fetch(path, {
      // envia/recebe o cookie de sessão (httpOnly) junto com a requisição
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        // Reserva do cookie: em iframe de outro site é o header que segura.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('Falha de rede: não foi possível falar com o servidor.', 0);
  }

  if (!res.ok) {
    // Sessão recusada: esquece o token para não seguir mandando credencial
    // vencida. Login/registro ficam de fora — 401 lá é senha errada.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      setSessionToken(null);
    }
    throw new ApiError(await toDetail(res), res.status);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Resposta inválida do servidor (JSON esperado).', res.status);
  }
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export const api = {
  // --- contas ----------------------------------------------------------- //
  register: (username: string, password: string) =>
    request<SessionPayload>('/api/auth/register', {
      method: 'POST',
      ...json({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<SessionPayload>('/api/auth/login', {
      method: 'POST',
      ...json({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<AuthStatus>('/api/auth/me'),
  /** Troca usuário e/ou senha (a senha atual sempre é exigida). */
  updateProfile: (payload: { current_password: string; username?: string; new_password?: string }) =>
    request<{ user: AuthUser }>('/api/auth/profile', { method: 'PUT', ...json(payload) }),
  /** Gera senha temporária em `RESET-<usuario>.txt` na raiz do volume. */
  resetPasswordFile: () =>
    request<ResetFileResult>('/api/auth/reset-file', { method: 'POST' }),

  /** Zera os itens escolhidos de volta ao padrão; a senha atual é exigida. */
  restoreSettings: (payload: { current_password: string; items: RestoreItem[] }) =>
    request<RestoreResult>('/api/config/restore', { method: 'POST', ...json(payload) }),

  getConfig: () => request<AppConfig>('/api/config'),
  putConfig: (config: Partial<AppConfig>) =>
    request<AppConfig>('/api/config', { method: 'PUT', ...json(config) }),

  /** Busca times (TheSportsDB) para o onboarding e a troca de time. */
  searchTeams: (query: string) =>
    request<{ query: string; results: TeamCandidate[] }>(
      `/api/teams/search?q=${encodeURIComponent(query)}`,
    ),
  /** Escolhe o time do usuário; devolve a config já salva dele. */
  setMyTeam: (provider: string, id: string) =>
    request<AppConfig>('/api/config/team', { method: 'POST', ...json({ provider, id }) }),

  getLayout: () => request<Layout>('/api/layout'),
  putLayout: (layout: Layout) =>
    request<Layout>('/api/layout', { method: 'PUT', ...json(layout) }),
  resetLayout: () => request<Layout>('/api/layout/reset', { method: 'POST' }),

  getDashboard: () => request<Dashboard>('/api/dashboard'),
  /** Jogo em andamento agora; `null` quando o time não está jogando. */
  getLiveMatch: () => request<LiveMatch | null>('/api/live-match'),

  listSources: () => request<AdminSource[]>('/api/admin/sources'),
  createSource: (source: SourcePayload) =>
    request<AdminSource>('/api/admin/sources', { method: 'POST', ...json(source) }),
  updateSource: (id: number, source: SourcePayload) =>
    request<AdminSource>(`/api/admin/sources/${id}`, { method: 'PUT', ...json(source) }),
  deleteSource: (id: number) => request<void>(`/api/admin/sources/${id}`, { method: 'DELETE' }),
  testSource: (body: SourceTestRequest) =>
    request<SourceTestResult>('/api/admin/sources/test', { method: 'POST', ...json(body) }),
  getAdminStatus: () => request<AdminStatus>('/api/admin/status'),

  /** Release versionada + commit exato de pé, lidos do repositório pela API. */
  getBuildInfo: () => request<BuildInfo>('/api'),
};

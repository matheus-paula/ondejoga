// Tipos espelhando exatamente o contrato da API (docs/API_CONTRACT.md).

export type ThemePref = 'system' | 'light' | 'dark';
export type WidgetSize = 'sm' | 'md' | 'lg' | 'full';
export type WidgetType =
  | 'my_team'
  | 'team_header' // legado: fundido em `my_team`
  | 'next_match'
  | 'last_match'
  | 'live_match'
  | 'standings'
  | 'news'
  | 'stats' // legado: fundido em `my_team`
  | 'form';
export type SourceStatus = 'ok' | 'fallback' | 'error';
/** "league" = pontos corridos · "cup" = mata-mata (fases). */
export type CompetitionKind = 'league' | 'cup';

export type WidgetOptions = Record<string, unknown>;

/* ---------- config ---------- */

export interface TeamIds {
  thesportsdb?: string;
  espn?: string;
  /** Slug da liga na ESPN (ex.: `bra.1`); vem do time escolhido. */
  espn_league?: string;
  football_data?: string;
  api_football?: string;
}

export interface TeamConfig {
  name: string;
  short_name?: string;
  city?: string;
  state?: string;
  primary_color?: string;
  secondary_color?: string;
  logo?: string | null;
  ids?: TeamIds;
  competitions?: CompetitionRef[];
}

export interface CompetitionRef {
  id?: string | null;
  name: string;
  provider?: string;
  logo?: string | null;
  kind?: CompetitionKind | null;
}

export interface AppConfig {
  team: TeamConfig;
  timezone: string;
  locale: string;
  refresh_interval_seconds?: number;
  default_theme?: ThemePref;
  /**
   * `false` = o usuário ainda não escolheu o time (herda o global) e cai no
   * portão de onboarding; ausente/`true` = já tem time próprio.
   */
  owned?: boolean;
}

/** Sugestão da busca de times (`GET /api/teams/search`). */
export interface TeamCandidate {
  provider: string;
  id: string;
  name: string;
  short_name?: string | null;
  logo?: string | null;
  country?: string | null;
  league?: string | null;
}

/** Senha temporária gravada em `RESET-<usuario>.txt` na raiz do volume. */
export interface ResetFileResult {
  username: string;
  file: string;
  path: string;
  password: string;
}

/* ---------- restaurar (manutenção) ---------- */

/** Itens que o "restaurar" de Configurações consegue zerar. */
export type RestoreItem = 'sources' | 'layout' | 'config';

export interface RestoreResult {
  reset: RestoreItem[];
  /** Quantas fontes o reset apagou (se `sources` estava marcado). */
  sources_count: number;
}

/* ---------- contas ---------- */

export interface AuthUser {
  id: number;
  username: string;
  team_name?: string;
}

/** Login e registro devolvem o token junto: é a reserva do cookie no iframe. */
export interface SessionPayload {
  user: AuthUser;
  token: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: AuthUser | null;
}

/* ---------- dashboard ---------- */

export interface MatchTeam {
  id: string;
  name: string;
  logo?: string | null;
  score?: number | null;
}

export interface Venue {
  name?: string | null;
  city?: string | null;
}

export interface Broadcast {
  name: string;
  country?: string | null;
  url?: string | null;
  logo?: string | null;
}

export interface MatchCompetition {
  id?: string | null;
  name: string;
  logo?: string | null;
  kind?: CompetitionKind | null;
}

interface MatchCommon {
  id: string;
  competition: MatchCompetition | null;
  status?: string | null;
  round?: string | null;
  home: MatchTeam;
  away: MatchTeam;
  venue?: Venue | null;
  broadcasts?: Broadcast[] | null;
  source?: string | null;
}

export interface NextMatch extends MatchCommon {
  kickoff?: string | null;
}

export interface LastMatch extends MatchCommon {
  finished_at?: string | null;
}

/** Jogo em andamento agora (widget "Tempo Real"). */
export interface LiveMatch extends MatchCommon {
  kickoff?: string | null;
  is_live?: boolean | null;
}

export interface StandingRow {
  position: number;
  team: MatchTeam;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form?: string | null;
  note?: string | null;
}

/** Confronto de um mata-mata (chave), ex.: Cruzeiro x Flamengo. */
export interface BracketTie {
  /** Rótulo da chave na Wikipédia ("A", "S1", "F1"...). */
  label?: string | null;
  home: MatchTeam;
  away: MatchTeam;
  /** Placar agregado como texto ("4–1", "1–1 (4–5 p)"); null quando pendente. */
  aggregate?: string | null;
  /** Resultados por jogo, na ordem ("1–1", "3–0"). */
  legs?: string[] | null;
  /** Placar dos pênaltis ("4–5"), quando houve. */
  penalties?: string | null;
  winner?: 'home' | 'away' | null;
  /** false quando o confronto ainda será disputado. */
  decided?: boolean;
}

export interface StandingsTable {
  competition: MatchCompetition;
  season?: string | null;
  updated_at?: string | null;
  highlight_team_id?: string | null;
  rows: StandingRow[];
  /** "league" (pontos corridos) ou "cup" (mata-mata). */
  kind?: CompetitionKind | null;
  /** Nome do grupo quando a tabela é de fase de grupos (ex.: "Grupo A"). */
  group?: string | null;
  /** Fase do mata-mata (ex.: "Oitavas de final"). */
  stage?: string | null;
  /** Fase em que o time monitorado está. */
  team_stage?: string | null;
  /** Frase descritiva exibida no cabeçalho da tabela. */
  description?: string | null;
  /** Aba de fase a que esta tabela pertence (ex.: "Fase de grupos"). */
  phase?: string | null;
  /** Ordem da fase no torneio (menor = mais antiga); null = pontos corridos. */
  phase_order?: number | null;
  /** true na tabela da fase atual do time (aba padrão). */
  is_current?: boolean;
  /** false quando o time já foi eliminado da competição (null = não sabe). */
  team_alive?: boolean | null;
  /** Confrontos da fase eliminatória (quando não há tabela de classificação). */
  bracket?: BracketTie[] | null;
}

export interface NewsItem {
  id: string;
  title: string;
  summary?: string | null;
  url: string;
  image?: string | null;
  published_at?: string | null;
  source?: string | null;
}

export interface RecentFormEntry {
  id: string;
  date?: string | null;
  opponent?: string | null;
  result: 'W' | 'D' | 'L' | string;
  score?: string | null;
  venue?: 'home' | 'away' | string | null;
  competition?: string | null;
}

export interface TopScorer {
  name: string;
  goals: number;
  assists?: number | null;
  matches?: number | null;
}

export interface SeasonStats {
  competition?: string | null;
  position?: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form?: string | null;
}

export interface SplitStats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
}

export interface Stats {
  season?: SeasonStats | null;
  home?: SplitStats | null;
  away?: SplitStats | null;
  goals_scored?: number | null;
  goals_conceded?: number | null;
  clean_sheets?: number | null;
  avg_goals_scored?: number | null;
  avg_goals_conceded?: number | null;
  unbeaten_streak?: number | null;
  win_streak?: number | null;
  goalless_draws?: number | null;
  recent_form?: RecentFormEntry[] | null;
  top_scorers?: TopScorer[] | null;
}

export interface MetaSource {
  capability: string;
  source: string;
  status: SourceStatus;
  error?: string | null;
}

export interface DashboardMeta {
  generated_at?: string | null;
  cached?: boolean;
  sources?: MetaSource[] | null;
}

export interface Dashboard {
  team: TeamConfig;
  next_match?: NextMatch | null;
  last_match?: LastMatch | null;
  live_match?: LiveMatch | null;
  standings?: StandingsTable[] | null;
  news?: NewsItem[] | null;
  stats?: Stats | null;
  meta?: DashboardMeta | null;
}

/* ---------- layout ---------- */

export interface LayoutWidget {
  id: string;
  type: WidgetType;
  title: string;
  visible: boolean;
  order: number;
  size: WidgetSize;
  options: WidgetOptions;
}

export interface Layout {
  theme: { default: ThemePref; accent: string };
  refresh_interval_seconds: number;
  widgets: LayoutWidget[];
}

/* ---------- admin ---------- */

export const SOURCE_KINDS = [
  'thesportsdb',
  'espn',
  'rss',
  'football_data',
  'api_football',
  'url_json',
  'static_json',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CAPABILITIES = [
  'team',
  'standings',
  'next_match',
  'last_match',
  'live_match',
  'news',
  'stats',
  'tv',
  'broadcasts',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface AdminSource {
  id: number;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  priority: number;
  capabilities: string[];
  base_url: string;
  api_key?: string | null;
  headers?: Record<string, string> | null;
  endpoints?: Record<string, string> | null;
  mapping?: Record<string, unknown> | null;
  cache_ttl_seconds?: number | null;
  timeout_seconds?: number | null;
  notes?: string | null;
  last_status?: SourceStatus | null;
  last_error?: string | null;
  last_success_at?: string | null;
}

/** Body de POST/PUT de fonte: mesmo formato, sem `id` e sem campos de status. */
export type SourcePayload = Omit<
  AdminSource,
  'id' | 'last_status' | 'last_error' | 'last_success_at'
>;

export interface SourceTestRequest {
  id?: number;
  source?: SourcePayload;
  capability?: string;
}

export interface SourceTestResult {
  ok: boolean;
  status_code?: number | null;
  elapsed_ms?: number | null;
  url?: string | null;
  sample?: unknown;
  normalized?: unknown;
  error?: string | null;
}

export interface CapabilityStatus {
  capability: string;
  active_source?: string | null;
  status?: SourceStatus | null;
  error?: string | null;
  last_success_at?: string | null;
  fallbacks_available?: string[] | null;
}

export interface AdminStatus {
  capabilities: CapabilityStatus[];
}

/**
 * O que está de pé, na API.
 *
 * `version` é a release versionada (muda quando se corta uma release);
 * `commit`, `branch`, `tag` e `dirty` vêm do repositório em tempo de execução
 * e mudam sozinhos a cada commit — mesmo esquema do `pihole -v`.
 * `source` diz de onde veio: `git`, ou só `release` quando não há repositório.
 *
 * `update_available` é a comparação com o remoto: `true` quando há commit lá
 * que ainda não chegou aqui, `false` quando estamos em dia, e `null` quando não
 * deu para saber (sem repositório ou sem rede). Não aparece em `/api/health`,
 * que é o healthcheck dos containers e não pode depender do GitHub.
 */
export interface BuildInfo {
  version: string;
  commit: string | null;
  branch: string | null;
  tag: string | null;
  dirty: boolean;
  source: 'git' | 'release';
  update_available: boolean | null;
}

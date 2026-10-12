// Rótulos em português para capacidades, status, tipos de widget e métricas.

import { STATS_METRIC_KEYS, type StatsMetricKey } from './widgetOptions';

const CAPABILITY_LABELS: Record<string, string> = {
  team: 'Time',
  standings: 'Tabela',
  next_match: 'Próximo jogo',
  last_match: 'Último jogo',
  live_match: 'Jogo ao vivo',
  news: 'Notícias',
  stats: 'Estatísticas',
  tv: 'TV',
  broadcasts: 'Transmissões',
};

export function capabilityLabel(key: string): string {
  return CAPABILITY_LABELS[key] ?? key;
}

const STATUS_LABELS: Record<string, string> = {
  ok: 'ok',
  fallback: 'fallback',
  error: 'erro',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export const WIDGET_TYPE_LABELS: Record<string, string> = {
  my_team: 'Meu Time',
  team_header: 'Cabeçalho do time (legado)',
  next_match: 'Próximo jogo',
  last_match: 'Último jogo',
  live_match: 'Tempo Real',
  standings: 'Tabelas',
  news: 'Notícias',
  stats: 'Estatísticas (legado)',
  form: 'Últimos resultados',
};

export function widgetTypeLabel(type: string): string {
  return WIDGET_TYPE_LABELS[type] ?? type;
}

/** Descrição curta do formato da competição (liga = pontos corridos, copa = fases). */
export const COMPETITION_KIND_LABELS: Record<string, string> = {
  league: 'Pontos corridos',
  cup: 'Mata-mata',
};

export function competitionKindLabel(kind?: string | null): string | null {
  return kind ? (COMPETITION_KIND_LABELS[kind] ?? kind) : null;
}

export const KIND_LABELS: Record<string, string> = {
  thesportsdb: 'TheSportsDB',
  espn: 'ESPN',
  rss: 'RSS',
  football_data: 'football-data.org',
  api_football: 'API-Football',
  url_json: 'URL JSON (genérico)',
  static_json: 'JSON estático',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export const STATS_METRIC_LABELS: Record<StatsMetricKey, string> = {
  position: 'Posição',
  points: 'Pontos',
  played: 'Jogos',
  record: 'V-E-D',
  goals_for: 'Gols marcados',
  goals_against: 'Gols sofridos',
  goal_difference: 'Saldo de gols',
  win_rate: 'Aproveitamento',
  avg_goals: 'Média de gols',
  clean_sheets: 'Jogos sem sofrer gol',
};

export function statsMetricLabel(key: string): string {
  return STATS_METRIC_LABELS[key as StatsMetricKey] ?? key;
}

export const ALL_STATS_METRICS: readonly StatsMetricKey[] = STATS_METRIC_KEYS;

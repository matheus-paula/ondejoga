// Fixtures compartilhadas pelos testes (formato do contrato da API).

import type { AdminSource, AdminStatus, AppConfig, Dashboard, Layout } from '../api/types';

export const configFixture: AppConfig = {
  team: {
    name: 'Cruzeiro',
    short_name: 'Cruzeiro',
    city: 'Belo Horizonte',
    state: 'MG',
    primary_color: '#0093EC',
    secondary_color: '#FFFFFF',
    logo: 'https://example.com/badge.png',
    ids: {
      thesportsdb: '134294',
      espn: '2022',
      football_data: '',
      api_football: '135',
    },
    competitions: [{ id: '4351', name: 'Brasileirão Série A', provider: 'thesportsdb' }],
  },
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  refresh_interval_seconds: 300,
  default_theme: 'system',
};

export const layoutFixture: Layout = {
  theme: { default: 'system', accent: 'auto' },
  refresh_interval_seconds: 300,
  widgets: [
    {
      id: 'my_team',
      type: 'my_team',
      title: 'Meu Time',
      visible: true,
      order: 0,
      size: 'sm',
      options: {},
    },
    {
      id: 'next_match',
      type: 'next_match',
      title: 'Próximo Jogo',
      visible: true,
      order: 1,
      size: 'md',
      options: {},
    },
    {
      id: 'standings',
      type: 'standings',
      title: 'Tabelas',
      visible: true,
      order: 2,
      size: 'lg',
      options: { max_rows: 20, competitions: [] },
    },
  ],
};

/** Dashboard de exemplo; `kickoff` parametrizável para testes de data/countdown. */
export function makeDashboard(kickoff: string): Dashboard {
  return {
    team: configFixture.team,
    next_match: {
      id: '2398483',
      competition: { id: '4351', name: 'Brasileirão Série A', logo: 'https://example.com/cbf.png' },
      kickoff,
      status: 'NS',
      round: '30',
      home: {
        id: '134736',
        name: 'Bragantino',
        logo: 'https://example.com/bragantino.png',
        score: null,
      },
      away: {
        id: '134294',
        name: 'Cruzeiro',
        logo: 'https://example.com/badge.png',
        score: null,
      },
      venue: { name: 'Estádio Cicero de Souza Marques', city: null },
      broadcasts: [],
      source: 'thesportsdb',
    },
    last_match: {
      id: '2398474',
      competition: { id: '4351', name: 'Brasileirão Série A', logo: 'https://example.com/cbf.png' },
      finished_at: '2026-10-08T00:30:00Z',
      status: 'FT',
      round: '29',
      home: { id: '134294', name: 'Cruzeiro', logo: 'https://example.com/badge.png', score: 2 },
      away: { id: '134434', name: 'São Paulo', logo: 'https://example.com/saopaulo.png', score: 0 },
      venue: { name: 'Mineirão', city: 'Belo Horizonte' },
      broadcasts: [],
      source: 'thesportsdb',
    },
    standings: [
      {
        competition: { id: '4351', name: 'Brasileirão Série A', logo: 'https://example.com/cbf.png' },
        season: '2026',
        updated_at: '2026-10-11T10:00:01Z',
        highlight_team_id: '134294',
        rows: [
          {
            position: 1,
            team: { id: '134287', name: 'Flamengo', logo: 'https://example.com/flamengo.png' },
            played: 29,
            won: 18,
            drawn: 7,
            lost: 4,
            goals_for: 57,
            goals_against: 25,
            goal_difference: 32,
            points: 61,
            form: 'DWWWW',
            note: null,
          },
          {
            position: 2,
            team: { id: '134276', name: 'Palmeiras', logo: 'https://example.com/palmeiras.png' },
            played: 29,
            won: 17,
            drawn: 8,
            lost: 4,
            goals_for: 50,
            goals_against: 28,
            goal_difference: 22,
            points: 59,
            form: 'WWEDW',
            note: null,
          },
          {
            position: 6,
            team: { id: '134294', name: 'Cruzeiro', logo: 'https://example.com/badge.png' },
            played: 28,
            won: 13,
            drawn: 6,
            lost: 9,
            goals_for: 42,
            goals_against: 40,
            goal_difference: 2,
            points: 45,
            form: 'WLWLW',
            note: 'Libertadores (fase de grupos)',
          },
          {
            position: 7,
            team: { id: '134349', name: 'Bahia', logo: 'https://example.com/bahia.png' },
            played: 29,
            won: 12,
            drawn: 8,
            lost: 9,
            goals_for: 38,
            goals_against: 35,
            goal_difference: 3,
            points: 44,
            form: 'EDWDL',
            note: null,
          },
        ],
      },
    ],
    news: [
      {
        id: 'n1',
        title: 'Cruzeiro negocia reforço para o meio-campo',
        summary: '',
        url: 'https://example.com/noticia-1',
        image: null,
        published_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
        source: 'Google Notícias',
      },
    ],
    stats: {
      season: {
        competition: 'Brasileirão Série A',
        position: 6,
        played: 28,
        won: 13,
        drawn: 6,
        lost: 9,
        goals_for: 42,
        goals_against: 40,
        goal_difference: 2,
        points: 45,
        form: 'WLWLW',
      },
      home: { played: 14, won: 7, drawn: 4, lost: 3, goals_for: 22, goals_against: 14 },
      away: { played: 14, won: 6, drawn: 2, lost: 6, goals_for: 20, goals_against: 26 },
      goals_scored: 42,
      goals_conceded: 40,
      clean_sheets: 8,
      avg_goals_scored: 1.5,
      avg_goals_conceded: 1.43,
      unbeaten_streak: 1,
      win_streak: 1,
      goalless_draws: 3,
      recent_form: [
        {
          id: 'r1',
          date: '2026-10-08',
          opponent: 'São Paulo',
          result: 'W',
          score: '2-0',
          venue: 'home',
          competition: 'Brasileirão Série A',
        },
      ],
      top_scorers: [{ name: 'Matheus Pereira', goals: 9, assists: 6, matches: 25 }],
    },
    meta: {
      generated_at: '2026-10-11T14:00:00Z',
      cached: false,
      sources: [
        { capability: 'standings', source: 'thesportsdb', status: 'ok', error: null },
        { capability: 'news', source: 'rss', status: 'fallback', error: 'timeout' },
      ],
    },
  };
}

export const sourcesFixture: AdminSource[] = [
  {
    id: 1,
    name: 'TheSportsDB',
    kind: 'thesportsdb',
    enabled: true,
    priority: 10,
    capabilities: ['team', 'standings', 'next_match', 'last_match', 'stats', 'tv'],
    base_url: 'https://www.thesportsdb.com/api/v1/json/{api_key}/',
    api_key: '3',
    headers: {},
    endpoints: {
      standings: 'lookuptable.php?l={competition_id}&s={season}',
      next_match: 'eventsnextall.php?id={team_id}',
    },
    mapping: {},
    cache_ttl_seconds: 600,
    timeout_seconds: 8,
    notes: '',
    last_status: 'ok',
    last_error: null,
    last_success_at: '2026-10-11T14:00:00Z',
  },
];

export const adminStatusFixture: AdminStatus = {
  capabilities: [
    {
      capability: 'standings',
      active_source: 'thesportsdb',
      status: 'ok',
      error: null,
      last_success_at: '2026-10-11T14:00:00Z',
      fallbacks_available: ['url_json'],
    },
  ],
};

/** Response fake compatível com o pouco que o cliente HTTP usa. */
export function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Erro',
    headers: { get: () => 'application/json' },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MyTeamWidget } from '../components/widgets/MyTeamWidget';
import { StandingsWidget } from '../components/widgets/StandingsWidget';
import { LastMatchWidget } from '../components/widgets/LastMatchWidget';
import { NewsWidget } from '../components/widgets/NewsWidget';
import { accentFor, parseHex, rgbToHsl, teamThemeTokens, toHex } from '../lib/color';
import { configFixture, makeDashboard } from '../test/fixtures';
import type { LayoutWidget, StandingsTable } from '../api/types';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

function widget(type: LayoutWidget['type'], options: Record<string, unknown> = {}): LayoutWidget {
  return { id: type, type, title: '', visible: true, order: 0, size: 'md', options };
}

describe('tema derivado do time', () => {
  it('converte hex nos espaços de cor esperados', () => {
    expect(parseHex('#0093EC')).toEqual({ r: 0, g: 147, b: 236 });
    expect(parseHex('abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHex('#GHIJKL')).toBeNull();
    expect(parseHex(null)).toBeNull();

    expect(toHex({ r: 0, g: 147, b: 236 })).toBe('#0093ec');
    expect(rgbToHsl({ r: 255, g: 0, b: 0 }).h).toBeCloseTo(0, 0);
  });

  it('mantém o accent legível nos dois modos', () => {
    const light = teamThemeTokens('#FFD700', 'light').accent;
    const dark = teamThemeTokens('#FFD700', 'dark').accent;
    // claro: não pode ser claro demais | escuro: não pode ser escuro demais
    expect(rgbToHsl(parseHex(light)!).l).toBeLessThanOrEqual(0.55);
    expect(rgbToHsl(parseHex(dark)!).l).toBeGreaterThanOrEqual(0.5);
    expect(accentFor('#FFD700', 'light')).not.toBe(accentFor('#FFD700', 'dark'));
  });

  it('gera paletas distintas para claro e escuro, com fundo e superfície próprios', () => {
    const light = teamThemeTokens('#0093EC', 'light');
    const dark = teamThemeTokens('#0093EC', 'dark');

    expect(light.bg).not.toBe(dark.bg);
    expect(light.surface).not.toBe(dark.surface);
    // fundo claro bem claro, fundo escuro bem escuro
    expect(rgbToHsl(parseHex(light.bg)!).l).toBeGreaterThan(0.9);
    expect(rgbToHsl(parseHex(dark.bg)!).l).toBeLessThan(0.2);
    // todas as cores são hex válidos
    for (const value of Object.values(light)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    for (const value of Object.values(dark)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('cai numa cor padrão quando a cor do time é inválida', () => {
    expect(teamThemeTokens('cor-invalida', 'light').accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(teamThemeTokens(undefined, 'dark').bg).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('widget "Meu Time"', () => {
  it('reúne identidade do clube e estatísticas num cartão só', () => {
    const data = makeDashboard(kickoff);
    render(
      <MyTeamWidget widget={widget('my_team')} data={data} config={configFixture} />,
    );

    // cabeçalho do clube
    expect(screen.getByRole('heading', { name: 'Cruzeiro' })).toBeInTheDocument();
    expect(screen.getByAltText('Escudo do Cruzeiro')).toBeInTheDocument();
    expect(screen.getByText('Belo Horizonte · MG')).toBeInTheDocument();
    const record = document.querySelector('[data-testid="team-record"]');
    expect(record?.textContent).toContain('6º lugar');
    expect(record?.textContent).toContain('em Brasileirão Série A');
    expect(record?.textContent).toContain('45 pontos');

    // estatísticas antes fundidas em outro widget
    expect(screen.getByText('Aproveitamento')).toBeInTheDocument();
    expect(screen.getByText('Marcados')).toBeInTheDocument();
    expect(screen.getByText('Forma recente')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Artilheiros' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="scorers-table"]')).not.toBeNull();
  });

  it('respeita as opções de métricas e dos blocos opcionais', () => {
    const data = makeDashboard(kickoff);
    render(
      <MyTeamWidget
        widget={widget('my_team', { metrics: ['points'], show_chart: false, show_top_scorers: false })}
        data={data}
        config={configFixture}
      />,
    );

    expect(screen.getByText('Pontos')).toBeInTheDocument();
    expect(screen.queryByText('Aproveitamento')).not.toBeInTheDocument();
    expect(screen.queryByText('Marcados')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Artilheiros' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="scorers-table"]')).toBeNull();
  });

  it('mostra estado vazio quando não há estatísticas', () => {
    const data = makeDashboard(kickoff);
    data.stats = null;
    render(<MyTeamWidget widget={widget('my_team')} data={data} config={configFixture} />);

    expect(screen.getByRole('heading', { name: 'Cruzeiro' })).toBeInTheDocument();
    expect(screen.getByText('Sem estatísticas disponíveis.')).toBeInTheDocument();
  });
});

describe('descrição das competições nas tabelas', () => {
  function cupTable(): StandingsTable {
    return {
      competition: { id: '4725', name: 'Copa do Brasil', kind: 'cup' },
      season: '2026',
      updated_at: null,
      highlight_team_id: '134294',
      rows: [],
      kind: 'cup',
      stage: 'Quartas de final',
      team_stage: 'Quartas de final',
      description: 'Copa do Brasil — Quartas de final',
    };
  }

  it('descreve a competição, o formato e a fase atual do mata-mata', () => {
    const data = makeDashboard(kickoff);
    data.standings = [cupTable()];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    expect(screen.getByText('Copa do Brasil', { selector: '[data-testid="standings-title"]' })).toBeInTheDocument();
    const meta = document.querySelector('[data-testid="standings-meta"]');
    expect(meta?.textContent).toContain('Mata-mata');
    expect(meta?.textContent).toContain('Fase atual: Quartas de final');
    expect(meta?.textContent).toContain('temporada 2026');
    // sem linhas => só a fase, em vez de tabela vazia
    expect(screen.getByText('Quartas de final')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('rotula grupos de fase de grupos nas abas', () => {
    const data = makeDashboard(kickoff);
    data.standings = [
      {
        ...cupTable(),
        competition: { id: '4501', name: 'Copa Libertadores', kind: 'league' },
        kind: 'league',
        stage: null,
        team_stage: null,
        group: 'Grupo D',
        rows: [
          {
            position: 1,
            team: { id: '1', name: 'Time A', logo: null },
            played: 6,
            won: 4,
            drawn: 1,
            lost: 1,
            goals_for: 10,
            goals_against: 4,
            goal_difference: 6,
            points: 13,
            form: 'VVEVD',
            note: null,
          },
        ],
      },
      {
        ...cupTable(),
        competition: { id: '4501', name: 'Copa Libertadores', kind: 'league' },
        kind: 'league',
        stage: null,
        team_stage: null,
        group: 'Grupo B',
        rows: [],
      },
    ];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    // abas de grupo (a competição é única => sem aba de competição)
    expect(screen.getByRole('tablist', { name: 'Grupos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grupo D' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grupo B' })).toBeInTheDocument();
    const meta = document.querySelector('[data-testid="standings-meta"]');
    expect(meta?.textContent).toContain('Grupo D');
    expect(meta?.textContent).not.toContain('Mata-mata');
  });
});

/* -------------------------------------------------------------------------- *
 * Rodada 3: abas de competição/fase, eliminação e mata-mata
 * -------------------------------------------------------------------------- */

function leagueTable(): StandingsTable {
  return {
    competition: { id: '4351', name: 'Brasileirão Série A', kind: 'league' },
    season: '2026',
    updated_at: null,
    highlight_team_id: '134294',
    kind: 'league',
    rows: [
      {
        position: 5,
        team: { id: '134294', name: 'Cruzeiro', logo: null },
        played: 29,
        won: 13,
        drawn: 9,
        lost: 7,
        goals_for: 38,
        goals_against: 27,
        goal_difference: 11,
        points: 48,
        form: 'VVEVD',
        note: null,
      },
    ],
  };
}

function cupPhase(
  stage: string,
  { isCurrent, alive }: { isCurrent: boolean; alive: boolean | null },
): StandingsTable {
  return {
    competition: { id: '4725', name: 'Copa do Brasil', kind: 'cup' },
    season: '2026',
    updated_at: null,
    highlight_team_id: '134294',
    kind: 'cup',
    rows: [],
    stage,
    team_stage: 'Quartas de final',
    phase: stage,
    phase_order: stage === 'Oitavas de final' ? 2 : 3,
    is_current: isCurrent,
    team_alive: alive,
  };
}

function eliminatedCup(): StandingsTable {
  return {
    competition: { id: '4501', name: 'Copa Libertadores', kind: 'cup' },
    season: '2026',
    updated_at: null,
    highlight_team_id: '134294',
    kind: 'cup',
    rows: [],
    stage: 'Oitavas de final',
    team_stage: 'Oitavas de final',
    phase: 'Oitavas de final',
    phase_order: 2,
    is_current: true,
    team_alive: false,
  };
}

describe('abas de competição e fase', () => {
  it('lista as competições em abas e oculta as que eliminaram o time', () => {
    const data = makeDashboard(kickoff);
    data.standings = [
      leagueTable(),
      cupPhase('Oitavas de final', { isCurrent: false, alive: true }),
      cupPhase('Quartas de final', { isCurrent: true, alive: true }),
      eliminatedCup(),
    ];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    const comps = screen.getByRole('tablist', { name: 'Competições' });
    expect(within(comps).getByRole('tab', { name: 'Brasileirão Série A' })).toBeInTheDocument();
    expect(within(comps).getByRole('tab', { name: 'Copa do Brasil' })).toBeInTheDocument();
    // time eliminado => competição some por padrão
    expect(within(comps).queryByRole('tab', { name: 'Copa Libertadores' })).toBeNull();

    // a fase padrão é a atual do time
    fireEvent.click(within(comps).getByRole('tab', { name: 'Copa do Brasil' }));
    const phases = screen.getByRole('tablist', { name: 'Fases' });
    expect(within(phases).getByRole('tab', { name: 'Quartas de final' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(phases).getByRole('tab', { name: 'Oitavas de final' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('troca de fase ao clicar na aba', () => {
    const data = makeDashboard(kickoff);
    data.standings = [
      cupPhase('Oitavas de final', { isCurrent: false, alive: true }),
      cupPhase('Quartas de final', { isCurrent: true, alive: true }),
    ];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    const phases = () => screen.getByRole('tablist', { name: 'Fases' });
    fireEvent.click(within(phases()).getByRole('tab', { name: 'Oitavas de final' }));
    expect(within(phases()).getByRole('tab', { name: 'Oitavas de final' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.querySelector('[data-testid="standings-meta"]')?.textContent).toContain(
      'Oitavas de final',
    );
    expect(document.querySelector('[data-testid="standings-meta"]')?.textContent).toContain(
      'fase atual: Quartas de final',
    );
  });

  it('mostra a competição eliminada quando hide_eliminated é desligado', () => {
    const data = makeDashboard(kickoff);
    data.standings = [leagueTable(), eliminatedCup()];

    render(
      <StandingsWidget
        widget={widget('standings', { hide_eliminated: false })}
        data={data}
        config={configFixture}
      />,
    );

    expect(
      within(screen.getByRole('tablist', { name: 'Competições' })).getByRole('tab', {
        name: 'Copa Libertadores',
      }),
    ).toBeInTheDocument();
  });

  it('esconde a competição eliminada mesmo sem a opção explícita (padrão)', () => {
    const data = makeDashboard(kickoff);
    data.standings = [leagueTable(), eliminatedCup()];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    expect(screen.queryByRole('tab', { name: 'Copa Libertadores' })).toBeNull();
    expect(screen.getByText('Brasileirão Série A', { selector: '[data-testid="standings-title"]' })).toBeInTheDocument();
  });
});

describe('mata-mata em chaves', () => {
  function bracketTable(): StandingsTable {
    return {
      competition: { id: '4725', name: 'Copa do Brasil', kind: 'cup' },
      season: '2026',
      updated_at: null,
      highlight_team_id: '134294',
      kind: 'cup',
      rows: [],
      stage: 'Quartas de final',
      team_stage: 'Quartas de final',
      phase: 'Quartas de final',
      phase_order: 3,
      is_current: true,
      team_alive: true,
      bracket: [
        {
          label: 'F1',
          home: {
            id: '134294',
            name: 'Cruzeiro',
            logo: 'https://example.com/badge.png',
            score: 4,
          },
          away: { id: '999', name: 'Time Fora', logo: null, score: 1 },
          aggregate: '4–1',
          legs: ['2–1', '2–0'],
          penalties: null,
          winner: 'home',
          decided: true,
        },
        {
          label: 'F2',
          home: { id: '111', name: 'Time Um', logo: null, score: null },
          away: { id: '222', name: 'Time Dois', logo: null, score: null },
          aggregate: null,
          legs: null,
          penalties: null,
          winner: null,
          decided: false,
        },
      ],
    };
  }

  it('renderiza cada confronto com escudos, placar e vencedor destacado', () => {
    const data = makeDashboard(kickoff);
    data.standings = [bracketTable()];

    render(<StandingsWidget widget={widget('standings')} data={data} config={configFixture} />);

    const ties = document.querySelectorAll('[data-testid="bracket-tie"]');
    expect(ties).toHaveLength(2);

    const decided = ties[0] as HTMLElement;
    expect(decided).toHaveAttribute('data-decided');
    expect(within(decided).getByText('Cruzeiro')).toBeInTheDocument();
    expect(within(decided).getByText('Time Fora')).toBeInTheDocument();
    expect(within(decided).getByText('4–1')).toBeInTheDocument();
    expect(within(decided).getByText('2–1 · 2–0')).toBeInTheDocument();
    expect(decided.querySelector('[data-testid="bracket-side"][data-winner] [data-testid="bracket-team-name"]')?.textContent).toBe(
      'Cruzeiro',
    );
    expect(decided.querySelector('[data-testid="bracket-side"][data-self] img')?.getAttribute('src')).toBe(
      'https://example.com/badge.png',
    );

    const pending = ties[1] as HTMLElement;
    expect(pending).not.toHaveAttribute('data-decided');
    expect(within(pending).getByText('a definir')).toBeInTheDocument();
    expect(pending.querySelector('[data-testid="bracket-side"][data-winner]')).toBeNull();

    // sem tabela de classificação, só a chave
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="standings-footer"]')?.textContent).toContain('2 confrontos');
  });
});

describe('escudos no Último Jogo', () => {
  it('mostra os dois escudos no placar', () => {
    const data = makeDashboard(kickoff);
    render(<LastMatchWidget widget={widget('last_match')} data={data} config={configFixture} />);

    const card = document.querySelector('[data-widget="last-match"]') as HTMLElement;
    const crests = [...card.querySelectorAll('[data-testid="team-crest"]')];
    expect(crests).toHaveLength(2);
    expect(crests[0].getAttribute('src')).toBe('https://example.com/badge.png');
    expect(crests[1].getAttribute('src')).toBe('https://example.com/saopaulo.png');
    expect(card.querySelector('[data-testid="match-teams"]')?.textContent).toContain('Cruzeiro');
    expect(card.querySelector('[data-testid="match-teams"]')?.textContent).toContain('São Paulo');
  });
});

describe('notícias', () => {
  it('sem imagem usa o placeholder', () => {
    const data = makeDashboard(kickoff);
    const original = data.news?.[0];
    if (!original) throw new Error('fixture sem notícia');
    data.news = [{ ...original, image: null }];
    render(<NewsWidget widget={widget('news')} data={data} config={configFixture} />);

    expect(document.querySelector('[data-testid="news-thumb"][data-placeholder]')).not.toBeNull();
    expect(document.querySelector('img[data-testid="news-thumb"]')).toBeNull();
  });

  it('com imagem renderiza a miniatura dentro do link', () => {
    const data = makeDashboard(kickoff);
    const original = data.news?.[0];
    if (!original) throw new Error('fixture sem notícia');
    data.news = [{ ...original, image: 'https://example.com/thumb.jpg' }];
    render(<NewsWidget widget={widget('news')} data={data} config={configFixture} />);

    const img = document.querySelector('img[data-testid="news-thumb"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/thumb.jpg');
    expect(img?.closest('a')?.getAttribute('href')).toBe(original.url);
  });
});

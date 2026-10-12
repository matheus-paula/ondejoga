import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StandingsWidget } from '../components/widgets/StandingsWidget';
import { configFixture, makeDashboard } from '../test/fixtures';
import type { LayoutWidget } from '../api/types';

function widget(options: Record<string, unknown> = {}): LayoutWidget {
  return {
    id: 'standings',
    type: 'standings',
    title: 'Tabelas',
    visible: true,
    order: 0,
    size: 'lg',
    options,
  };
}

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

describe('widget standings', () => {
  it('renderiza as colunas corretas (Pos/J/V/E/D/GP/GC/SG/P) com tooltips', () => {
    render(
      <StandingsWidget
        widget={widget()}
        data={makeDashboard(kickoff)}
        config={configFixture}
      />,
    );

    const expectedHeaders = [
      'Posição',
      'Time',
      'Jogos',
      'Vitórias',
      'Empates',
      'Derrotas',
      'Gols pró',
      'Gols contra',
      'Saldo de gols',
      'Pontos',
    ];
    for (const name of expectedHeaders) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('destaca a linha do time com a cor do time e mostra os números certos', () => {
    render(
      <StandingsWidget
        widget={widget()}
        data={makeDashboard(kickoff)}
        config={configFixture}
      />,
    );

    const teamCell = screen.getByText('Cruzeiro');
    const row = teamCell.closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('is-team');
    // cor primária do time (#0093EC) aplicada como fundo da linha
    expect(row?.getAttribute('style')).toContain('rgba(0, 147, 236');

    const rowElement = row as HTMLElement;
    expect(within(rowElement).getByRole('rowheader')).toHaveTextContent('6'); // posição
    expect(within(rowElement).getByText('45')).toBeInTheDocument(); // pontos

    // outras linhas não são destacadas
    const otherRow = screen.getByText('Flamengo').closest('tr');
    expect(otherRow).not.toHaveClass('is-team');
  });

  it('renderiza o form como círculos coloridos (V/E/D)', () => {
    render(
      <StandingsWidget
        widget={widget()}
        data={makeDashboard(kickoff)}
        config={configFixture}
      />,
    );

    const row = screen.getByText('Cruzeiro').closest('tr') as HTMLElement;
    const dots = within(row).getAllByTitle(/(Vitória|Empate|Derrota)/);
    expect(dots).toHaveLength(5); // "WLWLW"
    expect(dots.map((dot) => dot.textContent)).toEqual(['V', 'D', 'V', 'D', 'V']);
    expect(dots[0]).toHaveClass('form-dot--v');
    expect(dots[1]).toHaveClass('form-dot--d');
  });

  it('respeita options.competitions e options.max_rows', () => {
    const data = makeDashboard(kickoff);
    // segunda competição que NÃO deve aparecer com o filtro
    data.standings = [
      ...(data.standings ?? []),
      {
        competition: { id: '4332', name: 'Copa do Brasil' },
        season: '2026',
        updated_at: null,
        highlight_team_id: null,
        rows: [],
      },
    ];

    const { rerender } = render(
      <StandingsWidget
        widget={widget({ competitions: ['4351'], max_rows: 2 })}
        data={data}
        config={configFixture}
      />,
    );

    // competição filtrada => uma única tabela (sem abas); o cabeçalho descreve
    // de qual competição se trata
    expect(screen.getByText('Brasileirão Série A', { selector: '.standings-head-title' })).toBeInTheDocument();
    expect(screen.queryByText('Copa do Brasil')).not.toBeInTheDocument();
    // max_rows 2 => altura máxima do scroll = 2 * 40px + cabeçalho
    const scroll = document.querySelector('.standings-scroll');
    expect(scroll?.getAttribute('style')).toContain('max-height');

    rerender(
      <StandingsWidget widget={widget({ competitions: [] })} data={data} config={configFixture} />,
    );
    // vazio = todas as competições => abas aparecem
    expect(screen.getByRole('tab', { name: 'Brasileirão Série A' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Copa do Brasil' })).toBeInTheDocument();
  });
});

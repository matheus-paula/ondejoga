import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextMatchWidget } from '../components/widgets/NextMatchWidget';
import { configFixture, makeDashboard } from '../test/fixtures';
import type { Broadcast, LayoutWidget } from '../api/types';

function widget(options: Record<string, unknown> = {}): LayoutWidget {
  return {
    id: 'next_match',
    type: 'next_match',
    title: 'Próximo Jogo',
    visible: true,
    order: 0,
    size: 'md',
    options,
  };
}

/** 3 dias e 2h30 no futuro: margem segura para o arredondamento da contagem regressiva. */
function futureKickoff(): string {
  return new Date(Date.now() + 3 * 86_400_000 + 150 * 60_000).toISOString();
}

describe('widget next_match', () => {
  it('renderiza competição, times, data/hora no fuso configurado e contagem regressiva', () => {
    const kickoff = futureKickoff();
    render(
      <NextMatchWidget widget={widget()} data={makeDashboard(kickoff)} config={configFixture} />,
    );

    expect(screen.getByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    expect(screen.getByText(/Brasileirão Série A/)).toBeInTheDocument();
    expect(screen.getByText(/Rodada 30/)).toBeInTheDocument();
    expect(screen.getByText('Bragantino')).toBeInTheDocument();
    expect(screen.getByText('Cruzeiro')).toBeInTheDocument();
    expect(screen.getByText('Estádio Cicero de Souza Marques')).toBeInTheDocument();

    // Data e hora formatadas com locale/timezone da configuração (pt-BR / America/Sao_Paulo).
    const date = new Date(kickoff);
    const expectedDate = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
    const expectedTime = new Intl.DateTimeFormat('pt-BR', {
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
    expect(screen.getByText(expectedTime)).toBeInTheDocument();

    expect(screen.getByText('faltam 3d 2h')).toBeInTheDocument();
  });

  it('mostra "A definir" quando broadcasts é vazio', () => {
    const data = makeDashboard(futureKickoff());
    const match = data.next_match;
    if (!match) throw new Error('fixture inválida: next_match ausente');
    data.next_match = { ...match, broadcasts: [] };
    render(<NextMatchWidget widget={widget()} data={data} config={configFixture} />);

    expect(screen.getByText('Onde assistir')).toBeInTheDocument();
    expect(screen.getByText('A definir')).toBeInTheDocument();
    expect(screen.queryByText('Premiere')).not.toBeInTheDocument();
  });

  it('renderiza os nomes dos canais quando há broadcasts', () => {
    const data = makeDashboard(futureKickoff());
    const match = data.next_match;
    if (!match) throw new Error('fixture inválida: next_match ausente');
    const broadcasts: Broadcast[] = [
      { name: 'Premiere', country: 'BR', url: null, logo: null },
      { name: 'Globo', country: 'BR', url: null, logo: null },
    ];
    data.next_match = { ...match, broadcasts };
    render(<NextMatchWidget widget={widget()} data={data} config={configFixture} />);

    expect(screen.getByText('Premiere')).toBeInTheDocument();
    expect(screen.getByText('Globo')).toBeInTheDocument();
    expect(screen.queryByText('A definir')).not.toBeInTheDocument();
  });

  it('renderiza estado vazio quando não há próximo jogo', () => {
    const data = makeDashboard(futureKickoff());
    data.next_match = null;
    render(<NextMatchWidget widget={widget()} data={data} config={configFixture} />);

    expect(screen.getByText('Nenhum próximo jogo disponível.')).toBeInTheDocument();
  });
});

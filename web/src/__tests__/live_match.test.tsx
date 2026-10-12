import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextMatchWidget } from '../components/widgets/NextMatchWidget';
import { LastMatchWidget } from '../components/widgets/LastMatchWidget';
import { LiveMatchWidget } from '../components/widgets/LiveMatchWidget';
import { configFixture, makeDashboard } from '../test/fixtures';
import type { LayoutWidget, LiveMatch } from '../api/types';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

function widget(type: LayoutWidget['type'], options: Record<string, unknown> = {}): LayoutWidget {
  return { id: type, type, title: '', visible: true, order: 0, size: 'md', options };
}

const liveFixture: LiveMatch = {
  id: '401841266',
  competition: { id: 'bra.1', name: 'Brasileirão Série A', logo: null, kind: 'league' },
  kickoff: new Date(Date.now() - 50 * 60_000).toISOString(),
  status: "48'",
  round: null,
  home: { id: '9967', name: 'Bahia', logo: 'https://example.com/bahia.png', score: 1 },
  away: { id: '9169', name: 'Mirassol', logo: 'https://example.com/mirassol.png', score: 0 },
  venue: { name: 'Arena Fonte Nova', city: 'Salvador' },
  broadcasts: [],
  source: 'espn',
  is_live: true,
};

describe('padronização dos cartões de jogo', () => {
  it('Próximo e Último Jogo usam o mesmo escudo (44px) na mesma linha', () => {
    const data = makeDashboard(kickoff);
    const { container: next } = render(
      <NextMatchWidget widget={widget('next_match')} data={data} config={configFixture} />,
    );
    const nextCrests = [...next.querySelectorAll('.match-team-crest')];
    expect(nextCrests).toHaveLength(2);
    expect(nextCrests[0].getAttribute('width')).toBe('44');
    expect(nextCrests[1].getAttribute('width')).toBe('44');

    const { container: last } = render(
      <LastMatchWidget widget={widget('last_match')} data={data} config={configFixture} />,
    );
    const lastCrests = [...last.querySelectorAll('.match-team-crest')];
    expect(lastCrests).toHaveLength(2);
    // mesmo componente/estilo nos dois widgets
    expect(lastCrests[0].getAttribute('width')).toBe('44');
    expect(lastCrests[1].getAttribute('width')).toBe('44');
    expect(last.querySelector('.match-teams')).not.toBeNull();
    expect(next.querySelector('.match-teams')).not.toBeNull();
  });

  it('o placar fica ao lado do "×", não junto ao nome do clube', () => {
    const data = makeDashboard(kickoff);
    render(<LastMatchWidget widget={widget('last_match')} data={data} config={configFixture} />);

    const score = document.querySelector('.match-teams .match-score') as HTMLElement;
    expect(score).not.toBeNull();
    expect(score.textContent).toContain('2'); // gols do mando
    expect(score.textContent).toContain('0'); // gols do visitante
    expect(score.textContent).toContain('×');

    // a ordem no DOM é: escudo, nome | placar+x | nome, escudo
    const row = document.querySelector('.match-teams') as HTMLElement;
    const values = [...row.querySelectorAll('.match-team-name, .match-score')];
    expect(values.map((el) => el.className.split(' ')[0])).toEqual([
      'match-team-name',
      'match-score',
      'match-team-name',
    ]);
    // os gols NÃO ficam dentro dos blocos de nome
    expect(row.querySelector('.match-team-name')?.textContent).toBe('Cruzeiro');
  });
});

describe('widget Tempo Real', () => {
  it('mostra o placar atual, o "×" e o selo Ao vivo', () => {
    const data = makeDashboard(kickoff);
    data.live_match = liveFixture;
    render(<LiveMatchWidget widget={widget('live_match')} data={data} config={configFixture} />);

    expect(screen.getByTestId('live-badge').textContent).toMatch(/ao vivo/i);
    const score = document.querySelector('.match-teams .match-score') as HTMLElement;
    const values = [...score.querySelectorAll('.match-score-value')];
    expect(values.map((value) => value.textContent)).toEqual(['1', '0']);
    expect(score.textContent).toContain('×'); // placar colado no "×"
    expect(document.querySelector('.live-status')?.textContent).toBe("48'");
    expect(document.querySelector('.live-venue')?.textContent).toContain('Arena Fonte Nova');
    expect(screen.getByText('Brasileirão Série A')).toBeInTheDocument();
  });

  it('usa o mesmo escudo de 44px dos outros cartões', () => {
    const data = makeDashboard(kickoff);
    data.live_match = liveFixture;
    const { container } = render(
      <LiveMatchWidget widget={widget('live_match')} data={data} config={configFixture} />,
    );
    const crests = [...container.querySelectorAll('.match-team-crest')];
    expect(crests).toHaveLength(2);
    expect(crests[0].getAttribute('width')).toBe('44');
    expect(crests[0].getAttribute('src')).toBe('https://example.com/bahia.png');
    expect(crests[1].getAttribute('src')).toBe('https://example.com/mirassol.png');
  });

  it('some por completo quando o time não está jogando', () => {
    const data = makeDashboard(kickoff);
    data.live_match = null;
    const { container } = render(
      <LiveMatchWidget widget={widget('live_match')} data={data} config={configFixture} />,
    );
    expect(container.querySelector('.widget-card')).toBeNull();
  });

  it('respeita as opções de estádio e cronômetro', () => {
    const data = makeDashboard(kickoff);
    data.live_match = liveFixture;
    const { container } = render(
      <LiveMatchWidget
        widget={widget('live_match', { show_venue: false, show_status: false })}
        data={data}
        config={configFixture}
      />,
    );
    expect(container.querySelector('.live-venue')).toBeNull();
    expect(container.querySelector('.live-status')).toBeNull();
    expect(screen.getByTestId('live-badge')).toBeInTheDocument();
  });
});

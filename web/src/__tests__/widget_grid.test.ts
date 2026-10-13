import { describe, expect, it } from 'vitest';
import { visibleWidgets } from '../components/layout/WidgetGrid';
import { makeDashboard } from '../test/fixtures';
import type { LayoutWidget, LiveMatch } from '../api/types';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

function widget(type: LayoutWidget['type'], order: number): LayoutWidget {
  return { id: type, type, title: '', visible: true, order, size: 'md', options: {} };
}

/** O "último jogo" serve de base: tem o mesmo formato de um jogo em campo. */
function liveMatch(): LiveMatch {
  return { ...makeDashboard(kickoff).last_match, is_live: true } as LiveMatch;
}

describe('grade de widgets: Tempo Real x Próximo Jogo', () => {
  const layout = [widget('next_match', 0), widget('live_match', 1), widget('last_match', 2)];

  it('sem jogo em campo, mostra o Próximo Jogo e deixa o Tempo Real de fora', () => {
    const shown = visibleWidgets(layout, null).map((item) => item.type);
    expect(shown).toEqual(['next_match', 'last_match']);
  });

  it('com o jogo em campo, o Próximo Jogo sai e o Tempo Real entra', () => {
    const shown = visibleWidgets(layout, liveMatch()).map((item) => item.type);
    // o que está rolando é o tempo real: os dois juntos só confundem
    expect(shown).toEqual(['live_match', 'last_match']);
  });

  it('ordena por `order` e respeita `visible`', () => {
    const hidden = { ...widget('next_match', 0), visible: false };
    const shown = visibleWidgets([widget('last_match', 2), widget('my_team', 1), hidden], null);

    expect(shown.map((item) => item.type)).toEqual(['my_team', 'last_match']);
  });

  it('lista vazia ou ausente vira vazio (nunca estoura)', () => {
    expect(visibleWidgets([], null)).toEqual([]);
    expect(visibleWidgets(undefined, liveMatch())).toEqual([]);
  });
});

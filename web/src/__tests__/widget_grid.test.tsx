import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  WIDGET_GRID,
  WIDGET_SLOT,
  rowSpanFor,
  visibleWidgets,
} from '../components/layout/WidgetGrid';
import { SkeletonGrid } from '../components/ui/States';
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

describe('empacotamento da grade (cards fluem na própria altura)', () => {
  it('não estica o card: a célula fica com a altura do conteúdo', () => {
    // era o `items-start` que faltava: sem ele a célula virava a do card mais
    // alto da linha e sobrava papel pintado embaixo dos mais baixos.
    expect(WIDGET_GRID).toContain('items-start');
  });

  it('o vão vertical mora no slot, não no `gap` da grade', () => {
    // é o que fecha a aritmética: a altura medida do card já traz o vão de
    // baixo junto, então o span de faixas dá exato e a folga não oscila.
    expect(WIDGET_SLOT).toContain('pb-[18px]');
    expect(WIDGET_GRID).toContain('gap-x-[18px]');
    expect(WIDGET_GRID).not.toContain('gap-[');
    expect(WIDGET_GRID).not.toContain('gap-y-[');
  });

  it('altura vira span de faixas de 1px, e nunca vira span 0', () => {
    expect(rowSpanFor(280)).toBe('span 280');
    expect(rowSpanFor(1.2)).toBe('span 2');
    expect(rowSpanFor(1)).toBe('span 1');
    // jsdom devolve 0: um span 0 empurraria a célula para fora da grade
    expect(rowSpanFor(0)).toBe('span 1');
  });

  it('mede cada célula e grava o span dela antes de abrir as faixas de 1px', () => {
    const alturas = [120.5, 300, 64, 800];
    const medido = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
        return { height: alturas[index] ?? 0 } as DOMRect;
      });

    try {
      render(<SkeletonGrid />);

      const grade = screen.getAllByTestId('widget')[0].parentElement as HTMLElement;
      const celulas = screen.getAllByTestId('widget');
      expect(celulas.map((celula) => celula.style.gridRowEnd)).toEqual([
        'span 121',
        'span 300',
        'span 64',
        'span 800',
      ]);
      expect(grade.style.gridAutoRows).toBe('1px');
    } finally {
      medido.mockRestore();
    }
  });
});

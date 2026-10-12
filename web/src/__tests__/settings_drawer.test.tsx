import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { LayoutProvider } from '../context/LayoutContext';
import { DashboardView } from '../views/Dashboard';
import { configFixture, layoutFixture, jsonResponse, makeDashboard } from '../test/fixtures';
import type { Layout } from '../api/types';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/layout' && method === 'PUT') {
      return jsonResponse(JSON.parse(String(init?.body)) as Layout);
    }
    if (url === '/api/layout') return jsonResponse(layoutFixture);
    if (url === '/api/config') return jsonResponse(configFixture);
    if (url === '/api/auth/me') {
      return jsonResponse({
        authenticated: true,
        user: { id: 1, username: 'tester', team_name: 'Cruzeiro' },
      });
    }
    if (url === '/api/dashboard') return jsonResponse(makeDashboard(kickoff));
    throw new Error(`rota não mockada: ${method} ${url}`);
  });
}

describe('drawer Personalizar', () => {
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('alterna visibilidade, edita título, reordena e salva via PUT /api/layout', async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <LayoutProvider>
            <DashboardView />
          </LayoutProvider>
        </AuthProvider>
      </ThemeProvider>,
    );

    // painel carregado
    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tabelas' })).toBeInTheDocument();

    // abre o drawer
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog', { name: 'Personalizar' });

    // 1) oculta o widget "Tabelas" (aplicação otimista)
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Exibir widget Tabelas' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Tabelas' })).not.toBeInTheDocument(),
    );

    // 2) edita o título do "Próximo Jogo"
    const titleInput = within(dialog).getByLabelText('Título do widget Próximo jogo');
    fireEvent.change(titleInput, { target: { value: 'Jogo da Rodada' } });
    expect(await screen.findByRole('heading', { name: 'Jogo da Rodada' })).toBeInTheDocument();

    // 3) move "Tabelas" para cima (era o 3º widget)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Mover widget Tabelas para cima' }),
    );
    const titleInputs = within(dialog).getAllByLabelText(/^Título do widget/);
    expect(titleInputs[1]).toHaveValue('Tabelas');
    expect(titleInputs[2]).toHaveValue('Jogo da Rodada');

    // 4) salva
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/layout' && init?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit | undefined;
      const body = JSON.parse(String(init?.body)) as Layout;

      expect(body.theme).toEqual({ default: 'system', accent: 'auto' });
      expect(body.refresh_interval_seconds).toBe(300);
      expect(body.widgets.map((widget) => widget.order)).toEqual([0, 1, 2]);

      const standings = body.widgets.find((widget) => widget.id === 'standings');
      expect(standings?.visible).toBe(false);
      expect(standings?.order).toBe(1);
      expect(standings?.size).toBe('lg');
      expect(standings?.type).toBe('standings');

      const nextMatch = body.widgets.find((widget) => widget.id === 'next_match');
      expect(nextMatch?.title).toBe('Jogo da Rodada');

      // contrato: payload completo, sem campos extras
      expect(Object.keys(body).sort()).toEqual(
        ['refresh_interval_seconds', 'theme', 'widgets'].sort(),
      );
      for (const widget of body.widgets) {
        expect(Object.keys(widget).sort()).toEqual(
          ['id', 'options', 'order', 'size', 'title', 'type', 'visible'].sort(),
        );
      }
    });

    // drawer fecha após salvar com sucesso
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Personalizar' })).not.toBeInTheDocument(),
    );
  });

  it('descarta alterações ao cancelar', async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <LayoutProvider>
            <DashboardView />
          </LayoutProvider>
        </AuthProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog', { name: 'Personalizar' });

    fireEvent.click(within(dialog).getByRole('switch', { name: 'Exibir widget Tabelas' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Tabelas' })).not.toBeInTheDocument(),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('heading', { name: 'Tabelas' })).toBeInTheDocument();

    // nenhuma requisição de salvamento
    const putCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/layout' && init?.method === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });
});

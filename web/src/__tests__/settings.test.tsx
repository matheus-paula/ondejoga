import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { LayoutProvider } from '../context/LayoutContext';
import { SettingsView } from '../views/Settings';
import { configFixture, layoutFixture, jsonResponse } from '../test/fixtures';
import type { AppConfig, Layout } from '../api/types';

const USER = { id: 1, username: 'tester', team_name: 'Cruzeiro' };
const SEARCH_RESULTS = {
  query: 'cruzeiro',
  results: [
    {
      provider: 'thesportsdb',
      id: '134294',
      name: 'Cruzeiro',
      short_name: 'CRU',
      logo: 'https://example.com/badge.png',
      country: 'Brazil',
      league: 'Brasileirão Série A',
    },
  ],
};

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/teams/search')) return jsonResponse(SEARCH_RESULTS);
    if (url === '/api/config/team' && method === 'POST') return jsonResponse(configFixture);
    if (url === '/api/auth/profile' && method === 'PUT') return jsonResponse({ user: USER });
    if (url === '/api/auth/reset-file' && method === 'POST') {
      return jsonResponse({
        username: 'tester',
        file: 'RESET-tester.txt',
        path: '/ondejoga/RESET-tester.txt',
        password: 'a1b2-c3d4-e5f6-7890',
      });
    }
    if (url === '/api/layout' && method === 'POST') return jsonResponse(layoutFixture);
    if (url === '/api/layout' && method === 'PUT') {
      return jsonResponse(JSON.parse(String(init?.body)) as Layout);
    }
    if (url === '/api/layout') return jsonResponse(layoutFixture);
    if (url === '/api/config') return jsonResponse(configFixture);
    if (url === '/api/auth/me') return jsonResponse({ authenticated: true, user: USER });
    throw new Error(`rota não mockada: ${method} ${url}`);
  });
}

function renderSettings() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <LayoutProvider>
          <SettingsView />
        </LayoutProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('tela de Configurações', () => {
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renderiza as seções (conta, time, widgets) para usuário logado', async () => {
    renderSettings();

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configurações' })).toBeInTheDocument();

    for (const section of ['Conta', 'Time', 'Aparência', 'Widgets', 'Fontes de dados']) {
      expect(screen.getByRole('heading', { name: section, level: 2 })).toBeInTheDocument();
    }

    // time atual aparece preenchido
    expect(screen.getByText('Cruzeiro')).toBeInTheDocument();
    expect(screen.getByText(/134294/)).toBeInTheDocument();
  });

  it('renomeia a conta via PUT /api/auth/profile', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    fireEvent.change(screen.getByLabelText('Novo usuário'), { target: { value: 'novoNome' } });
    fireEvent.change(screen.getByLabelText('Senha atual (obrigatória)'), {
      target: { value: 'segredo123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar conta' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/auth/profile' && init?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as Record<string, string>;
      expect(body).toEqual({ current_password: 'segredo123', username: 'novoNome' });
    });
  });

  it('exige a senha atual para salvar a conta', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    const submit = screen.getByRole('button', { name: 'Salvar conta' });
    // sem senha atual o botão fica desabilitado e nada é enviado
    expect(submit).toBeDisabled();

    const putCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/auth/profile' && init?.method === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });

  it('gera o arquivo de reset e mostra o caminho + senha temporária', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: /Gerar senha temporária/ }));
    // confirmação inline antes de disparar
    expect(screen.getByRole('group', { name: 'Confirmar geração' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sim, gerar arquivo/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/auth/reset-file' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
    });

    expect(await screen.findByTestId('temp-password')).toHaveTextContent('a1b2-c3d4-e5f6-7890');
    expect(within(screen.getByTestId('reset-file')).getByText(/RESET-tester\.txt/)).toBeInTheDocument();
  });

  it('busca o time e salva a troca via POST /api/config/team', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    const search = screen.getByLabelText('Buscar time');
    fireEvent.change(search, { target: { value: 'cruzeiro' } });

    const result = await screen.findByTestId('team-result');
    fireEvent.click(result);

    const confirm = screen.getByTestId('team-confirm');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/config/team' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as Record<string, string>;
      expect(body).toEqual({ provider: 'thesportsdb', id: '134294' });
    });
  });

  it('mantém o botão de troca desabilitado até escolher um time', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    expect(screen.getByTestId('team-confirm')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Buscar time'), { target: { value: 'cruzeiro' } });
    // resultados aparecem, mas nada habilita o botão sem clicar num deles
    await screen.findByTestId('team-result');
    expect(screen.getByTestId('team-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('team-result'));
    expect(screen.getByTestId('team-confirm')).toBeEnabled();
  });

  it('alterna visibilidade, edita título, reordena e salva via PUT /api/layout', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    const list = screen.getByTestId('widget-list');

    // 1) oculta o widget "Tabelas"
    fireEvent.click(within(list).getByRole('switch', { name: 'Exibir widget Tabelas' }));

    // 2) edita o título do "Próximo Jogo"
    fireEvent.change(within(list).getByLabelText('Título do widget Próximo jogo'), {
      target: { value: 'Jogo da Rodada' },
    });

    // 3) move "Tabelas" para cima (era o 3º widget)
    fireEvent.click(
      within(list).getByRole('button', { name: 'Mover widget Tabelas para cima' }),
    );
    const titleInputs = within(list).getAllByLabelText(/^Título do widget/);
    expect(titleInputs[1]).toHaveValue('Tabelas');
    expect(titleInputs[2]).toHaveValue('Jogo da Rodada');

    // 4) salva
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/layout' && init?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as Layout;

      expect(body.theme).toEqual({ default: 'system', accent: 'auto' });
      expect(body.widgets.map((widget) => widget.order)).toEqual([0, 1, 2]);

      const standings = body.widgets.find((widget) => widget.id === 'standings');
      expect(standings?.visible).toBe(false);
      expect(standings?.order).toBe(1);

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
  });

  it('descarta alterações de widget ao cancelar', async () => {
    renderSettings();
    await screen.findByTestId('settings-page');

    const list = screen.getByTestId('widget-list');
    const switchEl = within(list).getByRole('switch', { name: 'Exibir widget Tabelas' });
    expect(switchEl).toBeChecked();

    fireEvent.click(switchEl);
    expect(switchEl).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(within(list).getByRole('switch', { name: 'Exibir widget Tabelas' })).toBeChecked(),
    );

    const putCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/layout' && init?.method === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });

  it('aplica o time novo sem exigir recarregar a página', async () => {
    const configWithTeam: AppConfig = {
      ...configFixture,
      team: { ...configFixture.team, name: 'Cruzeiro' },
      owned: true,
    };
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/teams/search')) return jsonResponse(SEARCH_RESULTS);
      if (url === '/api/config/team' && method === 'POST') return jsonResponse(configWithTeam);
      if (url === '/api/layout') return jsonResponse(layoutFixture);
      if (url === '/api/config') return jsonResponse(configWithTeam);
      if (url === '/api/auth/me') return jsonResponse({ authenticated: true, user: USER });
      throw new Error(`rota não mockada: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', mock);

    renderSettings();
    await screen.findByTestId('settings-page');

    fireEvent.change(screen.getByLabelText('Buscar time'), { target: { value: 'cruzeiro' } });
    fireEvent.click(await screen.findByTestId('team-result'));
    fireEvent.click(screen.getByTestId('team-confirm'));

    // aviso de sucesso + config recarregada (retry do LayoutContext)
    expect(await screen.findByText(/Time Cruzeiro aplicado ao painel/)).toBeInTheDocument();
    await waitFor(() => {
      const configCalls = mock.mock.calls.filter(([url]) => String(url) === '/api/config');
      expect(configCalls.length).toBeGreaterThan(1);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { LayoutProvider } from '../context/LayoutContext';
import { DashboardView } from '../views/Dashboard';
import { configFixture, layoutFixture, jsonResponse, makeDashboard } from '../test/fixtures';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

const SESSION = { authenticated: true, user: { id: 7, username: 'novo', team_name: '' } };
const ANON = { authenticated: false, user: null };

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
  // Simula o backend: a conta nasce sem time (owned=false) e só passa a
  // owned=true depois que o usuário escolhe o time em POST /api/config/team.
  const state = { owned: false };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/auth/register' && method === 'POST') return jsonResponse(SESSION);
    if (url === '/api/auth/login' && method === 'POST') return jsonResponse(SESSION);
    if (url === '/api/auth/me') return jsonResponse(ANON);
    if (url.startsWith('/api/teams/search')) return jsonResponse(SEARCH_RESULTS);
    if (url === '/api/config/team' && method === 'POST') {
      state.owned = true;
      return jsonResponse({ ...configFixture, owned: true });
    }
    if (url === '/api/layout') return jsonResponse(layoutFixture);
    if (url === '/api/config') return jsonResponse({ ...configFixture, owned: state.owned });
    if (url === '/api/dashboard') return jsonResponse(makeDashboard(kickoff));
    throw new Error(`rota não mockada: ${method} ${url}`);
  });
}

function renderView() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <LayoutProvider>
          <DashboardView />
        </LayoutProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('onboarding sem conta', () => {
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('orienta a criar conta em vez de mostrar um time padrão', async () => {
    renderView();

    expect(await screen.findByTestId('welcome-gate')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Crie a sua conta para começar' })).toBeInTheDocument();
    // nenhum widget do painel aparece para quem não tem conta
    expect(screen.queryByRole('heading', { name: 'Próximo Jogo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tabelas' })).not.toBeInTheDocument();
    // sem conta não há menu de conta (e nem atalho de configurações)
    expect(screen.queryByRole('button', { name: /^Conta de / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar' })).not.toBeInTheDocument();
    // e o dashboard nem é buscado
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/dashboard'),
    ).toBe(false);
  });

  it('abre o modal de criar conta como portal, acima do fundo semitransparente', async () => {
    renderView();
    await screen.findByTestId('welcome-gate');

    fireEvent.click(screen.getByTestId('welcome-register'));
    const dialog = await screen.findByRole('dialog', { name: 'Criar conta' });

    // portal em document.body: fora de qualquer stacking context local
    expect(dialog.parentElement).toBe(document.body);
    expect(document.querySelector('[data-testid="auth-backdrop"]')).not.toBeNull();
    expect(within(dialog).getByLabelText('Usuário')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Senha')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText('Usuário')),
    );
  });

  it('cria a conta e cobra a escolha do time antes de liberar o painel', async () => {
    renderView();
    await screen.findByTestId('welcome-gate');

    fireEvent.click(screen.getByTestId('welcome-register'));
    const dialog = await screen.findByRole('dialog', { name: 'Criar conta' });

    fireEvent.change(within(dialog).getByLabelText('Usuário'), {
      target: { value: 'novo' },
    });
    fireEvent.change(within(dialog).getByLabelText('Senha'), {
      target: { value: 'senha123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar conta' }));

    // registro disparado
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/auth/register' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(String((call?.[1] as RequestInit | undefined)?.body)).toContain('novo');
    });

    // o portão some, mas o modal continua aberto no passo de time
    await waitFor(() => expect(screen.queryByTestId('welcome-gate')).not.toBeInTheDocument());
    const teamDialog = await screen.findByRole('dialog', { name: 'Qual é o seu time?' });
    expect(within(teamDialog).getByLabelText('Buscar time')).toBeInTheDocument();
    // passo obrigatório: sem fechar e sem trocar de aba
    expect(within(teamDialog).queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    // o painel ainda não foi requisitado (time não escolhido)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/dashboard'),
    ).toBe(false);
  });

  it('registra, escolhe o time e entra no painel', async () => {
    renderView();
    await screen.findByTestId('welcome-gate');

    fireEvent.click(screen.getByTestId('welcome-register'));
    const dialog = await screen.findByRole('dialog', { name: 'Criar conta' });
    fireEvent.change(within(dialog).getByLabelText('Usuário'), { target: { value: 'novo' } });
    fireEvent.change(within(dialog).getByLabelText('Senha'), { target: { value: 'senha123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar conta' }));

    // escolhe o time no passo 2
    const teamDialog = await screen.findByRole('dialog', { name: 'Qual é o seu time?' });
    fireEvent.change(within(teamDialog).getByLabelText('Buscar time'), {
      target: { value: 'cruzeiro' },
    });
    fireEvent.click(await within(teamDialog).findByTestId('team-result'));
    fireEvent.click(within(teamDialog).getByTestId('team-confirm'));

    // time salvo => config recarregada e o painel carrega
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/config/team' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    // Configurações e Sair passaram para dentro do menu da conta
    expect(screen.getByRole('button', { name: 'Conta de novo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar' })).not.toBeInTheDocument();
    // e o tema saiu do cabeçalho
    expect(screen.queryByRole('radio', { name: /Escuro/ })).not.toBeInTheDocument();
  });

  it('ícone da conta abre o menu com Configurações e Sair', async () => {
    renderView();
    await screen.findByTestId('welcome-gate');

    fireEvent.click(screen.getByTestId('welcome-register'));
    const dialog = await screen.findByRole('dialog', { name: 'Criar conta' });
    fireEvent.change(within(dialog).getByLabelText('Usuário'), { target: { value: 'novo' } });
    fireEvent.change(within(dialog).getByLabelText('Senha'), { target: { value: 'senha123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar conta' }));

    const teamDialog = await screen.findByRole('dialog', { name: 'Qual é o seu time?' });
    fireEvent.change(within(teamDialog).getByLabelText('Buscar time'), {
      target: { value: 'cruzeiro' },
    });
    fireEvent.click(await within(teamDialog).findByTestId('team-result'));
    fireEvent.click(within(teamDialog).getByTestId('team-confirm'));

    const trigger = await screen.findByRole('button', { name: 'Conta de novo' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu', { name: 'Conta' });
    expect(within(menu).getByRole('heading', { name: 'novo' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Configurações' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Sair' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('portão força a escolha do time para conta logada sem time (owned=false)', async () => {
    const noTeamConfig = { ...configFixture, owned: false };
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/me') return jsonResponse(SESSION);
      if (url === '/api/layout') return jsonResponse(layoutFixture);
      if (url === '/api/config') return jsonResponse(noTeamConfig);
      if (url === '/api/config/team' && method === 'POST') return jsonResponse(configFixture);
      if (url.startsWith('/api/teams/search')) return jsonResponse(SEARCH_RESULTS);
      if (url === '/api/dashboard') return jsonResponse(makeDashboard(kickoff));
      throw new Error(`rota não mockada: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', mock);

    renderView();

    // já logado, sem time: o portão abre sozinho e não pode ser fechado
    const gate = await screen.findByRole('dialog', { name: 'Qual é o seu time?' });
    expect(within(gate).queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Qual é o seu time?' })).toBeInTheDocument();

    // escolhendo o time, o portão some e o painel aparece
    fireEvent.change(within(gate).getByLabelText('Buscar time'), {
      target: { value: 'cruzeiro' },
    });
    fireEvent.click(await within(gate).findByTestId('team-result'));
    fireEvent.click(within(gate).getByTestId('team-confirm'));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Qual é o seu time?' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
  });

  it('também permite entrar com conta existente (e cobra o time se ela não tem)', async () => {
    renderView();
    await screen.findByTestId('welcome-gate');

    fireEvent.click(screen.getByTestId('welcome-login'));
    const dialog = await screen.findByRole('dialog', { name: 'Entrar' });
    expect(within(dialog).getByText('Entrar', { selector: 'h2' })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Usuário'), {
      target: { value: 'antigo' },
    });
    fireEvent.change(within(dialog).getByLabelText('Senha'), {
      target: { value: 'senha123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entrar' }));

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/auth/login' && init?.method === 'POST',
      ),
    ).toBe(true);

    // a conta ainda não tinha time: o portão aparece e exige a escolha
    const gate = await screen.findByRole('dialog', { name: 'Qual é o seu time?' });
    fireEvent.change(within(gate).getByLabelText('Buscar time'), {
      target: { value: 'cruzeiro' },
    });
    fireEvent.click(await within(gate).findByTestId('team-result'));
    fireEvent.click(within(gate).getByTestId('team-confirm'));

    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
  });
});

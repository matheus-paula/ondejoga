import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { LayoutProvider } from '../context/LayoutContext';
import { DashboardView } from '../views/Dashboard';
import { configFixture, layoutFixture, jsonResponse, makeDashboard } from '../test/fixtures';

const kickoff = new Date(Date.now() + 86_400_000).toISOString();

const SESSION = { authenticated: true, user: { id: 7, username: 'novo', team_name: 'Cruzeiro' } };
const ANON = { authenticated: false, user: null };

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/auth/register' && method === 'POST') return jsonResponse(SESSION);
    if (url === '/api/auth/login' && method === 'POST') return jsonResponse(SESSION);
    if (url === '/api/auth/me') return jsonResponse(ANON);
    if (url === '/api/layout') return jsonResponse(layoutFixture);
    if (url === '/api/config') return jsonResponse(configFixture);
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
    // sem conta não há botão de configurações
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
    expect(document.querySelector('.auth-backdrop')).not.toBeNull();
    expect(within(dialog).getByLabelText('Usuário')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Senha')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText('Usuário')),
    );
  });

  it('cria a conta pelo portão e entra no painel', async () => {
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

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/auth/register' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(String((call?.[1] as RequestInit | undefined)?.body)).toContain('novo');
    });

    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-gate')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar' })).toBeInTheDocument();
  });

  it('também permite entrar com conta existente', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Próximo Jogo' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/auth/login' && init?.method === 'POST',
      ),
    ).toBe(true);
  });
});

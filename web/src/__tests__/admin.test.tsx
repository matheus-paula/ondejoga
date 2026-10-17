import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthProvider } from '../context/AuthContext';
import { LayoutProvider } from '../context/LayoutContext';
import { Admin } from '../views/Admin';
import {
  adminStatusFixture,
  buildInfoFixture,
  configFixture,
  jsonResponse,
  layoutFixture,
  sourcesFixture,
} from '../test/fixtures';
import type { AdminSource } from '../api/types';

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/admin/sources' && method === 'GET') return jsonResponse(sourcesFixture);
    if (url === '/api/admin/sources' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ ...body, id: 42 } as AdminSource, 201);
    }
    if (url === '/api/admin/sources/test') {
      return jsonResponse({
        ok: true,
        status_code: 200,
        elapsed_ms: 231,
        url: 'https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=4351&s=2026',
        sample: { tables: [] },
        normalized: { rows: [] },
      });
    }
    if (url === '/api/admin/status') return jsonResponse(adminStatusFixture);
    if (url === '/api') return jsonResponse(buildInfoFixture);
    // o cabeçalho do Admin lê o time do LayoutProvider para pintar a faixa
    if (url === '/api/layout') return jsonResponse(layoutFixture);
    if (url === '/api/config') return jsonResponse(configFixture);
    if (url === '/api/auth/me') return jsonResponse({ authenticated: true, user: USER });
    throw new Error(`rota não mockada: ${method} ${url}`);
  });
}

const USER = { id: 1, username: 'tester' };

/** No app o Admin vive dentro de `AuthProvider` + `LayoutProvider` (App.tsx); aqui é igual. */
function renderAdmin() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <LayoutProvider>
          <Admin />
        </LayoutProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('view Admin (fontes de dados)', () => {
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renderiza as fontes com tipo, capacidades e status', async () => {
    renderAdmin();

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'TheSportsDB' })).toBeInTheDocument();
    expect(within(table).getByText('standings')).toBeInTheDocument();
    expect(within(table).getByText('ok')).toBeInTheDocument();
    expect(within(table).getByRole('switch', { name: 'Habilitar fonte TheSportsDB' })).toBeChecked();

    // seção de status
    expect(screen.getByRole('heading', { name: 'Status por capacidade' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tabela' })).toBeInTheDocument();
    expect(screen.getByText(/thesportsdb/)).toBeInTheDocument();
  });

  it('mostra a release e o commit que está de pé, como o pihole -v', async () => {
    renderAdmin();

    const build = await screen.findByTestId('build-version');
    expect(build).toHaveTextContent('1.1.0');
    expect(build).toHaveTextContent('main');
    expect(build).toHaveTextContent('0606bad');
    // árvore limpa: nenhum aviso de alteração pendente
    expect(screen.queryByText('Alterações não commitadas')).not.toBeInTheDocument();
  });

  it('cria uma nova fonte via POST com o corpo esperado', async () => {
    renderAdmin();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Nova fonte' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova fonte' });

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Minha Fonte' },
    });
    fireEvent.change(within(dialog).getByLabelText('URL base'), {
      target: { value: 'https://exemplo.com/api/' },
    });
    fireEvent.click(within(dialog).getByLabelText(/Notícias \(news\)/));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/admin/sources' && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit | undefined;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

      expect(body.name).toBe('Minha Fonte');
      expect(body.kind).toBe('thesportsdb');
      expect(body.base_url).toBe('https://exemplo.com/api/');
      expect(body.capabilities).toEqual(['news']);
      expect(body.priority).toBe(10);
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('last_status');
    });

    // modal fecha e o toast de sucesso aparece
    expect(await screen.findByText('Fonte "Minha Fonte" criada.')).toBeInTheDocument();
  });

  it('exibe validação quando os dados são inválidos', async () => {
    renderAdmin();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Nova fonte' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova fonte' });

    // sem capacidades e sem URL base válida
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('Informe o nome da fonte.');
    expect(alert).toHaveTextContent('Selecione ao menos uma capacidade.');
    expect(alert).toHaveTextContent('A URL base precisa começar com http:// ou https://.');

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/admin/sources' && init?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  it('testa uma fonte e mostra o resultado', async () => {
    renderAdmin();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Testar' }));

    const panel = await screen.findByLabelText('Resultado do teste');
    expect(within(panel).getByText('HTTP 200')).toBeInTheDocument();
    expect(within(panel).getByText(/231 ms/)).toBeInTheDocument();
    expect(within(panel).getByText(/lookuptable\.php/)).toBeInTheDocument();

    const testCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/admin/sources/test' && init?.method === 'POST',
    );
    expect(testCall).toBeDefined();
    const init = testCall?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({ id: 1 });
  });
});

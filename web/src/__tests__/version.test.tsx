import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { VersionFooter } from '../components/layout/VersionFooter';
import { buildInfoFixture, jsonResponse } from '../test/fixtures';

/** `/api` responde; todo o resto do app (dashboard, auth, layout) responde 404. */
function stubFetch(payload = buildInfoFixture) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api') return jsonResponse(payload);
      return jsonResponse({ detail: 'fora do escopo deste teste' }, 404);
    }),
  );
}

describe('rodapé de versão', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra a release e o commit que está de pé', async () => {
    stubFetch();
    render(<VersionFooter />);

    const rodape = await screen.findByTestId('app-version');
    expect(rodape).toHaveTextContent('1.1.0');
    expect(rodape).toHaveTextContent('main');
    expect(rodape).toHaveTextContent('0606bad');
    expect(rodape).toHaveTextContent('atualizado');
    expect(rodape).not.toHaveTextContent('nova versão disponível');
  });

  it('avisa quando já existe commit novo esperando no remoto', async () => {
    stubFetch({ ...buildInfoFixture, update_available: true });
    render(<VersionFooter />);

    const rodape = await screen.findByTestId('app-version');
    expect(rodape).toHaveTextContent('nova versão disponível');
    expect(rodape).not.toHaveTextContent('atualizado');
  });

  it('sem como comparar, fala só o que sabe', async () => {
    stubFetch({ ...buildInfoFixture, update_available: null, source: 'release', commit: null });
    render(<VersionFooter />);

    const rodape = await screen.findByTestId('app-version');
    expect(rodape).toHaveTextContent('1.1.0');
    expect(rodape).not.toHaveTextContent('nova versão disponível');
    expect(rodape).not.toHaveTextContent('atualizado');
  });

  it('sem resposta da API não aparece rodapé algum', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'fora' }, 500)));
    render(<VersionFooter />);

    await waitFor(() => {
      expect(screen.queryByTestId('app-version')).not.toBeInTheDocument();
    });
  });

  it('o rodapé acompanha qualquer tela da aplicação', async () => {
    stubFetch();
    render(<App />);

    expect(await screen.findByTestId('app-version')).toHaveTextContent('1.1.0');
    // aparece uma vez só, seja qual for a view aberta
    expect(screen.getAllByTestId('app-version')).toHaveLength(1);
  });
});

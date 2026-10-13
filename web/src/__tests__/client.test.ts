import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getSessionToken, setSessionToken } from '../api/client';
import { jsonResponse, layoutFixture } from '../test/fixtures';

describe('cliente de API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normaliza erro HTTP com corpo {"detail": "..."}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'fonte inválida' }, 400)));

    const promise = api.getLayout();
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 400, detail: 'fonte inválida' });
  });

  it('usa o corpo como texto quando não é JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new Error('não é JSON');
        },
        text: async () => '<html>bad gateway</html>',
      } as unknown as Response),
    );

    await expect(api.getDashboard()).rejects.toMatchObject({
      status: 502,
      detail: '<html>bad gateway</html>',
    });
  });

  it('normaliza erros de validação em lista (detail: array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: [{ msg: 'field required', loc: ['body', 'name'] }] }, 422),
      ),
    );

    const error = await api.putLayout(layoutFixture).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).detail).toContain('field required');
  });

  it('normaliza falhas de rede (status 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api.getConfig()).rejects.toMatchObject({ status: 0 });
  });

  it('resolve o JSON em respostas de sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(layoutFixture)));
    await expect(api.getLayout()).resolves.toEqual(layoutFixture);
  });

  it('envia PUT /api/layout com JSON.stringify do layout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(layoutFixture));
    vi.stubGlobal('fetch', fetchMock);

    await api.putLayout(layoutFixture);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/layout',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(layoutFixture),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  // Reserva do cookie: dentro de um iframe de outro site (Home Assistant) o
  // navegador não envia o SameSite=Lax e a sessão só anda pelo header.
  it('manda Authorization: Bearer quando há token guardado', async () => {
    setSessionToken('tok123');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(layoutFixture));
    vi.stubGlobal('fetch', fetchMock);

    await api.getLayout();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/layout',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
  });

  it('não manda Authorization quando não há token guardado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(layoutFixture));
    vi.stubGlobal('fetch', fetchMock);

    await api.getLayout();

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
      'Authorization',
    );
  });

  it('login devolve o token no corpo, que fica guardado no cliente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ user: { id: 1, username: 'ana' }, token: 'tok9' })),
    );

    const result = await api.login('ana', 'senha123');
    expect(result.token).toBe('tok9');
    expect(result.user.username).toBe('ana');

    setSessionToken(result.token);
    expect(getSessionToken()).toBe('tok9');
  });

  it('esquece o token quando o servidor recusa a sessão', async () => {
    setSessionToken('velho');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'entre ou crie uma conta primeiro' }, 401)),
    );

    await expect(api.getLayout()).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBeNull();
  });

  it('senha errada no login não apaga a sessão guardada', async () => {
    setSessionToken('deOutraConta');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'senha incorreta' }, 401)));

    await expect(api.login('ana', 'errada')).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBe('deOutraConta');
  });
});

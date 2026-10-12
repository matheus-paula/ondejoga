import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
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
});

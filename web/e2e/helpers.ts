import { expect, test } from '@playwright/test';

/** Nome único para não colidir com execuções anteriores no mesmo banco. */
export function uniqueUser(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Resultado fixo da busca de times (evita depender da TheSportsDB no e2e).
 * O id é o do Cruzeiro real — o POST /api/config/team vai ao backend de
 * verdade, que consulta a fonte para salvar o time da conta.
 */
export const SEARCH_RESULTS = {
  query: 'cruzeiro',
  results: [
    {
      provider: 'thesportsdb',
      id: '134294',
      name: 'Cruzeiro',
      short_name: 'CRU',
      logo: 'https://r2.thesportsdb.com/images/media/team/badge/upsvvu1473538059.png',
      country: 'Brazil',
      league: 'Brazilian Serie A',
    },
  ],
};

/** Intercepta a busca de times (chamada dentro do modal/gate de escolha). */
export async function mockTeamSearch(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/teams/search*', (route) =>
    route.fulfill({ json: SEARCH_RESULTS }),
  );
}

/**
 * Cria uma conta e **escolhe o time** (passo obrigatório: o modal não fecha
 * nem tem Escape até o time ser salvo). Devolve quando o painel está aberto.
 */
export async function register(
  page: import('@playwright/test').Page,
  username: string,
  password = 'senha123',
): Promise<void> {
  await mockTeamSearch(page);
  await page.getByTestId('welcome-register').click();
  const dialog = page.getByRole('dialog', { name: 'Criar conta' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Usuário').fill(username);
  await dialog.getByLabel('Senha').fill(password);
  await dialog.getByRole('button', { name: 'Criar conta' }).click();

  // passo 2 (obrigatório): buscar e confirmar o time
  const teamDialog = page.getByRole('dialog', { name: 'Qual é o seu time?' });
  await expect(teamDialog).toBeVisible();
  await teamDialog.getByLabel('Buscar time').fill('cruzeiro');
  await teamDialog.getByTestId('team-result').first().click();
  await teamDialog.getByTestId('team-confirm').click();

  // time salvo => portão some e o painel aparece
  await expect(page.getByRole('button', { name: 'Configurar' })).toBeVisible();
  await expect(teamDialog).toHaveCount(0);
}

/** Sai da conta e espera o portão de boas-vindas. */
export async function logout(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByTestId('welcome-gate')).toBeVisible();
}

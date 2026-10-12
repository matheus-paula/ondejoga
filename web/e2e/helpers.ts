import { expect, test } from '@playwright/test';

/** Nome único para não colidir com execuções anteriores no mesmo banco. */
export function uniqueUser(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** Cria uma conta e devolve o nome de usuário usado. */
export async function register(
  page: import('@playwright/test').Page,
  username: string,
  password = 'senha123',
): Promise<void> {
  await page.getByTestId('welcome-register').click();
  const dialog = page.getByRole('dialog', { name: 'Criar conta' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Usuário').fill(username);
  await dialog.getByLabel('Senha').fill(password);
  await dialog.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('button', { name: 'Configurar' })).toBeVisible();
}

/** Sai da conta e espera o portão de boas-vindas. */
export async function logout(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByTestId('welcome-gate')).toBeVisible();
}

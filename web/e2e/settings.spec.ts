import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { register, uniqueUser } from './helpers';

// Raiz do projeto (onde o compose monta o volume que o container da API usa
// como RESET_DIR — os arquivos RESET-<usuario>.txt aparecem aqui no host).
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Abre o modal de login e tenta entrar; devolve true se entrou. */
async function tryLogin(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
): Promise<boolean> {
  await page.goto('/');
  await page.getByTestId('welcome-login').click();
  const dialog = page.getByRole('dialog', { name: 'Entrar' });
  await dialog.getByLabel('Usuário').fill(username);
  await dialog.getByLabel('Senha').fill(password);
  await dialog.getByRole('button', { name: 'Entrar' }).click();
  // entrou => o painel abre; recusou => o aviso de erro aparece no modal
  const ok = await page
    .getByRole('button', { name: 'Configurar' })
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) await expect(dialog.getByRole('alert')).toBeVisible();
  return ok;
}

test('gera RESET-<usuario>.txt na raiz do projeto e a senha temporária entra', async ({
  page,
  browser,
}) => {
  const username = uniqueUser('e2e');
  const file = path.join(projectRoot, `RESET-${username}.txt`);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  try {
    await page.goto('/');
    await register(page, username);

    // Configurações => seção "Esqueci a senha" => confirmação inline
    await page.getByRole('button', { name: 'Configurar' }).click();
    const settings = page.getByTestId('settings-page');
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: /Gerar senha temporária/ }).click();
    await expect(settings.getByRole('group', { name: 'Confirmar geração' })).toBeVisible();
    await settings.getByRole('button', { name: /Sim, gerar arquivo/ }).click();

    // a tela mostra o arquivo gerado + a senha temporária
    const temp = await settings.getByTestId('temp-password').textContent();
    expect(temp).toBeTruthy();

    // o arquivo existe na raiz do volume (host) com usuário e senha
    await expect.poll(() => fs.existsSync(file), { timeout: 10_000 }).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain(`Usuário: ${username}`);
    expect(content).toContain(`Senha temporária: ${temp}`);

    // a senha antiga passa a ser recusada numa sessão nova
    const oldCtx = await browser.newContext();
    const oldPage = await oldCtx.newPage();
    expect(await tryLogin(oldPage, username, 'senha123')).toBe(false);
    await oldCtx.close();

    // a temporária entra (mesmo caminho que o dono do servidor faria)
    const newCtx = await browser.newContext();
    const newPage = await newCtx.newPage();
    expect(await tryLogin(newPage, username, temp!)).toBe(true);
    await newCtx.close();
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('restaura só o que foi marcado, com senha, e devolve o portão do time', async ({
  page,
}) => {
  const username = uniqueUser('e2e');
  const password = 'senha123';

  await page.goto('/');
  await register(page, username, password);

  await page.getByRole('button', { name: 'Configurar' }).click();
  const settings = page.getByTestId('settings-page');
  await expect(settings).toBeVisible();

  const submit = settings.getByRole('button', { name: /Restaurar selecionado/ });
  await expect(submit).toBeDisabled(); // nada marcado e sem senha

  // senha errada: avisa e não restaura
  await settings.getByRole('checkbox', { name: /Fontes de API/ }).check();
  await expect(submit).toBeDisabled(); // marcado, mas ainda sem senha
  await settings.getByLabel('Sua senha atual').fill('senha-errada');
  await submit.click();
  await expect(settings.getByRole('alert')).toContainText('senha atual incorreta');

  // senha certa: as fontes voltam de fábrica
  await settings.getByLabel('Sua senha atual').fill(password);
  await submit.click();
  await expect(settings.getByText(/Restaurado: Fontes de API/)).toBeVisible();

  // zerar o time é separado: volta o portão de onboarding no painel
  await settings.getByRole('checkbox', { name: /Time e preferências/ }).check();
  await settings.getByLabel('Sua senha atual').fill(password);
  await submit.click();
  await expect(settings.getByText(/Restaurado: Time e preferências/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Qual é o seu time?' })).toBeVisible();
  // a conta segue viva — dá para só escolher o time de novo e voltar
  await expect(page.getByTestId('welcome-gate')).toHaveCount(0);
});

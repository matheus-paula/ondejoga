import { expect, test } from '@playwright/test';
import { logout, register, uniqueUser } from './helpers';

test('sem conta logada mostra o portão, não um time padrão', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('welcome-gate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Crie a sua conta para começar' })).toBeVisible();

  // nenhum widget do painel e nenhum botão de configurações
  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tabelas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configurar' })).toHaveCount(0);

  // o painel nem chega a ser requisitado
  const dashboards = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/dashboard')).length,
  );
  expect(dashboards).toBe(0);
});

test('o modal de conta fica acima do fundo semitransparente e é clicável', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-register').click();

  const dialog = page.getByRole('dialog', { name: 'Criar conta' });
  await expect(dialog).toBeVisible();

  // portal: filho direto de <body>, fora de qualquer stacking context local
  expect(await dialog.evaluate((el) => el.parentElement?.tagName)).toBe('BODY');

  const layers = await dialog.evaluate((el) => {
    const backdrop = document.querySelector('.auth-backdrop');
    if (!backdrop) return null;
    return {
      modal: Number(getComputedStyle(el).zIndex),
      backdrop: Number(getComputedStyle(backdrop).zIndex),
    };
  });
  expect(layers).not.toBeNull();
  expect(layers!.modal).toBeGreaterThan(layers!.backdrop);

  // dá para preencher os campos (prova de que nada bloqueia o clique)
  await dialog.getByLabel('Usuário').fill('abc');
  await expect(dialog.getByLabel('Usuário')).toHaveValue('abc');
  await dialog.getByLabel('Senha').fill('senha123');
  await expect(dialog.getByLabel('Senha')).toHaveValue('senha123');
});

test('cria conta pelo portão e cai no painel', async ({ page }) => {
  const username = uniqueUser('e2e');
  await page.goto('/');
  await register(page, username);

  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();
  await expect(page.getByTestId('welcome-gate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sair/ })).toBeVisible();
  // configurações só existem para quem está logado
  await expect(page.getByRole('button', { name: 'Configurar' })).toBeVisible();
});

test('sai e entra de volta com a conta existente', async ({ page }) => {
  const username = uniqueUser('e2e');
  await page.goto('/');
  await register(page, username);
  await logout(page);

  // modal de login
  await page.getByTestId('welcome-login').click();
  const dialog = page.getByRole('dialog', { name: 'Entrar' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Usuário').fill(username);
  await dialog.getByLabel('Senha').fill('senha123');
  await dialog.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();
  await expect(page.getByTestId('welcome-gate')).toHaveCount(0);
});

test('sessão sobrevive sem cookie — é o caso do iframe do Home Assistant', async ({
  page,
  context,
}) => {
  const username = uniqueUser('e2e');
  await page.goto('/');
  await register(page, username);
  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();

  // A reserva do cookie é o token no corpo do login. Guardado em localStorage,
  // ele viaja como Authorization: Bearer — que não sofre com SameSite.
  const token = await page.evaluate(() => window.localStorage.getItem('ondejoga_token'));
  expect(token).toBeTruthy();

  // Embarcar o app em site de outro host faz o navegador descartar o cookie.
  await context.clearCookies();
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();
  await expect(page.getByTestId('welcome-gate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sair/ })).toBeVisible();
});

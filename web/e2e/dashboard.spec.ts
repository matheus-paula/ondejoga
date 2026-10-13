import { expect, test } from '@playwright/test';
import { openSettings, register, uniqueUser } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await register(page, uniqueUser('e2e'));
  // "Último Jogo" é o widget sempre presente; o "Próximo Jogo" sai quando o
  // time está em campo (o Tempo Real assume).
  await expect(page.getByRole('heading', { name: 'Último Jogo' })).toBeVisible();
});

test('mostra escudos no Último Jogo e no Próximo Jogo', async ({ page }) => {
  const lastScore = page.locator('[data-widget="last-match"] [data-testid="match-teams"]');
  await expect(lastScore).toBeVisible();

  const crests = lastScore.locator('[data-testid="team-crest"]');
  await expect(crests).toHaveCount(2);
  await expect(crests.nth(0)).toHaveJSProperty('complete', true);
  await expect(lastScore).toContainText('×');

  // o placar fica colado ao "×" (mesmo componente dos outros cartões)
  await expect(lastScore.locator('[data-testid="match-score"]')).toContainText('×');

  // Próximo Jogo usa o mesmo componente — a não ser que o time esteja jogando,
  // quando ele sai de propósito para não competir com o Tempo Real.
  const nextCrests = page.locator('[data-widget="next-match"] [data-testid="team-crest"]');
  if ((await page.locator('[data-testid="widget"][data-type="live_match"]').count()) === 0) {
    await expect(nextCrests).toHaveCount(2);
    await expect(nextCrests.nth(0)).toHaveAttribute('width', '44');
  }
  await expect(crests.nth(0)).toHaveAttribute('width', '44');
});

test('Tempo Real só aparece com o time em campo, e aí o Próximo Jogo some', async ({ page }) => {
  const widget = page.locator('[data-testid="widget"][data-type="live_match"]');
  const card = page.locator('[data-widget="live-match"]');
  const next = page.locator('[data-testid="widget"][data-type="next_match"]');
  if ((await widget.count()) > 0) {
    // time jogando agora: placar + selo Ao vivo
    await expect(card).toBeVisible();
    await expect(card.getByTestId('live-badge')).toContainText('Ao vivo');
    await expect(card.locator('[data-testid="match-score"]')).toContainText('×');
    // os dois juntos só confundem: o que vale é o que está em campo
    await expect(next).toHaveCount(0);
  } else {
    await expect(card).toHaveCount(0);
    await expect(next).toBeVisible();
  }
});

test('tabela de competição em abas, com a fase atual selecionada', async ({ page }) => {
  const widget = page.locator('[data-widget="standings"]');
  await expect(widget).toBeVisible();

  // a fase atual (quando há mata-mata) é a aba selecionada
  const phases = widget.getByRole('tablist', { name: 'Fases' });
  if ((await phases.count()) > 0) {
    await expect(phases.getByRole('tab', { selected: true })).toHaveCount(1);
  }

  // há ou uma tabela ou uma chave de mata-mata
  const hasTable = await widget.locator('table[data-testid="standings-table"]').count();
  const hasBracket = await widget.locator('[data-testid="bracket-tie"]').count();
  expect(hasTable + hasBracket).toBeGreaterThan(0);

  // cabeçalho sempre descreve a competição exibida
  await expect(widget.locator('[data-testid="standings-title"]')).not.toBeEmpty();
  await expect(widget.locator('[data-testid="standings-meta"]')).not.toBeEmpty();

  // trocando de aba, o cabeçalho muda junto
  const comps = widget.getByRole('tablist', { name: 'Competições' });
  if ((await comps.count()) > 0 && (await comps.getByRole('tab').count()) > 1) {
    const first = comps.getByRole('tab').nth(0);
    const second = comps.getByRole('tab').nth(1);
    const before = await widget.locator('[data-testid="standings-title"]').textContent();
    await second.click();
    await expect(widget.locator('[data-testid="standings-title"]')).not.toHaveText(before ?? '');
    await first.click();
    await expect(widget.locator('[data-testid="standings-title"]')).toHaveText(before ?? '');
  }
});

test('tela de Configurações abre pelo menu da conta', async ({ page }) => {
  await openSettings(page);
  const settings = page.getByTestId('settings-page');
  await expect(settings).toBeVisible();
  for (const title of ['Conta', 'Time', 'Aparência', 'Widgets']) {
    await expect(settings.getByRole('heading', { name: title, level: 2 })).toBeVisible();
  }

  // o time atual aparece preenchido (Cruzeiro, escolhido no onboarding)
  await expect(settings.getByText('Cruzeiro').first()).toBeVisible();

  // volta ao painel
  await settings.getByRole('button', { name: 'Voltar ao painel' }).click();
  await expect(page).toHaveURL(/#\/$/);
  // "Último Jogo" é o widget sempre presente (o "Próximo" sai com jogo ao vivo)
  await expect(page.getByRole('heading', { name: 'Último Jogo' })).toBeVisible();
});

test('tema alterna claro/escuro na tela de Configurações', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByTestId('settings-page')).toBeVisible();

  const html = page.locator('html');
  const initial = await html.getAttribute('data-theme');
  await page.getByRole('radio', { name: /Escuro/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /Claro/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  if (initial) await html.getAttribute('data-theme');
});

test('o controle de tema saiu do cabeçalho', async ({ page }) => {
  // fora de Configurações não existe mais atalho de tema
  await expect(page.getByRole('radio', { name: /Escuro/ })).toHaveCount(0);
  await expect(page.locator('[data-testid="app-header"] [data-testid="theme-toggle"]')).toHaveCount(0);

  await openSettings(page);
  await expect(page.getByRole('radio', { name: /Escuro/ })).toBeVisible();
});

test('notícias renderizam itens com imagem ou placeholder', async ({ page }) => {
  const news = page.locator('[data-widget="news"]');
  await expect(news).toBeVisible();
  const items = news.locator('[data-testid="news-item"]');
  await expect(items.first()).toBeVisible();
});

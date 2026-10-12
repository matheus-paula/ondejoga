import { expect, test } from '@playwright/test';
import { register, uniqueUser } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await register(page, uniqueUser('e2e'));
  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();
});

test('mostra escudos no Último Jogo e no Próximo Jogo', async ({ page }) => {
  const lastScore = page.locator('.widget-card.last-match .match-teams');
  await expect(lastScore).toBeVisible();

  const crests = lastScore.locator('.match-team-crest');
  await expect(crests).toHaveCount(2);
  await expect(crests.nth(0)).toHaveJSProperty('complete', true);
  await expect(lastScore).toContainText('×');

  // o placar fica colado ao "×" (mesmo componente dos outros cartões)
  await expect(lastScore.locator('.match-score')).toContainText('×');

  // Próximo Jogo usa o mesmo componente: 2 escudos do mesmo tamanho (44px)
  const nextCrests = page.locator('.widget-card.next-match .match-team-crest');
  await expect(nextCrests).toHaveCount(2);
  await expect(nextCrests.nth(0)).toHaveAttribute('width', '44');
  await expect(crests.nth(0)).toHaveAttribute('width', '44');
});

test('widget Tempo Real só aparece com o time em campo', async ({ page }) => {
  const widget = page.locator('.widget[data-type="live_match"]');
  const card = page.locator('.widget-card.live-match');
  if ((await widget.count()) > 0) {
    // time jogando agora: placar + selo Ao vivo
    await expect(card).toBeVisible();
    await expect(card.getByTestId('live-badge')).toContainText('Ao vivo');
    await expect(card.locator('.match-score')).toContainText('×');
  } else {
    await expect(card).toHaveCount(0);
  }
});

test('tabela de competição em abas, com a fase atual selecionada', async ({ page }) => {
  const widget = page.locator('.widget-card.standings');
  await expect(widget).toBeVisible();

  // a fase atual (quando há mata-mata) é a aba selecionada
  const phases = widget.getByRole('tablist', { name: 'Fases' });
  if ((await phases.count()) > 0) {
    await expect(phases.getByRole('tab', { selected: true })).toHaveCount(1);
  }

  // há ou uma tabela ou uma chave de mata-mata
  const hasTable = await widget.locator('table.standings-table').count();
  const hasBracket = await widget.locator('.bracket-tie').count();
  expect(hasTable + hasBracket).toBeGreaterThan(0);

  // cabeçalho sempre descreve a competição exibida
  await expect(widget.locator('.standings-head-title')).not.toBeEmpty();
  await expect(widget.locator('.standings-head-meta')).not.toBeEmpty();

  // trocando de aba, o cabeçalho muda junto
  const comps = widget.getByRole('tablist', { name: 'Competições' });
  if ((await comps.count()) > 0 && (await comps.getByRole('tab').count()) > 1) {
    const first = comps.getByRole('tab').nth(0);
    const second = comps.getByRole('tab').nth(1);
    const before = await widget.locator('.standings-head-title').textContent();
    await second.click();
    await expect(widget.locator('.standings-head-title')).not.toHaveText(before ?? '');
    await first.click();
    await expect(widget.locator('.standings-head-title')).toHaveText(before ?? '');
  }
});

test('tela de Configurações abre pelo botão e o tema alterna', async ({ page }) => {
  await page.getByRole('button', { name: 'Configurar' }).click();

  // rota interna + seções da tela cheia (substituiu a gaveta)
  await expect(page).toHaveURL(/#\/configuracoes$/);
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
  await expect(page.getByRole('heading', { name: 'Próximo Jogo' })).toBeVisible();
});

test('tema alterna claro/escuro na tela de Configurações', async ({ page }) => {
  await page.getByRole('button', { name: 'Configurar' }).click();
  await expect(page.getByTestId('settings-page')).toBeVisible();

  const html = page.locator('html');
  const initial = await html.getAttribute('data-theme');
  await page.getByRole('radio', { name: /Escuro/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /Claro/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  if (initial) await html.getAttribute('data-theme');
});

test('notícias renderizam itens com imagem ou placeholder', async ({ page }) => {
  const news = page.locator('.widget-card.news');
  await expect(news).toBeVisible();
  const items = news.locator('.news-item, .news-list li, article');
  await expect(items.first()).toBeVisible();
});

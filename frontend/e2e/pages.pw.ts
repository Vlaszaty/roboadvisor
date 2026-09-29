import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll } from './helpers';

const universe = JSON.parse(readFileSync(new URL('../src/mocks/universe.json', import.meta.url), 'utf8')) as { name: string }[];

test('backtest: static run shows the metrics table', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await completeWizard(page); // backtest needs a built portfolio (in-memory state)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: /run backtest/i }).click();
  const metrics = page.getByRole('table', { name: /backtest metrics/i });
  await expect(metrics).toBeVisible({ timeout: 15_000 });
  await expect(metrics.getByRole('row', { name: /sharpe ratio/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('universe: table rendered', async ({ page }) => {
  await page.goto('/universe');
  await expect(page.getByRole('table').first()).toBeVisible({ timeout: 10_000 });
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText(universe[0].name);
});

test.describe('no horizontal scroll at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const path of ['/', '/start', '/portfolio']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    });
  }

  test('/portfolio with a built portfolio', async ({ page }) => {
    await completeWizard(page);
    await expectNoHorizontalScroll(page);
  });
});

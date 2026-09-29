import { expect, test } from '@playwright/test';
import { completeWizard } from './helpers';

test('backtest: static run shows the metrics table', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await completeWizard(page); // backtest needs a built portfolio (in-memory state)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: /run backtest/i }).click();
  await expect(page.getByRole('table', { name: /backtest metrics/i })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('universe: table rendered', async ({ page }) => {
  await page.goto('/universe');
  await expect(page.getByRole('table').first()).toBeVisible({ timeout: 10_000 });
  expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0);
});

test.describe('no horizontal scroll at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const path of ['/', '/start', '/portfolio']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }

  test('/portfolio with a built portfolio', async ({ page }) => {
    await completeWizard(page);
    await page.waitForLoadState('networkidle');
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
});

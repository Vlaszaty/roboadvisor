import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll } from './helpers';

const SHOT = process.env.SHOT_DIR;

for (const width of [1280, 360]) {
  test(`portfolio: last-N-years comparison and reading guide at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await completeWizard(page);
    const section = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: /^Last \d+ years?$/ }) }).last();
    await expect(section.getByRole('heading', { name: 'Last 5 years', exact: true })).toBeVisible();
    await expect(section.getByRole('table', { name: /key numbers/i })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByRole('columnheader', { name: 'S&P 500' })).toBeVisible();
    await expect(section.getByText('How to read these numbers')).toBeVisible();
    // keyboard: pick 10y via the radio group
    await section.getByRole('radio', { name: '10y' }).focus();
    await page.keyboard.press('Space');
    await expect(section.getByRole('heading', { name: 'Last 10 years', exact: true })).toBeVisible();
    await expect(section.getByRole('table', { name: /key numbers/i })).toBeVisible({ timeout: 15_000 });
    await expect(section.locator('.recharts-legend-item-text')).toHaveText(['Portfolio', 'World', 'S&P 500']);
    await expectNoHorizontalScroll(page);
    if (SHOT) await section.screenshot({ path: `${SHOT}/comparison-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test('backtest: World and S&P 500 columns', async ({ page }) => {
  await completeWizard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: /run backtest/i }).click();
  const metrics = page.getByRole('table', { name: /backtest metrics/i });
  await expect(metrics.getByRole('columnheader', { name: 'World' })).toBeVisible({ timeout: 15_000 });
  await expect(metrics.getByRole('columnheader', { name: 'S&P 500' })).toBeVisible();
  await expect(page.locator('.recharts-legend-item-text').first()).toBeVisible();
  await expect(page.locator('.recharts-legend-item-text').filter({ hasText: /^(Portfolio|Benchmark|World|S&P 500)$/ })).toHaveText(['Portfolio', 'Benchmark', 'World', 'S&P 500']);
});

test('portfolio: holdings table does not overflow at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeWizard(page);
  const table = page.locator('table.table-holdings');
  await expect(table).toBeVisible({ timeout: 15_000 });
  const box = await table.evaluate((el) => {
    const wrap = el.parentElement!;
    return { tw: el.scrollWidth, tc: el.clientWidth, ww: wrap.scrollWidth, wc: wrap.clientWidth };
  });
  expect(box.tw).toBeLessThanOrEqual(box.tc);
  expect(box.ww).toBeLessThanOrEqual(box.wc);
  await expectNoHorizontalScroll(page);
});

test('backtest: drawdown axis ticks are at or below 0%', async ({ page }) => {
  await completeWizard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: /run backtest/i }).click();
  const card = page.locator('figure.chart-frame').filter({ hasText: 'Portfolio drawdown' });
  const ticks = card.locator('.recharts-yAxis-tick-labels text');
  await expect(ticks.first()).toBeVisible({ timeout: 15_000 });
  const values = (await ticks.allTextContents()).map((t) => parseFloat(t.replace('−', '-')));
  expect(values.length).toBeGreaterThan(1);
  for (const v of values) expect(v).toBeLessThanOrEqual(0);
});

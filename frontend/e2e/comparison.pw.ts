import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll, goToPage } from './helpers';

const SHOT = process.env.SHOT_DIR;

for (const width of [1280, 360]) {
  test(`portfolio: last-N-years comparison and reading guide at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await completeWizard(page);
    const section = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: /^Today's mix, applied to the last \d+ years?$/ }) }).last();
    await expect(section.getByRole('heading', { name: "Today's mix, applied to the last 5 years", exact: true })).toBeVisible();
    await expect(section.getByRole('table', { name: /key numbers/i })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByRole('columnheader', { name: 'S&P 500' })).toBeVisible();
    await expect(section.getByText('How to read these numbers')).toBeVisible();
    await expect(section.getByText(/Not a track record/)).toBeVisible();
    await expect(section.getByRole('link', { name: 'backtest' })).toHaveAttribute('href', '/backtest');
    await expect(section.getByText(/Sharpe on the summary card is the model's forward-looking estimate/)).toBeVisible();
    // keyboard: pick 10y via the radio group; the previous result stays on screen (dimmed) while it loads
    await section.getByRole('radio', { name: '10y' }).focus();
    await page.keyboard.press('Space');
    await expect(section.getByRole('heading', { name: "Today's mix, applied to the last 10 years", exact: true })).toBeVisible();
    await expect(section.getByRole('table', { name: /key numbers/i })).toBeVisible({ timeout: 100 });
    await expect(section.getByText('Loading…', { exact: true })).toHaveCount(0);
    await expect(section.getByRole('table', { name: /key numbers over the last 10 years/i })).toBeVisible({ timeout: 15_000 });
    await expect(section.locator('.stale')).toHaveCount(0);
    await expect(section.locator('.recharts-legend-item-text')).toHaveText(['Portfolio', 'World', 'S&P 500']);
    await expectNoHorizontalScroll(page);
    if (SHOT) await section.screenshot({ path: `${SHOT}/comparison-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test('how it did: World and S&P 500 columns', async ({ page }) => {
  await completeWizard(page);
  await goToPage(page, 'How it did');
  const metrics = page.getByRole('table', { name: /replay numbers/i });
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
  // Regression: the ticker · ISIN line once matched `.table-holdings .num { width: 1% }` and wrapped
  // one character per line, making every row ~10x too tall. Each fits on one line; rows stay compact.
  const heights = await table.evaluate((el) => ({
    tickerLines: [...el.querySelectorAll('tbody td:first-child .small')].map((d) => d.getBoundingClientRect().height),
    rows: [...el.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().height),
  }));
  expect(heights.tickerLines.length).toBeGreaterThan(0);
  for (const h of heights.tickerLines) expect(h).toBeLessThan(24);
  for (const h of heights.rows) expect(h).toBeLessThan(90);
});

test('how it did: fall chart axis ticks are at or below 0%', async ({ page }) => {
  await completeWizard(page);
  await goToPage(page, 'How it did');
  const card = page.locator('figure.chart-frame').filter({ hasText: 'Fall from the highest point so far' });
  const ticks = card.locator('.recharts-yAxis-tick-labels text');
  await expect(ticks.first()).toBeVisible({ timeout: 15_000 });
  const values = (await ticks.allTextContents()).map((t) => parseFloat(t.replace('−', '-')));
  expect(values.length).toBeGreaterThan(1);
  for (const v of values) expect(v).toBeLessThanOrEqual(0);
});

// Regression: "View as table" stretched chart cards to the table's width (grid min-width:auto), so the
// page scrolled sideways; the frontier table listed every fund (3k+ px tall). Every table must scroll
// inside its own card and stay within a bounded height.
async function openAllTables(page: import('@playwright/test').Page) {
  const summaries = page.locator('summary', { hasText: /view as table/i });
  await expect(summaries.first()).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < (await summaries.count()); i++) await summaries.nth(i).click();
}
async function expectTablesContained(page: import('@playwright/test').Page) {
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('details.chart-table')].flatMap((d) => {
      const wrap = d.querySelector('.table-scroll') as HTMLElement | null;
      const card = (d.closest('.card') ?? d.parentElement) as HTMLElement;
      if (!wrap) return [];
      const w = wrap.getBoundingClientRect(), c = card.getBoundingClientRect();
      const title = d.closest('figure')?.querySelector('.chart-title')?.textContent ?? '?';
      return w.right > c.right + 1 || w.height > 460 ? [`${title}: right ${w.right}>${c.right} or height ${w.height}`] : [];
    }),
  );
  expect(bad).toEqual([]);
  await expectNoHorizontalScroll(page);
}
for (const width of [1280, 390]) {
  test(`every "View as table" stays inside its card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await completeWizard(page);
    // the best-mix chart is folded away until opened
    await page.locator('summary', { hasText: 'Best mix for each level of risk' }).click();
    await page.getByLabel('Show individual funds').check();
    await expect(page.locator('summary', { hasText: /view as table/i }).nth(3)).toBeVisible({ timeout: 15_000 });
    await openAllTables(page);
    await expectTablesContained(page);
    await expect(page.locator('table.table-holdings .badge')).toHaveCount(0);
    await goToPage(page, 'How it did');
    await openAllTables(page);
    await expectTablesContained(page);
  });
}

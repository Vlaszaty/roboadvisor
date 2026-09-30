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
});

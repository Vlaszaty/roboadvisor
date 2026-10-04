import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

for (const width of [1280, 360]) {
  test(`textbook: seven explained steps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/textbook');
    await expect(page.getByRole('heading', { name: 'Textbook portfolio' })).toBeVisible();
    await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
    await expect(page.locator('.step h2')).toContainText([
      'Returns and risk per fund', 'How the funds move together', 'Expected returns', 'The efficient frontier',
      'The tangent portfolio', 'Your split', 'Your textbook portfolio',
    ]);
    await expect(page.locator('.step .step-formula')).toHaveCount(7);
    await expect(page.getByText('Worked example.')).toHaveCount(7);
    await expect(page.locator('.step').nth(3).locator('.recharts-scatter .recharts-symbols').first()).toBeVisible();
    await expect(page.locator('.corr tbody tr')).toHaveCount(7);
    await expect(page.locator('th.used')).toContainText('CAPM return');
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test('textbook: the menu links to the page and the controls keep it alive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Textbook' }).click();
  await expect(page).toHaveURL(/\/textbook/);
  await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
  await page.getByRole('radio', { name: 'Historical average' }).check();
  await page.getByLabel('Market premium (%)').fill('');
  await page.getByLabel(/Risk level/).press('ArrowRight'); // a range input cannot be filled
  await expect(page.locator('.step')).toHaveCount(7);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, goToPage } from './helpers';

for (const width of [1280, 360]) {
  test(`textbook: seven explained steps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/textbook');
    await expect(page.getByRole('heading', { name: 'How it works', level: 1 })).toBeVisible();
    await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
    await expect(page.locator('.step h2')).toContainText([
      'How each fund has done', 'How the funds move together', 'What each fund could earn', 'The best mixes',
      'The best mix of risky funds', 'How much goes where', 'Your textbook plan',
    ]);
    // formulas are folded away; opening one shows it
    await expect(page.locator('.step').getByText('Show the formula')).toHaveCount(7);
    await expect(page.locator('.step .step-formula')).toHaveCount(0);
    await page.locator('.step').first().getByText('Show the formula').click();
    await expect(page.locator('.step .step-formula')).toHaveCount(1);
    await expect(page.getByText('With your numbers.')).toHaveCount(7);
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
  await goToPage(page, 'How it works');
  await expect(page).toHaveURL(/\/textbook/);
  await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
  await page.getByLabel('Market premium in percent').fill('');
  await page.getByRole('radio', { name: /Past averages/ }).check();
  await page.getByLabel(/Risk level/).press('ArrowRight'); // a range input cannot be filled
  await expect(page.locator('.step')).toHaveCount(7);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

for (const width of [1280, 360]) {
  test(`universe: risk/return card with model and realised frames at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/universe');
    // the chart is folded away until opened
    await page.locator('summary', { hasText: 'See these funds on a chart' }).click();
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Risk and return' }) });
    await expect(card.locator('.recharts-scatter .recharts-symbols').first()).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText(/Forward-looking estimates/)).toBeVisible();
    await expect(card.locator('.recharts-legend-item-text', { hasText: 'Efficient frontier' })).toBeVisible();
    await card.getByRole('radio', { name: 'Realised' }).check();
    await expect(card.getByText(/No frontier is drawn/)).toBeVisible();
    await expect(card.locator('.recharts-legend-item-text', { hasText: 'Efficient frontier' })).toHaveCount(0);
    await card.locator('.recharts-surface').first().scrollIntoViewIfNeeded();
    await card.locator('.recharts-scatter .recharts-symbols').first().hover({ force: true }); // points overlap: the tooltip is for whichever dot is on top
    await expect(card.locator('.tip-title')).not.toBeEmpty();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test('universe: the chart follows the filters', async ({ page }) => {
  await page.goto('/universe');
  await page.locator('summary', { hasText: 'See these funds on a chart' }).click();
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Risk and return' }) });
  await expect(card.locator('.recharts-scatter .recharts-symbols').first()).toBeVisible({ timeout: 20_000 });
  const all = await card.locator('.recharts-scatter .recharts-symbols').count();
  await page.getByRole('radio', { name: /^Bonds/ }).check();
  await expect.poll(async () => card.locator('.recharts-scatter .recharts-symbols').count(), { timeout: 20_000 }).toBeLessThan(all);
  await expect(card.locator('.marker-legend li')).toHaveText(['Bonds']);
});

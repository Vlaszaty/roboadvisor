import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll } from './helpers';

const SHOT = process.env.SHOT_DIR;

for (const width of [1280, 360]) {
  test(`portfolio: efficient frontier at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await completeWizard(page);
    await expect(page.getByText('world shares are around 0.3 to 0.5 in the long run')).toBeVisible({ timeout: 15_000 });
    // the chart is folded away until opened
    await page.locator('summary', { hasText: 'Best mix for each level of risk' }).click();
    const section = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: 'Efficient frontier' }) }).last();
    await expect(section.locator('.recharts-legend-item-text')).toHaveText(
      ['Model frontier', 'Capital market line'], { timeout: 15_000 },
    );
    const legend = section.getByRole('list', { name: 'Marker legend' });
    await expect(legend.getByRole('listitem')).toHaveText([
      'Your portfolio', 'World equities', 'S&P 500', 'Minimum variance', 'Maximum Sharpe', 'Risk parity', 'Hierarchical risk parity',
    ]);
    await expect(section.getByText(/sits on the model curve by construction/)).toBeVisible();
    await expect(section.getByText(/forward-looking estimates, not results/)).toBeVisible();
    await expect(section.getByRole('radio')).toHaveCount(0);
    if (SHOT) await section.screenshot({ path: `${SHOT}/frontier-model-${width}.png` });
    await section.getByLabel('Show individual funds').check();
    await expect(legend.getByRole('listitem').last()).toHaveText('Individual funds');
    await expectNoHorizontalScroll(page);
    if (SHOT) await section.screenshot({ path: `${SHOT}/frontier-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test('portfolio: hovering a frontier marker shows that marker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeWizard(page);
  await page.locator('summary', { hasText: 'Best mix for each level of risk' }).click();
  const section = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: 'Efficient frontier' }) }).last();
  await expect(section.locator('.frontier-label').first()).toBeVisible({ timeout: 15_000 });
  await section.locator('.recharts-surface').first().scrollIntoViewIfNeeded();
  for (const name of ['Your portfolio', 'World equities', 'S&P 500']) {
    // the shape sits next to its text label inside the marker's <g>
    const box = (await section.locator('.frontier-label', { hasText: name }).locator('xpath=..').locator('circle').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(section.locator('.tip-title')).toHaveText(new RegExp(name.replace(/[&]/g, '\\$&')));
  }
});

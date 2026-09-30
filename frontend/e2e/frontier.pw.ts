import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll } from './helpers';

const SHOT = process.env.SHOT_DIR;

for (const width of [1280, 360]) {
  test(`portfolio: efficient frontier at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await completeWizard(page);
    const section = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: 'Efficient frontier' }) }).last();
    await expect(section.locator('.recharts-legend-item-text')).toHaveText(
      ['Model frontier', 'Hindsight frontier', 'Capital market line'], { timeout: 15_000 },
    );
    const legend = section.getByRole('list', { name: 'Marker legend' });
    await expect(legend.getByRole('listitem')).toHaveText([
      'Your portfolio', 'World equities', 'S&P 500', 'Minimum variance', 'Maximum Sharpe', 'Risk parity', 'Hierarchical risk parity',
    ]);
    await section.getByRole('radio', { name: 'Hindsight' }).focus();
    await page.keyboard.press('Space');
    await section.getByLabel('Show individual funds').check();
    await expect(legend.getByRole('listitem').last()).toHaveText('Individual funds');
    await section.getByRole('radio', { name: '10y' }).check();
    await expect(section.locator('.recharts-legend-item-text').first()).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    if (SHOT) await section.screenshot({ path: `${SHOT}/frontier-${width}.png` });
    expect(errors).toEqual([]);
  });
}

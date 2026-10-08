import { expect, type Page } from '@playwright/test';

export async function expectNoHorizontalScroll(page: Page) {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
}

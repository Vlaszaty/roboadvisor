import { expect, type Page } from '@playwright/test';

// Buttons/links that move the wizard forward (the header "Build my plan" link is not one of them).
const ADVANCE = /^(next|continue|confirm|use this risk level|see my risk( level)?|show my plan|see my plan)\b/i;

async function answerVisibleQuestions(page: Page) {
  for (const input of await page.locator('input[type="number"]:visible').all()) {
    if (!(await input.inputValue())) {
      const min = Number((await input.getAttribute('min')) ?? '1');
      const max = Number((await input.getAttribute('max')) ?? '40');
      await input.fill(String(Math.min(Math.max(10, min), max)));
    }
  }
  for (const group of await page.getByRole('radiogroup').all()) {
    if (!(await group.isVisible())) continue;
    if (await group.getByRole('radio', { checked: true }).count()) continue;
    const radios = group.getByRole('radio');
    const n = await radios.count();
    if (n) await radios.nth(Math.floor((n - 1) / 2)).check();
  }
}

/** Drives landing -> wizard until the plan page is reached (state lives in memory, so tests that need a portfolio must go through the UI). */
export async function completeWizard(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: /build my plan/i }).first().click();
  await expect(page).toHaveURL(/\/start/);
  for (let i = 0; i < 30 && !/\/portfolio/.test(page.url()); i++) {
    await answerVisibleQuestions(page);
    const advance = page.getByRole('button', { name: ADVANCE }).or(page.getByRole('link', { name: ADVANCE })).first();
    await expect(advance).toBeEnabled();
    const before = { url: page.url(), text: await page.getByRole('main').innerText() };
    await advance.click();
    // condition wait: the page moved on (route changed or the step content was re-rendered)
    await expect
      .poll(async () => page.url() !== before.url || (await page.getByRole('main').innerText()) !== before.text)
      .toBe(true);
  }
  await expect(page).toHaveURL(/\/portfolio/);
}

/** Fails if the page is wider than the viewport. Waits for a visible landmark first so layout has settled. */
export async function expectNoHorizontalScroll(page: Page) {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
}

/** Opens a page from the main menu. On a phone the menu is folded away behind a Menu button. */
export async function goToPage(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Menu', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

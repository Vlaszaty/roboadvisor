import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const fixture = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8'));

test('the additional café leaves all three looks, existing navigation and plan state unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/portfolio', route => route.fulfill({ json: fixture }));
  for (const look of ['sunny', 'night', 'swiss']) {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Look', exact: true }).selectOption(look);
    const nav = await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link').allTextContents();
    const title = await page.getByRole('heading', { level: 1 }).innerText();
    const typography = await page.getByRole('heading', { level: 1 }).evaluate(node => {
      const s = getComputedStyle(node);
      return { font: s.fontFamily, transform: s.textTransform, spacing: s.letterSpacing, color: s.color };
    });
    const plan = await page.evaluate(() => localStorage.getItem('roboadvisor.state.v1'));
    // Exercise a client-side transition: café CSS stays loaded on the way back.
    await page.evaluate(() => {
      history.pushState(null, '', '/cafe');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('main.cafe-page')).toBeVisible();
    await expect(page.locator('.site-header')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-style', look);
    await expect(page.locator('.cafe-page h1')).toHaveCSS('text-transform', 'none');
    await expect(page.locator('.cafe-page h1')).toHaveCSS('font-stretch', '100%');
    await expect(page.locator('.cafe-page h1')).toHaveCSS('letter-spacing', 'normal');
    await expect(page.locator('.cafe-page h1')).toHaveCSS('color', 'rgb(61, 68, 52)');
    expect(await page.locator('.cafe-page h1').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Fraunces');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('radio', { name: /^Matcha/ }).check();
    await page.getByRole('button', { name: /Next choice/ }).click();
    await page.getByRole('button', { name: /Next choice/ }).click();
    await page.getByRole('radio', { name: /^Half milk/ }).check();
    await page.getByRole('button', { name: /Next choice/ }).click();
    await page.getByRole('radio', { name: /^Two spoons/ }).check();
    await page.getByRole('button', { name: 'Make my example' }).click();
    await expect(page.getByRole('heading', { name: 'This is your investment recipe.' })).toBeVisible();
    await expect(page.locator('.cafe-serving-time')).toHaveText('10 years');
    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => localStorage.getItem('roboadvisor.state.v1'))).toBe(plan);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.getByRole('heading', { level: 1 }).innerText()).toBe(title);
    expect(await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link').allTextContents()).toEqual(nav);
    expect(await page.getByRole('heading', { level: 1 }).evaluate(node => {
      const s = getComputedStyle(node);
      return { font: s.fontFamily, transform: s.textTransform, spacing: s.letterSpacing, color: s.color };
    })).toEqual(typography);
    await expect(page.locator('html')).toHaveAttribute('data-style', look);
    await expect(page.getByRole('link', { name: 'Café', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('roboadvisor.state.v1'))).toBe(plan);
  }
});

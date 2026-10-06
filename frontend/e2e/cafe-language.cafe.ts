import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const orderFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu_order.json', import.meta.url), 'utf8'));
const menuFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu.json', import.meta.url), 'utf8'));

test('English covers the order, the board and the receipt without recalculating on a switch', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/menu/order', route => { requests++; return route.fulfill({ json: orderFixture, headers: { 'X-Cafe-Data': 'synthetic' } }); });
  await page.route('**/api/menu', route => route.fulfill({ json: menuFixture }));
  await page.goto('/cafe');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('radio', { name: /^Coffee/ }).check();
  await expect(page.getByRole('slider')).toBeVisible(); // the click moved on by itself
  await page.getByRole('button', { name: /Next choice/ }).click();
  await page.getByRole('radio', { name: /^Plenty/ }).check();
  await page.getByRole('radio', { name: /^Old regular/ }).check();
  await page.getByRole('radio', { name: /^No milk/ }).check();
  await expect(page.getByRole('radio', { name: /^One spoon/ })).toBeVisible();
  await expect(page.getByText('€10,000 could fall to €7,000')).toBeVisible();
  await page.getByRole('radio', { name: /^One spoon/ }).check();
  const board = page.getByRole('complementary', { name: /Menu board|Menukaart/ });
  await expect(board.getByText(/\/7 · /)).toHaveText('6/7 · Strong');
  await page.getByRole('button', { name: 'Nederlands' }).click();
  await expect(board.getByText(/\/7 · /)).toHaveText('6/7 · Sterk');
  await expect(page.getByRole('radio', { name: /^Eén schepje/ })).toBeChecked();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Make my example' }).click();
  await expect(page.getByRole('heading', { name: 'Here you go: your coffee, strong (6 of 7).' })).toBeVisible();
  await expect(page.locator('.cafe-served-receipt')).toContainText('Bad months (Value at Risk)');
  await page.getByRole('button', { name: 'Nederlands' }).click();
  await expect(page.locator('.cafe-served-receipt')).toContainText('Slechte maanden (Value at Risk)');
  expect(requests).toBe(1);
});

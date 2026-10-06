import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const orderFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu_order.json', import.meta.url), 'utf8'));
const menuFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu.json', import.meta.url), 'utf8'));
const next = (page: Page) => page.getByRole('button', { name: /Volgende keuze/ }).click();

async function mockApi(page: Page, onOrder?: (body: Record<string, any>) => void) {
  await page.route('**/api/menu/order', route => {
    onOrder?.(route.request().postDataJSON());
    return route.fulfill({ json: orderFixture, headers: { 'X-Cafe-Data': 'synthetic' } });
  });
  await page.route('**/api/menu', route => route.fulfill({ json: menuFixture, headers: { 'X-Cafe-Data': 'synthetic' } }));
}
/** Matcha, 10 years, well-filled jar, no debt, regular, half milk, two spoons: capacity and tolerance both 67.5. */
async function order(page: Page, sugar = /^Twee schepjes/) {
  await page.goto('/cafe');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('radio', { name: /^Matcha/ }).check();
  await next(page);
  await page.getByRole('spinbutton', { name: /Hoe lang/ }).fill('10');
  await next(page);
  await page.getByRole('radio', { name: /^Ruim gevuld/ }).check();
  await page.getByRole('radio', { name: /^Geen dure schulden/ }).check();
  await next(page);
  await page.getByRole('radio', { name: /^Vaste gast/ }).check();
  await next(page);
  await page.getByRole('radio', { name: /^Half melk/ }).check();
  await next(page);
  await page.getByRole('radio', { name: sugar }).check();
}

test('six choices pick one fixed menu item and only send the item and amounts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let body: Record<string, any> | undefined;
  await mockApi(page, b => { body = b; });
  await order(page);
  const board = page.getByRole('complementary', { name: /Menukaart/ });
  await expect(board.getByText('5/7 · Vol')).toBeVisible();
  await expect(board).toContainText('wijzen naar hetzelfde (68/100)');
  await page.getByRole('textbox', { name: /Startbedrag/ }).fill('10000');
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toBeAttached();
  expect(body).toEqual({ base: 'matcha', profile_id: 5, horizon_years: 10, initial_amount: 10000, monthly_amount: 0 });
  await expect(page.getByRole('heading', { name: 'Alsjeblieft: je matcha, vol (5 van 7).' })).toBeVisible();
  await expect(page.getByText('Demorecept · fictieve marktprijzen en ESG-labels')).toBeVisible();
  const receipt = page.locator('.cafe-served-receipt');
  await expect(receipt.locator('.cafe-cases')).toContainText('€ 16.856');
  await expect(receipt.locator('.cafe-fund-list li')).toHaveCount(orderFixture.holdings.length);
  await expect(receipt.getByRole('table')).toContainText('1 op 20 maanden');
  await expect(receipt.locator('.cafe-past')).toContainText('Laatste 5 jaar');
  await expect(page.locator('.cafe-result')).toBeFocused();
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
  }
  expect(errors).toEqual([]);
});

test('later steps stay locked; the board jumps back to an earlier answer', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cafe');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const board = page.getByRole('complementary', { name: /Menukaart/ });
  await expect(board.getByRole('button', { name: /De suiker/ })).toBeDisabled();
  await order(page);
  await board.getByRole('button', { name: /Je spaarpot/ }).click();
  await expect(page.getByRole('heading', { name: 'Hoe vol is je spaarpot?' })).toBeVisible();
  await page.getByRole('radio', { name: /^Bijna leeg/ }).check();
  await expect(board).toContainText('Vul eerst je spaarpot');
  await expect(board.getByText(/\/7 · /)).toHaveText('4/7 · In balans');
});

test('extra sweet gives the mildest item and needs consent before any request', async ({ page }) => {
  let requests = 0;
  await mockApi(page, () => { requests++; });
  await order(page, /^Extra zoet/);
  const make = page.getByRole('button', { name: 'Maak mijn voorbeeld' });
  await expect(make).toBeDisabled();
  await expect(page.getByRole('complementary', { name: /Menukaart/ }).getByText('1/7 · Heel zacht')).toBeVisible();
  await page.getByRole('checkbox', { name: /mogelijk verlies verkennen/ }).check();
  await make.click();
  await expect(page.locator('.cafe-result')).toBeVisible();
  expect(requests).toBe(1);
});

test('errors keep the order and allow a retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/menu/order', route => fail
    ? route.fulfill({ status: 503, json: { error: 'NoData', detail: 'no data loaded' } })
    : route.fulfill({ json: orderFixture, headers: { 'X-Cafe-Data': 'synthetic' } }));
  await page.route('**/api/menu', route => route.fulfill({ json: menuFixture }));
  await order(page);
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('alert')).toContainText('no data loaded');
  fail = false;
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(page.locator('.cafe-result')).toBeVisible();
});

test('on a phone the board folds into a bar that opens as a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await order(page);
  const toggle = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Je bestelling' })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('heading', { name: 'Je bestelling' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Je bestelling' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Maak mijn voorbeeld' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.locator('.cafe-served-receipt')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('the menu page shows all seven strengths for both bases', async ({ page }) => {
  await page.route('**/api/menu', route => route.fulfill({ json: menuFixture }));
  await page.goto('/cafe/menu');
  const rows = page.locator('.menu-table tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(page.locator('.menu-table caption')).toContainText('Koffie');
  await page.getByRole('button', { name: /^Matcha/ }).click();
  await expect(page.locator('.menu-table caption')).toContainText('Matcha');
  await rows.nth(1).getByRole('button').click();
  await expect(page.getByRole('heading', { name: /Matcha · Zacht/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Groei van €1/ })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
  }
});

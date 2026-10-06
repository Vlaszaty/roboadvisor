import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const orderFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu_order.json', import.meta.url), 'utf8'));
const menuFixture = JSON.parse(readFileSync(new URL('../src/mocks/menu.json', import.meta.url), 'utf8'));
const next = (page: Page) => page.getByRole('button', { name: /Volgende keuze/ }).click();
/** Moves a preset slider to option i (0 = leftmost) with the keyboard, which also counts as choosing it. */
async function slide(page: Page, name: RegExp, i: number) {
  const slider = page.getByRole('slider', { name });
  await slider.focus();
  await page.keyboard.press('Home');
  for (let k = 0; k < i; k++) await page.keyboard.press('ArrowRight');
}

async function mockApi(page: Page, onOrder?: (body: Record<string, any>) => void) {
  await page.route('**/api/menu/order', route => {
    onOrder?.(route.request().postDataJSON());
    return route.fulfill({ json: orderFixture, headers: { 'X-Cafe-Data': 'synthetic' } });
  });
  await page.route('**/api/menu', route => route.fulfill({ json: menuFixture, headers: { 'X-Cafe-Data': 'synthetic' } }));
}
/** Matcha, 10 years, a little set aside, regular, half milk, two spoons: capacity 50, tolerance 67.5 -> profile 4. */
async function order(page: Page, sugar = 2) {
  await page.goto('/cafe/order');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('radio', { name: /^Matcha/ }).check(); // a click moves on by itself
  await expect(page.getByRole('slider', { name: /Hoe lang/ })).toHaveAttribute('aria-valuetext', /10 jaar/);
  await next(page);
  await slide(page, /achter de hand/, 1); // een beetje
  await next(page);
  await slide(page, /ervaring/, 2); // vaste gast
  await next(page);
  await slide(page, /melk/, 2); // half melk
  await next(page);
  await slide(page, /suiker/, sugar);
}

test('six choices pick one fixed menu item and only send the item and amounts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let body: Record<string, any> | undefined;
  await mockApi(page, b => { body = b; });
  await order(page);
  const board = page.getByRole('complementary', { name: /Menukaart/ });
  await expect(board.getByText('4/7 · In balans')).toBeVisible();
  await expect(board).toContainText('wat je financieel kunt dragen (50/100)');
  await page.getByRole('textbox', { name: /Startbedrag/ }).fill('10000');
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toBeAttached();
  expect(body).toEqual({ base: 'matcha', profile_id: 4, horizon_years: 10, initial_amount: 10000, monthly_amount: 0 });
  await expect(page.getByRole('heading', { name: 'Alsjeblieft: je matcha, in balans (4 van 7).' })).toBeVisible();
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

test('a click on an option moves on by itself; keyboard arrows only select', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cafe/order');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('radio', { name: /^Koffie/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^Matcha/ })).toBeChecked();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'Waar beginnen we mee?' })).toBeVisible();
  await page.getByRole('radio', { name: /^Koffie/ }).click();
  await expect(page.getByRole('heading', { name: 'Wanneer wil je je koffie?' })).toBeVisible();
});

test('the time slider brews from espresso to home-grown coffee', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cafe/order');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('radio', { name: /^Koffie/ }).click();
  const slider = page.getByRole('slider', { name: /Hoe lang/ });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '1 jaar, Espresso');
  await expect(page.locator('.cafe-choice-caption')).toContainText('Binnen 2 jaar nodig?');
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '40 jaar, Eigen koffieplant');
});

test('a preset slider chooses nothing until it is moved, then names the choice', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cafe/order');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('radio', { name: /^Koffie/ }).click();
  await expect(page.getByRole('slider', { name: /Hoe lang/ })).toBeVisible();
  await next(page);
  const slider = page.getByRole('slider', { name: /achter de hand/ });
  await expect(slider).toHaveAttribute('aria-valuetext', 'Nog niet gekozen');
  await expect(page.getByRole('button', { name: /Volgende keuze/ })).toBeDisabled();
  await slide(page, /achter de hand/, 0);
  await expect(slider).toHaveAttribute('aria-valuetext', /^Ruim/);
  await expect(page.getByText('Een onverwachte rekening betaal ik makkelijk.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Volgende keuze/ })).toBeEnabled();
});

test('later steps stay locked; the board jumps back to an earlier answer', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cafe/order');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const board = page.getByRole('complementary', { name: /Menukaart/ });
  await expect(board.getByRole('button', { name: /De suiker/ })).toBeDisabled();
  await order(page);
  await board.getByRole('button', { name: /Achter de hand/ }).click();
  await expect(page.getByRole('heading', { name: 'Heb je iets achter de hand?' })).toBeVisible();
  await slide(page, /achter de hand/, 2);
  await expect(page.getByRole('slider', { name: /achter de hand/ })).toHaveAttribute('aria-valuetext', 'Niets. Minder dan 1 maand vaste lasten opzij');
  await expect(board).toContainText('Zet eerst iets opzij');
  await expect(board.getByText(/\/7 · /)).toHaveText('3/7 · Rond');
});

test('extra sweet gives the mildest item with a warning, in the same space', async ({ page }) => {
  let requests = 0;
  await mockApi(page, () => { requests++; });
  await order(page, 3);
  const area = page.locator('.cafe-choice-area');
  const before = await area.boundingBox();
  await slide(page, /suiker/, 4);
  await expect(page.getByRole('note').filter({ hasText: 'Ook extra zoet kan verlies geven.' })).toBeVisible();
  const after = await area.boundingBox();
  expect([after!.y, after!.height]).toEqual([before!.y, before!.height]); // same place, same size
  await expect(page.getByRole('complementary', { name: /Menukaart/ }).getByText('1/7 · Heel zacht')).toBeVisible();
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
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

test('the entrance starts a new order and reopens past recipes', async ({ page }) => {
  let requests = 0;
  await mockApi(page, () => { requests++; });
  await page.goto('/cafe');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welkom aan de bar' })).toBeVisible();
  await expect(page.getByText('Nog geen recepten.')).toBeVisible();
  await order(page);
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.locator('.cafe-result')).toBeVisible();
  await page.getByRole('link', { name: /Naar de ingang/ }).click();
  const receipts = page.locator('.cafe-home-receipt');
  await expect(receipts).toHaveCount(1);
  await expect(receipts.first()).toContainText('Matcha · In balans');
  await page.getByRole('button', { name: 'Bekijk opnieuw' }).click();
  await expect(page.locator('.cafe-result')).toBeVisible();
  expect(requests).toBe(2);
  await page.goto('/cafe');
  await page.getByRole('button', { name: 'Nieuwe bestelling' }).click();
  await expect(page.getByRole('heading', { name: 'Waar beginnen we mee?' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Matcha/ })).not.toBeChecked();
  await page.goto('/cafe');
  await page.getByRole('button', { name: /^Verwijder/ }).click();
  await expect(receipts).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
  }
});

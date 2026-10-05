import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const fixture = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8'));
async function englishOrder(page: Page) {
  await page.goto('/cafe');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('radio', { name: /^Matcha/ }).check();
  await page.getByRole('button', { name: /Next choice/ }).click();
  await page.getByRole('spinbutton', { name: /How long/ }).fill('10');
  await page.getByRole('button', { name: /Next choice/ }).click();
  await page.getByRole('radio', { name: /^Half milk/ }).check();
  await page.getByRole('button', { name: /Next choice/ }).click();
  await page.getByRole('radio', { name: /^Two spoons/ }).check();
}

test('English covers the order, persisted choices, receipt and expanded calculations without recalculating on a language switch', async ({ page }) => {
  let requests = 0;
  let body: any;
  await page.route('**/api/portfolio', route => {
    requests++;
    body = route.request().postDataJSON();
    return route.fulfill({ json: fixture, headers: { 'X-Cafe-Data': 'synthetic' } });
  });
  await englishOrder(page);
  await expect(page.locator('main')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Your investment recipe · At the café');
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Nederlands', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Twee schepjes/ })).toBeChecked();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Two spoons/ })).toBeChecked();
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('radio', { name: /^Matcha/ })).toBeChecked();
  await page.getByRole('button', { name: '4 The sugar', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Two spoons/ })).toBeChecked();
  await page.getByText('Amount & explanation').click();
  await page.getByRole('textbox', { name: /Starting amount/ }).fill('10,000.50');
  await expect(page.getByRole('button', { name: 'Make my example' })).toBeEnabled();
  await page.getByRole('button', { name: 'Make my example' }).click();
  await expect(page.getByRole('heading', { name: 'Here you go, your matcha with half milk and two spoonfuls of sugar.' })).toBeVisible();
  expect(body.profile.risk_level).toBe(50);
  expect(body.profile.preferences.esg_only).toBe(true);
  expect(body.profile.horizon_years).toBe(10);
  expect(body).not.toHaveProperty('answers');
  await expect(page.locator('.cafe-serving-time')).toHaveText('10 years');
  await expect(page.getByText('Demo recipe · fictional market prices', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equity funds' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bond funds' })).toBeVisible();
  await expect(page.locator('.cafe-tasting-numbers')).toContainText('6.4%');
  await expect(page.getByRole('img', { name: /Sweet–bitter gauge: 11%/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Possible development/ })).not.toBeVisible();
  await page.getByText('View the calculation and scenarios', { exact: true }).click();
  await expect(page.getByText('Annual fund costs', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Possible development over 10 years/ })).toBeVisible();
  await expect(page.locator('.cafe-outcomes')).toContainText('€17,490');
  await page.getByText('And if it turns bitter?', { exact: true }).click();
  await expect(page.getByText('Your sugar choice does not limit possible losses.', { exact: false })).toBeVisible();
  await page.getByText('Open the recipe book · funds and weights', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Ingredient', exact: true })).toBeVisible();
  await page.getByText('View the chart values', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Year', exact: true })).toBeVisible();
  await page.getByText('Why this recipe?', { exact: true }).click();
  await expect(page.getByText(/The lower preset score/)).toBeVisible();
  await page.getByRole('button', { name: 'Nederlands', exact: true }).click();
  await expect(page.locator('.cafe-calculation')).toHaveAttribute('open', '');
  await expect(page.locator('.cafe-tasting-numbers')).toContainText('6,4%');
  await expect(page.getByRole('heading', { name: /Alsjeblieft, hier is je matcha/ })).toBeVisible();
  expect(requests).toBe(1);
});

test('English no-loss consent, labels and navigation stay usable at every size', async ({ page }) => {
  await englishOrder(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const language = await page.locator('.cafe-language').boundingBox();
    const steps = await page.locator('.cafe-steps').boundingBox();
    if (width <= 600) expect(language!.y + language!.height).toBeLessThan(steps!.y);
    for (const step of ['1 The base', '2 Your time', '3 The milk', '4 The sugar']) {
      await page.getByRole('button', { name: step, exact: true }).click();
      await expectNoHorizontalScroll(page);
    }
    await page.getByRole('radio', { name: /^Two spoons/ }).check();
    await page.getByRole('radio', { name: /^Extra sweet/ }).check();
    await expect(page.getByRole('button', { name: 'Make my example' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /only want to explore an example with possible losses/ }).check();
    await expect(page.getByRole('button', { name: 'Make my example' })).toBeEnabled();
    await page.getByRole('button', { name: 'Nederlands', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /alleen een voorbeeld met mogelijk verlies/ })).toBeChecked();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('radio', { name: /^Extra sweet/ })).toBeChecked();
    await expectNoHorizontalScroll(page);
  }
});

test('local calculation errors change language without losing the order', async ({ page }) => {
  await page.route('**/api/portfolio', route => route.fulfill({ json: fixture }));
  await englishOrder(page);
  await page.getByRole('button', { name: '2 Your time', exact: true }).click();
  await page.getByRole('spinbutton', { name: /How long/ }).fill('5');
  await page.getByRole('button', { name: '4 The sugar', exact: true }).click();
  await page.getByRole('button', { name: 'Make my example' }).click();
  await expect(page.getByRole('alert')).toContainText('different time horizon');
  await page.getByRole('button', { name: 'Nederlands', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('andere looptijd');
  await expect(page.getByRole('radio', { name: /^Twee schepjes/ })).toBeChecked();
});

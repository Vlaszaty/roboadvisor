import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const fixture = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8'));
async function order(page: Page, base = 'Matcha', milk = /Half melk/, sugar = /Twee schepjes/) {
  await page.goto('/cafe');
  await page.getByRole('radio', { name: new RegExp(`^${base}`) }).check();
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('spinbutton', { name: /Hoe lang/ }).fill('10');
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('radio', { name: milk }).check();
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('radio', { name: sugar }).check();
}
test('café submits real profile fields without old questionnaire answers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let body: Record<string, any> | undefined;
  await page.route('**/api/portfolio', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: fixture, headers: { 'X-Cafe-Data': 'synthetic' } });
  });
  await order(page);
  await expect(page.getByRole('button', { name: 'Maak mijn voorbeeld' })).toBeEnabled();
  await page.getByText('Bedrag & uitleg').click();
  await page.getByRole('textbox', { name: /Startbedrag/ }).fill('10000');
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toBeVisible();
  await expect(page.locator('.cafe-result')).toBeFocused();
  expect(body?.profile.risk_level).toBe(50);
  expect(body?.profile.preferences.esg_only).toBe(true);
  expect(body?.profile.horizon_years).toBe(10);
  expect(body).not.toHaveProperty('answers');
  await expect(page.getByText('Demorecept · fictieve marktprijzen', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Geserveerde matcha/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Geserveerde matcha/ })).toHaveJSProperty('naturalWidth', 1536);
  await expect(page.getByText('Modelrendement / jaar', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('img', { name: /Mogelijke ontwikkeling/ })).not.toBeVisible();
  await page.getByText('Bekijk de cijfers en scenario’s', { exact: true }).click();
  await expect(page.getByText('Modelrendement / jaar', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Mogelijke ontwikkeling/ })).toBeVisible();
  await page.getByText('Bekijk de cijfers en scenario’s', { exact: true }).click();
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole('img', { name: /Geserveerde matcha/ })).toBeInViewport();
  await expect(page.getByText('Bekijk de cijfers en scenario’s', { exact: true })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('extra sweet requires loss acknowledgement before any portfolio request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/portfolio', route => { requests++; return route.fulfill({ json: fixture }); });
  await order(page, 'Koffie', /Extra veel/, /Extra zoet/);
  await expect(page.getByRole('button', { name: 'Maak mijn voorbeeld' })).toBeDisabled();
  expect(requests).toBe(0);
  await page.getByRole('checkbox', { name: /alleen een voorbeeld met mogelijk verlies/ }).check();
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.getByRole('img', { name: /Geserveerde koffie/ })).toHaveJSProperty('naturalWidth', 1536);
});

test('mobile presets, saved choices and reduced motion remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await order(page);
  await expectNoHorizontalScroll(page);
  const dialogue = await page.locator('.cafe-speech').boundingBox();
  const choices = await page.locator('.cafe-choice-area').boundingBox();
  expect(dialogue!.y + dialogue!.height).toBeLessThanOrEqual(choices!.y);
  await page.getByRole('radio', { name: /Extra zoet/ }).check();
  const longDialogue = await page.locator('.cafe-speech').boundingBox();
  const longChoices = await page.locator('.cafe-choice-area').boundingBox();
  expect(longDialogue!.y + longDialogue!.height).toBeLessThanOrEqual(longChoices!.y);
  await page.getByRole('radio', { name: /Twee schepjes/ }).check();
  await page.reload();
  await page.getByRole('button', { name: /4 De suiker/ }).click();
  await expect(page.getByRole('radio', { name: /Twee schepjes/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /alleen een voorbeeld met mogelijk verlies/ })).toHaveCount(0);
});

test('errors preserve the order; changing a preset clears the old result', async ({ page }) => {
  await page.route('**/api/portfolio', route => route.fulfill({ status: 503, json: { detail: 'Geen marktdatabase beschikbaar.' } }));
  await order(page);
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('alert')).toContainText('Geen marktdatabase beschikbaar.');
  await expect(page.getByRole('radio', { name: /Twee schepjes/ })).toBeChecked();
  await page.unroute('**/api/portfolio');
  await page.route('**/api/portfolio', route => route.fulfill({ json: fixture }));
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toBeVisible();
  await page.getByRole('button', { name: 'Pas mijn recept aan' }).click();
  await page.getByRole('button', { name: /4 De suiker/ }).click();
  await page.getByRole('radio', { name: /Drie schepjes/ }).check();
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toHaveCount(0);
});

test('the scene fills the viewport without an external introduction', async ({ page }) => {
  await page.goto('/cafe');
  await expect(page.getByText('Een klein begin. Een eigen beleggingsrecept.')).toHaveCount(0);
  await expect(page.getByText('Ontwerppreview')).toHaveCount(0);
  await expect(page.getByText('Zet je financiële voorkeuren om in een recept.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Klassieke interface/ })).toHaveCount(0);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const scene = await page.locator('.cafe-scene').boundingBox();
    expect(scene?.x).toBe(0);
    expect(scene?.y).toBe(0);
    expect(scene?.width).toBe(viewport.width);
    expect(scene?.height).toBe(viewport.height);
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('button', { name: /Volgende keuze/ })).toBeInViewport();
  }
});

test('mismatched result horizons are rejected instead of mislabeled', async ({ page }) => {
  await page.route('**/api/portfolio', route => route.fulfill({ json: fixture }));
  await order(page);
  await page.getByRole('button', { name: /2 Je tijd/ }).click();
  await page.getByRole('spinbutton', { name: /Hoe lang/ }).fill('5');
  await page.getByRole('button', { name: /4 De suiker/ }).click();
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByRole('alert')).toContainText('andere looptijd');
  await expect(page.getByRole('heading', { name: 'Dit is jouw beleggingsrecept.' })).toHaveCount(0);
});

test('a risk-target overrun remains clear before opening technical details', async ({ page }) => {
  const higherRisk = structuredClone(fixture);
  higherRisk.summary.volatility = .15;
  higherRisk.summary.target_volatility = .11;
  higherRisk.warnings = ['target volatility 11.00% is below the lowest reachable 15.00%; using the minimum-variance portfolio'];
  await page.route('**/api/portfolio', route => route.fulfill({ json: higherRisk }));
  await order(page);
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByText('Dit recept schommelt naar schatting meer dan beoogd. Bekijk de uitleg.', { exact: true })).toBeVisible();
  await expect(page.getByText(higherRisk.warnings[0], { exact: true })).not.toBeVisible();
  await page.getByText('Bekijk de cijfers en scenario’s', { exact: true }).click();
  await expect(page.getByText(higherRisk.warnings[0], { exact: true })).toBeVisible();
});

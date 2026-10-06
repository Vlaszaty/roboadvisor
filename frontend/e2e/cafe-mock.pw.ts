import { expect, test } from '@playwright/test';

test('fixed mock café does not pretend to calculate the chosen order', async ({ page }) => {
  await page.goto('/cafe');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const next = () => page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('radio', { name: /^Koffie/ }).check();
  await expect(page.getByRole('slider')).toBeVisible(); // the click moved on by itself
  await next();
  await page.getByRole('radio', { name: /^Een beetje/ }).check();
  await page.getByRole('radio', { name: /^Een paar keer/ }).check();
  await page.getByRole('radio', { name: /^Half melk/ }).check();
  await page.getByRole('radio', { name: /^Twee schepjes/ }).check();
  await expect(page.getByRole('button', { name: 'Maak mijn voorbeeld' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Toon het vaste voorbeeld/ }).check();
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByText('Vast demoresultaat · niet berekend voor jouw keuzes', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alsjeblieft, een koffie als vast voorbeeld.' })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Here you go, a coffee as a fixed example.' })).toBeVisible();
});

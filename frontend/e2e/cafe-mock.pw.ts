import { expect, test } from '@playwright/test';

test('fixed mock café does not pretend to calculate chosen presets', async ({ page }) => {
  await page.goto('/cafe');
  await page.getByRole('radio', { name: /^Koffie/ }).check();
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('radio', { name: /Half melk/ }).check();
  await page.getByRole('button', { name: /Volgende keuze/ }).click();
  await page.getByRole('radio', { name: /Twee schepjes/ }).check();
  await expect(page.getByRole('button', { name: 'Maak mijn voorbeeld' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Toon het vaste voorbeeld/ }).check();
  await page.getByRole('button', { name: 'Maak mijn voorbeeld' }).click();
  await expect(page.getByText('Vast demoresultaat · niet berekend voor jouw keuzes', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alsjeblieft, een koffie als vast voorbeeld.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /half melk en twee schepjes/ })).toHaveCount(0);
  await expect(page.locator('.cafe-serving-time')).toHaveText('10 jaar');
  await expect(page.locator('.cafe-receipt-funds li')).toHaveCount(6);
  await expect(page.locator('.cafe-tasting-numbers')).toContainText('6,4%');
  await expect(page.getByRole('img', { name: /Mogelijke ontwikkeling/ })).not.toBeVisible();
});

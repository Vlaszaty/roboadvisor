import { expect, test } from '@playwright/test';
import { completeWizard, goToPage } from './helpers';

test('look switcher changes the look and remembers it', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-style', 'sunny');
  await goToPage(page, 'Funds'); // opens the menu on a phone-sized screen too
  await page.getByLabel('Look').selectOption('swiss');
  await expect(html).toHaveAttribute('data-style', 'swiss');
  await page.reload();
  await expect(html).toHaveAttribute('data-style', 'swiss');
});

test('glossary: search finds a word and a link opens its entry', async ({ page }) => {
  await page.goto('/glossary');
  await page.getByRole('searchbox').fill('fee');
  await expect(page.getByText('Yearly fund fee')).toBeVisible();
  await page.goto('/');
  await page.goto('/glossary#sharpe');
  await expect(page.locator('#sharpe')).toBeVisible();
  await expect(page.locator('#sharpe')).toContainText('Reward for the risk');
});

test('questionnaire: years slider and answer tiles', async ({ page }) => {
  await page.goto('/start');
  const slider = page.getByRole('slider');
  await expect(slider).toBeVisible();
  await slider.fill('20');
  await expect(page.getByText(/invested today could grow to about/)).toContainText('3,207');
  await page.getByRole('button', { name: 'Next' }).click();
  // the second question uses tiles; the title shrinks and Back appears
  await expect(page.getByRole('heading', { name: 'Build your plan', level: 1 })).toBeVisible();
  const tile = page.locator('.tile').nth(1);
  await tile.click();
  await expect(tile).toHaveClass(/is-selected/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Question 1 of 10')).toBeVisible();
  await expect(slider).toHaveValue('20');
});

test('plan: amount card offers one-time, monthly and both', async ({ page }) => {
  await completeWizard(page);
  const card = page.getByRole('region', { name: 'Your amount' });
  await expect(card).toBeVisible();
  await card.getByRole('radio', { name: /Every month/ }).check();
  await expect(card.getByLabel('Amount each month', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '€250' }).click();
  await expect(card.getByLabel('Amount each month', { exact: true })).toHaveValue('250');
  await card.getByRole('radio', { name: /^Both/ }).check();
  await expect(card.getByLabel('One-time amount', { exact: true })).toBeVisible();
  await card.getByRole('radio', { name: /Not sure yet/ }).check();
  await expect(card.getByLabel('Amount each month', { exact: true })).toHaveCount(0);
});

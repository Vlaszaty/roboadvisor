import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard } from './helpers';

const portfolio = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8')) as {
  holdings: { name: string }[];
};

test('landing -> questionnaire -> risk -> preferences -> portfolio (mock mode)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await completeWizard(page);

  await expect(page.getByText(portfolio.holdings[0].name).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(portfolio.holdings[1].name).first()).toBeVisible();
  expect(errors).toEqual([]);
});

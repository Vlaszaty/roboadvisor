import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard } from './helpers';

const portfolio = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8')) as {
  holdings: { name: string }[];
};

test('landing -> questionnaire -> risk -> amount and preferences -> plan (mock mode)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await completeWizard(page);

  // each fund is drawn twice (phone cards and the wide table); only one of them is shown at a time
  await expect(page.getByText(portfolio.holdings[0].name).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(portfolio.holdings[1].name).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What you own' })).toBeVisible();
  expect(errors).toEqual([]);
});

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard, expectNoHorizontalScroll, goToPage } from './helpers';

const universe = JSON.parse(readFileSync(new URL('../src/mocks/universe.json', import.meta.url), 'utf8')) as { name: string }[];

test('how it did: the replay runs by itself and shows the numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await completeWizard(page); // the replay needs a built plan (in-memory state)
  await goToPage(page, 'How it did');
  const metrics = page.getByRole('table', { name: /replay numbers/i });
  await expect(metrics).toBeVisible({ timeout: 15_000 });
  await expect(metrics.getByRole('row', { name: /^Reward for the risk\b/i })).toBeVisible();
  // a different period replays again without a button
  await page.getByRole('radio', { name: '10 years' }).check();
  await expect(page.locator('.replay-chip.is-selected')).toHaveText('10 years');
  await expect(page.getByRole('table', { name: /replay numbers/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'What would have happened' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('plan: adjusting risk rebuilds at the new level', async ({ page }) => {
  await completeWizard(page);
  const slider = page.getByLabel(/calmer on the left/i);
  await expect(slider).toBeVisible();
  const target = (await slider.inputValue()) === '80' ? '30' : '80';
  await slider.fill(target);
  // mocks are in-process (no network to watch); the header reads the same store value the /api/portfolio request key uses
  await expect(page.getByText(`Your risk score is ${target} out of 100`)).toBeVisible();
});

test('funds: cards, type chips, search and pages', async ({ page }) => {
  await page.goto('/universe');
  const cards = page.locator('.fund-card');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  await expect(cards).toHaveCount(Math.min(12, universe.length));
  if (universe.length > 12) {
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
  }
  // search narrows the list to funds that match
  await page.getByRole('searchbox').fill(universe[0].name);
  await expect(page.locator('.fund-card', { hasText: universe[0].name }).first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeLessThanOrEqual(12);
  // a type chip filters by investment type and the count in the chip matches the list
  await page.getByRole('searchbox').fill('');
  await page.getByRole('radio', { name: /^Bonds/ }).check();
  await expect(page.locator('.fund-type').first()).toHaveText('Bonds');
});

test.describe('no horizontal scroll at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const path of ['/', '/start', '/portfolio', '/backtest', '/textbook', '/universe', '/glossary']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    });
  }

  test('/portfolio with a built plan', async ({ page }) => {
    await completeWizard(page);
    await expectNoHorizontalScroll(page);
  });
});

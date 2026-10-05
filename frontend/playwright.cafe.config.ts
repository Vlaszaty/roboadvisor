import { defineConfig, devices } from '@playwright/test';

// Live client against intercepted API responses, independent from the legacy fixed mock suite.
export default defineConfig({
  testDir: './e2e', testMatch: /.*\.cafe\.ts$/, timeout: 60_000,
  outputDir: '.worktrees/cafe-test-results',
  retries: process.env.CI ? 1 : 0, reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5742', trace: 'retain-on-failure' },
  projects: [{ name: 'cafe', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --port 5742', url: 'http://localhost:5742', reuseExistingServer: false, timeout: 60_000 },
});

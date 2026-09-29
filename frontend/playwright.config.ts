import { defineConfig, devices } from '@playwright/test';

// The e2e files end in .pw.ts so vitest (which picks up *.spec.ts / *.test.ts) never runs them.
// Port 5740 is strictPort in Vite: if something already listens there, Vite exits and the run fails
// clearly. Outside CI an already-running server on 5740 is reused, so start it with `npm run dev:mock`.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.pw\.ts$/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5740', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:mock',
    url: 'http://localhost:5740',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

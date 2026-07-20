import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the public-page specs against a deployed environment instead of a local
 * standalone build. The local config deliberately points the app at an
 * unreachable API to pin graceful degradation; this one exercises the real
 * deployment, so it proves the pages render with live data rather than with
 * their fallbacks.
 */
const baseURL = process.env.E2E_BASE_URL;
if (baseURL === undefined || baseURL === '') {
  throw new Error('Set E2E_BASE_URL to the deployment under test');
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

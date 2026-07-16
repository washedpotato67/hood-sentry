import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

/**
 * Local escape hatch for machines where `playwright install chromium` cannot complete.
 *
 * It drives the Google Chrome already installed on the machine instead of Playwright's bundled
 * Chromium. Everything else, including the standalone server under test, comes from the committed
 * config. CI installs Chromium and uses that config directly; this one is never the gate, because
 * the pinned Chromium is reproducible and whatever Chrome a laptop happens to have is not.
 *
 * Usage: pnpm --filter @hood-sentry/e2e test:local
 */
export default defineConfig({
  ...base,
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});

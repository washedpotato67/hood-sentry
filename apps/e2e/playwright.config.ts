import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Runs the standalone server, which is what Dockerfile.web ships (CMD node apps/web/server.js).
  // `next start` is unsupported under output: 'standalone' and Next warns as much, so testing it
  // would exercise a server no deployment runs. The bundle is assembled by the pretest script.
  webServer: {
    command: 'node apps/web/server.js',
    cwd: '../../apps/web/.next/standalone',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Deliberately unreachable: the public pages must degrade rather than fail when the API
      // is down, which is the property these tests pin.
      SENTRY_API_INTERNAL_URL: 'http://127.0.0.1:65535',
      NEXT_PUBLIC_ROBINHOOD_CHAIN_ID: '46630',
      PORT: '3100',
      HOSTNAME: '127.0.0.1',
    },
  },
});

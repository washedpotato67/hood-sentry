import { expect, test } from '@playwright/test';

test('public research pages render through the production Next.js routes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Know the risk before you sign' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Discover', exact: true })).toBeVisible();
  await expect(page.getByText('Chain ID').first()).toBeVisible();

  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('Organic rankings keep score components')).toBeVisible();

  await page.getByRole('link', { name: 'Trade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trade' })).toBeVisible();
  await expect(page.getByText('Your wallet signs and broadcasts.')).toBeVisible();
});

test('authenticated alert controls submit a deterministic multi-channel rule', async ({ page }) => {
  let submittedRule: Record<string, unknown> | null = null;
  await page.route('**/api/sentry/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/sentry', '');
    if (path === '/v1/auth/session') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            authenticated: true,
            userId: '10000000-0000-4000-8000-000000000001',
            wallets: [
              {
                chainId: 46630,
                address: '0x1111111111111111111111111111111111111111',
                isPrimary: true,
              },
            ],
          },
        }),
      });
      return;
    }
    if (path === '/v1/alerts' && request.method() === 'POST') {
      submittedRule = request.postDataJSON();
      await route.fulfill({
        contentType: 'application/json',
        status: 201,
        body: JSON.stringify({ data: { id: '20000000-0000-4000-8000-000000000001' } }),
      });
      return;
    }
    if (path === '/v1/alerts') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { data: [], nextCursor: null } }),
      });
      return;
    }
    if (path === '/v1/alert-events') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    if (path === '/v1/notification-channels') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    if (path === '/v1/notification-channels/capabilities') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { email: false, telegram: false, push: false, webPushPublicKey: null },
        }),
      });
      return;
    }
    if (path === '/v1/webhooks') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    if (path.startsWith('/health/')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: 'ready' } }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_ROUTE_MISSING', message: path } }),
    });
  });

  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'New evidence alert' })).toBeVisible();
  await page.getByLabel('Target address').fill('0x2222222222222222222222222222222222222222');
  await page.getByLabel('Rule type').selectOption('large_transfer');
  await page.getByLabel('Minimum raw amount').fill('1000000000000000000000');
  await page.getByLabel('webhook').check();
  await page.getByRole('button', { name: 'Create alert' }).click();

  await expect.poll(() => submittedRule).not.toBeNull();
  expect(submittedRule).toMatchObject({
    chainId: 46630,
    targetAddress: '0x2222222222222222222222222222222222222222',
    ruleType: 'large_transfer',
    condition: {
      minimumAmountRaw: '1000000000000000000000',
      severity: 'high',
    },
    channels: ['in_app', 'webhook'],
    enabled: true,
  });
  await expect(page.getByText('Alert rule created.')).toBeVisible();
});

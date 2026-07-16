self.addEventListener('push', (event) => {
  let payload = {
    title: 'Hood Sentry alert',
    body: 'New evidence matched one of your alert rules.',
    url: '/alerts',
  };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      tag: 'hood-sentry-alert',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/alerts';
  event.waitUntil(self.clients.openWindow(target));
});

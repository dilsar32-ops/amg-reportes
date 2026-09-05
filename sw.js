// Web push for managers who are not on an iPhone.
// This file has to sit at the top level of the site so it can control the
// whole app, and it keeps running after the browser tab is closed - that is
// what lets the phone ring when nobody is looking at the page.

self.addEventListener('install',  e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: 'Field Reports', body: (event.data && event.data.text()) || '' };
  }
  const title = data.title || 'Nuevo labor log';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: data.icon || undefined,
      badge: data.badge || undefined,
      tag: data.tag || 'labor-log',
      renotify: true,
      data: { url: data.url || '/' }
    })
  );
});

// Tapping the notification focuses the tab if it is already open,
// otherwise opens the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(target); } catch (e) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// The portal moved from securitymbpatrolling.netlify.app to securitymb.vercel.app.
// Phones that installed the old site run its offline service worker, which would
// keep showing the old app and never reach the redirect. This replacement clears
// the old caches, removes itself and reloads the page, which then forwards.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});

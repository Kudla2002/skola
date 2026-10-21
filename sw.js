/* Škola · service worker: appka běží offline + push notifikace na termíny (notify.js). Cache se mění s každým buildem. */
const CACHE = 'skola-2026-10-21c';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'notify.js', 'pushcrypto.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith('skola-')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;       // odkazy do IS se necachují
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); return res;
  }).catch(() => caches.match('index.html'))));
});
/* push (prostředník zfp-push): text je zašifrovaný jen pro toto zařízení */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Škola', b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'Škola', { body: d.b || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || undefined, data: { u: d.u || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const u = new URL((e.notification.data && e.notification.data.u) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.focus(); try { c.postMessage({ type: 'push-open', u }); } catch (x) {} return; }
    return self.clients.openWindow(u);
  }));
});

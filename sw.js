// Service Worker لتشغيل التطبيق من غير إنترنت
const CACHE_NAME = 'budget-app-cache-v4';
const DATA_CACHE = 'budget-app-data';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .catch((err) => console.warn('SW cache install failed', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== DATA_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// استراتيجية: هات من الكاش فورًا (لو موجود) وفي نفس الوقت حدّث الكاش من النت لو متاح
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);
      return cachedResponse || networkFetch;
    })
  );
});

// لما المستخدم يدوس على التنبيه، يفتح التطبيق (أو يركّز عليه لو مفتوح بالفعل)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});

// ---------- فحص دوري في الخلفية لمواعيد الالتزامات ----------
// (Chrome أندرويد للتطبيق المثبّت بس — والمتصفح هو اللي بيحدد التوقيت بالظبط)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-commitments') {
    event.waitUntil(checkDueCommitments());
  }
});

function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function checkDueCommitments() {
  const cache = await caches.open(DATA_CACHE);
  const listUrl = new URL('data-commitments.json', self.registration.scope).href;
  const notifiedUrl = new URL('data-notified.json', self.registration.scope).href;
  const res = await cache.match(listUrl);
  if (!res) return;
  const list = await res.json();

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  let notified = {};
  const nres = await cache.match(notifiedUrl);
  if (nres) { try { notified = await nres.json(); } catch (e) {} }
  if (notified.day !== todayKey) notified = { day: todayKey, ids: [] };

  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  for (const c of list) {
    if (!c.notify) continue;
    if (c.lastPaidMonth === monthKey(today)) continue;
    if (notified.ids.includes(c.id)) continue;
    const due = new Date(today.getFullYear(), today.getMonth(), Math.min(Number(c.dueDay), daysInMonth));
    const diff = Math.round((due - midnight) / 86400000);
    if (diff > 3) continue;
    const title = diff < 0 ? '⚠️ اتأخرت على "' + c.name + '"' : '🔔 قرّب معاد "' + c.name + '"';
    const body = Math.round(Number(c.amount)) + ' ج.م — المعاد يوم ' + c.dueDay;
    await self.registration.showNotification(title, {
      body, tag: 'commit-' + c.id, icon: 'icon-192.png', badge: 'icon-192.png',
      lang: 'ar', dir: 'rtl', vibrate: [200, 100, 200],
    });
    notified.ids.push(c.id);
  }
  await cache.put(notifiedUrl, new Response(JSON.stringify(notified), { headers: { 'Content-Type': 'application/json' } }));
}

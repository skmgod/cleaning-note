// 오프라인 지원: 인터넷이 되면 항상 최신 파일을 받고, 안 되면 저장된 파일로 실행
const CACHE = 'cleannote-v3';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const FONT_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    // 글꼴은 없어도 앱이 동작하므로 실패해도 무시
    try { await cache.put(FONT_CSS, await fetch(FONT_CSS, { mode: 'no-cors' })); } catch (err) { /* 오프라인 설치 */ }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 인터넷이 되면 최신 버전을 먼저 사용
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    } catch (err) {
      // 인터넷이 없으면 저장된 파일 사용
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return cache.match('index.html');
      return Response.error();
    }
  })());
});

/* PERBAIKAN (28 Agu 2026): sebelumnya CACHE pakai nama tetap 'wali-rq-v1' yang
   tidak pernah berubah antar deploy, dan semua file (termasuk app.js) dilayani
   cache-first. Akibatnya waktu app.js diperbaiki (mis. URL/kunci Supabase yang
   sempat salah project), pengguna yang sebelumnya pernah buka app tetap
   dilayani app.js LAMA dari cache -- browser tidak mendeteksi service worker
   berubah karena isi sw.js sendiri tidak berubah. Ini yang menyebabkan login
   gagal (401) sampai proses fetch-di-belakang-layar sempat menyegarkan cache,
   yang waktunya tidak pasti. Sekarang: (1) versi cache dinaikkan setiap deploy
   supaya sw.js baru selalu dianggap "berubah", dan (2) app-shell (index.html,
   app.js, styles.css) dilayani network-first, bukan cache-first, supaya
   perbaikan langsung berlaku begitu online -- cache cuma dipakai kalau benar-
   benar offline. Ikon/manifest tetap cache-first karena jarang berubah. */
const CACHE = 'wali-rq-v2';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json'];
const STATIC_ASSETS = ['./icon-192.png', './icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll([...APP_SHELL, ...STATIC_ASSETS])));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAppShell = url.origin === self.location.origin &&
    APP_SHELL.some(f => url.pathname.endsWith(f.replace('./','/')) || (f==='./' && (url.pathname==='/' || url.pathname.endsWith('/'))));

  if(isAppShell){
    // Network-first: selalu coba versi terbaru dulu supaya perbaikan (mis. konfigurasi
    // Supabase) langsung terpakai; cache cuma jadi cadangan kalau lagi offline.
    e.respondWith(
      fetch(e.request).then(res=>{
        if(res.ok){ caches.open(CACHE).then(c=>c.put(e.request, res.clone())); }
        return res;
      }).catch(()=> caches.match(e.request))
    );
    return;
  }

  // Aset statis (ikon dll): cache-first seperti biasa, jarang berubah.
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fetchPromise = fetch(e.request).then(res=>{
        if(res.ok){ caches.open(CACHE).then(c=>c.put(e.request, res.clone())); }
        return res;
      }).catch(()=>cached);
      return cached || fetchPromise;
    })
  );
});

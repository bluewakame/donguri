const CACHE_NAME = "donguri-v2";

// キャッシュするファイル一覧
const CACHE_FILES = [
  "/donguri/",
  "/donguri/index.html",
  "/donguri/script.js",
  "/donguri/style.css",
  "/donguri/manifest.json",
  "/donguri/icon-192.png",
  "/donguri/icon-512.png"
];

// インストール時：ファイルをキャッシュ
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CACHE_FILES);
    })
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ時：キャッシュ優先、なければネットワーク
self.addEventListener("fetch", function (e) {
  // Supabaseへのリクエストはキャッシュしない（常にネットワーク）
  if (e.request.url.includes("supabase.co")) {
    e.respondWith(fetch(e.request).catch(() => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (response) {
        // 成功したレスポンスをキャッシュに追加
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // オフラインでHTMLリクエストの場合はindex.htmlを返す
      if (e.request.destination === "document") {
        return caches.match("/donguri/index.html");
      }
    })
  );
});

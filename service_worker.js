importScripts("./soundfiles.js"); // SOUND_FILES を読み込む

const CACHE = "contesttimer-v16";    // キャッシュを確実に更新したいときはバージョンを上げる

const FILES = [
    "./",
    "./index.html",
    "./contesttimer.css",
    "./contesttimer.js",
    "./soundfiles.js",
    "./apple-touch-icon.png",
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
    "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2",
    "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff",
    // SOUND_FILES の内容を使って、音声ファイルをキャッシュ
    ...((self.SOUND_FILES || []).map(name => `./sounds/${name}.mp3`))
];

// === install: 初回キャッシュ作成 ===
self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(FILES);
        await self.skipWaiting();
    })());
});

// === activate: 古いキャッシュ削除 ===
self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// === fetch: オフライン時はキャッシュを使う ===
self.addEventListener("fetch", event => {
    event.respondWith((async () => {
        const req = event.request;
        const url = new URL(req.url);

        // ① まずはCDN(jsDelivr)はキャッシュ優先（CSSやフォントを再利用）
        if (url.hostname === "cdn.jsdelivr.net") {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            try {
                const res = await fetch(req); // ← デフォルト(CORS)でOK
                const cache = await caches.open(CACHE);
                cache.put(req, res.clone());
                return res;
            } catch {
                // 取れない時は既存キャッシュ（あれば）かエラー
                const fallback = await caches.match(req);
                if (fallback) return fallback;
                throw new Error("offline");
            }
        }

        // ② アプリ本体の HTML/JS/CSS はネット優先（更新を反映しやすくする）
        const sameOrigin = url.origin === self.location.origin;
        const isAppShell =
            req.mode === "navigate" || (sameOrigin && (
                url.pathname.endsWith("/") ||
                url.pathname.endsWith("/index.html") ||
                url.pathname.endsWith(".html") ||
                url.pathname.endsWith(".js") ||
                url.pathname.endsWith(".css")
            ));
        if (isAppShell) {
            try {
                // ブラウザHTTPキャッシュも避けたいときは cache:'no-store' でもOK
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE);
                cache.put(req, fresh.clone());
                return fresh;
            } catch {
                const hit = await caches.match(req);
                if (hit) return hit;
                throw new Error("offline");
            }
        }

        // ③ それ以外（音声・画像など）は従来通り：キャッシュ→ネット
        const cached = await caches.match(req);
        return cached || fetch(req);
    })());
});


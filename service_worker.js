importScripts("./soundfiles.js"); // SOUND_FILES を読み込む

const CACHE = "contesttimer-v1";
const FILES = [
    "./",
    "./index.html",
    "./contesttimer.css",
    "./contesttimer.js",
    "./soundfiles.js",
    "./apple-touch-icon.png",
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
        const cached = await caches.match(event.request);
        return cached || fetch(event.request);
    })());
});

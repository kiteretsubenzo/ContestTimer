importScripts("./soundfiles.js"); // SOUND_FILES ��ǂݍ���

const CACHE = "contesttimer-v1";
const FILES = [
    "./",
    "./index.html",
    "./contesttimer.css",
    "./contesttimer.js",
    "./soundfiles.js",
    "./apple-touch-icon.png",
    // SOUND_FILES �̓��e���g���āA�����t�@�C�����L���b�V��
    ...((self.SOUND_FILES || []).map(name => `./sounds/${name}.mp3`))
];

// === install: ����L���b�V���쐬 ===
self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(FILES);
        await self.skipWaiting();
    })());
});

// === activate: �Â��L���b�V���폜 ===
self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// === fetch: �I�t���C�����̓L���b�V�����g�� ===
self.addEventListener("fetch", event => {
    event.respondWith((async () => {
        const cached = await caches.match(event.request);
        return cached || fetch(event.request);
    })());
});

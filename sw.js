// 音樂小學堂 - Service Worker 快取離線支援
const CACHE_NAME = 'music-theory-game-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './music-theory.html',
    './game.js',
    './style.css'
];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: 快取靜態資源');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
            .catch((err) => {
                console.warn('Service Worker: 快取失敗', err);
            })
    );
});

// 啟用事件 - 清理舊快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 請求事件 - 優先使用快取，失敗時回退網路
self.addEventListener('fetch', (event) => {
    // 跳過非 GET 請求
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then((response) => {
                        // 不快取 opaque response 或錯誤回應
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // 複製回應以進行快取
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(() => {
                        // 離線時回退到首頁
                        if (event.request.destination === 'document') {
                            return caches.match('./music-theory.html');
                        }
                    });
            })
    );
});

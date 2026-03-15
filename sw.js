// 音樂小學堂 - Service Worker 快取離線支援
// 使用固定的版本號，只有在應用更新時才需要手動更新
const CACHE_VERSION = 'v2.0.0'; // 版本號：改用固定版本，手動更新時才遞增
const CACHE_NAME = 'music-theory-game-' + CACHE_VERSION;

// 預設快取的靜態資源
const STATIC_ASSETS = [
    './',
    './index.html',
    './music-theory.html',
    './music-master.html',
    './game.js',
    './style.css',
    './manifest.json'
];

// 需要離線快取的外部資源
const EXTERNAL_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap'
];

// 合併所有需要快取的資源
const ASSETS_TO_CACHE = [...STATIC_ASSETS, ...EXTERNAL_ASSETS];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // 使用 Promise.allSettled 確保即使部分資源失敗也繼續
                const cachePromises = ASSETS_TO_CACHE.map(url => {
                    return cache.add(url).catch(err => {
                        console.warn('快取資源失敗:', url, err);
                        // 不阻止安裝過程
                    });
                });
                return Promise.allSettled(cachePromises);
            })
            .then(() => {
                console.log('Service Worker: 快取完成，版本', CACHE_NAME);
                return self.skipWaiting();
            })
            .catch((err) => {
                console.warn('Service Worker: 安裝失敗', err);
            })
    );
});

// 啟用事件 - 清理舊快取（保留舊版本作為離線回退）
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            // 保留當前版本和最近兩個舊版本，確保升級過程中的離線相容性
            const currentBase = CACHE_NAME.split('-').slice(0, -1).join('-');
            const versionsToKeep = [
                CACHE_NAME,
                CACHE_NAME.replace(CACHE_VERSION, 'v' + parseFloat(CACHE_VERSION) - 0.1),
                CACHE_NAME.replace(CACHE_VERSION, 'v' + parseFloat(CACHE_VERSION) - 0.2)
            ].filter(v => v !== CACHE_NAME);

            return Promise.all(
                cacheNames
                    .filter(name => name.startsWith('music-theory-game-') && 
                                   name !== CACHE_NAME && 
                                   !versionsToKeep.includes(name))
                    .map(name => {
                        console.log('清理舊快取:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('Service Worker: 激活成功');
            return self.clients.claim();
        })
    );
});

// 請求事件 - 智慧型快取策略
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 處理 Google Fonts - Stale-while-revalidate 策略
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchPromise = fetch(event.request).then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => cachedResponse || new Response('', { 
                        status: 200, 
                        statusText: 'OK',
                        headers: { 'Content-Type': 'text/css' }
                    }));

                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // 非 GET 請求直接傳遞到網路
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    // 導航請求（HTML 頁面）- 網路優先，有離線回退
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // 成功後快取結果
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => caches.match(event.request).then(cached => cached || fallbackToCachedPage(event.request.url)))
        );
        return;
    }

    // 靜態資源 - 快取優先，後續更新
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // 背景更新快取
                    fetch(event.request).then((response) => {
                        if (response && response.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                        }
                    }).catch(() => {});
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200) {
                            return response;
                        }
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                        return response;
                    })
                    .catch(() => {
                        // 離線時的非 document 請求回退
                        return new Response('', { status: 200, statusText: 'OK' });
                    });
            })
    );
});

// 智慧型回退頁面選擇
function fallbackToCachedPage(requestUrl) {
    let fallbackPage = './index.html';
    
    if (requestUrl.includes('music-master.html')) {
        fallbackPage = './music-master.html';
    } else if (requestUrl.includes('music-theory.html')) {
        fallbackPage = './music-theory.html';
    } else if (requestUrl.includes('index.html') || requestUrl.endsWith('/')) {
        fallbackPage = './index.html';
    }
    
    return caches.match(fallbackPage).then(response => 
        response || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
    );
}

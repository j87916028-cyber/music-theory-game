// 音樂小學堂 - Service Worker 快取離線支援
// 自動版本號：基於部署時間戳，每次更新自動遞增
const CACHE_VERSION = 'v' + Math.floor(Date.now() / 86400000); // 每天自動更新版本
const CACHE_NAME = 'music-theory-game-' + CACHE_VERSION;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './music-theory.html',
    './music-master.html',
    './game.js',
    './style.css',
    './manifest.json',
    // 快取 Google Fonts 以支援離線顯示
    'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap'
];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Service Worker: 快取靜態資源
                console.log('Service Worker: 快取資源，版本', CACHE_NAME);
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
    const url = new URL(event.request.url);

    // 處理 Google Fonts 的特殊快取策略 - Stale-while-revalidate
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchPromise = fetch(event.request).then((networkResponse) => {
                        // 快取字體資源以便離線使用
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // 網路失敗時，如果沒有快取就回傳失敗
                        if (!cachedResponse) {
                            console.warn('字體載入失敗且無快取:', event.request.url);
                            // 回傳一個空 Response 避免 undefined 錯誤
                            return new Response('', { 
                                status: 200, 
                                statusText: 'OK',
                                headers: { 'Content-Type': 'text/css' }
                            });
                        }
                        return cachedResponse;
                    });

                    // 如果有快取，先返回快取，同時在背景更新快取
                    // 這就是 stale-while-revalidate 策略
                    if (cachedResponse) {
                        // 觸發背景更新（不阻塞回應）
                        fetchPromise.then(() => {
                            // 字體快取已更新
                        }).catch(() => {});
                        return cachedResponse;
                    }

                    // 沒有快取時等待網路回應
                    return fetchPromise;
                });
            })
        );
        return;
    }

    // 處理非 GET 請求 - 直接傳遞到網路
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    // 處理導航請求（HTML 頁面）- 使用網路優先策略
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // 成功取得後快取結果
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // 離線時回退到對應的頁面（根據請求 URL）
                    const requestUrl = event.request.url;
                    let fallbackPage = './music-theory.html'; // 預設回退頁面
                    
                    if (requestUrl.includes('index.html') || requestUrl.endsWith('/')) {
                        fallbackPage = './index.html';
                    } else if (requestUrl.includes('music-master.html')) {
                        fallbackPage = './music-master.html';
                    } else if (requestUrl.includes('music-theory.html')) {
                        fallbackPage = './music-theory.html';
                    }
                    
                    return caches.match(fallbackPage).then((fallbackResponse) => {
                        // 如果沒有找到對應的快取頁面，回退到 index.html
                        if (fallbackResponse) {
                            return fallbackResponse;
                        }
                        // 嘗試回退到 index.html
                        return caches.match('./index.html').then((indexResponse) => {
                            // 確保一定返回一個 Response，避免 undefined
                            return indexResponse || new Response('Offline - Page not cached', { 
                                status: 503, 
                                statusText: 'Service Unavailable' 
                            });
                        });
                    });
                })
        );
        return;
    }

    // 處理其他資源 - 使用快取優先策略
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then((response) => {
                        // 不快取 opaque response 或錯誤回應
                        if (!response || response.status !== 200) {
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
                            return caches.match('./music-theory.html').then((response) => {
                                // 如果沒有找到 music-theory.html，回退到 index.html
                                return response || caches.match('./index.html');
                            });
                        }
                        // 對於非 document 請求，返回空回應而非 undefined
                        return new Response('', { status: 200, statusText: 'OK' });
                    });
            })
    );
});

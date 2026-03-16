// 音樂小學堂 - Service Worker 快取離線支援
// 使用固定的版本號，只有在應用更新時才需要手動更新
const CACHE_VERSION = 'v2.0.3'; // 版本號：啟用 Navigation Preload 加速導航請求
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
    // 啟用 Navigation Preload 加速導航請求
    const enablePreload = self.registration.navigationPreload?.enable() 
        .then(() => console.log('Navigation Preload 已啟用'))
        .catch(() => { /* 瀏覽器不支持 Navigation Preload，靜默失敗 */ });
    
    event.waitUntil(
        enablePreload.then(() => caches.keys()).then((cacheNames) => {
            // 簡化版本清理邏輯：保留當前版本 + 最近 2 個舊版本
            // 使用 semver 解析來正確排序版本
            const parseVersion = (name) => {
                const match = name.match(/v(\d+)\.(\d+)\.(\d+)/);
                if (!match) return { major: 0, minor: 0, patch: 0, raw: name };
                return {
                    major: parseInt(match[1]),
                    minor: parseInt(match[2]),
                    patch: parseInt(match[3]),
                    raw: name
                };
            };
            
            // 解析並排序所有版本（從新到舊）
            const allVersions = cacheNames
                .filter(name => name.startsWith('music-theory-game-'))
                .map(name => ({ name, ...parseVersion(name) }))
                .sort((a, b) => {
                    if (a.major !== b.major) return b.major - a.major;
                    if (a.minor !== b.minor) return b.minor - a.minor;
                    return b.patch - a.patch;
                });
            
            // 保留最多 3 個版本（當前版本 + 2 個舊版本）
            const versionsToKeep = allVersions.slice(0, 3).map(v => v.name);
            const toDelete = allVersions.slice(3).map(v => v.name);

            // 刪除舊版本
            return Promise.all(
                toDelete.map(name => {
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

// 檢查客戶端是否有可用更新並通知
function checkForUpdate() {
    self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
            // 發送更新可用訊息給客戶端
            client.postMessage({
                type: 'UPDATE_AVAILABLE',
                version: CACHE_VERSION
            });
        });
    });
}

// 請求事件 - 智慧型快取策略
// 添加 fetchWithTimeout 輔助函數，避免網路請求卡住
// 使用 AbortController 實現超時，這是現代瀏覽器推薦的方式
function fetchWithTimeout(request, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, timeout);
    
    // 確保 request 有 signal 屬性
    const fetchOptions = {};
    if (request instanceof Request) {
        if (!request.signal) {
            fetchOptions.signal = controller.signal;
        }
    } else {
        fetchOptions.signal = controller.signal;
    }
    
    return fetch(request, fetchOptions)
        .then(response => {
            clearTimeout(timeoutId);
            return response;
        })
        .catch(err => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error('Fetch timeout');
            }
            throw err;
        });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 處理 Google Fonts - Stale-while-revalidate 策略
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchPromise = fetchWithTimeout(event.request, 3000).then((networkResponse) => {
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

    // 導航請求（HTML 頁面）- 網路優先，有離線回退，添加超時處理
    // 使用 Navigation Preload 加速：嘗試並行獲取資源
    if (event.request.mode === 'navigate') {
        event.respondWith(
            Promise.race([
                // 嘗試使用 Navigation Preload（如果已啟用）
                event.preloadResponse || Promise.reject('no preload'),
                // 或者使用一般 fetch 但有超時
                fetchWithTimeout(event.request, 5000)
            ])
                .then((response) => {
                    // 成功後快取結果
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // 如果 preload 失敗，嘗試一般 fetch
                    return fetchWithTimeout(event.request, 5000)
                        .then((response) => {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(event.request, responseClone);
                            });
                            return response;
                        })
                        .catch(() => {
                            // 離線時嘗試返回快取的頁面，若無則顯示離線頁面
                            return caches.match(event.request).then(cached => {
                                if (cached) return cached;
                                return fallbackToCachedPage(event.request.url);
                            });
                        });
                })
        );
        return;
    }

    // 靜態資源 - 快取優先，後續更新，添加超時處理
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // 背景更新快取（添加超時避免長時間等待）
                    fetchWithTimeout(event.request, 3000).then((response) => {
                        if (response && response.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                        }
                    }).catch(() => {});
                    return cachedResponse;
                }

                return fetchWithTimeout(event.request, 5000)
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

// 監聽來自客戶端的訊息（用於手動觸發更新檢查）
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CHECK_FOR_UPDATE') {
        // 檢查是否需要更新
        fetch('./index.html', { cache: 'no-store' })
            .then(response => {
                if (response.ok) {
                    // 如果能成功獲取 index.html，說明有新版本可用
                    return response.text();
                }
                throw new Error('Network response was not ok');
            })
            .then(() => {
                // 通知所有客戶端有可用更新
                checkForUpdate();
            })
            .catch(err => {
                console.log('檢查更新失敗（可能離線）:', err);
            });
    }
});

const CACHE_NAME = 'apagonia-cfg-v4';
const APP_FILES = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './images.png',
    './qr.jpg',
    './horarios.json',
    './frases.json',
    './version.json'
];
const DATA_FILES = new Set(['horarios.json', 'frases.json', 'version.json']);

try {
    importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (error) {
    console.error('No se pudo cargar el componente de OneSignal para el service worker:', error);
}

self.addEventListener('install', (event) => {
    event.waitUntil(precacheApp().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith('apagonia-cfg-') && key !== CACHE_NAME)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    const fileName = url.pathname.split('/').pop();
    if (DATA_FILES.has(fileName)) {
        event.respondWith(networkFirst(request));
        return;
    }
    if (request.mode === 'navigate') {
        event.respondWith(cacheFirst(request, './index.html'));
        return;
    }
    event.respondWith(cacheFirst(request));
});

async function precacheApp() {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_FILES.map(async (file) => {
        const url = new URL(file, self.registration.scope);
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (!response.ok) throw new Error(`No se pudo precargar ${file}: HTTP ${response.status}`);
        await cache.put(url, response);
    }));
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request) || await cache.match(new URL(request.url).pathname);
        if (cached) return withOfflineHeader(cached);
        throw error;
    }
}

async function cacheFirst(request, fallbackPath) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request) || (fallbackPath ? await cache.match(new URL(fallbackPath, self.registration.scope)) : null);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
}

function withOfflineHeader(response) {
    const headers = new Headers(response.headers);
    headers.set('X-Offline-Cache', 'true');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

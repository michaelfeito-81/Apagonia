const CACHE_NAME = 'apagoniacnf-v4';
const APP_FILES = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './images.png',
    './qr.jpg',
    './horarios.json',
    './frases.json'
];
const DATA_FILES = new Set(['horarios.json', 'frases.json']);

self.addEventListener('install', (event) => {
    event.waitUntil(
        precacheApp()
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith('apagoniacnf-') && key !== CACHE_NAME)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (DATA_FILES.has(url.pathname.split('/').pop())) {
        event.respondWith(networkFirst(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, './index.html'));
        return;
    }

    event.respondWith(cacheFirst(request));
});

async function networkFirst(request, fallbackPath) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request) || (fallbackPath && await cache.match(fallbackPath));
        if (cached) return withOfflineHeader(cached);
        throw error;
    }
}

async function precacheApp() {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_FILES.map(async (file) => {
        const url = new URL(file, self.registration.scope);
        url.searchParams.set('precache', CACHE_NAME);
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (!response.ok) throw new Error(`No se pudo precargar ${file}: HTTP ${response.status}`);
        await cache.put(new URL(file, self.registration.scope), response);
    }));
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

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
}

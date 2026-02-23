const CACHE_NAME = 'sharkboat-v1';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request)
            .then((response) => response || fetch(e.request))
    );
});

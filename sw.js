// taco 星際戰機的 service worker：有網路就拿最新的；沒網路也能開來玩（圖片、音效都先存好）。
const CACHE = "taco-shooter-v1";
const CORE = [
  "./",
  "./manifest.json",
  "./core.js",
  "./app.js",
  "./icon-192.png",
  "./assets/darkPurple.png",
  "./assets/enemyBlack2.png",
  "./assets/enemyBlue1.png",
  "./assets/enemyBlue3.png",
  "./assets/enemyGreen3.png",
  "./assets/enemyRed3.png",
  "./assets/fire11.png",
  "./assets/fire12.png",
  "./assets/fire13.png",
  "./assets/fire14.png",
  "./assets/fire15.png",
  "./assets/fire16.png",
  "./assets/fire17.png",
  "./assets/kenvector_future.ttf",
  "./assets/laserBlue03.png",
  "./assets/laserRed03.png",
  "./assets/meteorBrown_big1.png",
  "./assets/meteorBrown_med1.png",
  "./assets/meteorGrey_big2.png",
  "./assets/meteorGrey_small1.png",
  "./assets/playerShip1_blue.png",
  "./assets/powerupBlue_shield.png",
  "./assets/powerupGreen.png",
  "./assets/powerupYellow_bolt.png",
  "./assets/sfx_laser1.mp3",
  "./assets/sfx_lose.mp3",
  "./assets/sfx_shieldUp.mp3",
  "./assets/sfx_twoTone.mp3",
  "./assets/sfx_zap.mp3",
  "./assets/shield3.png",
  "./assets/star_gold.png",
  "./assets/ufoRed.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("taco-shooter") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const nav = req.mode === "navigate";
  const key = nav ? new URL("./", self.registration.scope).href : url.origin + url.pathname;
  e.respondWith(fetch(nav ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req).then((res) => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || Promise.reject(new Error("offline")))));
});

// taco 星際戰機：畫面、操作、聲音、App 安裝。遊戲規則在 core.js（全域 Shooter）。
(function () {
  "use strict";
  const S = window.Shooter;
  const C = S.C;
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const canvas = $("game");
  const ctx = canvas.getContext("2d");

  // ---------------- 素材 ----------------
  const FIRE = ["fire11", "fire12", "fire13", "fire14", "fire15", "fire16", "fire17"];
  const POWERUP_IMG = { weapon: "powerupYellow_bolt", shield: "powerupBlue_shield", heal: "powerupGreen", coin: "star_gold" };
  const IMAGE_NAMES = ["playerShip1_blue", "ufoRed", "darkPurple", "laserBlue03", "laserRed03", "shield3",
    ...Object.values(POWERUP_IMG), ...C.ALIEN_IMAGES, ...C.METEORS.map((m) => m.img), ...FIRE];
  const SOUNDS = { laser: ["sfx_laser1", 0.25], hit: ["sfx_zap", 0.35], shield: ["sfx_shieldUp", 0.4], lose: ["sfx_lose", 0.5], pickup: ["sfx_twoTone", 0.4] };
  const IMG = {};

  function loadImages() {
    return Promise.all(IMAGE_NAMES.map((n) => new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { IMG[n] = im; resolve(); };
      im.onerror = () => reject(new Error(n));
      im.src = "assets/" + n + ".png";
    })));
  }

  // 依高度等比例縮放後的寬
  const widthAt = (img, h) => img.naturalWidth * h / img.naturalHeight;
  function blit(img, x, y, w, h) { ctx.drawImage(img, x - w / 2, y - h / 2, w, h); }

  // ---------------- 小工具：存最高分、音效開關（隱私模式存不了也不會壞） ----------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("taco-shooter-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("taco-shooter-" + k, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ } },
  };
  let best = Number(store.get("best", 0)) || 0;
  let muted = !!store.get("muted", false);

  // ---------------- 聲音：Web Audio，第一次按按鈕後才建立（手機規定要使用者先互動） ----------------
  let actx = null;
  const buffers = {};
  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { actx = new AC(); } catch (e) { return; }
    for (const [key, [file, vol]] of Object.entries(SOUNDS)) {
      fetch("assets/" + file + ".mp3").then((r) => r.arrayBuffer())
        .then((b) => new Promise((res, rej) => actx.decodeAudioData(b, res, rej)))
        .then((buf) => { buffers[key] = { buf, vol }; })
        .catch(() => {});   // 某個音效讀不到就安靜，不影響遊戲
    }
  }
  function play(key) {
    if (muted || !actx || !buffers[key]) return;
    if (actx.state === "suspended") actx.resume();
    const src = actx.createBufferSource();
    src.buffer = buffers[key].buf;
    const gain = actx.createGain();
    gain.gain.value = buffers[key].vol;
    src.connect(gain).connect(actx.destination);
    src.start();
  }

  // ---------------- 畫面大小：邏輯寬 400，高度跟著手機比例變（600~860） ----------------
  function gameH() {
    const r = window.innerHeight / Math.max(1, window.innerWidth);
    return Math.max(600, Math.min(860, Math.round(C.W * r)));
  }
  const view = { s: 1, k: 1 };   // s：邏輯 px -> CSS px；k：再乘上螢幕密度
  function fit() {
    const H = g ? g.H : gameH();
    const s = Math.min(window.innerWidth / C.W, window.innerHeight / H);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.s = s;
    view.k = s * dpr;
    stage.style.width = Math.floor(C.W * s) + "px";
    stage.style.height = Math.floor(H * s) + "px";
    canvas.width = Math.round(C.W * s * dpr);
    canvas.height = Math.round(H * s * dpr);
  }

  // ---------------- 背景：Kenney 底圖 + 彩色星雲，做一次就好，之後一直往下捲 ----------------
  const BG_PERIOD = 768;   // 底圖 256 的 3 倍，上下接起來沒有接縫
  let bg = null;
  function makeBackground() {
    const c = document.createElement("canvas");
    c.width = C.W;
    c.height = BG_PERIOD;
    const b = c.getContext("2d");
    const tile = IMG.darkPurple;
    for (let y = 0; y < BG_PERIOD; y += tile.height) for (let x = 0; x < C.W; x += tile.width) b.drawImage(tile, x, y);
    let seed = 7;
    const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647);   // 固定亂數：每次星雲都一樣
    const colors = ["120,50,220", "50,90,230", "210,50,150", "120,50,220", "50,130,230", "210,50,150"];
    for (const col of colors) {
      const r = 80 + rnd() * 70, x = rnd() * C.W, y = rnd() * BG_PERIOD;
      for (const dy of [-BG_PERIOD, 0, BG_PERIOD]) {   // 上中下各畫一份，接縫處的星雲才不會被切斷
        const grad = b.createRadialGradient(x, y + dy, 0, x, y + dy, r);
        grad.addColorStop(0, `rgba(${col},0.55)`);
        grad.addColorStop(1, `rgba(${col},0)`);
        b.fillStyle = grad;
        b.fillRect(x - r, y + dy - r, r * 2, r * 2);
      }
    }
    return c;
  }

  // 三層星星：越近越快、越亮（視差）
  const STAR_LAYERS = [[25, 1.2, 1, 110], [14, 2.6, 1, 190], [6, 4.5, 2, 255]];
  const stars = [];
  for (const [count, speed, size, bright] of STAR_LAYERS) {
    for (let i = 0; i < count; i++) stars.push({ x: Math.random() * C.W, y: Math.random() * 860, speed, size, bright, ph: Math.random() * 6.28 });
  }

  // 被補血道具：綠色方塊上自己畫一個白色「＋」
  let healImg = null;
  function makeHeal() {
    const src = IMG.powerupGreen;
    const c = document.createElement("canvas");
    c.width = src.naturalWidth;
    c.height = src.naturalHeight;
    const b = c.getContext("2d");
    b.drawImage(src, 0, 0);
    b.fillStyle = "#fff";
    const cx = c.width / 2, cy = c.height / 2;
    b.fillRect(cx - 7, cy - 2, 14, 4);
    b.fillRect(cx - 2, cy - 7, 4, 14);
    return c;
  }

  // ---------------- 爆炸粒子（純畫面效果，規則不需要知道） ----------------
  let particles = [];
  function explode(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.5;
      const life = 12 + Math.random() * 12;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life,
        color: [color, color, "#ffffff", "#ffe150"][Math.floor(Math.random() * 4)], size: 2 + Math.random() * 2.5 });
    }
  }

  // ---------------- 遊戲狀態 ----------------
  let g = null;
  let state = "loading";   // loading → menu → play ⇄ pause
  let bgY = 0;
  let endAt = 0;           // 遊戲結束的時間，結束後 0.8 秒內點畫面不會馬上重開（避免手指還在連射就誤觸）
  let newBest = false;
  const input = { dx: 0, fire: false };
  const keys = new Set();
  let pointerId = null, lastX = 0;
  const DRAG = 1.3;        // 手指移動 1 px，戰機移動 1.3 px（不用滑那麼遠）

  function startGame() {
    initAudio();
    g = S.newGame({ h: gameH() });
    particles = [];
    newBest = false;
    input.dx = 0;
    input.fire = false;
    pointerId = null;
    fit();
    state = "play";
    $("menu").hidden = true;
    $("pause").hidden = true;
    $("pauseBtn").hidden = false;
  }

  function pause() {
    if (state !== "play" || !g || g.over || g.win) return;
    state = "pause";
    input.fire = false;
    pointerId = null;
    $("pause").hidden = false;
  }
  function resume() {
    state = "play";
    $("pause").hidden = true;
  }
  function toMenu() {
    state = "menu";
    $("pause").hidden = true;
    $("pauseBtn").hidden = true;
    $("best").textContent = best;
    $("menu").hidden = false;
  }

  function handle(events) {
    for (const e of events) {
      if (e.t === "boom") explode(e.x, e.y, e.color, e.n);
      else if (e.t === "laser" || e.t === "hit" || e.t === "pickup" || e.t === "shield") play(e.t);
      if (e.t === "hit" && navigator.vibrate) navigator.vibrate(40);
      if (e.t === "lose" || e.t === "win") {
        endAt = performance.now();
        input.fire = false;
        $("pauseBtn").hidden = true;
        if (e.t === "lose") play("lose");
        else play("pickup");
        if (g.score > best) { best = g.score; newBest = true; store.set("best", best); }
      }
    }
  }

  // 規則每 1/60 秒走一步（dt = 0.5 tick），跟螢幕更新頻率無關，所以 60Hz、120Hz 手機速度都一樣
  function tick() {
    const k = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    const ev = S.step(g, { dx: input.dx + k * 3.5, fire: input.fire || keys.has("fire") }, 0.5);
    input.dx = 0;
    handle(ev);
  }

  // ---------------- 畫圖 ----------------
  function text(str, x, y, size, color, align, font) {
    ctx.font = `${size}px ${font || "kenvector, system-ui, sans-serif"}`;
    ctx.textAlign = align || "left";
    ctx.fillStyle = "#000";
    ctx.fillText(str, x + 2, y + 2);   // 陰影，花花的背景上才看得清楚
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function bar(x, y, w, h, ratio, color) {
    ratio = Math.max(0, Math.min(1, ratio));
    ctx.fillStyle = "#0f0f1e";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#3c3c50";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * ratio, h);
  }

  function draw() {
    const H = g ? g.H : gameH();
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
    ctx.textBaseline = "top";
    const y0 = Math.floor(bgY);
    for (const dy of [-BG_PERIOD, 0, BG_PERIOD]) ctx.drawImage(bg, 0, y0 + dy);
    const t = g ? g.t : performance.now() / 33;
    for (const s of stars) {
      if (s.y > H) continue;
      const b = Math.round(s.bright * (0.7 + 0.3 * Math.sin(t * 0.15 + s.ph)));
      ctx.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`;
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.size, s.size);
    }
    if (!g || state === "menu") return;

    for (const m of g.meteors) {
      const k = C.METEORS[m.kind];
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle * Math.PI / 180);
      ctx.drawImage(IMG[k.img], -k.w / 2, -k.h / 2, k.w, k.h);
      ctx.restore();
    }
    for (const p of g.powerups) {
      const img = p.kind === "heal" ? healImg : IMG[POWERUP_IMG[p.kind]];
      const bob = 2 * Math.sin(g.t * 0.25);
      ctx.drawImage(img, p.x - img.width / 2, p.y + bob - img.height / 2);
    }
    for (const a of g.aliens) {
      const img = IMG[C.ALIEN_IMAGES[a.row]];
      blit(img, a.x, a.y + 2 * Math.sin(g.t * 0.12 + a.col * 0.7), widthAt(img, C.ALIEN_H), C.ALIEN_H);
    }
    if (g.boss) {
      const b = g.boss, y = b.y + 3 * Math.sin(g.t * 0.1);
      blit(IMG.ufoRed, b.x, y, 110, 110);
      if (b.flash > 0) {   // 被打中：用「相加」的方式再疊一次，整台亮一下（透明的地方加了也還是透明）
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.45;
        blit(IMG.ufoRed, b.x, y, 110, 110);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
    }
    for (const b of g.enemyBullets) blit(IMG.laserRed03, b.x, b.y, b.w, b.h);
    for (const b of g.bullets) blit(IMG.laserBlue03, b.x, b.y, b.w, b.h);
    if (!g.over) drawPlayer();
    for (const p of particles) {
      const r = p.size * p.life / p.max;
      if (r < 0.5) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    drawHud();
    if (g.over || g.win) drawEnd();
  }

  function drawPlayer() {
    if (g.inv > 0 && Math.floor(g.t / 3) % 2) return;   // 被打中後閃爍
    const p = S.playerBox(g);
    const img = IMG.playerShip1_blue, h = 45, w = widthAt(img, h);
    const fire = IMG[FIRE[Math.floor(g.t) % FIRE.length]];
    const fw = widthAt(fire, 20);
    for (const dx of [-6, 6]) ctx.drawImage(fire, p.x + dx - fw / 2, p.y + h / 2 - 8, fw, 20);   // 引擎火焰在機身後面
    blit(img, p.x, p.y, w, h);
    if (g.shield > 0 && (g.shield > 30 || Math.floor(g.t / 3) % 2)) {   // 護盾最後 1 秒閃爍提醒
      const sh = IMG.shield3;
      blit(sh, p.x, p.y, 70, 70 * sh.naturalHeight / sh.naturalWidth);
    }
  }

  function drawHud() {
    text("SCORE " + g.score, 10, 8, 15, "#fff");
    text(`WAVE ${g.wave + 1}/${C.WAVES.length}`, C.W - 48, 10, 13, "#b4b4c8", "right");
    const ship = IMG.playerShip1_blue;
    ctx.drawImage(ship, 10, 33, widthAt(ship, 16), 16);
    const r = g.hp / C.PLAYER_HP;
    bar(34, 36, 110, 9, r, r > 0.5 ? "#50e66e" : r > 0.25 ? "#ffe150" : "#ff4646");
    for (let i = 0; i < C.MAX_WEAPON; i++) {
      ctx.fillStyle = i < g.weapon ? "#ffe150" : "#46465a";
      ctx.fillRect(160 + i * 12, 36, 9, 9);
    }
    if (g.shield > 0) text(`SHIELD ${Math.ceil(g.shield / 30)}s`, 210, 34, 13, "#5ad2ff");
    if (g.boss) bar(40, 62, C.W - 80, 8, g.boss.hp / g.boss.max, "#ff4646");
    if (g.banner > 0 && !g.over && !g.win) {
      const boss = C.WAVES[g.wave].kind === "boss";
      text(boss ? "BOSS!" : "WAVE " + (g.wave + 1), C.W / 2, g.H / 2 + 30, 34, boss ? "#ff6464" : "#fff", "center");
    }
  }

  function drawEnd() {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, C.W, g.H);
    const cy = g.H / 2;
    text(g.win ? "YOU WIN!" : "GAME OVER", C.W / 2, cy - 60, 36, g.win ? "#50e66e" : "#ff4646", "center");
    text("SCORE " + g.score, C.W / 2, cy - 8, 20, "#fff", "center");
    text(newBest ? "新紀錄！" : "最高分 " + best, C.W / 2, cy + 22, 16, newBest ? "#ffe150" : "#b4b4c8", "center", "system-ui, sans-serif");
    if (performance.now() - endAt > 800) {
      const b = Math.round(180 + 60 * Math.sin(performance.now() / 220));
      text("點一下再玩一次", C.W / 2, cy + 58, 16, `rgb(${b},${b},${b})`, "center", "system-ui, sans-serif");
    }
  }

  function updateVisuals(ticks) {
    const H = g ? g.H : 860;
    bgY = (bgY + 2 * ticks) % BG_PERIOD;
    for (const s of stars) {
      s.y += s.speed * ticks;
      if (s.y > H) { s.y = 0; s.x = Math.random() * C.W; }
    }
    const f = Math.pow(0.92, ticks);
    for (const p of particles) { p.x += p.vx * ticks; p.y += p.vy * ticks; p.vx *= f; p.vy *= f; p.life -= ticks; }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---------------- 主迴圈 ----------------
  const TICK = 1 / 60;
  let last = performance.now(), acc = 0;
  function frame(now) {
    const d = Math.min(0.25, (now - last) / 1000);   // 切到背景再回來，不要一次補跑太多
    last = now;
    if (state === "play") {
      acc += d;
      while (acc >= TICK) { acc -= TICK; tick(); }
    } else acc = 0;
    if (state !== "pause") updateVisuals(d * 30);
    if (bg) draw();
    requestAnimationFrame(frame);
  }

  // ---------------- 操作：手指拖曳 = 移動，按著 = 自動連射 ----------------
  function logicalX(e) {
    const r = canvas.getBoundingClientRect();
    return (e.clientX - r.left) / view.s;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "play") return;
    e.preventDefault();
    if (g.over || g.win) {
      if (performance.now() - endAt > 800) startGame();
      return;
    }
    if (pointerId != null) return;   // 已經有一根手指在控制了，第二根手指不搶
    pointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有也沒關係 */ }
    lastX = logicalX(e);
    input.fire = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const x = logicalX(e);
    input.dx += (x - lastX) * DRAG;
    lastX = x;
  });
  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    input.fire = false;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const KEY = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", " ": "fire" };
  window.addEventListener("keydown", (e) => {
    if (KEY[e.key]) { keys.add(KEY[e.key]); if (state === "play") e.preventDefault(); }
    if ((e.key === "p" || e.key === "P" || e.key === "Escape") && state === "play") pause();
    else if ((e.key === "p" || e.key === "P" || e.key === "Escape") && state === "pause") resume();
    if (e.key === "Enter" && state === "play" && g && (g.over || g.win) && performance.now() - endAt > 800) startGame();
  });
  window.addEventListener("keyup", (e) => { if (KEY[e.key]) keys.delete(KEY[e.key]); });
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });   // 切到別的 App 自動暫停
  window.addEventListener("resize", fit);

  // ---------------- 按鈕 ----------------
  function soundLabel() { $("sound").textContent = muted ? "🔇 音效：關" : "🔊 音效：開"; }
  $("start").addEventListener("click", startGame);
  $("sound").addEventListener("click", () => { muted = !muted; store.set("muted", muted); soundLabel(); if (!muted) initAudio(); });
  $("pauseBtn").addEventListener("click", pause);
  $("resume").addEventListener("click", resume);
  $("quit").addEventListener("click", toMenu);

  // 裝到手機桌面（Android Chrome／Edge 會給安裝事件；iPhone 要用 Safari 的「加入主畫面」）
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("install").hidden = false; });
  $("install").addEventListener("click", () => {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.finally(() => { installEvt = null; $("install").hidden = true; });
  });
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  $("iosTip").hidden = !(ios && !standalone);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // 版本號（部署時自動填上）
  const v = document.querySelector('meta[name="app-version"]').content;
  const built = document.querySelector('meta[name="app-built"]').content;
  $("ver").textContent = "版本 " + v + (built ? " · " + built : "");

  // ---------------- 開始：先讀圖，讀好才顯示主選單 ----------------
  soundLabel();
  $("best").textContent = best;
  fit();
  requestAnimationFrame(frame);
  const fontReady = document.fonts && document.fonts.load ? document.fonts.load("15px kenvector").catch(() => {}) : Promise.resolve();
  Promise.all([loadImages(), fontReady]).then(() => {
    bg = makeBackground();
    healImg = makeHeal();
    $("loading").hidden = true;
    toMenu();
  }).catch((err) => {
    $("loading").textContent = "圖片讀不到（" + err.message + "），請重新整理再試一次";
  });

  // 給測試用（Playwright 截圖時可以直接跳到某個狀態）
  window.__shooter = { get g() { return g; }, startGame, pause, get state() { return state; } };
})();

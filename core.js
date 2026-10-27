// taco 星際戰機：遊戲規則。
// 這個檔案只管「數字」（位置、血量、分數、碰撞），不碰畫面也不碰聲音，所以 node 也能跑，方便寫測試。
// 畫面和操作在 app.js；app.js 每一步呼叫 step()，再依照回傳的事件 (events) 播音效、放爆炸粒子。
//
// 時間單位：1 tick = 1/30 秒（跟 Python 版的 1 frame 一樣，數字可以直接對照）。
// 手機螢幕一秒更新 60 次，所以 app.js 每次用 dt = 0.5 呼叫 step()，速度、計時器都會乘上 dt。
(function (root) {
  "use strict";

  const C = {
    W: 400, H: 600,                       // 遊戲畫面的邏輯大小；手機比較高時 H 會變大（見 newGame）
    PLAYER_HP: 100, PLAYER_W: 40, PLAYER_H: 36, PLAYER_BOTTOM: 95,   // 戰機碰撞框頂端 = H - 95
    INVINCIBLE: 30, SHIELD: 150, MAX_WEAPON: 3, FIRE_INTERVAL: 8,
    BULLET_SPEED: 11, LASER_W: 6, LASER_H: 26,
    ENEMY_BULLET_SPEED: 4.5, ENEMY_LASER_W: 6, ENEMY_LASER_H: 24, ENEMY_BULLET_DAMAGE: 15,
    ROWS: 5, COLS: 8, ALIEN_W: 38, ALIEN_H: 32, PAD_X: 5, PAD_Y: 6, ALIEN_TOP: 80,
    ALIEN_SPEED: 1.5, ALIEN_DROP: 16, EDGE: 5, ALIEN_SHOOT: 40,
    ALIEN_IMAGES: ["enemyBlack2", "enemyRed3", "enemyGreen3", "enemyBlue3", "enemyBlue1"],   // 每一排一種
    WAVES: [
      { kind: "formation", speed: 1, shoot: 1 },
      { kind: "formation", speed: 1.35, shoot: 0.75 },   // 第 2 關：更快、更愛射
      { kind: "boss", speed: 1, shoot: 1 },
    ],
    BOSS_HP: 45, BOSS_BOX: 90, BOSS_SPEED: 2.2, BOSS_SHOOT: 32, BOSS_SCORE: 1000,
    BOSS_Y: 128,   // Boss 中心的高度：太高會蓋到上面的血條
    METEOR_INTERVAL: 70, METEOR_DAMAGE: 25,
    // 隕石：圖檔、耐打度、分數、畫出來的寬高（碰撞框 = 寬 - 8 的正方形，擦邊不算）
    METEORS: [
      { img: "meteorBrown_big1", hp: 3, score: 30, w: 67, h: 56 },
      { img: "meteorGrey_big2", hp: 3, score: 30, w: 73, h: 60 },
      { img: "meteorBrown_med1", hp: 2, score: 20, w: 38, h: 38 },
      { img: "meteorGrey_small1", hp: 1, score: 10, w: 26, h: 26 },
    ],
    // 打倒一隻敵機時依序抽籤；總和 27%，其餘什麼都不掉
    DROPS: [["weapon", 0.07], ["shield", 0.05], ["heal", 0.05], ["coin", 0.10]],
    POWERUP_SPEED: 2.5, POWERUP_BOX: 28, COIN_SCORE: 100, WEAPON_SCORE: 50, HEAL: 30,
  };

  // 兩個「中心點 + 寬高」的方框有沒有重疊
  function overlap(a, b) {
    return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
  }

  function playerBox(g) {
    return { x: g.px, y: playerTop(g) + C.PLAYER_H / 2, w: C.PLAYER_W, h: C.PLAYER_H };
  }

  function playerTop(g) {
    return g.H - C.PLAYER_BOTTOM * g.sk;
  }

  // opts.h：畫面高度（手機比較長，就給長一點的戰場）；opts.rng：亂數（測試時給固定的）
  // g.sk = 高度 / 600：所有「上下方向」的位置和速度都乘上它。
  // 這樣長手機只是把整個戰場等比例拉長，敵機降到底、子彈飛到戰機的時間都跟 600 高時一樣，難度不會因為手機長短而不同。
  // （左右方向和圖片大小不變。長手機上戰機會比較高，下面多出來的空間剛好給手指，不會蓋住戰機。）
  function newGame(opts) {
    opts = opts || {};
    const H = Math.round(opts.h || C.H);
    const g = { H, sk: H / C.H, rng: opts.rng || Math.random, t: 0 };
    reset(g);
    return g;
  }

  function reset(g) {
    g.px = C.W / 2;
    g.hp = C.PLAYER_HP;
    g.weapon = 1;
    g.shield = 0;
    g.inv = 0;
    g.fireTimer = 0;
    g.score = 0;
    g.bullets = [];
    g.enemyBullets = [];
    g.meteors = [];
    g.powerups = [];
    g.aliens = [];
    g.boss = null;
    g.over = false;
    g.win = false;
    g.wave = -1;
    nextWave(g, null);
  }

  function formation(g) {
    const total = C.COLS * (C.ALIEN_W + C.PAD_X) - C.PAD_X;
    const start = Math.floor((C.W - total) / 2);
    const out = [];
    for (let r = 0; r < C.ROWS; r++) {
      for (let c = 0; c < C.COLS; c++) {
        out.push({
          x: start + c * (C.ALIEN_W + C.PAD_X) + C.ALIEN_W / 2,
          y: (C.ALIEN_TOP + r * (C.ALIEN_H + C.PAD_Y)) * g.sk + C.ALIEN_H / 2,
          w: C.ALIEN_W, h: C.ALIEN_H, row: r, col: c,
        });
      }
    }
    return out;
  }

  function nextWave(g, ev) {
    g.wave += 1;
    const w = C.WAVES[g.wave];
    g.dir = 1;
    g.alienSpeed = C.ALIEN_SPEED * w.speed;
    g.shootInterval = Math.max(10, Math.round(C.ALIEN_SHOOT * w.shoot));
    g.shootTimer = 0;
    g.banner = 60;   // 畫面中間顯示「WAVE x」的剩餘時間
    if (w.kind === "formation") {
      g.aliens = formation(g);
      g.boss = null;
    } else {
      g.aliens = [];
      g.boss = { x: C.W / 2, y: C.BOSS_Y * g.sk, w: C.BOSS_BOX, h: C.BOSS_BOX, hp: C.BOSS_HP, max: C.BOSS_HP, dir: 1, timer: 0, flash: 0 };
    }
    if (ev) ev.push({ t: "wave", n: g.wave + 1, boss: w.kind === "boss" });
  }

  function setPlayerX(g, x) {
    const half = C.PLAYER_W / 2;
    g.px = Math.max(half, Math.min(C.W - half, x));
  }

  // 依武器等級發射：1 級單發、2 級雙發、3 級三發（左右兩發往外斜）
  function shoot(g, ev) {
    g.fireTimer = C.FIRE_INTERVAL;
    const top = playerTop(g) + 2;
    const pattern = g.weapon === 1 ? [[0, 0]] : g.weapon === 2 ? [[-9, 0], [9, 0]] : [[0, 0], [-12, -2.2], [12, 2.2]];
    for (const [dx, vx] of pattern) {
      g.bullets.push({ x: g.px + dx, y: top, vx, vy: -C.BULLET_SPEED * g.sk, w: C.LASER_W, h: C.LASER_H });
    }
    ev.push({ t: "laser" });
  }

  function boom(ev, x, y, color, n) {
    ev.push({ t: "boom", x, y, color, n });
  }

  function offscreen(g, b) {
    return b.y + b.h / 2 < 0 || b.y - b.h / 2 > g.H || b.x + b.w / 2 < 0 || b.x - b.w / 2 > C.W;
  }

  // ------------------------------------------------------------------
  // 每一步：input = { dx: 這一步手指移動了多少 px, x: 直接指定戰機位置, fire: 是否按著 }
  // 回傳事件陣列：laser / hit / boom / pickup / shield / lose / win / wave
  // ------------------------------------------------------------------
  function step(g, input, dt) {
    input = input || {};
    dt = dt == null ? 1 : dt;
    const ev = [];
    g.t += dt;
    if (g.over || g.win) return ev;

    g.inv = Math.max(0, g.inv - dt);
    g.shield = Math.max(0, g.shield - dt);
    g.banner = Math.max(0, g.banner - dt);
    g.fireTimer = Math.max(0, g.fireTimer - dt);

    if (input.x != null) setPlayerX(g, input.x);
    if (input.dx) setPlayerX(g, g.px + input.dx);
    if (input.fire && g.fireTimer <= 0) shoot(g, ev);   // 按住不放 = 自動連射

    for (const b of g.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const b of g.enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const m of g.meteors) { m.x += m.vx * dt; m.y += m.vy * dt; m.angle += m.spin * dt; }
    for (const p of g.powerups) p.y += C.POWERUP_SPEED * g.sk * dt;
    g.bullets = g.bullets.filter((b) => !offscreen(g, b));
    g.enemyBullets = g.enemyBullets.filter((b) => !offscreen(g, b));
    g.meteors = g.meteors.filter((m) => m.y - m.h / 2 <= g.H);
    g.powerups = g.powerups.filter((p) => p.y - p.h / 2 <= g.H);

    spawnMeteor(g, dt);
    if (g.boss) updateBoss(g, dt);
    else updateAliens(g, dt, ev);
    checkPlayerBullets(g, ev);
    checkPlayerDamage(g, ev);
    checkPickups(g, ev);
    // 這一關的敵機全滅（而且不是 Boss 關）-> 下一關；Boss 被打倒會直接 win
    if (!g.aliens.length && !g.boss && !g.win && !g.over && g.wave < C.WAVES.length - 1) nextWave(g, ev);
    return ev;
  }

  function spawnMeteor(g, dt) {
    if (g.boss || g.rng() >= dt / C.METEOR_INTERVAL) return;
    const k = C.METEORS[Math.floor(g.rng() * C.METEORS.length)];
    const box = k.w - 8;
    g.meteors.push({
      x: 25 + g.rng() * (C.W - 50), y: -30, w: box, h: box,
      vx: (g.rng() - 0.5) * 1.6, vy: (2 + g.rng() * 1.6) * g.sk,
      angle: g.rng() * 360, spin: (g.rng() < 0.5 ? -1 : 1) * (g.rng() < 0.33 ? 30 : 15),   // 每 tick 轉幾度
      hp: k.hp, score: k.score, kind: C.METEORS.indexOf(k),
    });
  }

  function updateAliens(g, dt, ev) {
    if (!g.aliens.length) return;
    for (const a of g.aliens) a.x += g.alienSpeed * g.dir * dt;
    // 只在「往那一邊移動」時碰到那一邊才轉向；不然剛轉向還沒離開邊界，下一步又會再轉一次、多往下掉一格
    const hit = g.aliens.some((a) => (g.dir > 0 && a.x + a.w / 2 >= C.W - C.EDGE) || (g.dir < 0 && a.x - a.w / 2 <= C.EDGE));
    if (hit) {
      g.dir *= -1;
      for (const a of g.aliens) a.y += C.ALIEN_DROP * g.sk;
    }
    if (g.aliens.some((a) => a.y + a.h / 2 >= playerTop(g))) lose(g, ev);   // 敵機降到戰機那一排 = 直接輸
    g.shootTimer += dt;
    if (g.shootTimer >= g.shootInterval) {
      g.shootTimer -= g.shootInterval;
      const s = g.aliens[Math.floor(g.rng() * g.aliens.length)];
      g.enemyBullets.push({ x: s.x, y: s.y + s.h / 2, vx: 0, vy: C.ENEMY_BULLET_SPEED * g.sk, w: C.ENEMY_LASER_W, h: C.ENEMY_LASER_H });
    }
  }

  function updateBoss(g, dt) {
    const b = g.boss;
    b.x += C.BOSS_SPEED * b.dir * dt;
    if ((b.dir < 0 && b.x - b.w / 2 <= 10) || (b.dir > 0 && b.x + b.w / 2 >= C.W - 10)) b.dir *= -1;
    b.flash = Math.max(0, b.flash - dt);
    b.timer += dt;
    if (b.timer >= C.BOSS_SHOOT) {   // 三方向散彈
      b.timer -= C.BOSS_SHOOT;
      for (const vx of [-1.8, 0, 1.8]) {
        g.enemyBullets.push({ x: b.x, y: b.y + b.h / 2 - 5, vx, vy: C.ENEMY_BULLET_SPEED * g.sk, w: C.ENEMY_LASER_W, h: C.ENEMY_LASER_H });
      }
    }
  }

  // 玩家雷射打到：敵機 > 隕石 > Boss。一發雷射最多打中一個目標。
  function checkPlayerBullets(g, ev) {
    if (g.over) return;   // 同一步裡已經輸了（例如敵機剛降到底），子彈就不再算分
    const keep = [];
    for (const b of g.bullets) {
      let used = false;
      const ai = g.aliens.findIndex((a) => overlap(b, a));
      if (ai >= 0) {
        killAlien(g, ai, ev);
        used = true;
      } else {
        const mi = g.meteors.findIndex((m) => overlap(b, m));
        if (mi >= 0) {
          const m = g.meteors[mi];
          m.hp -= 1;
          if (m.hp <= 0) {
            g.meteors.splice(mi, 1);
            g.score += m.score;
            boom(ev, m.x, m.y, "#c8a06e", 14);
          }
          used = true;
        } else if (g.boss && !g.win && overlap(b, g.boss)) {
          const boss = g.boss;
          boss.hp -= 1;
          boss.flash = 3;
          g.score += 5;
          boom(ev, b.x, b.y - b.h / 2, "#ffe150", 4);
          used = true;
          if (boss.hp <= 0) {
            boom(ev, boss.x, boss.y, "#ff9628", 60);
            boom(ev, boss.x, boss.y, "#ff4646", 40);
            g.score += C.BOSS_SCORE;
            g.boss = null;
            g.win = true;
            ev.push({ t: "win" });
          }
        }
      }
      if (!used) keep.push(b);
    }
    g.bullets = keep;
  }

  function killAlien(g, i, ev) {
    const a = g.aliens.splice(i, 1)[0];
    g.score += (C.ROWS - a.row) * 10;   // 越上面的排分數越高
    boom(ev, a.x, a.y, "#ff9628", 18);
    let roll = g.rng();
    for (const [kind, chance] of C.DROPS) {   // 抽籤：機率依序累加，落在哪一段就掉哪一種
      if (roll < chance) {
        g.powerups.push({ kind, x: a.x, y: a.y, w: C.POWERUP_BOX, h: C.POWERUP_BOX });
        break;
      }
      roll -= chance;
    }
  }

  function checkPlayerDamage(g, ev) {
    const p = playerBox(g);
    g.enemyBullets = g.enemyBullets.filter((b) => {
      if (!overlap(b, p)) return true;
      hurt(g, C.ENEMY_BULLET_DAMAGE, ev);
      return false;
    });
    g.meteors = g.meteors.filter((m) => {
      if (!overlap(m, p)) return true;
      boom(ev, m.x, m.y, "#c8a06e", 14);
      hurt(g, C.METEOR_DAMAGE, ev);
      return false;
    });
    if (g.boss && overlap(g.boss, p)) hurt(g, C.ENEMY_BULLET_DAMAGE, ev);   // 直接撞 Boss 也會痛
  }

  // 扣血。護盾或被打後的閃爍無敵期間不會受傷。
  function hurt(g, dmg, ev) {
    if (g.shield > 0 || g.inv > 0 || g.over || g.win) return;
    g.hp -= dmg;
    g.inv = C.INVINCIBLE;
    ev.push({ t: "hit" });
    const p = playerBox(g);
    boom(ev, p.x, p.y, "#5ad2ff", 14);
    if (g.hp <= 0) {
      g.hp = 0;
      lose(g, ev);
    }
  }

  function lose(g, ev) {
    if (g.over) return;
    g.over = true;
    const p = playerBox(g);
    boom(ev, p.x, p.y, "#ff9628", 50);
    ev.push({ t: "lose" });
  }

  function checkPickups(g, ev) {
    if (g.over || g.win) return;   // 已經結束就不能再撿（不然被打死的同一步撿到補血，結束畫面血條會回升）
    const p = playerBox(g);
    g.powerups = g.powerups.filter((u) => {
      if (!overlap(u, p)) return true;
      ev.push({ t: u.kind === "shield" ? "shield" : "pickup", kind: u.kind });
      if (u.kind === "weapon") {
        g.weapon = Math.min(C.MAX_WEAPON, g.weapon + 1);
        g.score += C.WEAPON_SCORE;
      } else if (u.kind === "shield") {
        g.shield = C.SHIELD;
      } else if (u.kind === "heal") {
        g.hp = Math.min(C.PLAYER_HP, g.hp + C.HEAL);
      } else {
        g.score += C.COIN_SCORE;
      }
      return false;
    });
  }

  const api = { C, newGame, reset, step, nextWave, overlap, playerBox, playerTop, setPlayerX, formation };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Shooter = api;
})(typeof self !== "undefined" ? self : this);

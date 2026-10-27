"""taco 星際戰機的檢查：App 檔案齊全、素材都在、core.js 的遊戲規則（用 node 跑）。"""
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run_node(js):
    """用 node 跑一段測試程式，core.js 以 require 載入，回傳它印出來的 JSON。"""
    out = subprocess.run(["node", "-e", js, str(ROOT / "core.js")], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


# 每段 node 程式開頭都一樣：載入 core.js、準備固定的亂數（結果每次都一樣）
PRE = """
const S=require(process.argv[1]);const C=S.C;
let seed=7;const rng=()=>((seed=seed*16807%2147483647)/2147483647);
const never=()=>0.999999;   // 不掉寶、不出隕石
"""


def test_app_files():
    """可以裝到手機桌面：manifest、圖示、service worker；部署流程會填版本號、也會帶上 assets。"""
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert m["scope"] == "./" and m["start_url"] == "./" and m["display"] == "standalone"
    for i in m["icons"]:
        assert (ROOT / i["src"]).is_file(), i["src"]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert re.findall(r'<script src="([^"]+)"', html) == ["core.js", "app.js"]
    assert '<meta name="app-version" content="dev">' in html
    assert re.search(r"\[hidden\][^{]*\{\s*display\s*:\s*none\s*!important", html)
    for el in ["stage", "game", "menu", "start", "sound", "install", "iosTip", "best", "ver", "pause", "pauseBtn", "resume", "quit", "loading"]:
        assert f'id="{el}"' in html, el
    pages = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "site/index.html" in pages and "assets" in pages and "pytest" in pages


def test_assets_match_code():
    """程式用到的圖片、音效都在 assets 裡；assets 裡也沒有多餘沒用到的檔案；service worker 會先存好全部。"""
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    core = (ROOT / "core.js").read_text(encoding="utf-8")
    # 圖檔名：前綴後面一定接大寫、數字或底線（例如 enemyRed3、fire11），這樣不會把 "shield" 這種道具種類當成檔名
    names = set(re.findall(r'"((?:player|enemy|ufo|laser|powerup|meteor|fire|shield|star)[A-Z0-9_][A-Za-z0-9_]*|darkPurple)"', app + core))
    sounds = set(re.findall(r'"(sfx_[a-zA-Z0-9]+)"', app))
    files = {p.name for p in (ROOT / "assets").iterdir()}
    for n in names:
        assert n + ".png" in files, n
    for s in sounds:
        assert s + ".mp3" in files, s
    used = {n + ".png" for n in names} | {s + ".mp3" for s in sounds} | {"kenvector_future.ttf"}
    assert files == used, sorted(files ^ used)
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    for f in files:
        assert f'"./assets/{f}"' in sw, f


def test_start_and_controls():
    """開局 40 隻敵機、滿血；戰機不會跑出畫面；按著才會射，而且有間隔。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const g=S.newGame({rng:never});const o={};
    o.start=[g.aliens.length,g.hp,g.weapon,g.wave,g.boss];
    S.step(g,{dx:-999});o.left=g.px;S.step(g,{dx:9999});o.right=g.px;
    const g2=S.newGame({rng:never});let n=0;
    for(let i=0;i<4;i++)n+=S.step(g2,{}).filter(e=>e.t==="laser").length;o.noFire=n;
    n=0;for(let i=0;i<16;i++)n+=S.step(g2,{fire:true}).filter(e=>e.t==="laser").length;o.held=n;
    const g3=S.newGame({rng:never,h:760});o.tall=[g3.H,S.playerTop(g3)];
    console.log(JSON.stringify(o));""")
    assert out["start"] == [40, 100, 1, 0, None]
    assert out["left"] == 20 and out["right"] == 380
    assert out["noFire"] == 0 and out["held"] == 2   # 每 8 tick 一發：16 tick 射 2 發
    assert out["tall"] == [760, 665]


def test_weapon_levels():
    """武器 1 級單發、2 級雙發、3 級三發（左右兩發往外斜）。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const o=[];for(const w of [1,2,3]){const g=S.newGame({rng:never});g.weapon=w;g.aliens=[];
      S.step(g,{fire:true},0.01);o.push(g.bullets.map(b=>[Math.round(b.x-g.px),b.vx]));}
    console.log(JSON.stringify(o));""")
    assert out == [[[0, 0]], [[-9, 0], [9, 0]], [[0, 0], [-12, -2.2], [12, 2.2]]]


def test_kill_score_and_drops():
    """打到敵機：分數照排數（最上排 50、最下排 10）；掉寶照抽籤表。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const o={};const shot=(g,a)=>{g.bullets=[{x:a.x,y:a.y,vx:0,vy:0,w:6,h:26}];};
    let g=S.newGame({rng:never});shot(g,g.aliens[0]);S.step(g,{},0.001);o.top=[g.score,g.aliens.length,g.powerups.length];
    g=S.newGame({rng:never});shot(g,g.aliens[39]);S.step(g,{},0.001);o.bottom=g.score;
    const kinds=[];for(const r of [0.01,0.08,0.13,0.2,0.5]){const g=S.newGame({rng:()=>r});g.meteors=[];shot(g,g.aliens[0]);
      S.step(g,{},0.001);kinds.push(g.powerups.length?g.powerups[0].kind:null);}
    o.kinds=kinds;console.log(JSON.stringify(o));""")
    assert out["top"] == [50, 39, 0]
    assert out["bottom"] == 10
    assert out["kinds"] == ["weapon", "shield", "heal", "coin", None]


def test_damage_shield_and_pickups():
    """被打扣血、短暫無敵不會連續扣；護盾擋傷害；撿道具效果正確、武器最多 3 級、補血不超過上限。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const o={};const hitMe=(g)=>{const p=S.playerBox(g);g.enemyBullets.push({x:p.x,y:p.y,vx:0,vy:0,w:6,h:24});};
    let g=S.newGame({rng:never});hitMe(g);S.step(g,{},0.01);o.first=[g.hp,g.inv>0];hitMe(g);S.step(g,{},0.01);o.again=g.hp;
    g=S.newGame({rng:never});g.shield=50;hitMe(g);S.step(g,{},0.01);o.shield=[g.hp,g.enemyBullets.length];
    g=S.newGame({rng:never});const p=S.playerBox(g);
    for(const k of ["weapon","weapon","weapon","shield","heal","coin"])g.powerups.push({kind:k,x:p.x,y:p.y,w:28,h:28});
    g.hp=90;S.step(g,{},0.01);o.picks=[g.weapon,g.shield>100,g.hp,g.score];
    g=S.newGame({rng:never});g.meteors.push({x:g.px,y:S.playerBox(g).y,w:30,h:30,vx:0,vy:0,angle:0,spin:0,hp:3,score:30,kind:0});
    g.hp=20;const ev=S.step(g,{},0.01).map(e=>e.t);o.meteor=[g.hp,g.over,ev.includes("lose")];
    console.log(JSON.stringify(o));""")
    assert out["first"] == [85, True] and out["again"] == 85
    assert out["shield"] == [100, 0]
    assert out["picks"] == [3, True, 100, 250]   # 3 次武器 +150、金幣 +100
    assert out["meteor"] == [0, True, True]


def test_meteor_needs_several_hits():
    """大隕石要打 3 下才會碎，碎了才給分。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const g=S.newGame({rng:never});g.aliens=[];g.meteors.push({x:200,y:300,w:59,h:59,vx:0,vy:0,angle:0,spin:0,hp:3,score:30,kind:0});
    const r=[];for(let i=0;i<3;i++){g.bullets=[{x:200,y:300,vx:0,vy:0,w:6,h:26}];S.step(g,{},0.001);r.push([g.meteors.length,g.score]);}
    console.log(JSON.stringify(r));""")
    assert out == [[1, 0], [1, 0], [0, 30]]


def test_formation_edge_drops_once():
    """敵機碰到邊界只往下掉一格就轉向，不會在邊界來回抖、連掉好幾格。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const g=S.newGame({rng:never});const y0=g.aliens[0].y;const drops=[];let last=y0;
    for(let i=0;i<400;i++){S.step(g,{},0.5);if(g.aliens[0].y!==last){drops.push(i);last=g.aliens[0].y;}}
    let gaps=drops.slice(1).map((d,i)=>d-drops[i]);
    console.log(JSON.stringify({n:drops.length,minGap:Math.min(...gaps),dy:last-y0}));""")
    assert out["n"] >= 2
    assert out["minGap"] > 20          # 兩次下降之間至少隔一段橫移
    assert out["dy"] == out["n"] * 16


def test_waves_boss_and_win():
    """清完一關進下一關（第 2 關更快）；第 3 關 Boss 會三方向散彈；打倒 Boss = 贏、加 1000 分。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const o={};const g=S.newGame({rng:never});g.aliens=[];let ev=S.step(g,{},0.01).map(e=>e.t);
    o.w2=[g.wave,g.aliens.length,g.alienSpeed>C.ALIEN_SPEED,ev.includes("wave")];
    g.aliens=[];S.step(g,{},0.01);o.w3=[g.wave,!!g.boss,g.aliens.length];
    g.boss.timer=C.BOSS_SHOOT-0.01;g.enemyBullets=[];S.step(g,{},0.01);o.spread=g.enemyBullets.map(b=>b.vx);
    g.boss.hp=1;g.bullets=[{x:g.boss.x,y:g.boss.y,vx:0,vy:0,w:6,h:26}];const s0=g.score;
    ev=S.step(g,{},0.001).map(e=>e.t);o.win=[g.win,g.boss,g.score-s0,ev.includes("win")];
    const after=S.step(g,{fire:true},1);o.frozen=after.length;
    S.reset(g);o.reset=[g.win,g.wave,g.aliens.length,g.score];
    console.log(JSON.stringify(o));""")
    assert out["w2"] == [1, 40, True, True]
    assert out["w3"] == [2, True, 0]
    assert out["spread"] == [-1.8, 0, 1.8]
    assert out["win"] == [True, None, 1005, True]
    assert out["frozen"] == 0
    assert out["reset"] == [False, 0, 40, 0]


def test_aliens_reaching_player_loses():
    """敵機降到戰機那一排就直接輸。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const g=S.newGame({rng:never});g.aliens=[g.aliens[0]];g.aliens[0].y=S.playerTop(g);
    const ev=S.step(g,{},0.01).map(e=>e.t);console.log(JSON.stringify([g.over,ev.includes("lose")]));""")
    assert out == [True, True]


def test_speed_same_on_60hz():
    """手機一秒更新 60 次（每步 dt=0.5），移動距離要跟 30 次（dt=1）一樣。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const a=S.newGame({rng:never}),b=S.newGame({rng:never});
    // 只跑 10 tick（敵機還沒碰到邊界）：碰邊的那一下兩種步長本來就會差一點點
    for(let i=0;i<10;i++)S.step(a,{fire:true},1);for(let i=0;i<20;i++)S.step(b,{fire:true},0.5);
    console.log(JSON.stringify([a.aliens[0].x,b.aliens[0].x,a.bullets[0].y,b.bullets[0].y,a.bullets.length,b.bullets.length]));""")
    assert abs(out[0] - out[1]) < 1e-9
    assert abs(out[2] - out[3]) < 1e-9 and out[4] == out[5]


def test_full_game_with_bot():
    """自動駕駛（開著護盾、一直瞄準最下面的敵機）能從第 1 關打到贏，中途不會出錯。"""
    if not shutil.which("node"):
        return
    out = run_node(PRE + """
    const g=S.newGame({rng,h:720});const waves=[];let i=0;
    for(;i<20000&&!g.over&&!g.win;i++){g.shield=999;
      const t=g.boss?g.boss.x:(g.aliens.length?g.aliens.reduce((a,b)=>a.y>b.y?a:b).x:200);
      for(const e of S.step(g,{x:t,fire:true},0.5))if(e.t==="wave")waves.push(e.n);}
    console.log(JSON.stringify({waves,win:g.win,over:g.over,score:g.score}));""")
    assert out["waves"] == [2, 3]
    assert out["win"] is True and out["over"] is False
    assert out["score"] > 1000

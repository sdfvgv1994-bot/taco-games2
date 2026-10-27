# taco-games2：taco 星際戰機

直式太空射擊遊戲。手機、電腦打開網址就能玩，不用安裝也不用登入。

網址：**https://sdfvgv1994-bot.github.io/taco-games2/**

## 怎麼玩

- 手機：手指**按著拖**，戰機跟著左右移動，同時自動連射
- 電腦：← → 移動、空白鍵射擊、P 暫停
- 打倒敵機有機會掉道具：⚡ 武器升級（最多三發）、🛡 5 秒護盾、＋ 補血、⭐ 加分
- 隕石會掉下來，可以打碎，被撞到會扣血
- 共三關：兩波敵機編隊（第二波更快），最後是 UFO 大魔王；血量歸零就輸
- **裝到手機桌面**：Android 的 Chrome／Edge 在主選單按「📲 安裝到桌面」；iPhone 用 Safari 的「分享 → 加入主畫面」。裝好後是全螢幕，沒網路也能玩

## 程式

| 檔案 | 內容 |
| --- | --- |
| `core.js` | 遊戲規則（位置、碰撞、血量、分數、關卡），不碰畫面，node 也能跑 |
| `app.js` | 畫面、操作（觸控／鍵盤）、音效、安裝到桌面 |
| `index.html` | 畫面骨架和主選單 |
| `sw.js` | 離線也能開：先把圖片、音效存起來 |
| `assets/` | 圖片、音效、字型 |
| `tests/` | 檢查（`pytest`，規則用 node 跑） |

main 分支有改動時，GitHub Actions「網站上線」會先跑測試，通過才自動更新網站。

## 素材

美術、音效、字型：[Kenney](https://www.kenney.nl/) 的 [Space Shooter Redux](https://opengameart.org/content/space-shooter-redux)，授權 CC0（公眾領域）。

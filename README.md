# 城巴 56／56A 實時到站

查 **NOVO LAND（欣寶路）** 與 **上水站** 之間城巴 56、56A 的實時到站，以及預計抵達終點的時間。介面為繁體中文。

手機可直接打開：

- 去上水：https://qioqiao.github.io/grok4.6_56_demo/
- 回 NOVO LAND：https://qioqiao.github.io/grok4.6_56_demo/inbound.html

## 兩個頁面

| 頁面 | 上車 | 落車 |
| --- | --- | --- |
| `index.html`（去上水） | NOVO LAND 欣寶路 | 上水站 D2 |
| `inbound.html`（回程） | 上水站 D1 | NOVO LAND 欣寶路 |

每班會顯示：

- 這班還有多久到上車點
- 預計幾點抵達終點
- 資料是實時、原定班次，還是班表推算

56 用藍色、56A 用橙色。快到站時只改倒計時文字顏色，卡片底色不變。

## 路線說明

兩線互補，平日一起覆蓋屯門北 ↔ 北區：

- **56A**：平日繁忙時間，經皇后山，也停上水站；週末及公眾假期停開
- **56**：平日非繁忙時段，以及週末全日，往天平邨

有城巴開放數據時以實時 ETA 為準；沒有覆蓋的時段才用官方班表推算。

## 本機執行

需要 [Node.js](https://nodejs.org/)。在專案目錄：

```powershell
npm start
```

或雙擊 `start.cmd`。瀏覽器打開 http://127.0.0.1:8756/

本機伺服器會代理城巴 API；GitHub Pages 上則直接請求開放數據。

## 資料來源

- 實時到站：[data.gov.hk 城巴 ETA](https://rt.data.gov.hk/)
- 班表推算：運輸署 2024-07-28 服務調整，以及公開班距資料

約每 30 秒自動更新。

## 網站圖示

桌面 Chrome 分頁用 `favicon.svg`。iOS 加到主畫面必須用 PNG（不吃 SVG），檔案是：

- `apple-touch-icon.png`（180×180，給 iPhone）
- `icon-192.png` / `icon-512.png`（給 Android / 桌面 PWA）

改圖後執行 `node scripts/write-icons.mjs` 可依 `favicon.svg` 的配色重繪 PNG。手機若已經加過主畫面，要刪掉舊捷徑再加一次才會刷新圖示。iOS 上用 **Safari** 分享 → 加入主畫面最穩；Chrome iOS 仍走系統 WebKit，對 SVG / PWA manifest 支援不完整。


# CGMS / AGP 判讀工具

這個資料夾提供一個可部署到 GitHub Pages 的 CGMS / AGP 互動網站，用於連續葡萄糖監測（CGM/CGMS）報告的本機解析、圖表、臨床分析、飲食調整重點與治療建議。

## 網站功能

- 上傳 LibreView CSV，於瀏覽器本機解析 FreeStyle Libre 2 glucose readings。
- 自動計算 active days、capture percent、average glucose、GMI、TIR、TBR、TAR、CV。
- 產生 glucose trend、AGP percentile band、TIR/TBR/TAR 圖表。
- 輸入治療藥物、insulin、CKD/透析背景、三餐時間與飲食/運動線索。
- 以規則式邏輯輸出可能原因、飲食調整關鍵點、治療建議與可複製臨床報告。
- 可下載匿名 JSON 摘要；不預設上傳或儲存 PHI。

## 手機資料取得

手機瀏覽器不能在未經使用者動作下直接掃描或讀取 FreeStyle Libre 2 / LibreView App 或 Downloads 內的資料。這是 iOS/Android 與瀏覽器的隱私沙盒限制。

v1 支援兩種手機流程：

1. 從 LibreView 匯出 CSV，回到網站點選「上傳 LibreView CSV」。
2. 將網站安裝成 PWA 後，從手機檔案或分享選單把 CSV 分享到「CGMS AGP」，網站會接收後自動解析。

PDF、手機截圖與 OCR 留待後續版本。

## 判讀順序

1. 確認資料品質：建議至少 14 天、CGM active time >=70%。
2. 先看安全性：TBR <70 mg/dL 與 <54 mg/dL 是否超標。
3. 再看整體控制：TIR 70-180 mg/dL、TAR >180 與 >250 mg/dL。
4. 再看波動：CV 是否 >36%。
5. 最後對照 AGP 曲線時段：夜間、空腹、早餐後、午餐後、晚餐後、睡前。

## 常用目標值

| 指標 | 一般成人常用目標 |
| --- | --- |
| TIR 70-180 mg/dL | >70% |
| TBR <70 mg/dL | <4% |
| TBR <54 mg/dL | <1% |
| TAR >180 mg/dL | <25% |
| TAR >250 mg/dL | <5% |
| CV | <=36% |

高齡、CKD、透析、反覆低血糖、低血糖感知不良或多重共病病人，目標需個別化，通常先放寬降糖強度並優先避免低血糖。

## 使用核心判讀

```bash
/Users/YHTseng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node test-core.js
```

本機預覽：

```bash
python3 -m http.server 4173
```

部署目標：

```text
https://github.com/yht5582-source/cgms
https://yht5582-source.github.io/cgms/
```

可在其他程式中呼叫：

```js
const { analyzeAgp } = require("./core");

const result = analyzeAgp({
  profile: {
    diabetesType: "type 2 diabetes",
    kidneyContext: "CKD G4",
    therapy: ["basal insulin", "sulfonylurea"],
  },
  metrics: {
    activeDays: 14,
    capturePercent: 88,
    averageGlucose: 168,
    gmi: 7.3,
    tir70to180: 54,
    tbrBelow70: 5.2,
    tbrBelow54: 1.3,
    tarAbove180: 40,
    tarAbove250: 9,
    cv: 41,
  },
  patterns: {
    nocturnalLow: true,
    fastingLow: true,
    postBreakfastSpike: true,
    postDinnerSpike: true,
    lateEveningHyperglycemia: true,
  },
});
```

## 需要補上的資料

- AGP 圖或 CGM 匯出 CSV。
- 監測天數、active time、平均血糖、GMI、TIR、TBR、TAR、CV。
- 三餐、點心、含糖飲料、水果、運動與睡眠時間。
- 藥物與 insulin：品項、劑量、服藥/施打時間、是否漏藥。
- CKD stage、eGFR、透析日/非透析日、低血糖症狀與處置。

## 參考

- International Consensus on Time in Range, Diabetes Care 2019.
- American Diabetes Association Standards of Care: Glycemic Goals and Hypoglycemia.

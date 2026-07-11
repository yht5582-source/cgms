# CGMSNative iOS App

Native SwiftUI 版本的 CGMS / AGP 判讀工具，對應根目錄 GitHub Pages 版的核心功能。

## 功能

- 使用 Files picker 匯入 LibreView CSV。
- 本機解析 glucose readings，不上傳病人資料。
- 計算 active days、capture percent、average glucose、GMI、TIR/TBR/TAR、CV。
- 偵測夜間低血糖、空腹高/低血糖、三餐後尖峰與晚間延遲性高血糖。
- 輸入治療藥物、CKD/透析背景與補充用藥資訊。
- 產生繁體中文臨床報告、飲食調整重點與治療建議。
- App Intents / Shortcuts：
  - 開啟 CGMS 判讀
  - 匯入 CGMS 資料
  - 查看最近 AGP 摘要

## 手機資料限制

iOS 不允許 app 未經使用者授權直接讀取 FreeStyle Libre 2 / LibreView app 或 Downloads。v1 採用 Apple 支援的安全路徑：

1. 從 LibreView 匯出 CSV。
2. 在 app 內透過 Files picker 選擇 CSV，或由 Files / Share Sheet 分享到 app。
3. app 在本機解析並產生 AGP 分析。

## 開啟方式

在安裝完整 Xcode 的 Mac 上開啟：

```bash
open ios/CGMSNative/CGMSNative.xcodeproj
```

目前這台環境只有 Command Line Tools，`xcodebuild` 無法建置 iOS target。已用 `swiftc -parse` 檢查核心模型與服務檔案語法；完整 build 請在 Xcode 中選擇 iOS Simulator 或實機執行。

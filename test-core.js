const assert = require("node:assert/strict");
const {
  analyzeAgp,
  calculateAgpMetrics,
  detectPatterns,
  parseLibreCsv,
  generateClinicalReport,
} = require("./core");

function includesAny(items, keyword) {
  return items.some((item) => item.includes(keyword));
}

const difficultCase = analyzeAgp({
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

assert.equal(difficultCase.validity.status, "usable");
assert.equal(difficultCase.priority, "先處理低血糖風險，再改善餐後高血糖");
assert.ok(includesAny(difficultCase.safetyAlerts, "TBR"));
assert.ok(includesAny(difficultCase.possibleCauses, "basal insulin"));
assert.ok(includesAny(difficultCase.possibleCauses, "早餐"));
assert.ok(includesAny(difficultCase.dietKeyPoints, "早餐"));
assert.ok(includesAny(difficultCase.treatmentSuggestions, "sulfonylurea"));
assert.ok(includesAny(difficultCase.treatmentSuggestions, "CKD"));

const insufficientData = analyzeAgp({
  metrics: {
    activeDays: 6,
    capturePercent: 55,
    tir70to180: 72,
    tbrBelow70: 0.3,
    tbrBelow54: 0,
    tarAbove180: 27,
    tarAbove250: 2,
    cv: 28,
  },
  patterns: {},
});

assert.equal(insufficientData.validity.status, "limited");
assert.ok(includesAny(insufficientData.validity.reasons, "14"));
assert.ok(includesAny(insufficientData.validity.reasons, "70%"));
assert.ok(includesAny(insufficientData.nextDataNeeded, "飲食照片"));

const stableCase = analyzeAgp({
  metrics: {
    activeDays: 14,
    capturePercent: 82,
    tir70to180: 78,
    tbrBelow70: 1,
    tbrBelow54: 0,
    tarAbove180: 20,
    tarAbove250: 2,
    cv: 31,
  },
  patterns: {
    postLunchSpike: true,
  },
});

assert.equal(stableCase.priority, "維持整體控制，針對餐後尖峰微調");
assert.ok(includesAny(stableCase.dietKeyPoints, "午餐"));
assert.ok(includesAny(stableCase.treatmentSuggestions, "目前藥物"));

const sampleCsv = `Device Timestamp,Historic Glucose mg/dL,Scan Glucose mg/dL,Notes
2026-07-01 00:00,62,,
2026-07-01 03:00,68,,
2026-07-01 07:00,102,,
2026-07-01 09:00,225,,
2026-07-01 12:00,142,,
2026-07-01 14:00,188,,
2026-07-01 18:00,156,,
2026-07-01 20:00,261,,
2026-07-01 23:00,214,,
2026-07-02 00:00,72,,
2026-07-02 03:00,61,,
2026-07-02 07:00,112,,
2026-07-02 09:00,,238,
2026-07-02 12:00,148,,
2026-07-02 14:00,176,,
2026-07-02 18:00,154,,
2026-07-02 20:00,252,,
2026-07-02 23:00,202,,`;

const readings = parseLibreCsv(sampleCsv);
assert.equal(readings.length, 18);
assert.equal(readings[12].glucoseMgDl, 238);
assert.equal(readings[0].sourceRow, 2);

const metrics = calculateAgpMetrics(readings);
assert.equal(metrics.activeDays, 2);
assert.equal(metrics.totalReadings, 18);
assert.equal(metrics.tbrBelow70, 16.7);
assert.equal(metrics.tarAbove180, 38.9);
assert.equal(metrics.tarAbove250, 11.1);
assert.ok(metrics.cv > 39);
assert.equal(metrics.hourlySummary.length, 24);

const patterns = detectPatterns(readings, {
  breakfast: "07:30",
  lunch: "12:00",
  dinner: "18:00",
}, {
  kidneyContext: "HD_MWF",
});
assert.equal(patterns.nocturnalLow, true);
assert.equal(patterns.postBreakfastSpike, true);
assert.equal(patterns.postDinnerSpike, true);
assert.equal(patterns.lateEveningHyperglycemia, true);
assert.equal(patterns.dialysisSchedule, "HD_MWF");
assert.ok(patterns.dialysisDaySummary.dialysis.below70Percent > patterns.dialysisDaySummary.nonDialysis.below70Percent);

assert.throws(
  () => parseLibreCsv("Time,Value\nnot-a-date,100"),
  /無法辨識有效的日期與血糖欄位/
);

const report = generateClinicalReport({
  profile: {
    diabetesType: "type 2 diabetes",
    kidneyContext: "HD_MWF",
    therapy: ["Ryzodeg", "premixed insulin"],
    ryzodegBreakfastDose: 18,
    ryzodegDinnerDose: 10,
  },
  metrics,
  patterns,
});
assert.ok(report.includes("AGP 判讀摘要"));
assert.ok(report.includes("TIR"));
assert.ok(report.includes("飲食調整關鍵點"));
assert.ok(report.includes("Ryzodeg"));
assert.ok(report.includes("透析日"));

// ---- v2.0 regression tests ----
const core = require("./core");

// mmol/L 換算：舊版 glucoseMgDl 為 undefined，所有指標變成 NaN。
const mmol = parseLibreCsv("Device Timestamp,Historic Glucose mmol/L\n2026-07-01 08:15,6.5\n2026-07-01 08:30,7.0");
assert.equal(mmol.length, 2);
assert.equal(mmol[0].glucoseMgDl, 117);
assert.equal(mmol.meta.unit, "mmol/L");
assert.ok(Number.isFinite(calculateAgpMetrics(mmol).averageGlucose));

// DD-MM-YYYY 與分號分隔。
const dmy = parseLibreCsv("Device Timestamp;Historic Glucose mg/dL\n25-07-2026 08:15;120\n26-07-2026 20:15;130");
assert.equal(dmy.length, 2);
assert.equal(dmy[0].timestamp.getDate(), 25);
assert.equal(dmy[0].timestamp.getMonth(), 6);

// LibreView US：MM-DD-YYYY hh:mm AM/PM，含 metadata 首列與 BOM。
const us = parseLibreCsv("﻿Glucose Data,Generated on,07-03-2026 10:00 AM UTC,Generated by,X\nDevice,Serial Number,Device Timestamp,Record Type,Historic Glucose mg/dL,Scan Glucose mg/dL\nFreeStyle Libre 2,ABC,07-01-2026 12:15 AM,0,120,\nFreeStyle Libre 2,ABC,07-01-2026 08:30 PM,0,130,");
assert.equal(us.length, 2);
assert.equal(us[0].timestamp.getHours(), 0);
assert.equal(us[1].timestamp.getHours(), 20);
assert.equal(core.parseDateTime("2026/07/01 下午 03:05").getHours(), 15);
assert.equal(core.parseDateTime("2026-02-30 08:00"), null);

// 掃描值在 historic 15 分鐘內不重複計入。
const dup = parseLibreCsv("Device Timestamp,Record Type,Historic Glucose mg/dL,Scan Glucose mg/dL\n2026-07-01 08:00,0,100,\n2026-07-01 08:05,1,,100\n2026-07-01 08:06,1,,101\n2026-07-01 08:15,0,102,\n2026-07-01 10:00,1,,150");
assert.equal(dup.length, 3);
assert.equal(dup.meta.scanSkipped, 2);

// 15 分鐘 historic、14 天完整資料 → capture 約 100%。
const start = new Date(2026, 6, 1, 0, 0).getTime();
const full = Array.from({ length: 14 * 96 }, (_, i) => ({ timestamp: new Date(start + i * 15 * 60000), glucoseMgDl: 90 + (i % 80) }));
const fullMetrics = calculateAgpMetrics(full);
assert.equal(fullMetrics.activeDays, 14);
assert.equal(fullMetrics.intervalMinutes, 15);
assert.equal(fullMetrics.capturePercent, 100);
assert.equal(fullMetrics.tir70to180, 100);
// 5 分鐘資料不再超過 100% 或被誤判。
const dex = Array.from({ length: 288 }, (_, i) => ({ timestamp: new Date(start + i * 5 * 60000), glucoseMgDl: 120 }));
assert.equal(calculateAgpMetrics(dex).intervalMinutes, 5);
assert.equal(calculateAgpMetrics(dex).capturePercent, 100);

// 90 天檔案只取最近 14 天。
const long = Array.from({ length: 90 * 24 }, (_, i) => ({ timestamp: new Date(start + i * 3600000), glucoseMgDl: 120 }));
assert.equal(calculateAgpMetrics(core.lastDays(long, 14)).activeDays, 14);
assert.equal(core.lastDays(long, 0).length, long.length);

// 目標族群：CKD G4/透析自動採高風險（TIR >50、TBR <1）。
const hd = analyzeAgp({ profile: { kidneyContext: "HD_MWF" }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 55, tbrBelow70: 2, tbrBelow54: 0.3, tarAbove180: 43, tarAbove250: 8, cv: 30 } });
assert.equal(hd.targetProfile.key, "highRisk");
assert.equal(hd.priority, "先處理低血糖風險，再改善餐後高血糖");
const std = analyzeAgp({ profile: { kidneyContext: "HD_MWF", targetGroup: "standard" }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 55, tbrBelow70: 2, tbrBelow54: 0.3, tarAbove180: 43, tarAbove250: 8, cv: 30 } });
assert.equal(std.priority, "先找出主要高血糖時段，再分餐別調整");

// 懷孕：使用 63-140 指標。
const preg = analyzeAgp({ profile: { diabetesType: "gestational diabetes" }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 90, tirPregnancy: 60, tbrBelow63: 1, tbrBelow54: 0, tarAbove140: 39, tarAbove250: 0, cv: 25 } });
assert.equal(preg.targetProfile.key, "pregnancy");
assert.equal(preg.metricAssessment.lowTir, true);
assert.ok(preg.targetEvaluation.some((row) => row.key === "tirPregnancy" && !row.met));
const pregMetrics = calculateAgpMetrics(full);
assert.ok(pregMetrics.tirPregnancy < pregMetrics.tir70to180);

// 空腹高血糖以前計算了但從未使用。
const fastingHigh = analyzeAgp({ profile: { therapy: ["basal insulin"] }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 60, tbrBelow70: 0.5, tbrBelow54: 0, tarAbove180: 39, tarAbove250: 6, cv: 28 }, patterns: { fastingHigh: true, fastingAverage: 168 } });
assert.ok(includesAny(fastingHigh.possibleCauses, "空腹平均 168"));
assert.ok(includesAny(fastingHigh.treatmentSuggestions, "每 3 天增加 2U"));

// 藥物規則。
const meds = analyzeAgp({ profile: { kidneyContext: "CKD_G4", therapy: ["metformin", "GLP-1 RA", "DPP-4 inhibitor", "sulfonylurea"] }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 75, tbrBelow70: 0.5, tbrBelow54: 0, tarAbove180: 24, tarAbove250: 3, cv: 30 } });
assert.ok(includesAny(meds.treatmentSuggestions, "metformin 在 eGFR <30"));
assert.ok(includesAny(meds.treatmentSuggestions, "不應併用"));
assert.ok(includesAny(meds.treatmentSuggestions, "glyburide"));
const pd = analyzeAgp({ profile: { kidneyContext: "PD" }, metrics: { activeDays: 14, capturePercent: 90, tir70to180: 60, tbrBelow70: 0, tbrBelow54: 0, tarAbove180: 40, tarAbove250: 9, cv: 30 } });
assert.ok(includesAny(pd.treatmentSuggestions, "icodextrin"));

// HbA1c 與 GMI 只有在填寫或進階 CKD 時才判讀。
assert.ok(!includesAny(stableCase.possibleCauses, "HbA1c"));
const a1c = analyzeAgp({ profile: { hba1c: 8.5 }, metrics: { gmi: 7.2, activeDays: 14, capturePercent: 90 } });
assert.ok(includesAny(a1c.possibleCauses, "+1.3%"));

// 報告需包含安全警訊。
const report2 = generateClinicalReport({ profile: { kidneyContext: "HD_MWF" }, metrics, patterns });
assert.ok(report2.includes("安全警訊"));
assert.ok(report2.includes("目標族群"));
assert.ok(report2.includes("TBR <54"));

// 夜間下降（overbasalization）。
const nightReadings = [];
for (let d = 0; d < 3; d += 1) {
  for (let h = 0; h < 24; h += 0.25) {
    const glucose = h >= 22 ? 230 : h < 8 ? 150 : 160;
    nightReadings.push({ timestamp: new Date(start + d * 86400000 + h * 3600000), glucoseMgDl: glucose });
  }
}
const night = detectPatterns(nightReadings, {}, {});
assert.equal(night.overnightDrop, true);

console.log("test-core: all assertions passed");

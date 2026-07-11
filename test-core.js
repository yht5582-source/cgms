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

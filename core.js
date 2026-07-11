const TARGETS = {
  tir70to180: 70,
  tbrBelow70: 4,
  tbrBelow54: 1,
  tarAbove180: 25,
  tarAbove250: 5,
  cv: 36,
  activeDays: 14,
  capturePercent: 70,
};

const MEAL_LABELS = {
  postBreakfastSpike: "早餐",
  postLunchSpike: "午餐",
  postDinnerSpike: "晚餐",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return String(header || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers, candidates) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => normalizeHeader(header).includes(candidate))
  );
}

function parseDateTime(raw) {
  const valueText = String(raw || "").trim();
  if (!valueText) return null;
  const normalized = valueText
    .replace(/\//g, "-")
    .replace(/^(\d{1,2})-(\d{1,2})-(\d{4})/, "$3-$1-$2")
    .replace("T", " ");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanGlucose(raw) {
  const match = String(raw || "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const glucose = Number(match[0]);
  if (!Number.isFinite(glucose) || glucose < 20 || glucose > 600) return null;
  return glucose;
}

function parseLibreCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    throw new Error("CSV 內容不足，請上傳 LibreView 匯出的 glucose CSV。");
  }

  const headerRowIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return (
      findColumn(headers, ["timestamp", "時間", "date", "日期"]) >= 0 &&
      findColumn(headers, ["glucose", "葡萄糖", "血糖"]) >= 0
    );
  });

  if (headerRowIndex < 0) {
    throw new Error("無法辨識有效的日期與血糖欄位，請確認 CSV 包含時間與 glucose mg/dL 欄位。");
  }

  const headers = rows[headerRowIndex];
  const normalizedHeaders = headers.map(normalizeHeader);
  const timeIndex = findColumn(normalizedHeaders, ["timestamp", "device timestamp", "時間", "date", "日期"]);
  const historicIndex = findColumn(normalizedHeaders, ["historic glucose", "歷史", "sensor glucose", "glucose value"]);
  const scanIndex = findColumn(normalizedHeaders, ["scan glucose", "掃描"]);
  const genericGlucoseIndex = findColumn(normalizedHeaders, ["glucose", "葡萄糖", "血糖"]);
  const glucoseIndexes = [historicIndex, scanIndex, genericGlucoseIndex]
    .filter((index, position, indexes) => index >= 0 && indexes.indexOf(index) === position);

  const readings = [];
  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const timestamp = parseDateTime(row[timeIndex]);
    const glucose = glucoseIndexes.map((col) => cleanGlucose(row[col])).find((item) => item !== null);
    if (timestamp && glucose !== null) {
      readings.push({
        timestamp,
        glucoseMgDl: glucose,
        sourceRow: headerRowIndex + index + 2,
      });
    }
  });

  if (!readings.length) {
    throw new Error("無法辨識有效的日期與血糖欄位，請確認時間格式與 glucose mg/dL 數值。");
  }

  return readings.sort((a, b) => a.timestamp - b.timestamp);
}

function value(metrics, key, fallback = 0) {
  return Number.isFinite(metrics?.[key]) ? metrics[key] : fallback;
}

function hasTherapy(profile, keyword) {
  return (profile?.therapy || []).some((item) =>
    String(item).toLowerCase().includes(keyword.toLowerCase())
  );
}

function round(valueToRound, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(valueToRound * factor) / factor;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hourOfDay(date) {
  return date.getHours() + date.getMinutes() / 60;
}

function summarizeWindow(readings, startHour, endHour) {
  const values = readings
    .filter(({ timestamp }) => {
      const hour = hourOfDay(timestamp);
      return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
    })
    .map((reading) => reading.glucoseMgDl);

  if (!values.length) return { count: 0, average: null, below70Percent: 0, above180Percent: 0 };
  return {
    count: values.length,
    average: round(values.reduce((sum, item) => sum + item, 0) / values.length),
    below70Percent: round((values.filter((item) => item < 70).length / values.length) * 100),
    above180Percent: round((values.filter((item) => item > 180).length / values.length) * 100),
  };
}

function calculateAgpMetrics(readings = []) {
  if (!readings.length) {
    return {
      activeDays: 0,
      capturePercent: 0,
      totalReadings: 0,
      averageGlucose: 0,
      gmi: 0,
      tir70to180: 0,
      tbrBelow70: 0,
      tbrBelow54: 0,
      tarAbove180: 0,
      tarAbove250: 0,
      cv: 0,
      dailySummary: [],
      hourlySummary: Array.from({ length: 24 }, (_, hour) => ({ hour, median: null, p10: null, p25: null, p75: null, p90: null })),
      timeWindows: {},
    };
  }

  const values = readings.map((reading) => reading.glucoseMgDl);
  const averageGlucose = values.reduce((sum, item) => sum + item, 0) / values.length;
  const byDay = new Map();
  const byHour = new Map(Array.from({ length: 24 }, (_, hour) => [hour, []]));

  readings.forEach((reading) => {
    const key = dayKey(reading.timestamp);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(reading.glucoseMgDl);
    byHour.get(reading.timestamp.getHours()).push(reading.glucoseMgDl);
  });

  const first = readings[0].timestamp;
  const last = readings[readings.length - 1].timestamp;
  const spanDays = Math.max(1, Math.ceil((last - first + 1) / DAY_MS));
  const expectedReadings = spanDays * 96;
  const activeDays = byDay.size;

  const dailySummary = [...byDay.entries()].map(([date, dayValues]) => ({
    date,
    count: dayValues.length,
    average: round(dayValues.reduce((sum, item) => sum + item, 0) / dayValues.length),
    tir70to180: round((dayValues.filter((item) => item >= 70 && item <= 180).length / dayValues.length) * 100),
    below70: round((dayValues.filter((item) => item < 70).length / dayValues.length) * 100),
    above180: round((dayValues.filter((item) => item > 180).length / dayValues.length) * 100),
  }));

  return {
    activeDays,
    capturePercent: round(Math.min(100, (readings.length / expectedReadings) * 100)),
    totalReadings: readings.length,
    averageGlucose: round(averageGlucose),
    gmi: round(3.31 + 0.02392 * averageGlucose),
    tir70to180: round((values.filter((item) => item >= 70 && item <= 180).length / values.length) * 100),
    tbrBelow70: round((values.filter((item) => item < 70).length / values.length) * 100),
    tbrBelow54: round((values.filter((item) => item < 54).length / values.length) * 100),
    tarAbove180: round((values.filter((item) => item > 180).length / values.length) * 100),
    tarAbove250: round((values.filter((item) => item > 250).length / values.length) * 100),
    cv: round((standardDeviation(values) / averageGlucose) * 100),
    dailySummary,
    hourlySummary: [...byHour.entries()].map(([hour, hourValues]) => ({
      hour,
      median: hourValues.length ? round(percentile(hourValues, 0.5)) : null,
      p10: hourValues.length ? round(percentile(hourValues, 0.1)) : null,
      p25: hourValues.length ? round(percentile(hourValues, 0.25)) : null,
      p75: hourValues.length ? round(percentile(hourValues, 0.75)) : null,
      p90: hourValues.length ? round(percentile(hourValues, 0.9)) : null,
    })),
    timeWindows: {
      nocturnal: summarizeWindow(readings, 0, 6),
      fasting: summarizeWindow(readings, 5, 8),
      morning: summarizeWindow(readings, 8, 11),
      afternoon: summarizeWindow(readings, 13, 16),
      evening: summarizeWindow(readings, 19, 23),
    },
  };
}

function parseHour(timeText, fallback) {
  const match = String(timeText || "").match(/(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return fallback;
  return Number(match[1]) + Number(match[2] || 0) / 60;
}

function windowAverage(readings, centerHour, startOffset, endOffset) {
  const start = (centerHour + startOffset + 24) % 24;
  const end = (centerHour + endOffset + 24) % 24;
  return summarizeWindow(readings, start, end).average;
}

function detectMealSpike(readings, mealHour) {
  const baseline = windowAverage(readings, mealHour, -1, 0.25);
  const postMeal = windowAverage(readings, mealHour, 1, 3);
  return Number.isFinite(baseline) && Number.isFinite(postMeal) && (postMeal >= 180 || postMeal - baseline >= 60);
}

function detectPatterns(readings = [], mealTimes = {}) {
  const breakfast = parseHour(mealTimes.breakfast, 7.5);
  const lunch = parseHour(mealTimes.lunch, 12);
  const dinner = parseHour(mealTimes.dinner, 18);
  const nocturnal = summarizeWindow(readings, 0, 6);
  const fasting = summarizeWindow(readings, 5, 8);
  const evening = summarizeWindow(readings, 20, 24);

  return {
    nocturnalLow: nocturnal.below70Percent >= 5,
    fastingLow: fasting.below70Percent >= 5,
    fastingHigh: Number.isFinite(fasting.average) && fasting.average > 130,
    postBreakfastSpike: detectMealSpike(readings, breakfast),
    postLunchSpike: detectMealSpike(readings, lunch),
    postDinnerSpike: detectMealSpike(readings, dinner),
    lateEveningHyperglycemia: evening.above180Percent >= 30,
  };
}

function assessValidity(metrics = {}) {
  const reasons = [];
  if (value(metrics, "activeDays") < TARGETS.activeDays) {
    reasons.push("建議至少 14 天資料，才能可靠判讀週間與週末、工作日與休息日差異");
  }
  if (value(metrics, "capturePercent") < TARGETS.capturePercent) {
    reasons.push("CGM 資料完整率建議至少 70%，否則 TIR/TBR/TAR 可能偏差");
  }

  return {
    status: reasons.length ? "limited" : "usable",
    reasons,
  };
}

function classifyMetrics(metrics = {}) {
  const flags = {
    hasHypoglycemia:
      value(metrics, "tbrBelow70") > TARGETS.tbrBelow70 ||
      value(metrics, "tbrBelow54") > TARGETS.tbrBelow54,
    hasSevereHypoglycemia: value(metrics, "tbrBelow54") > TARGETS.tbrBelow54,
    lowTir: value(metrics, "tir70to180") < TARGETS.tir70to180,
    highTar:
      value(metrics, "tarAbove180") > TARGETS.tarAbove180 ||
      value(metrics, "tarAbove250") > TARGETS.tarAbove250,
    highVariability: value(metrics, "cv") > TARGETS.cv,
  };

  return flags;
}

function buildSafetyAlerts(metrics, flags, patterns) {
  const alerts = [];
  if (flags.hasHypoglycemia) {
    alerts.push(
      `TBR <70 mg/dL ${value(metrics, "tbrBelow70")}% 或 <54 mg/dL ${value(
        metrics,
        "tbrBelow54"
      )}% 超過建議上限，需優先降低低血糖風險`
    );
  }
  if (patterns?.nocturnalLow || patterns?.fastingLow) {
    alerts.push("夜間或空腹低血糖提示 basal insulin、晚間藥物或睡前點心安排需重新檢視");
  }
  if (flags.highVariability) {
    alerts.push(`CV ${value(metrics, "cv")}% >36%，代表血糖波動偏大，治療調整要避免只追求平均值`);
  }
  return alerts;
}

function buildPossibleCauses(profile, metrics, flags, patterns) {
  const causes = [];
  if (patterns?.fastingLow || patterns?.nocturnalLow) {
    causes.push("basal insulin 劑量偏高、晚餐後活動量增加、腎功能下降造成藥物作用延長，或睡前碳水不足");
  }
  if (hasTherapy(profile, "sulfonylurea")) {
    causes.push("sulfonylurea 在 CKD 或進食不穩時會增加低血糖風險，需特別核對用藥時間與劑量");
  }
  for (const [key, meal] of Object.entries(MEAL_LABELS)) {
    if (patterns?.[key]) {
      causes.push(`${meal}後尖峰常見原因包括精緻澱粉、含糖飲料、飯量集中、蛋白質不足或餐前藥效銜接不佳`);
    }
  }
  if (patterns?.lateEveningHyperglycemia) {
    causes.push("晚間延遲性高血糖可來自高脂晚餐、宵夜、晚餐胰島素不足或運動後補食過量");
  }
  if (flags.lowTir && flags.highTar && !flags.hasHypoglycemia) {
    causes.push("TIR 不足且 TAR 偏高時，需區分是全天基礎偏高，還是集中於特定餐後時段");
  }
  if (value(metrics, "averageGlucose") && value(metrics, "gmi")) {
    causes.push("平均血糖與 GMI 可用來和 HbA1c 比對；若差距明顯，需考慮貧血、CKD、輸血或紅血球壽命改變");
  }
  return causes;
}

function buildDietKeyPoints(patterns) {
  const points = [];
  for (const [key, meal] of Object.entries(MEAL_LABELS)) {
    if (patterns?.[key]) {
      points.push(`${meal}先調整主食份量與種類：白飯、粥、麵、麵包、甜飲改為定量全穀雜糧，並搭配蛋白質與蔬菜`);
      points.push(`${meal}後若 1-2 小時快速上升，優先檢查進食順序、液態糖、點心與水果時間`);
    }
  }
  if (patterns?.lateEveningHyperglycemia) {
    points.push("晚餐與宵夜需拆開檢視：避免高脂大餐、睡前澱粉或水果集中，必要時改為低醣高蛋白點心");
  }
  if (patterns?.nocturnalLow || patterns?.fastingLow) {
    points.push("若有夜間低血糖，飲食調整不能只減醣；需同時檢視晚餐量、睡前點心與降糖藥作用時間");
  }
  if (!points.length) {
    points.push("飲食重點應由 AGP 的時段尖峰決定，請補上三餐照片、份量、點心、運動與用藥時間");
  }
  return points;
}

function buildTreatmentSuggestions(profile, flags, patterns) {
  const suggestions = [];
  if (flags.hasHypoglycemia) {
    suggestions.push("治療優先順序為降低低血糖：先檢視 insulin 或促胰島素分泌藥，再談強化降糖");
  }
  if (patterns?.nocturnalLow || patterns?.fastingLow) {
    suggestions.push("若使用 basal insulin，可評估降低夜間 basal、調整注射時間，或改用低低血糖風險方案");
  }
  if (hasTherapy(profile, "sulfonylurea")) {
    suggestions.push("sulfonylurea 可考慮減量、停用或改用低低血糖風險藥物，特別是 CKD、長者或進食不穩者");
  }
  if (String(profile?.kidneyContext || "").toUpperCase().includes("CKD")) {
    suggestions.push("CKD 病人需依 eGFR 調整用藥，避免藥物蓄積，並把低血糖風險列為第一安全目標");
  }
  if (flags.highTar && !flags.hasHypoglycemia) {
    suggestions.push("若低血糖少而餐後 TAR 高，可考慮強化餐前治療、調整 GLP-1 RA/SGLT2 inhibitor 適應性或餐前 insulin 策略");
  }
  if (flags.highVariability) {
    suggestions.push("CV 偏高時避免一次大幅加藥，宜按時段分拆：夜間、空腹、早餐後、午餐後、晚餐後逐一處理");
  }
  if (!suggestions.length) {
    suggestions.push("目前藥物可先維持，聚焦於造成尖峰的餐別、份量與運動安排，並追蹤下一份 AGP");
  }
  return suggestions;
}

function decidePriority(flags) {
  if (flags.hasHypoglycemia) return "先處理低血糖風險，再改善餐後高血糖";
  if (flags.lowTir || flags.highTar) return "先找出主要高血糖時段，再分餐別調整";
  return "維持整體控制，針對餐後尖峰微調";
}

function analyzeAgp(input = {}) {
  const metrics = input.metrics || {};
  const profile = input.profile || {};
  const patterns = input.patterns || {};
  const validity = assessValidity(metrics);
  const flags = classifyMetrics(metrics);

  return {
    validity,
    targets: TARGETS,
    priority: decidePriority(flags),
    metricAssessment: flags,
    safetyAlerts: buildSafetyAlerts(metrics, flags, patterns),
    possibleCauses: buildPossibleCauses(profile, metrics, flags, patterns),
    dietKeyPoints: buildDietKeyPoints(patterns),
    treatmentSuggestions: buildTreatmentSuggestions(profile, flags, patterns),
    nextDataNeeded: [
      "AGP 圖或 CGM 匯出 CSV",
      "三餐與點心時間、飲食照片或份量紀錄",
      "降糖藥、insulin 劑量與施打/服藥時間",
      "運動、透析日/非透析日、低血糖症狀與處置紀錄",
    ],
  };
}

function generateClinicalReport(input = {}) {
  const analysis = analyzeAgp(input);
  const metrics = input.metrics || {};
  const lines = [
    "AGP 判讀摘要",
    `資料品質：${analysis.validity.status === "usable" ? "可判讀" : "有限制"}。${analysis.validity.reasons.join("；")}`,
    `核心指標：TIR ${value(metrics, "tir70to180")}%、TBR <70 ${value(metrics, "tbrBelow70")}%、TAR >180 ${value(metrics, "tarAbove180")}%、CV ${value(metrics, "cv")}%。`,
    `優先處理：${analysis.priority}。`,
    "",
    "可能原因",
    ...analysis.possibleCauses.map((item) => `- ${item}`),
    "",
    "飲食調整關鍵點",
    ...analysis.dietKeyPoints.map((item) => `- ${item}`),
    "",
    "治療建議",
    ...analysis.treatmentSuggestions.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}

const AgpCore = {
  TARGETS,
  calculateAgpMetrics,
  detectPatterns,
  analyzeAgp,
  generateClinicalReport,
  parseLibreCsv,
};

if (typeof module !== "undefined") {
  module.exports = AgpCore;
}

if (typeof window !== "undefined") {
  window.AgpCore = AgpCore;
}

// CGMS / AGP 判讀核心 v2.0
// 目標值：International Consensus on Time in Range (Battelino, Diabetes Care 2019)
// 與 ADA Standards of Care 2025 §6 Glycemic Goals / §15 Pregnancy。

const TARGET_PROFILES = {
  standard: {
    key: "standard",
    label: "一般成人 T1/T2",
    range: [70, 180],
    tir: 70,
    tbrBelow70: 4,
    tbrBelow54: 1,
    tarAbove180: 25,
    tarAbove250: 5,
  },
  highRisk: {
    key: "highRisk",
    label: "高齡 / 高低血糖風險（含 CKD G4-5、透析）",
    range: [70, 180],
    tir: 50,
    tbrBelow70: 1,
    tbrBelow54: null,
    tarAbove180: null,
    tarAbove250: 10,
  },
  pregnancy: {
    key: "pregnancy",
    label: "懷孕（63-140 mg/dL）",
    range: [63, 140],
    tir: 70,
    tbrBelow63: 4,
    tbrBelow54: 1,
    tarAbove140: 25,
  },
};

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

const MEAL_KEYS = {
  postBreakfastSpike: "breakfast",
  postLunchSpike: "lunch",
  postDinnerSpike: "dinner",
};

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const MMOL_TO_MGDL = 18.0;
const DIALYSIS_SCHEDULES = {
  HD_MWF: {
    label: "血液透析 HD 一三五",
    days: [1, 3, 5],
  },
  HD_TTS: {
    label: "血液透析 HD 二四六",
    days: [2, 4, 6],
  },
};
const ADVANCED_KIDNEY = ["CKD_G4", "CKD_G5_ND", "HD_MWF", "HD_TTS", "PD"];

function detectDelimiter(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  const score = (char) => lines.reduce((sum, line) => sum + line.split(char).length - 1, 0);
  return [",", ";", "\t"].reduce((best, char) => (score(char) > score(best) ? char : best), ",");
}

function parseCsvRows(csvText, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const text = String(csvText || "").replace(/^﻿/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
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
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers, candidates) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => normalizeHeader(header).includes(candidate))
  );
}

const DATE_RE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T]+(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm|上午|下午)?)?/i;

// 以 Date(y, m, d, h, mi) 建立本機時間，避免 Safari 無法解析 "YYYY-MM-DD HH:mm" 或 AM/PM 字串。
function parseDateTime(raw, order = "MDY") {
  const valueText = String(raw || "").trim();
  if (!valueText) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(valueText)) {
    const isoDate = new Date(valueText);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }
  const match = valueText.match(DATE_RE);
  if (!match) return null;
  const [, a, b, c, prefixMeridiem, hourText, minuteText, secondText, suffixMeridiem] = match;
  let year;
  let month;
  let day;
  if (a.length === 4) {
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else {
    year = Number(c.length === 2 ? `20${c}` : c);
    month = Number(order === "DMY" ? b : a);
    day = Number(order === "DMY" ? a : b);
  }
  let hour = Number(hourText || 0);
  const meridiem = String(prefixMeridiem || suffixMeridiem || "").toLowerCase();
  if ((meridiem === "pm" || meridiem === "下午") && hour < 12) hour += 12;
  if ((meridiem === "am" || meridiem === "上午") && hour === 12) hour = 0;
  const minute = Number(minuteText || 0);
  const second = Number(secondText || 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) return null;
  return date;
}

// 依整份檔案判斷 MM-DD-YYYY 或 DD-MM-YYYY；兩者皆可時採 LibreView 預設的 MDY。
function detectDateOrder(values) {
  let dmy = false;
  let mdy = false;
  values.forEach((raw) => {
    const match = String(raw || "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!match) return;
    if (Number(match[1]) > 12) dmy = true;
    if (Number(match[2]) > 12) mdy = true;
  });
  return dmy && !mdy ? "DMY" : "MDY";
}

function cleanGlucose(raw, factor = 1) {
  const match = String(raw || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const glucose = Number(match[0]) * factor;
  if (!Number.isFinite(glucose) || glucose < 20 || glucose > 600) return null;
  return round(glucose, 1);
}

function unitFactor(header) {
  return /mmol/i.test(String(header || "")) ? MMOL_TO_MGDL : 1;
}

function nearestGapMs(sortedTimes, time) {
  let low = 0;
  let high = sortedTimes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sortedTimes[mid] < time) low = mid + 1;
    else high = mid - 1;
  }
  const gaps = [sortedTimes[low], sortedTimes[low - 1]]
    .filter((item) => item !== undefined)
    .map((item) => Math.abs(item - time));
  return gaps.length ? Math.min(...gaps) : Infinity;
}

function parseLibreCsv(csvText) {
  const rows = parseCsvRows(csvText, detectDelimiter(String(csvText || "")));
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
  const timeIndex = findColumn(normalizedHeaders, ["device timestamp", "timestamp", "時間", "date", "日期"]);
  const historicIndex = findColumn(normalizedHeaders, ["historic glucose", "歷史", "sensor glucose", "glucose value"]);
  const scanIndex = findColumn(normalizedHeaders, ["scan glucose", "掃描"]);
  const genericGlucoseIndex = findColumn(normalizedHeaders, ["glucose", "葡萄糖", "血糖"]);
  const primaryIndex = historicIndex >= 0 ? historicIndex : genericGlucoseIndex;
  const dataRows = rows.slice(headerRowIndex + 1);
  const order = detectDateOrder(dataRows.map((row) => row[timeIndex]));
  const primaryFactor = unitFactor(headers[primaryIndex]);
  const scanFactor = scanIndex >= 0 ? unitFactor(headers[scanIndex]) : 1;

  const primary = [];
  const scans = [];
  dataRows.forEach((row, index) => {
    const timestamp = parseDateTime(row[timeIndex], order);
    if (!timestamp) return;
    const sourceRow = headerRowIndex + index + 2;
    const glucose = primaryIndex !== scanIndex ? cleanGlucose(row[primaryIndex], primaryFactor) : null;
    if (glucose !== null) {
      primary.push({ timestamp, glucoseMgDl: glucose, sourceRow, source: "historic" });
      return;
    }
    const scan = scanIndex >= 0 ? cleanGlucose(row[scanIndex], scanFactor) : null;
    if (scan !== null) scans.push({ timestamp, glucoseMgDl: scan, sourceRow, source: "scan" });
  });

  // 掃描值只補在 historic 15 分鐘紀錄的空缺，避免頻繁掃描的時段被重複加權。
  const primaryTimes = primary.map((item) => item.timestamp.getTime()).sort((a, b) => a - b);
  const keptScans = [];
  scans
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((scan) => {
      const time = scan.timestamp.getTime();
      const lastKept = keptScans[keptScans.length - 1];
      if (nearestGapMs(primaryTimes, time) < 15 * MIN_MS) return;
      if (lastKept && time - lastKept.timestamp.getTime() < 15 * MIN_MS) return;
      keptScans.push(scan);
    });

  const seen = new Set();
  const readings = [...primary, ...keptScans]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((reading) => {
      const key = reading.timestamp.getTime();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!readings.length) {
    throw new Error("無法辨識有效的日期與血糖欄位，請確認時間格式與 glucose mg/dL 數值。");
  }

  Object.defineProperty(readings, "meta", {
    value: {
      unit: primaryFactor === 1 ? "mg/dL" : "mmol/L",
      dateOrder: order,
      historicCount: primary.length,
      scanUsed: keptScans.length,
      scanSkipped: scans.length - keptScans.length,
    },
    enumerable: false,
  });
  return readings;
}

function lastDays(readings = [], days) {
  if (!readings.length || !days) return readings;
  const end = readings[readings.length - 1].timestamp.getTime();
  const end0 = new Date(end);
  end0.setHours(0, 0, 0, 0);
  const start = end0.getTime() - (days - 1) * DAY_MS;
  return readings.filter((reading) => reading.timestamp.getTime() >= start);
}

function value(metrics, key, fallback = 0) {
  return Number.isFinite(metrics?.[key]) ? metrics[key] : fallback;
}

function hasTherapy(profile, keyword) {
  return (profile?.therapy || []).some((item) =>
    String(item).toLowerCase().includes(keyword.toLowerCase())
  );
}

function dialysisSchedule(profile = {}) {
  const key = String(profile.kidneyContext || "").toUpperCase();
  return DIALYSIS_SCHEDULES[key] ? key : null;
}

function kidneyKey(profile = {}) {
  return String(profile.kidneyContext || "").toUpperCase().replace(/[\s-]+/g, "_");
}

function isAdvancedKidney(profile) {
  return ADVANCED_KIDNEY.includes(kidneyKey(profile));
}

function isDialysis(profile) {
  return ["HD_MWF", "HD_TTS", "PD"].includes(kidneyKey(profile));
}

function resolveTargetProfile(profile = {}) {
  const chosen = profile.targetGroup;
  if (chosen && TARGET_PROFILES[chosen]) return TARGET_PROFILES[chosen];
  if (/gestational|pregnan/i.test(profile.diabetesType || "")) return TARGET_PROFILES.pregnancy;
  if (isAdvancedKidney(profile)) return TARGET_PROFILES.highRisk;
  return TARGET_PROFILES.standard;
}

function round(valueToRound, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(valueToRound * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / (values.length - 1);
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

function percentOf(values, test) {
  return values.length ? round((values.filter(test).length / values.length) * 100) : 0;
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

// 讀值間隔取相鄰差的中位數（Libre historic 15 分、Dexcom 5 分、Libre 3 為 1-5 分）。
function samplingIntervalMinutes(readings) {
  const diffs = [];
  for (let i = 1; i < readings.length; i += 1) {
    const diff = (readings[i].timestamp - readings[i - 1].timestamp) / MIN_MS;
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) return 15;
  return Math.min(15, Math.max(1, Math.round(percentile(diffs, 0.5))));
}

function summarizeReadings(readings) {
  const values = readings.map((reading) => reading.glucoseMgDl);
  if (!values.length) {
    return { count: 0, average: null, below70Percent: 0, above180Percent: 0 };
  }
  return {
    count: values.length,
    average: round(mean(values)),
    below70Percent: percentOf(values, (item) => item < 70),
    above180Percent: percentOf(values, (item) => item > 180),
  };
}

function inWindow(hour, startHour, endHour) {
  return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

function summarizeWindow(readings, startHour, endHour) {
  return summarizeReadings(readings.filter(({ timestamp }) => inWindow(hourOfDay(timestamp), startHour, endHour)));
}

function emptyHourly() {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, median: null, p5: null, p25: null, p75: null, p95: null, p10: null, p90: null }));
}

function calculateAgpMetrics(readings = []) {
  if (!readings.length) {
    return {
      activeDays: 0,
      capturePercent: 0,
      totalReadings: 0,
      intervalMinutes: 15,
      averageGlucose: 0,
      gmi: 0,
      sd: 0,
      tir70to180: 0,
      tbrBelow70: 0,
      tbrBelow54: 0,
      tbr54to69: 0,
      tarAbove180: 0,
      tarAbove250: 0,
      tar181to250: 0,
      cv: 0,
      dailySummary: [],
      hourlySummary: emptyHourly(),
      timeWindows: {},
    };
  }

  const values = readings.map((reading) => reading.glucoseMgDl);
  const averageGlucose = mean(values);
  const sd = standardDeviation(values);
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
  const intervalMinutes = samplingIntervalMinutes(readings);
  const expectedReadings = Math.max(1, Math.round((last - first) / (intervalMinutes * MIN_MS)) + 1);
  const pct = (test) => percentOf(values, test);
  const tbrBelow70 = pct((item) => item < 70);
  const tbrBelow54 = pct((item) => item < 54);
  const tarAbove180 = pct((item) => item > 180);
  const tarAbove250 = pct((item) => item > 250);

  const dailySummary = [...byDay.entries()].map(([date, dayValues]) => ({
    date,
    count: dayValues.length,
    average: round(mean(dayValues)),
    tir70to180: percentOf(dayValues, (item) => item >= 70 && item <= 180),
    below70: percentOf(dayValues, (item) => item < 70),
    above180: percentOf(dayValues, (item) => item > 180),
  }));

  return {
    activeDays: byDay.size,
    capturePercent: round(Math.min(100, (readings.length / expectedReadings) * 100)),
    totalReadings: readings.length,
    intervalMinutes,
    startDate: dayKey(first),
    endDate: dayKey(last),
    averageGlucose: round(averageGlucose),
    gmi: round(3.31 + 0.02392 * averageGlucose),
    sd: round(sd),
    tir70to180: pct((item) => item >= 70 && item <= 180),
    tbrBelow70,
    tbrBelow54,
    tbr54to69: round(tbrBelow70 - tbrBelow54),
    tarAbove180,
    tarAbove250,
    tar181to250: round(tarAbove180 - tarAbove250),
    tirPregnancy: pct((item) => item >= 63 && item <= 140),
    tbrBelow63: pct((item) => item < 63),
    tarAbove140: pct((item) => item > 140),
    cv: round((sd / averageGlucose) * 100),
    dailySummary,
    hourlySummary: [...byHour.entries()].map(([hour, hourValues]) => {
      const p = (q) => (hourValues.length ? round(percentile(hourValues, q)) : null);
      return { hour, count: hourValues.length, median: p(0.5), p5: p(0.05), p10: p(0.1), p25: p(0.25), p75: p(0.75), p90: p(0.9), p95: p(0.95) };
    }),
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

function windowSummary(readings, centerHour, startOffset, endOffset) {
  const start = (centerHour + startOffset + 24) % 24;
  const end = (centerHour + endOffset + 24) % 24;
  return summarizeWindow(readings, start, end);
}

function mealDetail(readings, mealHour) {
  const baseline = windowSummary(readings, mealHour, -1, 0.25);
  const post = windowSummary(readings, mealHour, 1, 3);
  const rise = Number.isFinite(baseline.average) && Number.isFinite(post.average) ? round(post.average - baseline.average) : null;
  return {
    baseline: baseline.average,
    postMeal: post.average,
    rise,
    spike: rise !== null && (post.average >= 180 || rise >= 60),
    postMealLow: post.below70Percent >= 5,
  };
}

function detectPatterns(readings = [], mealTimes = {}, profile = {}) {
  const breakfast = parseHour(mealTimes.breakfast, 7.5);
  const lunch = parseHour(mealTimes.lunch, 12);
  const dinner = parseHour(mealTimes.dinner, 18);
  const nocturnal = summarizeWindow(readings, 0, 6);
  const fasting = summarizeWindow(readings, 5, 8);
  const evening = summarizeWindow(readings, 20, 24);
  const bedtime = summarizeWindow(readings, 22, 24);
  const preLunch = windowSummary(readings, lunch, -2, 0);
  const meals = {
    breakfast: mealDetail(readings, breakfast),
    lunch: mealDetail(readings, lunch),
    dinner: mealDetail(readings, dinner),
  };
  const scheduleKey = dialysisSchedule(profile);
  const dialysisDays = scheduleKey ? DIALYSIS_SCHEDULES[scheduleKey].days : [];
  const dialysisReadings = readings.filter((reading) => dialysisDays.includes(reading.timestamp.getDay()));
  const nonDialysisReadings = readings.filter((reading) => scheduleKey && !dialysisDays.includes(reading.timestamp.getDay()));
  const overnightChange = Number.isFinite(bedtime.average) && Number.isFinite(fasting.average) ? round(fasting.average - bedtime.average) : null;

  return {
    nocturnalLow: nocturnal.below70Percent >= 5,
    fastingLow: fasting.below70Percent >= 5,
    fastingHigh: Number.isFinite(fasting.average) && fasting.average > 130,
    fastingAverage: fasting.average,
    bedtimeAverage: bedtime.average,
    overnightChange,
    overnightDrop: overnightChange !== null && overnightChange <= -50,
    preLunchLow: preLunch.below70Percent >= 5,
    postBreakfastSpike: meals.breakfast.spike,
    postLunchSpike: meals.lunch.spike,
    postDinnerSpike: meals.dinner.spike,
    meals,
    lateEveningHyperglycemia: evening.above180Percent >= 30,
    dialysisSchedule: scheduleKey,
    dialysisScheduleLabel: scheduleKey ? DIALYSIS_SCHEDULES[scheduleKey].label : "",
    dialysisDaySummary: scheduleKey
      ? {
          dialysis: summarizeReadings(dialysisReadings),
          nonDialysis: summarizeReadings(nonDialysisReadings),
        }
      : null,
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

// 回傳各指標對應目標的評估列，供 UI 與報告共用。
function evaluateTargets(metrics = {}, target = TARGET_PROFILES.standard) {
  const rows = [];
  const add = (key, label, actual, goal, direction) => {
    if (goal === null || goal === undefined) return;
    const met = direction === "min" ? actual >= goal : actual < goal;
    rows.push({ key, label, actual, goal, direction, met });
  };
  if (target.key === "pregnancy") {
    add("tirPregnancy", "TIR 63-140", value(metrics, "tirPregnancy", value(metrics, "tir70to180")), target.tir, "min");
    add("tbrBelow63", "TBR <63", value(metrics, "tbrBelow63", value(metrics, "tbrBelow70")), target.tbrBelow63, "max");
    add("tbrBelow54", "TBR <54", value(metrics, "tbrBelow54"), target.tbrBelow54, "max");
    add("tarAbove140", "TAR >140", value(metrics, "tarAbove140", value(metrics, "tarAbove180")), target.tarAbove140, "max");
  } else {
    add("tir70to180", "TIR 70-180", value(metrics, "tir70to180"), target.tir, "min");
    add("tbrBelow70", "TBR <70", value(metrics, "tbrBelow70"), target.tbrBelow70, "max");
    add("tbrBelow54", "TBR <54", value(metrics, "tbrBelow54"), target.tbrBelow54, "max");
    add("tarAbove180", "TAR >180", value(metrics, "tarAbove180"), target.tarAbove180, "max");
    add("tarAbove250", "TAR >250", value(metrics, "tarAbove250"), target.tarAbove250, "max");
  }
  rows.push({ key: "cv", label: "CV", actual: value(metrics, "cv"), goal: TARGETS.cv, direction: "maxInclusive", met: value(metrics, "cv") <= TARGETS.cv });
  return rows;
}

function classifyMetrics(metrics = {}, target = TARGET_PROFILES.standard) {
  const rows = Object.fromEntries(evaluateTargets(metrics, target).map((row) => [row.key, row]));
  const failed = (key) => Boolean(rows[key] && !rows[key].met);
  return {
    hasHypoglycemia: failed("tbrBelow70") || failed("tbrBelow63") || failed("tbrBelow54"),
    hasSevereHypoglycemia: value(metrics, "tbrBelow54") >= TARGETS.tbrBelow54,
    lowTir: failed("tir70to180") || failed("tirPregnancy"),
    highTar: failed("tarAbove180") || failed("tarAbove250") || failed("tarAbove140"),
    veryHigh: value(metrics, "tarAbove250") >= 10,
    highVariability: value(metrics, "cv") > TARGETS.cv,
  };
}

function mealText(patterns, mealKey) {
  const meal = patterns?.meals?.[mealKey];
  if (!meal || meal.rise === null) return "";
  return `（餐前 ${meal.baseline} → 餐後 1-3h ${meal.postMeal} mg/dL，上升 ${meal.rise}）`;
}

function buildSafetyAlerts(profile, metrics, flags, patterns, target) {
  const alerts = [];
  if (flags.hasHypoglycemia) {
    const lowKey = target.key === "pregnancy" ? "tbrBelow63" : "tbrBelow70";
    const lowLabel = target.key === "pregnancy" ? "<63" : "<70";
    const goal = target[lowKey];
    alerts.push(
      `TBR ${lowLabel} mg/dL ${value(metrics, lowKey, value(metrics, "tbrBelow70"))}%（目標 <${goal}%）、<54 mg/dL ${value(metrics, "tbrBelow54")}%（目標 <1%），需優先降低低血糖風險`
    );
  }
  if (flags.hasSevereHypoglycemia) {
    alerts.push("Level 2 低血糖（<54 mg/dL）≥1%：需詢問低血糖症狀/感知不良，確認病人與家屬會 15-15 處置並備有升糖素");
  }
  if (patterns?.nocturnalLow || patterns?.fastingLow) {
    alerts.push("夜間或空腹低血糖提示 basal insulin、晚間藥物或睡前點心安排需重新檢視");
  }
  if (patterns?.preLunchLow) {
    alerts.push("午餐前 2 小時低血糖比例 ≥5%：檢視早餐劑量（預混/Ryzodeg、sulfonylurea、早餐 prandial）與早餐份量是否不足");
  }
  if (flags.highVariability) {
    alerts.push(`CV ${value(metrics, "cv")}% >36%，代表血糖波動偏大，低血糖風險上升，治療調整要避免只追求平均值`);
  }
  if (/type 1/i.test(profile?.diabetesType || "") && flags.veryHigh) {
    alerts.push(`第 1 型糖尿病 TAR >250 mg/dL ${value(metrics, "tarAbove250")}%：持續 >250 時應檢測血酮，排除漏打 insulin、針頭/注射部位或幫浦問題`);
  }
  if (patterns?.dialysisDaySummary?.dialysis?.below70Percent > patterns?.dialysisDaySummary?.nonDialysis?.below70Percent + 3) {
    alerts.push(`透析日低血糖比例 ${patterns.dialysisDaySummary.dialysis.below70Percent}% 高於非透析日 ${patterns.dialysisDaySummary.nonDialysis.below70Percent}%，需分開檢視透析前後進食與 insulin 劑量`);
  }
  return alerts;
}

function buildPossibleCauses(profile, metrics, flags, patterns) {
  const causes = [];
  const usesRyzodeg = hasTherapy(profile, "ryzodeg");
  const usesPremix = hasTherapy(profile, "premixed insulin") || hasTherapy(profile, "預混");
  if (patterns?.fastingLow || patterns?.nocturnalLow) {
    causes.push("夜間/空腹低血糖：basal insulin 或晚餐劑量偏高、晚餐後活動量增加、腎功能下降造成藥物作用延長，或晚餐/睡前碳水不足");
  }
  if (patterns?.overnightDrop) {
    causes.push(`睡前到清晨下降 ${Math.abs(patterns.overnightChange)} mg/dL（≥50）：提示 basal 過量（overbasalization）或晚餐/睡前藥效過強`);
  }
  if (patterns?.fastingHigh && !patterns?.fastingLow && !patterns?.nocturnalLow) {
    causes.push(`空腹平均 ${patterns.fastingAverage} mg/dL >130：basal insulin 不足、黎明現象、晚餐/宵夜過量或漏服晚間藥物`);
  }
  if (usesRyzodeg || usesPremix) {
    causes.push(`預混型胰島素/Ryzodeg 需同時對照早餐劑量 ${profile?.ryzodegBreakfastDose || "未填"}U、晚餐劑量 ${profile?.ryzodegDinnerDose || "未填"}U 與餐後尖峰；若早餐後高血糖合併午前低血糖，需避免只增加早餐劑量`);
  }
  if (hasTherapy(profile, "sulfonylurea")) {
    causes.push("sulfonylurea 在 CKD 或進食不穩時會增加低血糖風險，需特別核對用藥時間與劑量");
  }
  for (const [key, meal] of Object.entries(MEAL_LABELS)) {
    if (patterns?.[key]) {
      causes.push(`${meal}後尖峰${mealText(patterns, MEAL_KEYS[key])}：常見原因包括精緻澱粉、含糖飲料、飯量集中、蛋白質不足或餐前藥效銜接不佳`);
    }
  }
  if (patterns?.lateEveningHyperglycemia) {
    causes.push("晚間延遲性高血糖可來自高脂晚餐、宵夜、晚餐胰島素不足或運動後補食過量");
  }
  if (flags.lowTir && flags.highTar && !flags.hasHypoglycemia) {
    causes.push("TIR 不足且 TAR 偏高時，需區分是全天基礎偏高，還是集中於特定餐後時段");
  }
  const hba1c = Number(profile?.hba1c);
  const gmi = value(metrics, "gmi");
  if (hba1c > 0 && gmi > 0) {
    const gap = round(hba1c - gmi);
    if (Math.abs(gap) >= 0.5) {
      causes.push(`HbA1c ${hba1c}% 與 GMI ${gmi}% 相差 ${gap > 0 ? "+" : ""}${gap}%：${gap > 0 ? "HbA1c 偏高可見於缺鐵性貧血、紅血球壽命延長" : "HbA1c 偏低可見於 CKD/透析、ESA 治療、出血、溶血或近期輸血"}；個人化調整時以 CGM 為準`);
    } else {
      causes.push(`HbA1c ${hba1c}% 與 GMI ${gmi}% 相差 <0.5%，兩者一致`);
    }
  } else if (isAdvancedKidney(profile) && gmi > 0) {
    causes.push("CKD G4-5/透析病人 HbA1c 可信度下降（貧血、ESA、紅血球壽命縮短），血糖控制評估以 CGM 的 TIR/TBR/GMI 為主");
  }
  if (patterns?.dialysisDaySummary) {
    const { dialysis, nonDialysis } = patterns.dialysisDaySummary;
    causes.push(`透析日與非透析日需分開判讀：透析日平均 ${dialysis.average ?? "無資料"} mg/dL、低血糖 ${dialysis.below70Percent}%；非透析日平均 ${nonDialysis.average ?? "無資料"} mg/dL、低血糖 ${nonDialysis.below70Percent}%`);
  }
  if (kidneyKey(profile) === "PD") {
    causes.push("腹膜透析含葡萄糖透析液每天吸收可觀熱量，換液留置期間常見高血糖；高濃度（2.5%/4.25%）袋數增加時尤其明顯");
  }
  if (kidneyKey(profile) === "TRANSPLANT") {
    causes.push("移植後高血糖常與類固醇（午後至傍晚高血糖）與 calcineurin inhibitor（tacrolimus）相關，需對照抗排斥藥劑量變化");
  }
  return causes;
}

function buildDietKeyPoints(profile, patterns) {
  const points = [];
  for (const [key, meal] of Object.entries(MEAL_LABELS)) {
    if (patterns?.[key]) {
      points.push(`${meal}先調整主食份量與種類：白飯、粥、麵、麵包、甜飲改為定量全穀雜糧，並搭配蛋白質與蔬菜`);
      points.push(`${meal}後若 1-2 小時快速上升，優先檢查進食順序（菜→肉→飯）、液態糖、點心與水果時間`);
    }
  }
  if (patterns?.lateEveningHyperglycemia) {
    points.push("晚餐與宵夜需拆開檢視：避免高脂大餐、睡前澱粉或水果集中，必要時改為低醣高蛋白點心");
  }
  if (patterns?.nocturnalLow || patterns?.fastingLow) {
    points.push("若有夜間低血糖，飲食調整不能只減醣；需同時檢視晚餐量、睡前點心與降糖藥作用時間");
  }
  if (patterns?.preLunchLow) {
    points.push("午餐前低血糖：早餐需有固定份量的醣類，必要時上午加一份點心，並避免延遲午餐");
  }
  if (patterns?.dialysisDaySummary) {
    points.push("HD 病人請把透析日與非透析日分開記錄飲食：透析前點心、透析中進食、透析後晚餐與運動量都可能改變血糖型態");
  }
  if (isAdvancedKidney(profile)) {
    points.push("CKD G4-5/透析飲食需同時兼顧鉀、磷與蛋白質目標；低血糖處置優先用葡萄糖錠或方糖，避免以高鉀果汁（柳橙汁）處理");
  }
  if (!points.length) {
    points.push("飲食重點應由 AGP 的時段尖峰決定，請補上三餐照片、份量、點心、運動與用藥時間");
  }
  return points;
}

function buildTreatmentSuggestions(profile, flags, patterns) {
  const suggestions = [];
  const usesRyzodeg = hasTherapy(profile, "ryzodeg");
  const usesPremix = hasTherapy(profile, "premixed insulin") || hasTherapy(profile, "預混");
  const usesBasal = hasTherapy(profile, "basal insulin");
  const usesPrandial = hasTherapy(profile, "prandial insulin");
  const usesInsulin = usesBasal || usesPrandial || usesPremix || usesRyzodeg || hasTherapy(profile, "insulin");
  const kidney = kidneyKey(profile);
  const lowAtNight = patterns?.nocturnalLow || patterns?.fastingLow;

  if (flags.hasHypoglycemia) {
    suggestions.push("治療優先順序為降低低血糖：先檢視 insulin 或促胰島素分泌藥，再談強化降糖");
  }
  if (lowAtNight) {
    suggestions.push(usesBasal
      ? "夜間/空腹低血糖且使用 basal insulin：basal 先減量 10-20%，或調整注射時間，再追蹤 3-7 天 CGM"
      : "若使用 basal insulin，可評估降低夜間 basal、調整注射時間，或改用低低血糖風險方案");
  }
  if (usesBasal && patterns?.overnightDrop && !lowAtNight) {
    suggestions.push("睡前到清晨下降 ≥50 mg/dL：疑似 overbasalization，不宜再增加 basal；改處理餐後高血糖（prandial 或 GLP-1 RA）");
  } else if (usesBasal && patterns?.fastingHigh && !lowAtNight && !flags.hasHypoglycemia) {
    suggestions.push("空腹偏高且無夜間低血糖：basal 可每 3 天增加 2U（或 10%）滴定至空腹 80-130 mg/dL；若 basal 已 >0.5 U/kg/day 仍未達標，改加 prandial 或 GLP-1 RA");
  }
  if (usesPrandial) {
    const spikes = Object.entries(MEAL_LABELS).filter(([key]) => patterns?.[key]).map(([, meal]) => meal);
    const lows = Object.entries(patterns?.meals || {}).filter(([, meal]) => meal.postMealLow).map(([key]) => ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐" })[key]);
    if (lows.length) suggestions.push(`${lows.join("、")}後 1-3 小時低血糖：該餐 prandial insulin 先減量，或改為餐前 0-15 分鐘注射並確認醣量`);
    if (spikes.length && !flags.hasHypoglycemia) suggestions.push(`${spikes.join("、")}後尖峰：僅調整該餐 prandial insulin（每次 1-2U 或 10-15%），並確認注射時間在餐前 15-20 分鐘`);
  }
  if (hasTherapy(profile, "sulfonylurea")) {
    suggestions.push(isDialysis(profile) || kidney === "CKD_G4" || kidney === "CKD_G5_ND"
      ? "sulfonylurea 在 CKD G4-5/透析：避免 glyburide（glibenclamide），若需保留以 gliclazide 或 glipizide 低劑量；有低血糖應減量或停用"
      : "sulfonylurea 可考慮減量、停用或改用低低血糖風險藥物，特別是 CKD、長者或進食不穩者");
  }
  if (hasTherapy(profile, "metformin") && ADVANCED_KIDNEY.includes(kidney)) {
    suggestions.push("metformin 在 eGFR <30（CKD G4-5、透析）屬禁忌，應停用；eGFR 30-45 不建議新開始、既有使用需減量");
  } else if (hasTherapy(profile, "metformin") && kidney === "CKD_G3") {
    suggestions.push("CKD G3 使用 metformin：eGFR 30-45 需減量（常用上限 1000 mg/day），每 3-6 個月追蹤 eGFR");
  }
  if (hasTherapy(profile, "SGLT2") && (isDialysis(profile) || kidney === "CKD_G5_ND")) {
    suggestions.push("SGLT2 inhibitor 在 eGFR <20/透析已無降糖效果，不應作為控制血糖的手段；腎/心保護適應症另依腎臟科評估");
  }
  if (hasTherapy(profile, "SGLT2") && /type 1/i.test(profile?.diabetesType || "")) {
    suggestions.push("第 1 型糖尿病使用 SGLT2 inhibitor 有正常血糖 DKA 風險，需確認適應症並衛教生病日停藥與血酮監測");
  }
  if (hasTherapy(profile, "GLP-1") && hasTherapy(profile, "DPP-4")) {
    suggestions.push("GLP-1 RA 與 DPP-4 inhibitor 不應併用（機轉重疊、無額外降糖效益），建議停用 DPP-4 inhibitor");
  }
  if (usesRyzodeg || usesPremix) {
    suggestions.push(`預混型胰島素/Ryzodeg 建議依餐別與透析日分開調整：早餐 ${profile?.ryzodegBreakfastDose || "未填"}U 主要對早餐後至午餐前，晚餐 ${profile?.ryzodegDinnerDose || "未填"}U 需同時看晚餐後與夜間低血糖`);
  }
  if (kidney.includes("CKD")) {
    suggestions.push("CKD 病人需依 eGFR 調整用藥，避免藥物蓄積，並把低血糖風險列為第一安全目標");
  }
  if (dialysisSchedule(profile)) {
    suggestions.push(`${DIALYSIS_SCHEDULES[dialysisSchedule(profile)].label}：治療建議需分透析日與非透析日；若透析日低血糖較多，先檢視透析前餐、透析中補食與當日 insulin 劑量（透析日 basal 常需減量）`);
  }
  if (kidney === "PD") {
    suggestions.push("腹膜透析：insulin 配合換液時間調整（高濃度袋當日需求較高），可評估以 icodextrin 取代部分高濃度葡萄糖液；icodextrin 會使 GDH-PQQ 試紙假性偏高，指尖驗證需用相容血糖機");
  }
  if (kidney === "TRANSPLANT") {
    suggestions.push("移植後類固醇型高血糖：以早上 NPH 或白天 prandial 覆蓋午後高峰，類固醇減量時同步減量避免低血糖");
  }
  if (flags.highTar && !flags.hasHypoglycemia && !usesInsulin) {
    suggestions.push("未使用 insulin 且 TAR 偏高：可評估加上或調整 GLP-1 RA、SGLT2 inhibitor（依 eGFR 與心腎共病），仍未達標再考慮 basal insulin");
  } else if (flags.highTar && !flags.hasHypoglycemia) {
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
  const target = resolveTargetProfile(profile);
  const validity = assessValidity(metrics);
  const flags = classifyMetrics(metrics, target);

  return {
    validity,
    targets: TARGETS,
    targetProfile: target,
    targetEvaluation: evaluateTargets(metrics, target),
    priority: decidePriority(flags),
    metricAssessment: flags,
    safetyAlerts: buildSafetyAlerts(profile, metrics, flags, patterns, target),
    possibleCauses: buildPossibleCauses(profile, metrics, flags, patterns),
    dietKeyPoints: buildDietKeyPoints(profile, patterns),
    treatmentSuggestions: buildTreatmentSuggestions(profile, flags, patterns),
    nextDataNeeded: [
      "AGP 圖或 CGM 匯出 CSV",
      "三餐與點心時間、飲食照片或份量紀錄",
      "降糖藥、insulin 劑量與施打/服藥時間",
      "運動、透析日/非透析日、低血糖症狀與處置紀錄",
    ],
  };
}

function formatGoal(row) {
  if (row.direction === "min") return `>${row.goal}%`;
  if (row.direction === "maxInclusive") return `≤${row.goal}%`;
  return `<${row.goal}%`;
}

function generateClinicalReport(input = {}) {
  const analysis = analyzeAgp(input);
  const metrics = input.metrics || {};
  const period = metrics.startDate ? `${metrics.startDate} ~ ${metrics.endDate}，` : "";
  const evaluation = analysis.targetEvaluation
    .map((row) => `${row.label} ${row.actual}%（${formatGoal(row)}）${row.met ? "達標" : "未達標"}`)
    .join("；");
  const lines = [
    "AGP 判讀摘要",
    `資料品質：${analysis.validity.status === "usable" ? "可判讀" : "有限制"}（${period}${value(metrics, "activeDays")} 天、資料完整率 ${value(metrics, "capturePercent")}%）。${analysis.validity.reasons.join("；")}`,
    `核心指標：平均血糖 ${value(metrics, "averageGlucose")} mg/dL、GMI ${value(metrics, "gmi")}%、TIR ${value(metrics, "tir70to180")}%、TBR <70 ${value(metrics, "tbrBelow70")}%、TBR <54 ${value(metrics, "tbrBelow54")}%、TAR >180 ${value(metrics, "tarAbove180")}%、TAR >250 ${value(metrics, "tarAbove250")}%、CV ${value(metrics, "cv")}%。`,
    `目標族群：${analysis.targetProfile.label}。${evaluation}。`,
    `優先處理：${analysis.priority}。`,
    "",
    "安全警訊",
    ...(analysis.safetyAlerts.length ? analysis.safetyAlerts : ["未偵測明顯低血糖或高變異警訊"]).map((item) => `- ${item}`),
    "",
    "可能原因",
    ...analysis.possibleCauses.map((item) => `- ${item}`),
    "",
    "飲食調整關鍵點",
    ...analysis.dietKeyPoints.map((item) => `- ${item}`),
    "",
    "治療建議",
    ...analysis.treatmentSuggestions.map((item) => `- ${item}`),
    "",
    "（規則式臨床輔助，需由醫療人員依病人狀況判斷）",
  ];
  return lines.join("\n");
}

const AgpCore = {
  TARGETS,
  TARGET_PROFILES,
  calculateAgpMetrics,
  detectPatterns,
  analyzeAgp,
  evaluateTargets,
  resolveTargetProfile,
  generateClinicalReport,
  parseLibreCsv,
  parseDateTime,
  lastDays,
};

if (typeof module !== "undefined") {
  module.exports = AgpCore;
}

if (typeof window !== "undefined") {
  window.AgpCore = AgpCore;
}

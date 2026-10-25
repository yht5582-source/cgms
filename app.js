(function () {
  const core = window.AgpCore;
  let allReadings = [];
  let currentReadings = [];
  let currentMetrics = null;
  let currentPatterns = {};
  let currentAnalysis = null;
  let currentReport = "";
  let sourceLabel = "";

  const $ = (id) => document.getElementById(id);

  function profileFromForm() {
    const therapy = [...document.querySelectorAll("input[name='therapy']:checked")].map((item) => item.value);
    const notes = $("therapyNotes").value.trim();
    if (notes) therapy.push(notes);
    return {
      diabetesType: $("diabetesType").value,
      targetGroup: $("targetGroup").value,
      kidneyContext: $("kidneyContext").value,
      hba1c: Number($("hba1c").value || 0),
      therapy,
      ryzodegBreakfastDose: Number($("ryzodegBreakfastDose").value || 0),
      ryzodegDinnerDose: Number($("ryzodegDinnerDose").value || 0),
      lifestyleNotes: $("lifestyleNotes").value.trim(),
    };
  }

  function mealTimesFromForm() {
    return {
      breakfast: $("breakfastTime").value || "07:30",
      lunch: $("lunchTime").value || "12:00",
      dinner: $("dinnerTime").value || "18:00",
    };
  }

  function isPregnancyTarget() {
    return core.resolveTargetProfile(profileFromForm()).key === "pregnancy";
  }

  function num(id) {
    const parsed = Number($(id).value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function manualMetricsFromForm() {
    const metrics = {
      activeDays: num("manualActiveDays"),
      capturePercent: num("manualCapture"),
      averageGlucose: num("manualAverage"),
      gmi: num("manualGmi"),
      tir70to180: num("manualTir"),
      tbrBelow70: num("manualTbr70"),
      tbrBelow54: num("manualTbr54"),
      tarAbove180: num("manualTar180"),
      tarAbove250: num("manualTar250"),
      cv: num("manualCv"),
      totalReadings: 0,
      dailySummary: [],
      hourlySummary: core.calculateAgpMetrics([]).hourlySummary,
      timeWindows: {},
    };
    // 懷孕目標時手動欄位代表 63-140 / <63 / >140。
    if (isPregnancyTarget()) {
      metrics.tirPregnancy = metrics.tir70to180;
      metrics.tbrBelow63 = metrics.tbrBelow70;
      metrics.tarAbove140 = metrics.tarAbove180;
    }
    return metrics;
  }

  function syncManualInputs(metrics) {
    const pregnancy = isPregnancyTarget();
    $("manualActiveDays").value = metrics.activeDays || 0;
    $("manualCapture").value = metrics.capturePercent || 0;
    $("manualAverage").value = metrics.averageGlucose || 0;
    $("manualGmi").value = metrics.gmi || 0;
    $("manualTir").value = (pregnancy ? metrics.tirPregnancy : metrics.tir70to180) || 0;
    $("manualTbr70").value = (pregnancy ? metrics.tbrBelow63 : metrics.tbrBelow70) || 0;
    $("manualTbr54").value = metrics.tbrBelow54 || 0;
    $("manualTar180").value = (pregnancy ? metrics.tarAbove140 : metrics.tarAbove180) || 0;
    $("manualTar250").value = metrics.tarAbove250 || 0;
    $("manualCv").value = metrics.cv || 0;
  }

  function updateManualLabels() {
    const pregnancy = isPregnancyTarget();
    $("lblTir").textContent = pregnancy ? "TIR 63-140 %" : "TIR 70-180 %";
    $("lblTbr70").textContent = pregnancy ? "TBR <63 %" : "TBR <70 %";
    $("lblTar180").textContent = pregnancy ? "TAR >140 %" : "TAR >180 %";
  }

  function manualPatterns() {
    // 手動模式沒有時段資料，只保留透析背景標籤。
    const patterns = core.detectPatterns([], mealTimesFromForm(), profileFromForm());
    Object.keys(patterns).forEach((key) => {
      if (patterns[key] === true) patterns[key] = false;
    });
    patterns.dialysisDaySummary = null;
    patterns.meals = null;
    return patterns;
  }

  function analyze(metrics, patterns, readings) {
    const profile = profileFromForm();
    currentMetrics = metrics;
    currentPatterns = patterns;
    currentAnalysis = core.analyzeAgp({ profile, metrics, patterns });
    currentReport = core.generateClinicalReport({ profile, metrics, patterns });
    render(readings || []);
  }

  function windowedReadings() {
    return core.lastDays(allReadings, Number($("analysisDays").value || 0));
  }

  function analyzeCsv() {
    currentReadings = windowedReadings();
    const metrics = core.calculateAgpMetrics(currentReadings);
    const patterns = core.detectPatterns(currentReadings, mealTimesFromForm(), profileFromForm());
    syncManualInputs(metrics);
    analyze(metrics, patterns, currentReadings);
    return metrics;
  }

  function refresh() {
    updateManualLabels();
    if (allReadings.length) {
      // metrics 不受表單影響，只需重算 patterns。
      const patterns = core.detectPatterns(currentReadings, mealTimesFromForm(), profileFromForm());
      analyze(currentMetrics, patterns, currentReadings);
    } else {
      analyze(manualMetricsFromForm(), manualPatterns(), []);
    }
  }

  function setStatus(message, isError) {
    $("fileStatus").textContent = message;
    $("fileStatus").classList.toggle("error", Boolean(isError));
  }

  function describeImport(metrics) {
    const meta = allReadings.meta || {};
    const parts = [`${sourceLabel}：已匯入 ${currentReadings.length} 筆 glucose readings，資料日期 ${metrics.activeDays} 天（${metrics.startDate} ~ ${metrics.endDate}）`];
    if (allReadings.length > currentReadings.length) parts.push(`檔案共 ${allReadings.length} 筆，依分析期間取最近資料`);
    if (meta.unit === "mmol/L") parts.push("mmol/L 已換算為 mg/dL");
    if (meta.scanSkipped) parts.push(`${meta.scanSkipped} 筆掃描值與 historic 紀錄重疊，未重複計入`);
    return `${parts.join("；")}。`;
  }

  async function handleCsvText(csvText, label) {
    try {
      const readings = core.parseLibreCsv(csvText);
      allReadings = readings;
      sourceLabel = label;
      const metrics = analyzeCsv();
      setStatus(describeImport(metrics), false);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function renderList(id, items, emptyText) {
    const list = $(id);
    list.innerHTML = "";
    const source = items && items.length ? items : [emptyText];
    source.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
  }

  function kidneyContextLabel(value) {
    const option = [...$("kidneyContext").options].find((item) => item.value === value);
    return option && value ? option.textContent : "";
  }

  function renderSummary(metrics) {
    const evaluation = Object.fromEntries(currentAnalysis.targetEvaluation.map((row) => [row.key, row]));
    const pregnancy = currentAnalysis.targetProfile.key === "pregnancy";
    const card = (label, key, unitNote) => {
      const row = evaluation[key];
      const actual = row ? row.actual : metrics[key] ?? 0;
      const state = row ? (row.met ? "met" : "unmet") : "";
      const goal = row ? ` · 目標 ${row.direction === "min" ? ">" : row.direction === "maxInclusive" ? "≤" : "<"}${row.goal}%` : "";
      return { label, value: `${actual}%`, note: `${unitNote}${goal}`, state };
    };
    const cards = [
      pregnancy ? card("TIR", "tirPregnancy", "63-140") : card("TIR", "tir70to180", "70-180"),
      pregnancy ? card("TBR", "tbrBelow63", "<63") : card("TBR", "tbrBelow70", "<70"),
      card("TBR <54", "tbrBelow54", "Level 2"),
      pregnancy ? card("TAR", "tarAbove140", ">140") : card("TAR", "tarAbove180", ">180"),
      card("CV", "cv", "變異係數"),
      { label: "平均 / GMI", value: `${metrics.averageGlucose || 0} · ${metrics.gmi || 0}%`, note: "mg/dL · GMI", state: "" },
      {
        label: "HD/CKD",
        value: currentPatterns?.dialysisScheduleLabel || kidneyContextLabel(profileFromForm().kidneyContext) || "未指定",
        note: currentPatterns?.dialysisDaySummary ? "已分透析日" : "背景",
        state: "context",
      },
    ];
    const host = $("summaryCards");
    host.innerHTML = "";
    cards.forEach((item) => {
      const article = document.createElement("article");
      article.className = `metric-card ${item.state === "context" ? "context-card" : item.state}`;
      ["span", "strong", "span"].forEach((tag, index) => {
        const el = document.createElement(tag);
        el.textContent = [item.label, item.value, item.note][index];
        article.appendChild(el);
      });
      host.appendChild(article);
    });
  }

  function svgEl(name, attrs = {}, text) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function makeSvg(width, height, label) {
    return svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label, preserveAspectRatio: "xMidYMid meet" });
  }

  function targetRange() {
    return currentAnalysis?.targetProfile?.range || [70, 180];
  }

  function drawGrid(svg, { y, left, right, lines }) {
    const [low, high] = targetRange();
    svg.appendChild(svgEl("rect", { x: left, y: y(high), width: right - left, height: y(low) - y(high), fill: "#e7f5ee" }));
    lines.forEach((line) => {
      svg.appendChild(svgEl("line", { x1: left, x2: right, y1: y(line), y2: y(line), stroke: line === low || line === high ? "#16794c" : "#9aa9b4", "stroke-dasharray": "4 5", "stroke-width": line === low || line === high ? 1.2 : 1 }));
      svg.appendChild(svgEl("text", { x: left - 6, y: y(line) + 4, fill: "#64727f", "font-size": "12", "text-anchor": "end" }, line));
    });
  }

  function renderTrend(readings) {
    const host = $("trendChart");
    if (!readings.length) {
      host.className = "chart empty";
      host.textContent = "手動指標模式無 glucose trend，請上傳 CSV。";
      return;
    }
    host.className = "chart";
    host.innerHTML = "";
    const width = 900;
    const height = 280;
    const left = 40;
    const right = width - 12;
    const top = 12;
    const bottom = height - 28;
    const svg = makeSvg(width, height, "glucose trend");
    const minTime = readings[0].timestamp.getTime();
    const maxTime = readings[readings.length - 1].timestamp.getTime();
    const minG = 40;
    const peak = readings.reduce((max, item) => Math.max(max, item.glucoseMgDl), 0);
    const maxG = Math.max(320, Math.ceil(peak / 40) * 40);
    const x = (time) => left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (right - left);
    const y = (glucose) => bottom - ((Math.max(minG, glucose) - minG) / (maxG - minG)) * (bottom - top);
    const [low, high] = targetRange();
    drawGrid(svg, { y, left, right, lines: [...new Set([54, low, high, 250])].sort((a, b) => a - b) });

    // 每日分隔線與日期刻度（天數多時每隔數天標一次）。
    const dayStart = new Date(minTime);
    dayStart.setHours(0, 0, 0, 0);
    const days = Math.ceil((maxTime - dayStart.getTime()) / 86400000);
    const step = Math.max(1, Math.ceil(days / 14));
    for (let d = 1; d <= days; d += 1) {
      const t = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + d).getTime();
      if (t > maxTime) break;
      svg.appendChild(svgEl("line", { x1: x(t), x2: x(t), y1: top, y2: bottom, stroke: "#eef1f4" }));
      if (d % step === 0) {
        const date = new Date(t);
        svg.appendChild(svgEl("text", { x: x(t), y: height - 8, fill: "#64727f", "font-size": "11", "text-anchor": "middle" }, `${date.getMonth() + 1}/${date.getDate()}`));
      }
    }

    // 超過 2 小時沒有讀值時斷線，避免把感測器空窗畫成連續曲線。
    const gapMs = 2 * 60 * 60 * 1000;
    let path = "";
    readings.forEach((reading, index) => {
      const time = reading.timestamp.getTime();
      const move = !index || time - readings[index - 1].timestamp.getTime() > gapMs;
      path += `${move ? "M" : "L"}${x(time).toFixed(1)} ${y(reading.glucoseMgDl).toFixed(1)} `;
    });
    svg.appendChild(svgEl("path", { d: path, fill: "none", stroke: "#177e89", "stroke-width": readings.length > 3000 ? "1.2" : "2", "stroke-linejoin": "round" }));
    host.appendChild(svg);
  }

  function renderAgp(metrics) {
    const host = $("agpChart");
    const points = (metrics.hourlySummary || []).filter((item) => item.median !== null);
    if (!points.length) {
      host.className = "chart empty";
      host.textContent = "CSV 匯入後顯示 24 小時 AGP percentile band。";
      return;
    }
    host.className = "chart";
    host.innerHTML = "";
    const width = 620;
    const height = 270;
    const left = 40;
    const right = width - 22;
    const top = 12;
    const bottom = height - 30;
    const peak = points.reduce((max, item) => Math.max(max, item.p95 ?? item.p90), 0);
    const maxG = Math.max(300, Math.ceil(peak / 50) * 50);
    const minG = 40;
    const x = (hour) => left + (hour / 24) * (right - left);
    const y = (glucose) => bottom - ((Math.max(minG, Math.min(maxG, glucose)) - minG) / (maxG - minG)) * (bottom - top);
    const svg = makeSvg(width, height, "AGP percentile");
    const [low, high] = targetRange();
    drawGrid(svg, { y, left, right, lines: [...new Set([54, low, high, 250])].sort((a, b) => a - b) });

    // 每小時分位數畫在該小時中點，並在 0 與 24 點以首尾值延伸。
    const sample = [
      { ...points[points.length - 1], at: 0 },
      ...points.map((item) => ({ ...item, at: item.hour + 0.5 })),
      { ...points[0], at: 24 },
    ];
    const hasFullDay = points.length === 24;
    const series = hasFullDay ? sample : points.map((item) => ({ ...item, at: item.hour + 0.5 }));
    const band = (lowKey, highKey) => [
      ...series.map((item) => `${x(item.at).toFixed(1)},${y(item[lowKey]).toFixed(1)}`),
      ...series.slice().reverse().map((item) => `${x(item.at).toFixed(1)},${y(item[highKey]).toFixed(1)}`),
    ].join(" ");
    svg.appendChild(svgEl("polygon", { points: band("p5", "p95"), fill: "#e1eff2" }));
    svg.appendChild(svgEl("polygon", { points: band("p25", "p75"), fill: "#8fc3cc" }));
    const median = series.map((item, index) => `${index ? "L" : "M"}${x(item.at).toFixed(1)} ${y(item.median).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { d: median, fill: "none", stroke: "#0f5f67", "stroke-width": "3", "stroke-linejoin": "round" }));
    [0, 3, 6, 9, 12, 15, 18, 21, 24].forEach((hour) => {
      svg.appendChild(svgEl("text", { x: x(hour), y: height - 10, fill: "#64727f", "font-size": "12", "text-anchor": "middle" }, `${String(hour).padStart(2, "0")}:00`));
    });
    const legend = svgEl("text", { x: right, y: top + 10, fill: "#64727f", "font-size": "11", "text-anchor": "end" }, "中位數 · 25-75% · 5-95%");
    svg.appendChild(legend);
    host.appendChild(svg);
  }

  function renderRange(metrics) {
    const pregnancy = currentAnalysis.targetProfile.key === "pregnancy";
    const rows = pregnancy
      ? [
          ["Very high", ">250", metrics.tarAbove250 || 0, "very-high"],
          ["High", ">140", Math.max(0, (metrics.tarAbove140 ?? metrics.tarAbove180 ?? 0) - (metrics.tarAbove250 || 0)), "high"],
          ["Target", "63-140", metrics.tirPregnancy ?? metrics.tir70to180 ?? 0, "target"],
          ["Low", "54-62", Math.max(0, (metrics.tbrBelow63 ?? metrics.tbrBelow70 ?? 0) - (metrics.tbrBelow54 || 0)), "low"],
          ["Very low", "<54", metrics.tbrBelow54 || 0, "very-low"],
        ]
      : [
          ["Very high", ">250", metrics.tarAbove250 || 0, "very-high"],
          ["High", "181-250", Math.max(0, (metrics.tarAbove180 || 0) - (metrics.tarAbove250 || 0)), "high"],
          ["Target", "70-180", metrics.tir70to180 || 0, "target"],
          ["Low", "54-69", Math.max(0, (metrics.tbrBelow70 || 0) - (metrics.tbrBelow54 || 0)), "low"],
          ["Very low", "<54", metrics.tbrBelow54 || 0, "very-low"],
        ];
    const host = $("rangeChart");
    host.innerHTML = "";
    const stack = document.createElement("div");
    stack.className = "range-stack";
    stack.setAttribute("aria-hidden", "true");
    rows.forEach(([, , value, cls]) => {
      const seg = document.createElement("div");
      seg.className = `seg ${cls}`;
      seg.style.flexGrow = Math.max(0, value);
      stack.appendChild(seg);
    });
    const list = document.createElement("div");
    list.className = "range-list";
    rows.forEach(([label, range, value, cls]) => {
      const row = document.createElement("div");
      row.className = "range-row";
      row.innerHTML = `<i class="swatch ${cls}"></i><strong></strong><span class="range-label"></span><span class="range-value"></span>`;
      row.querySelector("strong").textContent = label;
      row.querySelector(".range-label").textContent = `${range} mg/dL`;
      row.querySelector(".range-value").textContent = `${Math.round(value * 10) / 10}%`;
      list.appendChild(row);
    });
    host.append(stack, list);
    $("targetLabel").textContent = currentAnalysis.targetProfile.label;
  }

  function updateDialysisRail() {
    const value = $("kidneyContext").value;
    const activeDays = value === "HD_MWF" ? ["1", "3", "5"] : value === "HD_TTS" ? ["2", "4", "6"] : [];
    $("dialysisRail").hidden = !value.startsWith("HD");
    document.querySelectorAll("#dialysisRail span").forEach((item) => {
      item.classList.toggle("active", activeDays.includes(item.dataset.day));
      item.classList.toggle("muted-day", activeDays.length === 0);
    });
  }

  function updateDoseGrid() {
    const premix = document.querySelector("input[name='therapy'][value='Ryzodeg']").checked
      || document.querySelector("input[name='therapy'][value='premixed insulin']").checked;
    $("doseGrid").hidden = !premix;
  }

  function render(readings) {
    if (!currentMetrics || !currentAnalysis) return;
    renderSummary(currentMetrics);
    renderTrend(readings);
    renderAgp(currentMetrics);
    renderRange(currentMetrics);
    $("readingCount").textContent = readings.length ? `${readings.length} 筆 readings · 每 ${currentMetrics.intervalMinutes} 分` : "手動 AGP 指標";
    $("priorityText").textContent = currentAnalysis.priority;
    const target = currentAnalysis.targetProfile;
    $("targetNote").textContent = `目前目標：${target.label}${$("targetGroup").value ? "" : "（自動）"}${target.key === "pregnancy" && !/type 1/i.test($("diabetesType").value) ? "；T2/GDM 懷孕的 CGM 目標證據有限，供參考" : ""}`;
    renderList("safetyList", currentAnalysis.safetyAlerts, "未偵測明顯低血糖或高變異警訊。");
    renderList("causeList", currentAnalysis.possibleCauses, "請補上餐食、用藥與 CGM 時段型態以強化原因判讀。");
    renderList("dietList", currentAnalysis.dietKeyPoints, "請補上三餐照片與點心時間。");
    renderList("treatmentList", currentAnalysis.treatmentSuggestions, "目前以追蹤與生活型態調整為主。");
    $("reportText").value = currentReport;
    updateDialysisRail();
    updateDoseGrid();
  }

  async function trySharedCsv() {
    if (!new URLSearchParams(location.search).has("shared")) return;
    history.replaceState(null, "", location.pathname);
    try {
      // 讀取後立即刪除，避免病人資料長期留在 Cache Storage。
      const cache = await caches.open("cgms-share-cache");
      const response = await cache.match("shared-cgm.csv");
      await cache.delete("shared-cgm.csv");
      if (response && response.ok) {
        await handleCsvText(await response.text(), "手機分享匯入");
      } else {
        setStatus("沒有收到可解析的分享檔案，請改用上傳 CSV。", true);
      }
    } catch (error) {
      setStatus("沒有收到可解析的分享檔案，請改用上傳 CSV。", true);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = $("reportText");
      area.focus();
      area.select();
      return document.execCommand && document.execCommand("copy");
    }
  }

  $("csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await handleCsvText(await file.text(), file.name);
    event.target.value = "";
  });

  const drop = $("fileDrop");
  ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("dragging")));
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) await handleCsvText(await file.text(), file.name);
  });

  $("analysisDays").addEventListener("change", () => {
    if (!allReadings.length) return;
    const metrics = analyzeCsv();
    setStatus(describeImport(metrics), false);
  });

  $("useManual").addEventListener("click", () => {
    allReadings = [];
    currentReadings = [];
    analyze(manualMetricsFromForm(), manualPatterns(), []);
    setStatus("已使用手動 AGP 指標分析（無時段型態，原因判讀較有限）。", false);
  });

  $("manualAverage").addEventListener("input", () => {
    const average = Number($("manualAverage").value);
    if (average > 0) $("manualGmi").value = Math.round((3.31 + 0.02392 * average) * 10) / 10;
  });

  ["diabetesType", "targetGroup", "kidneyContext", "hba1c", "ryzodegBreakfastDose", "ryzodegDinnerDose", "therapyNotes", "lifestyleNotes", "breakfastTime", "lunchTime", "dinnerTime"].forEach((id) => {
    $(id).addEventListener("input", refresh);
  });
  ["diabetesType", "targetGroup"].forEach((id) => {
    $(id).addEventListener("change", () => {
      if (allReadings.length) syncManualInputs(currentMetrics);
    });
  });

  document.querySelectorAll("input[name='therapy']").forEach((item) => {
    item.addEventListener("change", refresh);
  });

  $("copyReport").addEventListener("click", async () => {
    const ok = await copyText($("reportText").value);
    $("copyReport").textContent = ok ? "Copied" : "請手動複製";
    setTimeout(() => {
      $("copyReport").textContent = "Copy";
    }, 1500);
  });

  $("downloadJson").addEventListener("click", () => {
    const { lifestyleNotes, ...profile } = profileFromForm();
    const payload = {
      tool: "CGMS / AGP 判讀工作台 v2.0",
      metrics: { ...currentMetrics, dailySummary: undefined, startDate: undefined, endDate: undefined },
      patterns: currentPatterns,
      analysis: currentAnalysis,
      profile: { ...profile, therapy: profile.therapy.filter((item) => item !== $("therapyNotes").value.trim()) },
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "agp-anonymous-summary.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  updateManualLabels();
  analyze(manualMetricsFromForm(), manualPatterns(), []);
  trySharedCsv();
})();

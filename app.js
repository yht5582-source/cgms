(function () {
  const core = window.AgpCore;
  let currentReadings = [];
  let currentMetrics = null;
  let currentPatterns = {};
  let currentAnalysis = null;
  let currentReport = "";

  const $ = (id) => document.getElementById(id);

  function profileFromForm() {
    const therapy = [...document.querySelectorAll("input[name='therapy']:checked")].map((item) => item.value);
    const notes = $("therapyNotes").value.trim();
    if (notes) therapy.push(notes);
    return {
      diabetesType: $("diabetesType").value,
      kidneyContext: $("kidneyContext").value,
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

  function manualMetricsFromForm() {
    return {
      activeDays: Number($("manualActiveDays").value || 0),
      capturePercent: Number($("manualCapture").value || 0),
      averageGlucose: Number($("manualAverage").value || 0),
      gmi: Number($("manualGmi").value || 0),
      tir70to180: Number($("manualTir").value || 0),
      tbrBelow70: Number($("manualTbr70").value || 0),
      tbrBelow54: Number($("manualTbr54").value || 0),
      tarAbove180: Number($("manualTar180").value || 0),
      tarAbove250: Number($("manualTar250").value || 0),
      cv: Number($("manualCv").value || 0),
      totalReadings: 0,
      dailySummary: [],
      hourlySummary: Array.from({ length: 24 }, (_, hour) => ({ hour, median: null, p10: null, p25: null, p75: null, p90: null })),
      timeWindows: {},
    };
  }

  function syncManualInputs(metrics) {
    $("manualActiveDays").value = metrics.activeDays || 0;
    $("manualCapture").value = metrics.capturePercent || 0;
    $("manualAverage").value = metrics.averageGlucose || 0;
    $("manualGmi").value = metrics.gmi || 0;
    $("manualTir").value = metrics.tir70to180 || 0;
    $("manualTbr70").value = metrics.tbrBelow70 || 0;
    $("manualTbr54").value = metrics.tbrBelow54 || 0;
    $("manualTar180").value = metrics.tarAbove180 || 0;
    $("manualTar250").value = metrics.tarAbove250 || 0;
    $("manualCv").value = metrics.cv || 0;
  }

  function analyze(metrics, patterns, readings) {
    currentMetrics = metrics;
    currentPatterns = patterns;
    currentAnalysis = core.analyzeAgp({
      profile: profileFromForm(),
      metrics,
      patterns,
    });
    currentReport = core.generateClinicalReport({
      profile: profileFromForm(),
      metrics,
      patterns,
    });
    render(readings || []);
  }

  function setStatus(message, isError) {
    $("fileStatus").textContent = message;
    $("fileStatus").style.color = isError ? "#b91c1c" : "";
  }

  async function handleCsvText(csvText, sourceLabel) {
    try {
      currentReadings = core.parseLibreCsv(csvText);
      const metrics = core.calculateAgpMetrics(currentReadings);
      const patterns = core.detectPatterns(currentReadings, mealTimesFromForm(), profileFromForm());
      syncManualInputs(metrics);
      analyze(metrics, patterns, currentReadings);
      setStatus(`${sourceLabel}：已匯入 ${currentReadings.length} 筆 glucose readings，資料日期 ${metrics.activeDays} 天。`, false);
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

  function renderSummary(metrics) {
    const dialysisLabel = currentPatterns?.dialysisScheduleLabel || kidneyContextLabel(profileFromForm().kidneyContext);
    const cards = [
      ["TIR", `${metrics.tir70to180 ?? 0}%`, "70-180 mg/dL"],
      ["TBR", `${metrics.tbrBelow70 ?? 0}%`, "<70 mg/dL"],
      ["TAR", `${metrics.tarAbove180 ?? 0}%`, ">180 mg/dL"],
      ["CV", `${metrics.cv ?? 0}%`, "變異係數"],
      ["HD/CKD", dialysisLabel || "未指定", currentPatterns?.dialysisDaySummary ? "已分透析日" : "背景"],
    ];
    $("summaryCards").innerHTML = cards
      .map(([label, value, note]) => `<article class="metric-card ${label === "HD/CKD" ? "context-card" : ""}"><span>${label}</span><strong>${value}</strong><span>${note}</span></article>`)
      .join("");
  }

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function makeSvg(width, height) {
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
    return svg;
  }

  function renderTrend(readings) {
    const host = $("trendChart");
    if (!readings.length) {
      host.className = "chart empty";
      host.textContent = "手動指標模式無 glucose trend。";
      return;
    }
    host.className = "chart";
    host.innerHTML = "";
    const width = 900;
    const height = 280;
    const pad = 36;
    const svg = makeSvg(width, height);
    const minTime = readings[0].timestamp.getTime();
    const maxTime = readings[readings.length - 1].timestamp.getTime();
    const minG = 40;
    const maxG = Math.max(320, ...readings.map((item) => item.glucoseMgDl));
    const x = (time) => pad + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad * 2);
    const y = (glucose) => height - pad - ((glucose - minG) / (maxG - minG)) * (height - pad * 2);

    svg.appendChild(svgEl("rect", { x: pad, y: y(180), width: width - pad * 2, height: y(70) - y(180), fill: "#e7f5ee" }));
    [70, 180, 250].forEach((line) => {
      svg.appendChild(svgEl("line", { x1: pad, x2: width - pad, y1: y(line), y2: y(line), stroke: "#9aa9b4", "stroke-dasharray": "4 5" }));
      const text = svgEl("text", { x: 6, y: y(line) + 4, fill: "#64727f", "font-size": "12" });
      text.textContent = line;
      svg.appendChild(text);
    });

    const path = readings
      .map((reading, index) => `${index ? "L" : "M"} ${x(reading.timestamp.getTime()).toFixed(1)} ${y(reading.glucoseMgDl).toFixed(1)}`)
      .join(" ");
    svg.appendChild(svgEl("path", { d: path, fill: "none", stroke: "#177e89", "stroke-width": "2.4" }));
    host.appendChild(svg);
  }

  function renderAgp(metrics) {
    const host = $("agpChart");
    if (!metrics.hourlySummary || !metrics.hourlySummary.some((item) => item.median !== null)) {
      host.className = "chart empty";
      host.textContent = "CSV 匯入後顯示 24 小時 AGP percentile band。";
      return;
    }
    host.className = "chart";
    host.innerHTML = "";
    const width = 620;
    const height = 260;
    const pad = 34;
    const maxG = 320;
    const minG = 40;
    const x = (hour) => pad + (hour / 23) * (width - pad * 2);
    const y = (glucose) => height - pad - ((glucose - minG) / (maxG - minG)) * (height - pad * 2);
    const svg = makeSvg(width, height);
    svg.appendChild(svgEl("rect", { x: pad, y: y(180), width: width - pad * 2, height: y(70) - y(180), fill: "#e7f5ee" }));

    const points = metrics.hourlySummary.filter((item) => item.median !== null);
    const band90 = [
      ...points.map((item) => `${x(item.hour)},${y(item.p10)}`),
      ...points.slice().reverse().map((item) => `${x(item.hour)},${y(item.p90)}`),
    ].join(" ");
    const band50 = [
      ...points.map((item) => `${x(item.hour)},${y(item.p25)}`),
      ...points.slice().reverse().map((item) => `${x(item.hour)},${y(item.p75)}`),
    ].join(" ");
    svg.appendChild(svgEl("polygon", { points: band90, fill: "#cfe6eb" }));
    svg.appendChild(svgEl("polygon", { points: band50, fill: "#7db7c1" }));
    const median = points.map((item, index) => `${index ? "L" : "M"} ${x(item.hour)} ${y(item.median)}`).join(" ");
    svg.appendChild(svgEl("path", { d: median, fill: "none", stroke: "#0f5f67", "stroke-width": "3" }));
    [0, 6, 12, 18, 23].forEach((hour) => {
      const text = svgEl("text", { x: x(hour) - 8, y: height - 8, fill: "#64727f", "font-size": "12" });
      text.textContent = `${hour}`;
      svg.appendChild(text);
    });
    host.appendChild(svg);
  }

  function renderRange(metrics) {
    const rows = [
      ["TBR", metrics.tbrBelow70 || 0, "low"],
      ["TIR", metrics.tir70to180 || 0, "target"],
      ["TAR", metrics.tarAbove180 || 0, "high"],
    ];
    $("rangeChart").innerHTML = rows
      .map(([label, value, cls]) => `<div class="range-row"><strong>${label}</strong><div class="range-track"><div class="range-fill ${cls}" style="width:${Math.min(100, value)}%"></div></div><span>${value}%</span></div>`)
      .join("");
  }

  function kidneyContextLabel(value) {
    const option = [...$("kidneyContext").options].find((item) => item.value === value);
    return option ? option.textContent : "";
  }

  function updateDialysisRail() {
    const value = $("kidneyContext").value;
    const activeDays = value === "HD_MWF" ? ["1", "3", "5"] : value === "HD_TTS" ? ["2", "4", "6"] : [];
    document.querySelectorAll("#dialysisRail span").forEach((item) => {
      item.classList.toggle("active", activeDays.includes(item.dataset.day));
      item.classList.toggle("muted-day", activeDays.length === 0);
    });
  }

  function render(readings) {
    if (!currentMetrics || !currentAnalysis) return;
    renderSummary(currentMetrics);
    renderTrend(readings);
    renderAgp(currentMetrics);
    renderRange(currentMetrics);
    $("readingCount").textContent = readings.length ? `${readings.length} 筆 readings` : "手動 AGP 指標";
    $("priorityText").textContent = currentAnalysis.priority;
    renderList("safetyList", currentAnalysis.safetyAlerts, "未偵測明顯低血糖或高變異警訊。");
    renderList("causeList", currentAnalysis.possibleCauses, "請補上餐食、用藥與 CGM 時段型態以強化原因判讀。");
    renderList("dietList", currentAnalysis.dietKeyPoints, "請補上三餐照片與點心時間。");
    renderList("treatmentList", currentAnalysis.treatmentSuggestions, "目前以追蹤與生活型態調整為主。");
    $("reportText").value = currentReport;
    updateDialysisRail();
  }

  async function trySharedCsv() {
    if (!location.search.includes("shared=1")) return;
    try {
      const response = await fetch("shared-cgm.csv", { cache: "no-store" });
      if (response.ok) {
        await handleCsvText(await response.text(), "手機分享匯入");
      }
    } catch (error) {
      setStatus("沒有收到可解析的分享檔案，請改用上傳 CSV。", true);
    }
  }

  $("csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await handleCsvText(await file.text(), file.name);
  });

  $("useManual").addEventListener("click", () => {
    currentReadings = [];
    analyze(manualMetricsFromForm(), currentPatterns, []);
    setStatus("已使用手動 AGP 指標分析。", false);
  });

  ["diabetesType", "kidneyContext", "ryzodegBreakfastDose", "ryzodegDinnerDose", "therapyNotes", "lifestyleNotes", "breakfastTime", "lunchTime", "dinnerTime"].forEach((id) => {
    $(id).addEventListener("input", () => {
      if (currentReadings.length) {
        analyze(core.calculateAgpMetrics(currentReadings), core.detectPatterns(currentReadings, mealTimesFromForm(), profileFromForm()), currentReadings);
      } else if (currentMetrics) {
        analyze(currentMetrics, currentPatterns, []);
      }
    });
  });

  document.querySelectorAll("input[name='therapy']").forEach((item) => {
    item.addEventListener("change", () => {
      if (currentMetrics) analyze(currentMetrics, currentPatterns, currentReadings);
    });
  });

  $("copyReport").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("reportText").value);
    $("copyReport").textContent = "Copied";
    setTimeout(() => {
      $("copyReport").textContent = "Copy";
    }, 1200);
  });

  $("downloadJson").addEventListener("click", () => {
    const payload = {
      metrics: currentMetrics,
      patterns: currentPatterns,
      analysis: currentAnalysis,
      profile: profileFromForm(),
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "agp-anonymous-summary.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  analyze(manualMetricsFromForm(), {}, []);
  updateDialysisRail();
  trySharedCsv();
})();

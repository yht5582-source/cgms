const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("/Users/YHTseng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const root = __dirname;
const sampleCsv = `Device Timestamp,Historic Glucose mg/dL,Scan Glucose mg/dL
2026-07-01 00:00,62,
2026-07-01 03:00,68,
2026-07-01 07:00,102,
2026-07-01 09:00,225,
2026-07-01 12:00,142,
2026-07-01 14:00,188,
2026-07-01 18:00,156,
2026-07-01 20:00,261,
2026-07-01 23:00,214,
2026-07-02 00:00,72,
2026-07-02 03:00,61,
2026-07-02 07:00,112,
2026-07-02 09:00,,238,
2026-07-02 12:00,148,
2026-07-02 14:00,176,
2026-07-02 18:00,154,
2026-07-02 20:00,252,
2026-07-02 23:00,202,`;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const safePath = path.normalize(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.join(root, safePath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

(async () => {
  const targetUrl = process.env.TARGET_URL;
  const localServer = targetUrl ? null : await startServer();
  const url = targetUrl || localServer.url;
  const csvPath = path.join(os.tmpdir(), `libreview-smoke-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, sampleCsv);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await assert.doesNotReject(page.locator("#priorityText").waitFor({ timeout: 3000 }));
    assert.match(await page.locator("#priorityText").innerText(), /維持|先/);
    await page.selectOption("#kidneyContext", "HD_MWF");
    await page.locator("input[name='therapy'][value='Ryzodeg']").check();
    await page.locator("#ryzodegBreakfastDose").fill("18");
    await page.locator("#ryzodegDinnerDose").fill("10");
    await page.locator("#csvFile").setInputFiles(csvPath);
    await page.waitForFunction(() => document.querySelector("#readingCount")?.textContent.includes("18 筆"));
    assert.match(await page.locator("#fileStatus").innerText(), /已匯入 18 筆/);
    assert.match(await page.locator("#reportText").inputValue(), /AGP 判讀摘要/);
    assert.match(await page.locator("#reportText").inputValue(), /Ryzodeg/);
    assert.match(await page.locator("#reportText").inputValue(), /透析日/);
    assert.match(await page.locator("#priorityText").innerText(), /低血糖/);
    assert.equal(await page.locator("#dialysisRail span.active").count(), 3);
    assert.ok(await page.locator("#trendChart svg").count());
    assert.ok(await page.locator("#agpChart svg").count());

    await page.setViewportSize({ width: 390, height: 860 });
    await page.waitForTimeout(100);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    assert.ok(bodyWidth <= 430, `mobile layout overflowed: ${bodyWidth}`);
  } finally {
    await browser.close();
    if (localServer) localServer.server.close();
    fs.rmSync(csvPath, { force: true });
  }
})();

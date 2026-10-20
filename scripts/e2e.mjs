// End-to-end check of the published site in the bundled Chromium: serves docs/,
// opens the page, starts a round and waits for it to end.
//   node scripts/e2e.mjs [--rounds=1] [--screenshot=out.png] [--keep]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");
const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const rounds = Number(opt("rounds", "1"));
const screenshot = opt("screenshot", "");
const seed = opt("seed", "");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".py": "text/plain", ".json": "application/json", ".ort": "application/octet-stream", ".wrp": "application/octet-stream", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(docs, url === "/" ? "index.html" : url);
  if (!file.startsWith(docs) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const executablePath = fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
page.on("console", (m) => {
  if (m.text().startsWith("[curvycook]")) console.log("  " + m.text());
  else if (m.type() === "error" || m.type() === "warning") errors.push(`console ${m.type()}: ${m.text()}`);
});
page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
});

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/${seed ? `?seed=${seed}` : ""}`, { waitUntil: "load" });
await page.waitForSelector("#waiting.ready", { timeout: 120000 });
console.log(`ready after ${((Date.now() - t0) / 1000).toFixed(1)}s (runtime + model loaded)`);
console.log("players:", await page.$$eval("#player-list .player-name, #player-list .name, #player-list", (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, " ")).join(" | ")));
for (let round = 1; round <= rounds; round++) {
  const t1 = Date.now();
  await page.keyboard.press("s");
  try {
    await page.waitForSelector("#end:not(.hidden)", { timeout: 120000 });
  } catch (e) {
    const msg = await page.$eval("#msg", (el) => el.textContent.trim()).catch(() => "?");
    const result = await page.$eval("#result", (el) => el.textContent.trim()).catch(() => "?");
    console.log(`round ${round}: did not end within 120s; #msg="${msg}" #result="${result}"`);
    if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, `-timeout.png`) });
    for (const err of errors.slice(0, 20)) console.log("  " + err);
    await browser.close();
    server.close();
    process.exit(1);
  }
  const elapsed = (Date.now() - t1) / 1000;
  const title = await page.$eval("#end-title", (e) => e.textContent.trim().replace(/\s+/g, " "));
  const detail = await page.$eval("#end-detail", (e) => e.textContent.trim().replace(/\s+/g, " "));
  const ticks = Number(/(\d+) ticks/.exec(detail)?.[1] ?? 0);
  console.log(`round ${round}: ${title} after ${ticks} ticks in ${elapsed.toFixed(1)}s wall time (${(ticks / elapsed).toFixed(0)} ticks/s; real time is 60)`);
  if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, `-${round}.png`) });
  await page.waitForTimeout(500);
}
if (errors.length) {
  console.log("errors/warnings:");
  for (const e of errors.slice(0, 20)) console.log("  " + e);
}
await browser.close();
server.close();
process.exit(errors.some((e) => e.startsWith("page error") || e.startsWith("request failed")) ? 1 : 0);

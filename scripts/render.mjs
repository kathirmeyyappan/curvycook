// Renders recorded games (from `npm run match -- --record=DIR`) to PNG with the
// bundled Chromium: node scripts/render.mjs DIR/seed0-bot0.json [more.json...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/render.mjs game.json [...]");
  process.exit(1);
}
const executablePath = process.env.CHROME_PATH || fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });

for (const file of files) {
  const game = JSON.parse(fs.readFileSync(file, "utf8"));
  const html = `<!doctype html><body style="margin:0;background:#fff"><canvas id=c width=900 height=900></canvas><script>(() => {
const g = ${JSON.stringify(game)};
const S = 880 / 88, O = 10;
const c = document.getElementById("c").getContext("2d");
c.fillStyle = "#111"; c.fillRect(0, 0, 900, 900);
c.fillStyle = "#222"; c.fillRect(O, O, 880, 880);
const col = ["#4caf50", "#e53935"]; // seat 0 green, seat 1 red
for (const b of g.bodies) { c.fillStyle = col[b.owner]; c.beginPath(); c.arc(O + b.x * S, O + (88 - b.y) * S, 0.6 * S, 0, 7); c.fill(); }
// faint full tracks (including warmup where no trail is laid)
for (const p of [0, 1]) { c.strokeStyle = col[p] + "55"; c.lineWidth = 1; c.beginPath(); g.track.forEach((r, i) => { const x = O + r[1 + 4 * p] * S, y = O + (88 - r[2 + 4 * p]) * S; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); }
// tick labels every 300 ticks
c.font = "12px sans-serif"; c.fillStyle = "#fff";
g.track.forEach((r) => { if (r[0] % 300 === 0) for (const p of [0, 1]) c.fillText(r[0], O + r[1 + 4 * p] * S + 3, O + (88 - r[2 + 4 * p]) * S - 3); });
// heads
const last = g.track[g.track.length - 1];
for (const p of [0, 1]) { c.fillStyle = "#fff"; c.beginPath(); c.arc(O + last[1 + 4 * p] * S, O + (88 - last[2 + 4 * p]) * S, 5, 0, 7); c.fill(); }
c.fillStyle = "#fff"; c.font = "16px sans-serif";
const kinds = g.kinds || [g.botSeat === 0 ? "bot" : "model", g.botSeat === 1 ? "bot" : "model"];
const causes = g.causes ? g.causes.map((c, i) => c ? kinds[i] + ":" + c : null).filter(Boolean).join(",") : g.cause;
c.fillText("seed " + g.seed + "  green=" + kinds[0] + "  red=" + kinds[1] + "  winner=" + (g.winner < 0 ? "tie" : kinds[g.winner] + "(seat" + g.winner + ")") + "  ticks=" + g.ticks + "  " + causes, 14, 24);
})();</script></body>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const out = file.replace(/\.json$/, ".png");
  await page.screenshot({ path: out });
  console.log("wrote", out);
}
await browser.close();

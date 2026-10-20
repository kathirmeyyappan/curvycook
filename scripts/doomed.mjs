// For each recorded game the bot lost, prints when its evaluation first
// collapsed for good and the situation around that moment.
//   node scripts/doomed.mjs DIR [--all]
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const all = process.argv.includes("--all");
const deg = (a) => ((a * 180) / Math.PI + 360 * 10) % 360;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const bs = g.kinds.indexOf("bot");
  if (bs < 0) continue;
  if (!all && g.winner === bs) continue;
  const d = g.diag.filter((x) => x.seat === bs);
  const tr = g.track;
  let idx = d.length;
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i].score > -10000) {
      idx = i + 1;
      break;
    }
  }
  const entry = d[idx];
  const result = g.winner === bs ? "WIN " : g.winner < 0 ? "TIE " : "LOSS";
  console.log(`== ${f} ${result} ticks ${g.ticks} cause ${g.causes[bs] ?? "-"} | doomed from ${entry ? `${entry.tick} (${g.ticks - entry.tick} before the end)` : "never"} budgetHits ${d.at(-1)?.budgetHits ?? 0}`);
  if (!entry) continue;
  for (const x of d.slice(Math.max(0, idx - 3), idx + 2)) {
    const row = tr.find((r) => r[0] === x.tick);
    const bx = row[1 + 4 * bs], by = row[2 + 4 * bs], ba = row[3 + 4 * bs];
    const ox = row[1 + 4 * (1 - bs)], oy = row[2 + 4 * (1 - bs)], oa = row[3 + 4 * (1 - bs)];
    console.log(`  t${x.tick} score=${x.score.toFixed(0)} terr=${(x.territory ?? 0).toFixed(0)} esc=${x.escape} plan=${x.plan[0]} bot=(${bx.toFixed(1)},${by.toFixed(1)},${deg(ba).toFixed(0)}deg) opp=(${ox.toFixed(1)},${oy.toFixed(1)},${deg(oa).toFixed(0)}deg) dist=${Math.hypot(bx - ox, by - oy).toFixed(1)}`);
  }
}

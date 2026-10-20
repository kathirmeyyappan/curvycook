// Aggregates recorded games: node scripts/analyze.mjs DIR [kind]
// Prints death causes, game lengths and a behaviour profile per player kind:
// how close to walls it drives, how far from the opponent, how often it turns,
// and how often it dies within N ticks of a decision window start.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const profiles = {};
const lengths = [];
const causes = {};
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  lengths.push(g.ticks);
  g.kinds.forEach((kind, seat) => {
    const p = (profiles[kind] ??= { ticks: 0, nearWall: 0, wallDist: 0, oppDist: 0, turnChanges: 0, straightTicks: 0, deaths: 0, wins: 0, games: 0, deathCause: {}, chaseTicks: 0 });
    p.games++;
    if (g.winner === seat) p.wins++;
    if (g.causes[seat]) {
      p.deaths++;
      p.deathCause[g.causes[seat]] = (p.deathCause[g.causes[seat]] || 0) + 1;
      causes[`${kind}:${g.causes[seat]}`] = (causes[`${kind}:${g.causes[seat]}`] || 0) + 1;
    }
    let prevAngle = null;
    let prevTurn = 0;
    for (const r of g.track) {
      const x = r[1 + 4 * seat], y = r[2 + 4 * seat], a = r[3 + 4 * seat];
      const ox = r[1 + 4 * (1 - seat)], oy = r[2 + 4 * (1 - seat)], oa = r[3 + 4 * (1 - seat)];
      const wd = Math.min(x, y, 88 - x, 88 - y);
      p.ticks++;
      p.wallDist += wd;
      if (wd < 4) p.nearWall++;
      const od = Math.hypot(ox - x, oy - y);
      p.oppDist += od;
      // "chasing": within 12 units behind the opponent, heading within 30 degrees of its heading
      const headingDiff = Math.abs(Math.atan2(Math.sin(a - oa), Math.cos(a - oa)));
      const behind = (ox - x) * Math.cos(a) + (oy - y) * Math.sin(a) > 0;
      if (od < 12 && headingDiff < Math.PI / 6 && behind) p.chaseTicks++;
      if (prevAngle !== null) {
        const d = Math.atan2(Math.sin(a - prevAngle), Math.cos(a - prevAngle));
        const turn = Math.abs(d) < 1e-4 ? 0 : d > 0 ? 1 : -1;
        if (turn === 0) p.straightTicks++;
        if (turn !== prevTurn) p.turnChanges++;
        prevTurn = turn;
      }
      prevAngle = a;
    }
  });
}
lengths.sort((a, b) => a - b);
console.log(`${files.length} games; length min ${lengths[0]} median ${lengths[Math.floor(lengths.length / 2)]} max ${lengths.at(-1)} mean ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(0)}`);
console.log("death causes:", causes);
for (const [kind, p] of Object.entries(profiles)) {
  console.log(`\n${kind}: ${p.games} games, ${p.wins} wins, ${p.deaths} deaths ${JSON.stringify(p.deathCause)}`);
  console.log(`  mean wall distance ${(p.wallDist / p.ticks).toFixed(1)}, ticks within 4 of a wall ${((100 * p.nearWall) / p.ticks).toFixed(0)}%`);
  console.log(`  mean distance to opponent ${(p.oppDist / p.ticks).toFixed(1)}, chasing behind opponent ${((100 * p.chaseTicks) / p.ticks).toFixed(1)}% of ticks`);
  console.log(`  straight ${((100 * p.straightTicks) / p.ticks).toFixed(0)}% of ticks, turn changes per 100 ticks ${((100 * p.turnChanges) / p.ticks).toFixed(1)}`);
}

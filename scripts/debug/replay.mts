// Rebuilds the bot's view of a recorded game at a tick and dumps its search:
//   npx tsx scripts/debug/replay.mts GAME.json TICK [--map]
import fs from "node:fs";
import { Bot } from "../../src/bot/bot.js";
import { INF } from "../../src/bot/territory.js";
const [file, tickArg] = process.argv.slice(2);
const wantMap = process.argv.includes("--map");
const driveArg = process.argv.find((a) => a.startsWith("--drive="))?.slice(8); // e.g. S4,R,R,R,S : optional tick count per segment
const g = JSON.parse(fs.readFileSync(file, "utf8"));
const bs = g.kinds.indexOf("bot");
const T = Number(tickArg);
const bot = new Bot(bs);
bot.debug = true;
// Bodies are laid in order; each one was laid at the first tick where some head stood on it.
const trackByTick = new Map<number, number[]>(g.track.map((r: number[]) => [r[0], r]));
const bodyTick: number[] = [];
let scan = 0;
for (const b of g.bodies) {
  let laid = -1;
  for (let t = scan; t <= g.ticks; t++) {
    const r = trackByTick.get(t);
    if (!r) continue;
    const x = r[1 + 4 * b.owner], y = r[2 + 4 * b.owner];
    if (Math.abs(x - b.x) < 1e-3 && Math.abs(y - b.y) < 1e-3) { laid = t; break; }
  }
  bodyTick.push(laid);
  if (laid > scan + 8) scan = laid - 8;
}
// Feed the bot every tick up to T exactly like the harness does.
for (let t = 0; t <= T; t++) {
  const r = trackByTick.get(t);
  if (!r) break;
  const count = bodyTick.filter((bt) => bt >= 0 && bt <= t).length;
  const bodies = g.bodies.slice(0, count);
  const players = [0, 1].map((p) => ({ x: r[1 + 4 * p], y: r[2 + 4 * p], angle: r[3 + 4 * p], alive: true }));
  if (t === T) {
    (bot as any).planFrom = -1; // force a fresh plan at T
    const turn = bot.decide({ tick: t, players, bodies });
    console.log(`tick ${t}: bot=(${players[bs].x.toFixed(2)},${players[bs].y.toFixed(2)}) heading ${((players[bs].angle * 180) / Math.PI).toFixed(0)}deg, opp=(${players[1 - bs].x.toFixed(2)},${players[1 - bs].y.toFixed(2)}); chose ${turn}; recorded choice ${r[9 + bs] - 1}; plan ms ${bot.lastPlanMs.toFixed(1)}`);
    for (const c of bot.trace) {
      console.log(`  turn ${c.turn}: worst=${c.worst.toFixed(0)} likely=${c.likely.toFixed(0)} escape=${c.escape} nodes=${c.nodes} endArea=${c.endArea} path=${c.path.map((p) => (p === 1 ? "L" : p === -1 ? "R" : "S")).join("")}`);
    }
    if (driveArg) {
      // Drive a given manoeuvre sequence from the current state (opponent straight) and report.
      const game = bot.game;
      const buf = new Float64Array(64);
      game.save(buf, 0);
      let t = 0;
      let dead = false;
      for (const seg of driveArg.split(",")) {
        const turn = seg[0] === "L" ? 1 : seg[0] === "R" ? -1 : 0;
        const n = Number(seg.slice(1) || 8);
        for (let i = 0; i < n && !dead; i++) {
          const turns: any = [0, 0];
          turns[bs] = turn;
          game.step(turns, [true, true]);
          t++;
          if (!game.players[bs].alive) dead = true;
        }
        const me = game.players[bs];
        console.log(`  after ${seg.padEnd(3)} (t+${t}): (${me.x.toFixed(2)},${me.y.toFixed(2)}) heading ${(((me.angle * 180) / Math.PI) % 360).toFixed(0)}deg ${dead ? "DEAD" : "ok"} nearest body ${Math.sqrt(game.bodies.nearest2(me.x, me.y, 10)).toFixed(2)}`);
        if (dead) break;
      }
      game.load(buf, 0);
    }
    if (wantMap) {
      const occ = bot.fat;
      const gsz = occ.grid;
      const me = bot.game.players[bs];
      const cx = Math.floor(me.x / occ.cell), cy = Math.floor(me.y / occ.cell);
      const ox = Math.floor(bot.game.players[1 - bs].x / occ.cell), oy = Math.floor(bot.game.players[1 - bs].y / occ.cell);
      console.log(`fat grid (${occ.cell}u cells), '#' blocked, '.' free, 'B' bot, 'O' opponent, y up:`);
      for (let y = gsz - 1; y >= 0; y--) {
        let line = "";
        for (let x = 0; x < gsz; x++) {
          const c = y * gsz + x;
          line += x === cx && y === cy ? "B" : x === ox && y === oy ? "O" : !occ.edgeOk[c] ? " " : occ.blocker[c] !== INF ? "#" : ".";
        }
        console.log(String(y * occ.cell).padStart(3) + " " + line);
      }
    }
  } else {
    bot.decide({ tick: t, players, bodies });
  }
}

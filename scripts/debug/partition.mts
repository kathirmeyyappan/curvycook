// How the arena partition evolved in recorded games: at a few ticks, rebuild
// the engine state and print each player's territory (fat-grid Voronoi) and
// free area, so we can see whether the bot wins or loses the partition.
//   npx tsx scripts/debug/partition.mts DIR
import fs from "node:fs";
import path from "node:path";
import { Game } from "../../src/engine/game.js";
import { Occupancy, Territory, FAT_CELL, FAT_RADIUS, FINE_CELL, FINE_RADIUS } from "../../src/bot/territory.js";

const dir = process.argv[2];
const TICKS = [200, 400, 600, 900, 1200, 1500, 1800, 2400];
const rows: string[] = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const bs = g.kinds.indexOf("bot");
  if (bs < 0) continue;
  const trackByTick = new Map<number, number[]>(g.track.map((r: number[]) => [r[0], r]));
  // Laying tick of each body (first tick its owner's head stood on it).
  const bodyTick: number[] = [];
  let scan = 0;
  for (const b of g.bodies) {
    let laid = -1;
    for (let t = scan; t <= g.ticks; t++) {
      const r = trackByTick.get(t);
      if (!r) continue;
      if (Math.abs(r[1 + 4 * b.owner] - b.x) < 1e-3 && Math.abs(r[2 + 4 * b.owner] - b.y) < 1e-3) {
        laid = t;
        break;
      }
    }
    bodyTick.push(laid);
    if (laid > scan + 8) scan = laid - 8;
  }
  const game = new Game(2);
  const fat = new Occupancy(game.bodies, FAT_CELL, FAT_RADIUS, 1.2);
  const fine = new Occupancy(game.bodies, FINE_CELL, FINE_RADIUS, 0.6);
  const territory = new Territory(game, fat);
  const space = new Territory(game, fine);
  const result = g.winner === bs ? "WIN " : g.winner < 0 ? "TIE " : "LOSS";
  let line = `${f.padEnd(28)} ${result} ${String(g.ticks).padStart(4)} ${(g.causes[bs] ?? "-").padEnd(9)}`;
  for (const t of TICKS) {
    const r = trackByTick.get(t);
    if (!r) {
      line += "  " + "".padEnd(15);
      continue;
    }
    const bodies = g.bodies.map((b: any, i: number) => ({ ...b, tick: bodyTick[i] })).filter((b: any) => b.tick >= 0 && b.tick <= t);
    game.loadWorld(t, [0, 1].map((p) => ({ x: r[1 + 4 * p], y: r[2 + 4 * p], angle: r[3 + 4 * p], alive: true })), bodies);
    fat.sync();
    fine.sync();
    const e = territory.evaluate(bs, 1 - bs);
    const roomMe = space.floodArea(bs);
    const roomOpp = space.floodArea(1 - bs);
    line += `  t${t}:${e.contested ? "c" : "s"} ${String(e.mine).padStart(4)}/${String(e.theirs).padEnd(4)} ${String(roomMe).padStart(4)}/${String(roomOpp).padEnd(4)}`;
  }
  rows.push(line);
}
console.log("per tick: (c)ontested or (s)eparated, voronoi cells mine/theirs (fat 2u grid), free fine cells mine/theirs");
for (const row of rows) console.log(row);

/**
 * Replays random per-tick games in the real Warp simulator and in the
 * TypeScript engine, and checks they agree: head positions, body counts and
 * positions, who dies when, and the outcome.
 *
 *   npm test            (default 40 games)
 *   npx tsx src/engine/validate.ts 200
 */
import { Game, Turn } from "./game.js";
import { loadWarpSim, PER_TICK_SCHEME } from "../harness/warp-sim.js";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const games = Number(process.argv[2] ?? 40);
const { sim, config } = await loadWarpSim();
config.action_schemes = [PER_TICK_SCHEME, PER_TICK_SCHEME];
sim.init(config, 0);
const engine = new Game(2);

let worstPos = 0;
let worstBody = 0;
let mismatches = 0;
let totalTicks = 0;
const deathTicks: number[] = [];

for (let g = 0; g < games; g++) {
  const rng = mulberry32(1000 + g);
  const frame0 = sim.reset(g);
  engine.reset(frame0.players);
  // Random "hold a turn for a while" walkers that steer away from walls so games
  // last long enough to exercise trail collisions. Player 1 is more twitchy.
  const hold = [0, 0];
  const turn: Turn[] = [0, 0];
  let frame = frame0;
  let problem = "";
  while (!frame.done) {
    for (let p = 0; p < 2; p++) {
      const pl = frame.players[p];
      const aheadX = pl.x + 12 * Math.cos(pl.angle);
      const aheadY = pl.y + 12 * Math.sin(pl.angle);
      if (aheadX < 2 || aheadX > 86 || aheadY < 2 || aheadY > 86) {
        // Turn towards the arena centre.
        const want = Math.atan2(44 - pl.y, 44 - pl.x);
        const delta = Math.atan2(Math.sin(want - pl.angle), Math.cos(want - pl.angle));
        turn[p] = delta > 0 ? 1 : -1;
        hold[p] = 0;
      } else if (hold[p]-- <= 0) {
        const r = rng();
        turn[p] = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
        hold[p] = 1 + Math.floor(rng() * (p === 0 ? 40 : 12));
      }
      sim.setAction(p, turn[p] + 1);
    }
    if (frame.tick % 16 === 0) sim.beginDecision();
    frame = sim.advance();
    engine.step(turn, [frame.players[0].printing, frame.players[1].printing]);
    totalTicks++;
    for (let p = 0; p < 2; p++) {
      const a = frame.players[p];
      const b = engine.players[p];
      if (a.alive) {
        const err = Math.hypot(a.x - b.x, a.y - b.y);
        if (err > worstPos) worstPos = err;
      }
      if (a.alive !== b.alive && !problem) problem = `tick ${frame.tick}: player ${p} alive sim=${a.alive} engine=${b.alive} at (${a.x.toFixed(3)},${a.y.toFixed(3)})`;
    }
    const nb = sim.bodyCount();
    if (nb !== engine.bodies.count && !problem) problem = `tick ${frame.tick}: body count sim=${nb} engine=${engine.bodies.count}`;
    if (problem) break;
  }
  if (!problem) {
    const bodies = sim.bodies();
    for (let i = 0; i < bodies.length; i++) {
      const err = Math.hypot(bodies[i].x - engine.bodies.xs[i], bodies[i].y - engine.bodies.ys[i]);
      if (err > worstBody) worstBody = err;
      if (bodies[i].owner !== engine.bodies.owners[i]) problem = `body ${i} owner mismatch`;
    }
    if (engine.done !== frame.done) problem = `done sim=${frame.done} engine=${engine.done}`;
    for (let p = 0; p < 2; p++) if (frame.players[p].outcome !== engine.players[p].outcome) problem = `outcome p${p} sim=${frame.players[p].outcome} engine=${engine.players[p].outcome}`;
  }
  deathTicks.push(frame.tick);
  if (problem) {
    mismatches++;
    console.log(`game ${g}: MISMATCH ${problem}`);
  }
}
console.log(`validated ${games} games, ${totalTicks} ticks; mean length ${(totalTicks / games).toFixed(0)} ticks`);
console.log(`max head position error ${worstPos.toExponential(2)}, max body position error ${worstBody.toExponential(2)}`);
console.log(mismatches ? `${mismatches} games disagreed` : "all games agree on deaths, bodies and outcomes");
sim.close();
process.exit(mismatches ? 1 : 0);

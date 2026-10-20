import { loadWarpSim, PER_TICK_SCHEME } from "../../src/harness/warp-sim.js";
function mulberry32(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const { sim, config } = await loadWarpSim();
config.action_schemes = [PER_TICK_SCHEME, PER_TICK_SCHEME];
sim.init(config, 0);
for (const g of [6, 53, 0]) {
  const rng = mulberry32(1000 + g);
  let frame = sim.reset(g);
  const hold = [0, 0]; const turn = [0, 0];
  const lastBody: any[] = [null, null];
  console.log(`--- game ${g} ---`);
  while (!frame.done && frame.tick < 230) {
    for (let p = 0; p < 2; p++) { if (hold[p]-- <= 0) { const r = rng(); turn[p] = r < 0.35 ? -1 : r < 0.7 ? 1 : 0; hold[p] = 1 + Math.floor(rng() * (p === 0 ? 40 : 12)); } sim.setAction(p, turn[p] + 1); }
    if (frame.tick % 16 === 0) sim.beginDecision();
    const before = sim.bodyCount();
    frame = sim.advance();
    const after = sim.bodyCount();
    if (frame.tick >= 180 && frame.tick <= 230) {
      const bodies = sim.bodies();
      const line = [0, 1].map(p => { const h = frame.players[p]; const mine = bodies.filter(b => b.owner === p); const lb = mine.at(-1); const d = lb ? Math.hypot(h.x - lb.x, h.y - lb.y) : -1; return `p${p} turn=${turn[p]} pr=${h.printing ? 1 : 0} n=${mine.length} dLast=${d.toFixed(4)}`; }).join(" | ");
      console.log(`t${frame.tick} +${after - before} ${line}`);
    }
  }
}

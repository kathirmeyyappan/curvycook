// Does the checkpoint's observation depend on the OTHER seat's action scheme?
// Compares the model seat's feature vectors over identical states when seat 0
// uses the per-tick scheme (as the bot does) vs the controller scheme (as on
// the original site).
import { loadWarpSim, PER_TICK_SCHEME, MODEL_SCHEME } from "../../src/harness/warp-sim.js";
const { sim, config } = await loadWarpSim();
const run = (seat0: any) => {
  const cfg = structuredClone(config);
  cfg.action_schemes = [seat0, MODEL_SCHEME];
  sim.init(cfg, 3);
  let frame = sim.reset(3);
  const feats: Float32Array[] = [];
  for (let t = 0; t < 400 && !frame.done; t++) {
    if (frame.tick % 16 === 0) {
      sim.beginDecision();
      feats.push(sim.observe(1));
    }
    sim.setAction(0, seat0.code === 0 ? 1 : 16); // straight in either encoding
    sim.setAction(1, 16);
    frame = sim.advance();
  }
  return feats;
};
const a = run(PER_TICK_SCHEME);
const b = run(MODEL_SCHEME);
let maxDiff = 0;
let n = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) for (let j = 0; j < a[i].length; j++) { maxDiff = Math.max(maxDiff, Math.abs(a[i][j] - b[i][j])); n++; }
console.log(`${a.length} observations of ${a[0].length} features compared (${n} values); max difference ${maxDiff}`);
sim.close();

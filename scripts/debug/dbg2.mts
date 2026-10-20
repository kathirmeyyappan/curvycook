import { loadWarpSim, PER_TICK_SCHEME, MODEL_SCHEME } from "../../src/harness/warp-sim.js";
import { RlPolicy } from "../../src/harness/rl-policy.js";
const { sim, game, config } = await loadWarpSim();
const actor = game.client_game.actors[0]; actor.model.url = "../vendor/model/model.ort";
const policy = await RlPolicy.load(actor);
const cfg = structuredClone(config); cfg.action_schemes = [PER_TICK_SCHEME, MODEL_SCHEME];
sim.init(cfg, 0);
let frame = sim.reset(0);
const x = sim.region("body_x");
const buf0 = x.buffer;
let modelAction = 16;
for (let t = 0; t < 400 && !frame.done; t++) {
  if (frame.tick % 16 === 0) { sim.beginDecision(); modelAction = await policy.decide(sim.observe(1)); }
  sim.setAction(0, 1); sim.setAction(1, modelAction);
  frame = sim.advance();
  const fresh = sim.region("body_x");
  if (fresh.buffer !== buf0 || x.buffer.byteLength === 0) { console.log(`tick ${frame.tick}: heap buffer changed! old byteLength=${x.buffer.byteLength} new=${fresh.buffer.byteLength}; stale x[0]=${x[0]} fresh x[0]=${fresh[0]}`); break; }
}
console.log("done at tick", frame.tick, "buffer stable:", sim.region("body_x").buffer === buf0, "bytes", buf0.byteLength);
sim.close();

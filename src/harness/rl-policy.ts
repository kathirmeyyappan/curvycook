/**
 * The curvytron-rl checkpoint ("Shai Hulud") run through onnxruntime-node,
 * reproducing docs/static/play-client-worker.js: a recurrent policy whose
 * LSTM state is carried across decisions, greedy (argmax) by default.
 */
import path from "node:path";
import { DOCS_DIR } from "./warp-sim.js";

export interface ModelActor {
  model: { url: string; contract: { inputs: { name: string; dtype: string; shape: number[] }[]; outputs: { name: string }[]; state: [string, string][] } };
  decision_window: number;
}

export class RlPolicy {
  private state: Record<string, any> = {};
  private constructor(private readonly ort: any, private readonly session: any, private readonly actor: ModelActor) {}

  static async load(actor: ModelActor): Promise<RlPolicy> {
    // Resolved at run time only: onnxruntime-node is an optional dependency
    // (the site and the engine tests do not need it), so keep the type
    // checker from resolving the specifier.
    const specifier = "onnxruntime-node";
    const mod: any = await import(specifier);
    const ort = mod.InferenceSession ? mod : mod.default;
    const url = actor.model.url;
    const file = url.startsWith("http") ? url : path.join(DOCS_DIR, "static", url);
    const session = await ort.InferenceSession.create(file, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    return new RlPolicy(ort, session, actor);
  }

  get decisionWindow(): number {
    return this.actor.decision_window;
  }

  reset(): void {
    this.state = {};
    for (const [input] of this.actor.model.contract.state) {
      const spec = this.actor.model.contract.inputs.find((s) => s.name === input)!;
      const size = spec.shape.reduce((a, b) => a * b, 1);
      this.state[input] = new this.ort.Tensor("float32", new Float32Array(size), spec.shape);
    }
  }

  /** Returns the chosen action (0..32) for a feature vector from `sim.observe(player)`. */
  async decide(features: Float32Array, sample = false, random: () => number = Math.random): Promise<number> {
    if (!Object.keys(this.state).length) this.reset();
    const feeds: Record<string, any> = { features: new this.ort.Tensor("float32", features, [1, features.length]), ...this.state };
    const out = await this.session.run(feeds);
    for (const [input, output] of this.actor.model.contract.state) this.state[input] = out[output];
    const logits: Float32Array = out.logits.data;
    if (!sample) {
      let best = 0;
      for (let a = 1; a < logits.length; a++) if (logits[a] > logits[best]) best = a;
      return best;
    }
    let max = -Infinity;
    for (const v of logits) max = Math.max(max, v);
    const probs = Array.from(logits, (v) => Math.exp(v - max));
    const total = probs.reduce((a, b) => a + b, 0);
    let draw = random() * total;
    for (let a = 0; a < probs.length; a++) {
      draw -= probs[a];
      if (draw <= 0) return a;
    }
    return probs.length - 1;
  }
}

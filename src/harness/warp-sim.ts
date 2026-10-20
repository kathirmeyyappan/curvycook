/**
 * Node wrapper around the real curvytron-rl Warp simulator (docs/vendor/simulator).
 * Mirrors the BrowserSimulator class from docs/static/play-client-worker.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DOCS_DIR = path.resolve(here, "../../docs");

const ARRAY_TYPES: Record<string, any> = {
  bool: Uint8Array,
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  int64: BigInt64Array,
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  uint64: BigUint64Array,
  float32: Float32Array,
  float64: Float64Array,
};

export interface ActionScheme {
  code: number;
  granularity: number;
  window: number;
}

export interface SimConfig {
  n_players: number;
  arena_size: number;
  radius: number;
  max_ticks: number;
  tick_hz: number;
  velocity_per_second: number;
  angular_velocity_per_second: number;
  action_schemes: ActionScheme[];
  powerups: Record<string, { code: number; duration_ticks: number }>;
  [key: string]: unknown;
}

export interface WarpPlayer {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  printing: boolean;
  outcome: number;
}

export interface WarpFrame {
  tick: number;
  done: boolean;
  players: WarpPlayer[];
}

export interface WarpBody {
  x: number;
  y: number;
  owner: number;
}

/** Per-tick action schemes: 0 = direct turns (actions 0/1/2 = right/straight/left). */
export const PER_TICK_SCHEME: ActionScheme = { code: 0, granularity: 1, window: 1 };
/** The RL checkpoint's scheme: 33 targets, a 16-tick controller window. */
export const MODEL_SCHEME: ActionScheme = { code: 2, granularity: 16, window: 16 };

export class WarpSim {
  private readonly regionSpecs = new Map<string, { dtype: string; shape: number[]; index: number }>();
  private readonly operations: Record<string, number>;
  private instance: number;
  nPlayers = 2;
  config!: SimConfig;

  constructor(private readonly runtime: any, contract: any, graph: Uint8Array) {
    this.operations = contract.operations;
    contract.regions.forEach((r: any, index: number) => this.regionSpecs.set(r.name, { ...r, index }));
    runtime.FS.writeFile("/runtime.wrp", graph);
    this.instance = runtime._runtime_create();
    if (!this.instance) throw new Error("unable to create the Warp runtime");
  }

  region(name: string): any {
    const spec = this.regionSpecs.get(name);
    if (!spec) throw new Error(`unknown region ${name}`);
    const T = ARRAY_TYPES[spec.dtype];
    const ptr = Number(this.runtime._runtime_region(this.instance, spec.index));
    const len = spec.shape.reduce((a, b) => a * b, 1);
    return new T(this.runtime.HEAPU8.buffer, ptr, len);
  }

  execute(op: string): void {
    this.region("command")[0] = this.operations[op];
    if (!this.runtime._runtime_execute(this.instance)) throw new Error(`Warp operation failed: ${op}`);
  }

  init(config: SimConfig, seed: bigint | number = 0): WarpFrame {
    this.config = config;
    this.nPlayers = config.n_players;
    this.region("active_players")[0] = config.n_players;
    const codes = this.region("action_codes");
    const gran = this.region("action_granularities");
    const win = this.region("action_windows");
    config.action_schemes.forEach((s, p) => {
      codes[p] = s.code;
      gran[p] = s.granularity;
      win[p] = s.window;
    });
    this.reset(seed);
    this.region("powerup_spawn_types")[0] = 0;
    this.region("powerup_spawn_rate")[0] = 0;
    this.execute("configure_powerup_spawns");
    return this.snapshot();
  }

  reset(seed: bigint | number = 0): WarpFrame {
    this.region("seed")[0] = BigInt(seed);
    this.execute("reset");
    return this.snapshot();
  }

  setAction(player: number, action: number): void {
    this.region("actions")[player] = BigInt(action);
  }

  beginDecision(): void {
    this.execute("begin_decision");
  }

  advance(): WarpFrame {
    this.execute("step");
    return this.snapshot();
  }

  observe(player: number): Float32Array {
    this.execute(`observe_${player}`);
    return this.region(`features_${player}`).slice();
  }

  /** Overwrite a head pose (test helper; the simulator reads these regions back). */
  place(player: number, x: number, y: number, angle: number): void {
    this.region("x")[player] = x;
    this.region("y")[player] = y;
    this.region("angle")[player] = angle;
  }

  snapshot(): WarpFrame {
    const x = this.region("x");
    const y = this.region("y");
    const angle = this.region("angle");
    const alive = this.region("alive");
    const printing = this.region("printing");
    const outcomes = this.region("outcomes");
    return {
      tick: this.region("ticks")[0],
      done: Boolean(this.region("done")[0]),
      players: Array.from({ length: this.nPlayers }, (_, p) => ({
        x: x[p],
        y: y[p],
        angle: angle[p],
        alive: Boolean(alive[p]),
        printing: Boolean(printing[p]),
        outcome: outcomes[p],
      })),
    };
  }

  bodies(): WarpBody[] {
    const n = Number(this.region("body_counts")[0]);
    const x = this.region("body_x");
    const y = this.region("body_y");
    const owner = this.region("body_owner");
    return Array.from({ length: n }, (_, i) => ({ x: x[i], y: y[i], owner: owner[i] }));
  }

  bodyCount(): number {
    return Number(this.region("body_counts")[0]);
  }

  close(): void {
    if (!this.instance) return;
    this.runtime._runtime_destroy(this.instance);
    this.instance = 0;
  }
}

export interface LoadedSim {
  sim: WarpSim;
  /** One of the site's exported game configs (its simulator section is what matters). */
  game: any;
  /** The RL checkpoint's actor manifest (model url relative to docs/static). */
  modelActor: any;
  /** Simulator config (copy before mutating action_schemes). */
  config: SimConfig;
}

export async function loadWarpSim(): Promise<LoadedSim> {
  const html = fs.readFileSync(path.join(DOCS_DIR, "index.html"), "utf8");
  const match = /<script id="play-bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("play-bootstrap not found in docs/index.html");
  const boot = JSON.parse(match[1]);
  const games = Object.values<any>(boot.games);
  const game = games[0];
  const modelActor = structuredClone(games.flatMap((g) => g.client_game.actors).find((a) => a?.model));
  if (!modelActor) throw new Error("no checkpoint actor exported in docs/index.html");
  const simulator = game.client_game.simulator;
  const dir = path.join(DOCS_DIR, "vendor/simulator");
  const mod = await import(path.join(dir, "simulator.mjs"));
  const runtime = await mod.default({ locateFile: (p: string) => path.join(dir, p) });
  const graph = fs.readFileSync(path.join(dir, "simulator.wrp"));
  const sim = new WarpSim(runtime, simulator.runtime, new Uint8Array(graph));
  return { sim, game, modelActor, config: structuredClone(simulator.config) };
}

/**
 * Browser entry point: wraps the bot as a policy for play-client-worker.js.
 *
 * The worker's Python game loop calls `policy.decide(features)` once per
 * decision window; a bot policy has `observe: false` so the loop skips the
 * (expensive) feature extraction and the bot reads the raw simulator state
 * instead: head poses from the frame regions, trail bodies from the body
 * regions.
 */
import { Bot, BotOptions } from "../bot/bot.js";
import type { Turn } from "../engine/game.js";

export { Bot, DEFAULT_OPTIONS } from "../bot/bot.js";
export type { BotOptions, Observation } from "../bot/bot.js";

/** The subset of the worker's BrowserSimulator the bot needs. */
export interface SimulatorLike {
  region(name: string): ArrayLike<number> & { length: number };
  nPlayers: number;
}

export interface BotPolicy {
  observe: false;
  reset(): void;
  /** Async because the Python game loop awaits every policy's decision. */
  decide(features?: unknown): Promise<number>;
  /** Diagnostics for overlays / debugging. */
  readonly bot: Bot;
}

export function createBotPolicy(simulator: SimulatorLike, seat: number, options: Partial<BotOptions> = {}): BotPolicy {
  const bot = new Bot(seat, options);
  const players = Array.from({ length: 2 }, () => ({ x: 0, y: 0, angle: 0, alive: true }));
  const bodies = { count: 0, x: [] as ArrayLike<number>, y: [] as ArrayLike<number>, owner: [] as ArrayLike<number> };
  return {
    observe: false,
    bot,
    reset: () => bot.reset(),
    decide: async () => {
      // Fresh views every call: the wasm heap can be reallocated.
      const x = simulator.region("x");
      const y = simulator.region("y");
      const angle = simulator.region("angle");
      const alive = simulator.region("alive");
      for (let p = 0; p < players.length; p++) {
        players[p].x = x[p];
        players[p].y = y[p];
        players[p].angle = angle[p];
        players[p].alive = Boolean(alive[p]);
      }
      bodies.count = Number(simulator.region("body_counts")[0]);
      bodies.x = simulator.region("body_x");
      bodies.y = simulator.region("body_y");
      bodies.owner = simulator.region("body_owner");
      const tick = Number(simulator.region("ticks")[0]);
      const turn: Turn = bot.decide({ tick, players, bodies });
      if (tick % 300 === 0 && bot.lastPlanMs) {
        console.log(`[curvycook] tick ${tick} seat ${seat} score ${bot.lastScore.toFixed(0)} escape ${bot.lastEscape} plan ${bot.lastPlanMs.toFixed(1)}ms bodies ${bodies.count}`);
      }
      // Per-tick scheme (code 0): 0 = right, 1 = straight, 2 = left.
      return turn + 1;
    },
  };
}

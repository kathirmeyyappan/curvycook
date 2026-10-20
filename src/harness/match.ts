/**
 * Runs matches inside the real Warp simulator exactly as the website does:
 * the RL checkpoint decides every 16 ticks through its 33-target controller,
 * the TypeScript bot decides every tick (the same per-tick scheme a human
 * has).
 *
 *   npm run match -- [--p0=bot|model|random] [--p1=bot|model|random] [--games=N]
 *                    [--seeds=0,1,2] [--swap] [--record=DIR] [--verbose]
 *                    [--bot-opts='{"replan":4}']
 *
 * --swap plays every seed twice with the seats exchanged (default when no
 * pairing is given: bot vs model both ways).
 */
import fs from "node:fs";
import path from "node:path";
import { Bot, BotOptions } from "../bot/bot.js";
import { ARENA, COLLIDE, RADIUS, Turn } from "../engine/game.js";
import { loadWarpSim, PER_TICK_SCHEME, MODEL_SCHEME, WarpFrame, ActionScheme } from "./warp-sim.js";
import { RlPolicy } from "./rl-policy.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const kinds = [opt("p0", "bot"), opt("p1", "model")];
const games = Number(opt("games", args.find((a) => /^\d+$/.test(a)) ?? "12"));
const swap = args.includes("--swap") || !args.some((a) => a.startsWith("--p0") || a.startsWith("--p1"));
const verbose = args.includes("--verbose");
const seedArg = opt("seeds", "");
const recordDir = opt("record", "");
const botOpts: Partial<BotOptions> = JSON.parse(opt("bot-opts", "{}"));
if (recordDir) fs.mkdirSync(recordDir, { recursive: true });

const { sim, modelActor, config } = await loadWarpSim();
const needModel = kinds.includes("model");
const policy = needModel ? await RlPolicy.load(modelActor) : null;

interface Player {
  kind: string;
  scheme: ActionScheme;
  reset(seat: number): void;
  /** Action for this tick (already in the simulator's encoding for the scheme). */
  act(frame: WarpFrame, seat: number): Promise<number> | number;
  stats?(): { planMsMean: number; planMsMax: number };
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlayer(kind: string, seat: number): Player {
  if (kind === "model") {
    let action = 16;
    return {
      kind,
      scheme: MODEL_SCHEME,
      reset: () => policy!.reset(),
      act: async (frame) => {
        if (frame.tick % policy!.decisionWindow === 0) action = await policy!.decide(sim.observe(seat));
        return action;
      },
    };
  }
  if (kind === "random") {
    let rng = mulberry32(1);
    let turn = 0;
    let hold = 0;
    return {
      kind,
      scheme: PER_TICK_SCHEME,
      reset: (s) => {
        rng = mulberry32(100 + s);
      },
      act: (frame) => {
        const pl = frame.players[seat];
        const ax = pl.x + 12 * Math.cos(pl.angle);
        const ay = pl.y + 12 * Math.sin(pl.angle);
        if (ax < 2 || ax > 86 || ay < 2 || ay > 86) {
          const want = Math.atan2(44 - pl.y, 44 - pl.x);
          const delta = Math.atan2(Math.sin(want - pl.angle), Math.cos(want - pl.angle));
          turn = delta > 0 ? 1 : -1;
        } else if (hold-- <= 0) {
          const r = rng();
          turn = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
          hold = 1 + Math.floor(rng() * 30);
        }
        return turn + 1;
      },
    };
  }
  const bot = new Bot(seat, botOpts);
  let planMsMax = 0;
  let planMsSum = 0;
  let plans = 0;
  const columns = { count: 0, x: sim.region("body_x"), y: sim.region("body_y"), owner: sim.region("body_owner") };
  const player: Player & { bot: Bot } = {
    kind,
    bot,
    scheme: PER_TICK_SCHEME,
    reset: () => {
      bot.reset();
      planMsMax = planMsSum = plans = 0;
    },
    act: (frame) => {
      columns.count = sim.bodyCount();
      const turn: Turn = bot.decide({ tick: frame.tick, players: frame.players, bodies: columns });
      if (bot.lastPlanMs) {
        planMsMax = Math.max(planMsMax, bot.lastPlanMs);
        planMsSum += bot.lastPlanMs;
        plans++;
      }
      return turn + 1;
    },
    stats: () => ({ planMsMean: plans ? planMsSum / plans : 0, planMsMax }),
  };
  return player;
}

/** Why did `seat` die at its final position? */
function deathCause(frame: WarpFrame, seat: number, bodies: { x: number; y: number; owner: number }[]): string {
  const p = frame.players[seat];
  if (p.x < RADIUS || p.x > ARENA - RADIUS || p.y < RADIUS || p.y > ARENA - RADIUS) return "wall";
  const ownIndices = bodies.map((b, i) => (b.owner === seat ? i : -1)).filter((i) => i >= 0);
  const fresh = new Set(ownIndices.slice(-2)); // grace period: the two freshest own bodies
  let own = Infinity;
  let other = Infinity;
  bodies.forEach((b, i) => {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (b.owner === seat) {
      if (!fresh.has(i) && d < own) own = d;
    } else if (d < other) other = d;
  });
  if (own < COLLIDE && own <= other) return "own-trail";
  if (other < COLLIDE) return "opp-trail";
  return "unknown";
}

interface Result {
  seed: number;
  kinds: string[];
  winner: number;
  ticks: number;
  causes: (string | null)[];
  plan: ({ planMsMean: number; planMsMax: number } | null)[];
}

async function play(seed: number, kinds: string[]): Promise<Result> {
  const players = kinds.map((k, seat) => makePlayer(k, seat));
  const cfg = structuredClone(config);
  cfg.action_schemes = players.map((p) => p.scheme);
  sim.init(cfg, seed);
  let frame = sim.reset(seed);
  players.forEach((p, seat) => p.reset(seat));
  const track: number[][] = [];
  const diag: any[] = [];
  const bots = players.map((p) => (p as any).bot as Bot | undefined);
  while (!frame.done) {
    if (frame.tick % 16 === 0) sim.beginDecision();
    const actions: number[] = [];
    for (let seat = 0; seat < 2; seat++) actions.push(await players[seat].act(frame, seat));
    if (recordDir) {
      const pl = frame.players;
      track.push([frame.tick, pl[0].x, pl[0].y, pl[0].angle, pl[0].printing ? 1 : 0, pl[1].x, pl[1].y, pl[1].angle, pl[1].printing ? 1 : 0, actions[0], actions[1]]);
      bots.forEach((bot, seat) => {
        if (bot?.lastPlanMs) diag.push({ seat, tick: frame.tick, score: bot.lastScore, escape: bot.lastEscape, territory: bot.lastTerritory, budgetHits: bot.escapeBudgetHits, plan: bot.currentPlan() });
      });
    }
    for (const bot of bots) if (bot) bot.lastPlanMs = 0;
    actions.forEach((a, seat) => sim.setAction(seat, a));
    frame = sim.advance();
    if (verbose && frame.tick % 60 === 0) {
      const p = frame.players;
      console.log(`  t${frame.tick} p0(${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}) p1(${p[1].x.toFixed(1)},${p[1].y.toFixed(1)})`);
    }
  }
  const winner = frame.players.findIndex((p) => p.outcome === 1);
  const bodies = sim.bodies();
  const causes = frame.players.map((p, i) => (p.alive ? null : deathCause(frame, i, bodies)));
  if (recordDir) {
    const pl = frame.players;
    track.push([frame.tick, pl[0].x, pl[0].y, pl[0].angle, pl[0].printing ? 1 : 0, pl[1].x, pl[1].y, pl[1].angle, pl[1].printing ? 1 : 0, 0, 0]);
    fs.writeFileSync(path.join(recordDir, `seed${seed}-${kinds.join("-vs-")}.json`), JSON.stringify({ seed, kinds, winner, ticks: frame.tick, causes, bodies, track, diag }));
  }
  return { seed, kinds, winner, ticks: frame.tick, causes, plan: players.map((p) => p.stats?.() ?? null) };
}

const results: Result[] = [];
const seedList = seedArg ? seedArg.split(",").map(Number) : Array.from({ length: games }, (_, i) => i);
const pairings = swap && kinds[0] !== kinds[1] ? [kinds, [kinds[1], kinds[0]]] : [kinds];
for (const seed of seedList) {
  for (const pair of pairings) {
    const r = await play(seed, pair);
    results.push(r);
    const who = r.winner < 0 ? "tie" : `${pair[r.winner]}(seat${r.winner})`;
    const causes = r.causes.map((c, i) => (c ? `${pair[i]}:${c}` : null)).filter(Boolean).join(",");
    const plan = r.plan.map((p, i) => (p ? `${pair[i]} plan ${p.planMsMean.toFixed(1)}/${p.planMsMax.toFixed(0)}ms` : null)).filter(Boolean).join(" ");
    console.log(`seed ${String(seed).padStart(3)} ${pair.join(" vs ")}: winner ${who.padEnd(14)} in ${String(r.ticks).padStart(4)} ticks  ${causes.padEnd(28)} ${plan}`);
  }
}
const score = (kind: string) => results.filter((r) => r.winner >= 0 && r.kinds[r.winner] === kind).length;
const ties = results.filter((r) => r.winner < 0).length;
const summary = [...new Set(kinds)].map((k) => `${k} ${score(k)}`).join(", ");
console.log(`\n${results.length} games: ${summary}, ties ${ties}`);
if (kinds[0] !== kinds[1]) console.log(`${kinds[0]} win rate ${((100 * score(kinds[0])) / results.length).toFixed(0)}%`);
sim.close();

/**
 * A geometric search bot for curvytron-rl.
 *
 * Every REPLAN ticks it:
 *   1. syncs its private engine with the observed world (heads + new bodies),
 *   2. for each first manoeuvre (hold left / straight / right for SEGMENT
 *      ticks):
 *      - tactics: minimax over the opponent's first segment, then my best
 *        second segment (opponent keeps its heading), scored by territory
 *        (cells reached first on a "fat" grid that ignores corridors too
 *        narrow to turn in) and by how much free space is left (fine grid),
 *      - safety: an escape search from the position after the manoeuvre, a
 *        depth-first search over my own manoeuvres (memoised by position and
 *        heading) that must find a collision-free continuation of ESCAPE
 *        ticks ending in open space; pockets and corridors fail it,
 *   3. commits to the best manoeuvre's first ticks.
 *
 * Deterministic, a few milliseconds per plan, no dependencies: it runs in
 * Node (harness) and in the browser worker alike.
 */
import { Game, Turn, WARMUP, MAX_TICKS, SPEED, ARENA, TURN } from "../engine/game.js";
import { Occupancy, Territory, FAT_CELL, FAT_RADIUS, FINE_CELL, FINE_RADIUS } from "./territory.js";

export interface ObservedPlayer {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
}

export interface ObservedBody {
  x: number;
  y: number;
  owner: number;
}

export interface BodyColumns {
  count: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  owner: ArrayLike<number>;
}

export interface Observation {
  tick: number;
  players: ObservedPlayer[];
  /** All bodies laid so far, in laying order (the bot only reads the new tail). */
  bodies: ArrayLike<ObservedBody> | BodyColumns;
}

export interface BotOptions {
  /** Ticks between re-plans. */
  replan: number;
  /** Ticks per manoeuvre segment in the search. */
  segment: number;
  /** Ticks of collision-free continuation a candidate must keep available. */
  escape: number;
  /** Open area (fat cells, 4 units² each) required at the end of the escape search, unless plenty of fine free cells remain. */
  openArea: number;
  /** Maximum segments the escape search may drive before giving up (then assumed safe). */
  escapeBudget: number;
}

export const DEFAULT_OPTIONS: BotOptions = { replan: 4, segment: 8, escape: 640, openArea: 20, escapeBudget: 2500 };

const TURNS: readonly Turn[] = [0, -1, 1];
const PRINT_ALL = [true, true];
const DEAD = -1e9;
const STRIDE = Game.SAVE_STRIDE;
const MEMO_CELL = 1; // units
const MEMO_GRID = Math.ceil(ARENA / MEMO_CELL);
const HEADINGS = 24;
/**
 * Space the opponent can reach within this many ticks (two of its manoeuvre
 * windows) is not mine to escape through if it gets there first; beyond that
 * horizon the bot will have re-planned many times.
 */
const OPP_REACH = 32;
const OPP_MARGIN = 8;

export class Bot {
  readonly game = new Game(2);
  readonly fat = new Occupancy(this.game.bodies, FAT_CELL, FAT_RADIUS, 1.2);
  readonly fine = new Occupancy(this.game.bodies, FINE_CELL, FINE_RADIUS, 0.6);
  readonly territory = new Territory(this.game, this.fat);
  readonly space = new Territory(this.game, this.fine);
  readonly options: BotOptions;
  private plan: Turn[] = [];
  private planFrom = -1;
  private lastTick = -1;
  private knownBodies = 0;
  /** The opponent's angles over the last few ticks, to estimate its current turn. */
  private readonly oppAngles: number[] = [];
  private oppTurn: Turn = 0;
  private readonly stack = new Float64Array(STRIDE * 256);
  private readonly turns: Turn[] = [0, 0];
  private readonly memo = new Int32Array(MEMO_GRID * MEMO_GRID * HEADINGS);
  private readonly dfsOrders: Turn[][] = Array.from({ length: 128 }, () => [0, -1, 1] as Turn[]);
  private readonly dfsClearances: Float64Array[] = Array.from({ length: 128 }, () => new Float64Array(3));
  private memoStamp = 0;
  /** Diagnostics from the last plan. */
  lastPlanMs = 0;
  lastScore = 0;
  lastEscape = 0;
  lastTerritory = 0;
  escapeBudgetHits = 0;
  /** When set, `search` fills `trace` with per-candidate details. */
  debug = false;
  trace: { turn: Turn; worst: number; likely: number; escape: number; path: Turn[]; nodes: number; endArea: number }[] = [];
  private bestPath: Turn[] = [];
  private curPath: Turn[] = [];
  private lastNodes = 0;
  private lastEndArea = 0;

  constructor(public readonly me: number, options: Partial<BotOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    // Rollouts continue after the opponent dies: its trail stays, it stops moving.
    this.game.endsWhenOneLeft = false;
  }

  reset(): void {
    this.plan = [];
    this.planFrom = -1;
    this.lastTick = -1;
    this.knownBodies = 0;
    this.game.bodies.clear();
    this.syncGrids();
  }

  /** Called once per tick with the current world; returns the turn for this tick. */
  decide(obs: Observation): Turn {
    this.sync(obs);
    const me = this.game.players[this.me];
    if (!me.alive) return 0;
    const offset = obs.tick - this.planFrom;
    if (this.planFrom < 0 || offset >= this.options.replan || offset >= this.plan.length) {
      const t0 = now();
      this.plan = this.search();
      this.planFrom = obs.tick;
      this.lastPlanMs = now() - t0;
      return this.plan[0];
    }
    return this.plan[offset];
  }

  /** The turn sequence the bot currently intends to follow (for overlays / debugging). */
  currentPlan(): Turn[] {
    return this.plan.slice();
  }

  private syncGrids(): void {
    this.fat.sync();
    this.fine.sync();
  }

  private sync(obs: Observation): void {
    const game = this.game;
    const bodies = obs.bodies as any;
    const columns = typeof bodies.count === "number";
    const count: number = columns ? bodies.count : bodies.length;
    if (obs.tick <= this.lastTick || count < this.knownBodies) {
      // New round (or rewind): reload everything.
      game.bodies.clear();
      this.knownBodies = 0;
      this.plan = [];
      this.planFrom = -1;
      this.lastTick = -1;
    }
    for (let i = this.knownBodies; i < count; i++) {
      const bx = columns ? bodies.x[i] : bodies[i].x;
      const by = columns ? bodies.y[i] : bodies[i].y;
      const owner = columns ? bodies.owner[i] : bodies[i].owner;
      // Bodies first seen now were laid in the last tick; on a fresh sync all are old.
      game.bodies.push(bx, by, owner, this.lastTick < 0 ? -1000 : obs.tick);
      const s = game.players[owner];
      s.lastBodyX = bx;
      s.lastBodyY = by;
      s.hasBody = true;
    }
    this.knownBodies = count;
    game.tick = obs.tick;
    game.done = false;
    obs.players.forEach((p, i) => {
      const s = game.players[i];
      s.x = p.x;
      s.y = p.y;
      s.angle = p.angle;
      s.alive = p.alive;
    });
    // Estimate the opponent's current turn from its heading over the last 4 ticks.
    const oa = obs.players[1 - this.me].angle;
    if (this.lastTick < 0) this.oppAngles.length = 0;
    this.oppAngles.push(oa);
    if (this.oppAngles.length > 5) this.oppAngles.shift();
    if (this.oppAngles.length >= 2) {
      const first = this.oppAngles[0];
      const delta = Math.atan2(Math.sin(oa - first), Math.cos(oa - first)) / ((this.oppAngles.length - 1) * TURN);
      this.oppTurn = delta > 0.5 ? 1 : delta < -0.5 ? -1 : 0;
    }
    this.syncGrids();
    this.lastTick = obs.tick;
  }

  // ---------------------------------------------------------------- search

  private search(): Turn[] {
    const game = this.game;
    const { segment, escape } = this.options;
    const stack = this.stack;
    // Manoeuvre segments are aligned to a global phase (tick % segment == 0):
    // the first segment is shortened so that every continuation the escape
    // search verifies now is still representable at the next re-plan.
    const first = segment - (game.tick % segment);
    game.save(stack, 0);
    let bestTurn: Turn = 0;
    let bestScore = -Infinity;
    let bestEscape = 0;
    let bestTerritory = 0;
    if (this.debug) this.trace = [];
    for (const turn of TURNS) {
      // Tactics: the opponent commits to one manoeuvre for a whole 16-tick
      // window (that is how its controller works), so each of its options is
      // held over both of my segments. Blend the worst case with the likely
      // case (it keeps its current turn) so that a paranoid "dead everywhere"
      // still picks the move that survives what it is actually doing.
      let worst = Infinity;
      let likely = 0;
      for (const oppTurn of TURNS) {
        game.load(stack, 0);
        const alive = this.drive(turn, oppTurn, first);
        const score = alive ? this.myBestReply(STRIDE, oppTurn) : DEAD + game.tick;
        if (score < worst) worst = score;
        if (oppTurn === this.oppTurn) likely = score;
      }
      let score = 0.5 * worst + 0.5 * likely;
      let esc = 0;
      if (likely > DEAD + MAX_TICKS) {
        // Safety: a long collision-free continuation must exist after this manoeuvre.
        game.load(stack, 0);
        this.drive(turn, 0, first);
        esc = this.escape(STRIDE);
        if (esc < escape) score -= 20000 + (escape - esc) * 40;
      }
      if (this.debug) this.trace.push({ turn, worst, likely, escape: esc, path: this.bestPath.slice(), nodes: this.lastNodes, endArea: this.lastEndArea });
      if (score > bestScore) {
        bestScore = score;
        bestTurn = turn;
        bestEscape = esc;
        bestTerritory = worst;
      }
    }
    game.load(stack, 0);
    this.syncGrids();
    this.lastScore = bestScore;
    this.lastEscape = bestEscape;
    this.lastTerritory = bestTerritory;
    const plan: Turn[] = [];
    for (let i = 0; i < first; i++) plan.push(bestTurn);
    return plan;
  }

  /** Drive `ticks` ticks with fixed turns; false if I die. */
  private drive(myTurn: Turn, oppTurn: Turn, ticks: number): boolean {
    const game = this.game;
    const turns = this.turns;
    turns[this.me] = myTurn;
    turns[1 - this.me] = oppTurn;
    const mine = game.players[this.me];
    for (let t = 0; t < ticks; t++) {
      game.step(turns, PRINT_ALL);
      if (!mine.alive) return false;
      if (game.done) return true; // tick cap reached alive
    }
    return true;
  }

  /** Best tactical score over my second segment (opponent holds `oppTurn`). */
  private myBestReply(at: number, oppTurn: Turn): number {
    const game = this.game;
    if (game.done) return this.evaluate();
    const stack = this.stack;
    game.save(stack, at);
    let best = -Infinity;
    for (const turn of TURNS) {
      game.load(stack, at);
      const alive = this.drive(turn, oppTurn, this.options.segment);
      const score = alive ? this.evaluate() : DEAD + game.tick;
      if (score > best) best = score;
    }
    game.load(stack, at);
    return best;
  }

  /** Static (tactical) evaluation of the current engine state from my point of view. */
  private evaluate(): number {
    const game = this.game;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    if (!mine.alive) return DEAD + game.tick;
    if (!other.alive) return -DEAD - game.tick;
    this.syncGrids();
    const t = this.territory.evaluate(me, opp);
    // Free space left for me, in fine cells (1 unit² each); rewards hugging
    // walls and trails instead of wasting open space.
    const room = this.space.floodArea(me);
    let score = 0;
    if (t.contested) {
      score += (t.mine - t.theirs) * 6;
    } else {
      // Separated: whoever has more room outlives the other.
      score += (t.reachMe - t.reachOpp) * 6;
    }
    score += room * 0.5;
    // Stay out of the opponent's immediate reach: within a few units a single
    // 16-tick manoeuvre of theirs can wall me in before I can turn away.
    const dx = other.x - mine.x;
    const dy = other.y - mine.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 14) score -= (14 - d) * (14 - d) * 300;
    return score;
  }

  /**
   * Longest collision-free continuation (ticks, capped at the escape horizon)
   * found by a depth-first search over my own manoeuvres with the opponent
   * going straight. A continuation only counts as complete if it ends in
   * open space, so corridors and pockets are detected as traps. States are
   * memoised by (position cell, heading) so a pocket is explored once; if the
   * search exceeds its budget the position is assumed safe.
   */
  private escape(at: number): number {
    const game = this.game;
    const seg = this.options.segment;
    const horizon = this.options.escape;
    const budget = this.options.escapeBudget;
    const stack = this.stack;
    const memo = this.memo;
    const stamp = ++this.memoStamp;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    let best = 0;
    let nodes = 0;
    let exhausted = false;
    const debug = this.debug;
    if (debug) {
      this.curPath.length = 0;
      this.bestPath.length = 0;
      this.lastEndArea = -1;
    }
    game.save(stack, at);
    // Space the opponent can reach before me is not mine to escape through:
    // it can wall it off within one of its manoeuvre windows.
    this.fat.sync();
    const oppDist = other.alive ? this.territory.fill(opp) && this.territory.dist[opp] : null;
    const fat = this.fat;
    // Per-depth scratch space: a child call must not clobber its parent's loop.
    const orders = this.dfsOrders;
    const clearances = this.dfsClearances;
    const dfs = (remaining: number, depth: number): boolean => {
      const order = orders[depth];
      const clearance = clearances[depth];
      const driven = horizon - remaining;
      if (driven > best) {
        best = driven;
        if (debug) this.bestPath = this.curPath.slice();
      }
      if (oppDist && driven > 0) {
        const od = oppDist[fat.cellOf(mine.x, mine.y)];
        if (od <= OPP_REACH && od + OPP_MARGIN < driven) {
          if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) pruned: opponent reach ${od}`);
          return false;
        }
      }
      if (remaining <= 0) {
        // Survived the whole horizon: accept if it ends somewhere with room to
        // manoeuvre (fat cells) or with plenty of free space left (fine cells).
        this.syncGrids();
        const area = this.territory.floodArea(me);
        if (debug) this.lastEndArea = area;
        return area >= this.options.openArea || this.space.floodArea(me) >= 200;
      }
      if (++nodes > budget) {
        exhausted = true;
        return false;
      }
      const cx = Math.min(MEMO_GRID - 1, Math.max(0, Math.floor(mine.x / MEMO_CELL)));
      const cy = Math.min(MEMO_GRID - 1, Math.max(0, Math.floor(mine.y / MEMO_CELL)));
      let h = Math.round((mine.angle / (2 * Math.PI)) * HEADINGS) % HEADINGS;
      if (h < 0) h += HEADINGS;
      const key = (cy * MEMO_GRID + cx) * HEADINGS + h;
      const seen = memo[key];
      if ((seen >>> 12) === stamp && (seen & 0xfff) >= remaining) {
        if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) h${h} pruned: memo ${seen & 0xfff}`);
        return false;
      }
      memo[key] = (stamp << 12) | remaining;
      const here = at + STRIDE * (depth + 1);
      game.save(stack, here);
      const ticks = Math.min(seg, remaining);
      // Try the manoeuvres that end with the most clearance first.
      for (let i = 0; i < 3; i++) {
        const turn = TURNS[i];
        game.load(stack, here);
        if (!this.drive(turn, 0, ticks)) {
          clearance[i] = -1;
          continue;
        }
        clearance[i] = game.bodies.nearest2(mine.x, mine.y, 6) + Math.min(6, mine.x, mine.y, ARENA - mine.x, ARENA - mine.y) ** 2;
      }
      for (let i = 0; i < 3; i++) order[i] = TURNS[i];
      order.sort((a, b) => clearance[TURNS.indexOf(b)] - clearance[TURNS.indexOf(a)]);
      if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) h${h} clearance S/R/L ${Array.from(clearance).map((c) => c.toFixed(1)).join("/")} order ${order.join(",")}`);
      for (const turn of order) {
        if (clearance[TURNS.indexOf(turn)] < 0) continue;
        game.load(stack, here);
        if (debug) this.curPath.push(turn);
        this.drive(turn, 0, ticks);
        if (game.done) {
          best = horizon; // survived to the tick cap
          if (debug) this.bestPath = this.curPath.slice();
          return true;
        }
        if (dfs(remaining - ticks, depth + 1)) return true;
        if (debug) this.curPath.pop();
        if (exhausted) return false;
      }
      return false;
    };
    const ok = dfs(horizon, 0);
    if (debug) {
      this.lastNodes = nodes;
      if (ok) this.bestPath = this.curPath.slice();
    }
    if (exhausted) this.escapeBudgetHits++;
    game.load(stack, at);
    this.syncGrids();
    return ok ? horizon : Math.min(best, horizon - 1);
  }
}

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
const traceDfs = typeof process !== "undefined" && !!process.env?.TRACE_DFS;

export { WARMUP, MAX_TICKS, SPEED };

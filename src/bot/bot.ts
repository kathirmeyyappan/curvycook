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
import { Occupancy, Territory, FAT_CELL, FAT_RADIUS, FINE_CELL, FINE_RADIUS, INF } from "./territory.js";

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
  /** Maximum segments the escape search may drive before giving up (then treated as unsafe). */
  escapeBudget: number;
  /** Memo granularity of the escape search: cell size in units and number of heading buckets. */
  memoCell: number;
  memoHeadings: number;
  /** Bodies are inflated to this radius on the territory grid (collision distance is 1.2). */
  fatRadius: number;
  /** Score bonus for keeping straight (smooth trails waste less space). */
  straightBonus: number;
  /** Score penalty for reversing the previous plan's turn direction. */
  reversalPenalty: number;
  /** Opponent travel-time scale in the territory race (> 1 claims space more boldly). */
  oppSlack: number;
  /** Once separated, bonus for keeping the head at lane distance (1.3–2.2) from the nearest obstacle. */
  hugBonus: number;
  /** Escape search move ordering: "open" tries the most open manoeuvre first, "lane" the one that follows walls. */
  dfsOrder: "open" | "lane";
  /** Space the opponent can reach within this many ticks is not mine to escape through if it gets there first. */
  oppReach: number;
  /** Ticks both players are driven straight on from a leaf before the territory is judged (rewards long clean lines). */
  momentum: number;
  /** Once the regions are separated, pick the move whose escape search survives longest (dense, dead-end-free filling). */
  fillMode: boolean;
}

export const DEFAULT_OPTIONS: BotOptions = {
  replan: 4,
  segment: 8,
  escape: 640,
  openArea: 20,
  escapeBudget: 2500,
  memoCell: 1,
  memoHeadings: 24,
  fatRadius: FAT_RADIUS,
  straightBonus: 0,
  reversalPenalty: 0,
  oppSlack: 1,
  hugBonus: 0,
  dfsOrder: "open",
  oppReach: 32,
  momentum: 0,
  fillMode: false,
};

const TURNS: readonly Turn[] = [0, -1, 1];
const PRINT_ALL = [true, true];
const DEAD = -1e9;
const DEAD_MOVE = -1e9; // clearance marker for a manoeuvre that dies
const STRIDE = Game.SAVE_STRIDE;
const MEMO_GRID_MAX = Math.ceil(ARENA / 0.5) + 1;
/**
 * Space the opponent can reach within this many ticks (two of its manoeuvre
 * windows) is not mine to escape through if it gets there first; beyond that
 * horizon the bot will have re-planned many times.
 */
const OPP_REACH = 32;
const OPP_MARGIN = 8;

export class Bot {
  readonly game = new Game(2);
  readonly options: BotOptions;
  readonly fat: Occupancy;
  readonly fine = new Occupancy(this.game.bodies, FINE_CELL, FINE_RADIUS, 0.6);
  readonly territory: Territory;
  readonly space = new Territory(this.game, this.fine);
  private readonly memoGrid: number;
  private readonly memoCell: number;
  private readonly headings: number;
  private lastTurn: Turn = 0;
  /** Fill mode: the per-tick turns of a verified long continuation, from `fillFrom`. */
  private fillPath: Turn[] = [];
  private fillFrom = -1;
  private plan: Turn[] = [];
  private planFrom = -1;
  private lastTick = -1;
  private knownBodies = 0;
  /** The opponent's angles over the last few ticks, to estimate its current turn. */
  private readonly oppAngles: number[] = [];
  private oppTurn: Turn = 0;
  private readonly stack = new Float64Array(STRIDE * 256); // search depth < 200; slots 200/201 are evaluation scratch
  private readonly turns: Turn[] = [0, 0];
  private readonly memo: Int32Array;
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
    this.fat = new Occupancy(this.game.bodies, FAT_CELL, this.options.fatRadius, 1.2);
    this.territory = new Territory(this.game, this.fat);
    this.memoCell = this.options.memoCell;
    this.memoGrid = Math.ceil(ARENA / this.memoCell) + 1;
    this.headings = this.options.memoHeadings;
    this.memo = new Int32Array(this.memoGrid * this.memoGrid * this.headings);
    // Rollouts continue after the opponent dies: its trail stays, it stops moving.
    this.game.endsWhenOneLeft = false;
  }

  reset(): void {
    this.plan = [];
    this.fillPath = [];
    this.fillFrom = -1;
    this.lastTurn = 0;
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

  /**
   * The next `first` turns of the committed fill path, if it still exists,
   * covers the current tick, keeps the bot alive to its end (re-simulated
   * against the current trails) and has a useful length left.
   */
  private committedPlan(first: number): Turn[] | null {
    const game = this.game;
    const offset = game.tick - this.fillFrom;
    if (this.fillFrom < 0 || offset < 0 || offset + first > this.fillPath.length) return null;
    const remaining = this.fillPath.length - offset;
    if (remaining < 96) return null; // nearly consumed: search again
    const stack = this.stack;
    game.save(stack, 0);
    const turns = this.turns;
    turns[1 - this.me] = 0;
    const mine = game.players[this.me];
    let ok = true;
    for (let i = offset; i < this.fillPath.length; i++) {
      turns[this.me] = this.fillPath[i];
      game.step(turns, PRINT_ALL);
      if (!mine.alive) {
        ok = false;
        break;
      }
      if (game.done) break;
    }
    game.load(stack, 0);
    this.syncGrids();
    if (!ok) {
      this.fillPath = [];
      this.fillFrom = -1;
      return null;
    }
    return this.fillPath.slice(offset, offset + first);
  }

  /** True when the opponent's head cannot reach my region any more (fine grid). */
  private separated(): boolean {
    const other = this.game.players[1 - this.me];
    if (!other.alive) return true;
    this.syncGrids();
    this.space.fill(this.me);
    return this.space.dist[this.me][this.fine.cellOf(other.x, other.y)] === INF;
  }

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
    if (this.options.fillMode && this.separated()) {
      // Filling: nothing the opponent does matters any more. Follow the
      // committed long continuation while it stays valid; otherwise search
      // for the move that survives longest (ties: most room, hug the walls).
      const committed = this.committedPlan(first);
      if (committed) {
        this.lastScore = this.options.escape * 100;
        this.lastEscape = this.options.escape;
        this.lastTurn = committed[0];
        return committed;
      }
      let bestPath: Turn[] = [];
      for (const turn of TURNS) {
        game.load(stack, 0);
        let score: number;
        let esc = 0;
        let path: Turn[] = [];
        if (!this.drive(turn, 0, first)) score = DEAD + game.tick;
        else {
          esc = this.escape(STRIDE);
          path = this.bestPath.slice();
          game.load(stack, 0);
          this.drive(turn, 0, first);
          score = esc * 100 + this.staticScore();
          if (turn === 0) score += this.options.straightBonus;
          else if (this.lastTurn !== 0 && turn !== this.lastTurn) score -= this.options.reversalPenalty;
        }
        if (this.debug) this.trace.push({ turn, worst: score, likely: score, escape: esc, path: path.slice(), nodes: this.lastNodes, endArea: this.lastEndArea });
        if (score > bestScore) {
          bestScore = score;
          bestTurn = turn;
          bestEscape = esc;
          bestTerritory = score;
          bestPath = path;
        }
      }
      game.load(stack, 0);
      this.syncGrids();
      this.lastScore = bestScore;
      this.lastEscape = bestEscape;
      this.lastTerritory = bestTerritory;
      this.lastTurn = bestTurn;
      const plan: Turn[] = [];
      for (let i = 0; i < first; i++) plan.push(bestTurn);
      if (bestEscape >= this.options.escape) {
        // Commit: first segment, then the search's segments (8 ticks each).
        this.fillPath = plan.slice();
        for (const t of bestPath) for (let i = 0; i < segment; i++) this.fillPath.push(t);
        this.fillFrom = game.tick;
      } else {
        this.fillPath = [];
        this.fillFrom = -1;
      }
      return plan;
    }
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
      if (turn === 0) score += this.options.straightBonus;
      else if (this.lastTurn !== 0 && turn !== this.lastTurn) score -= this.options.reversalPenalty;
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
    this.lastTurn = bestTurn;
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
    const momentum = this.options.momentum;
    if (momentum > 0) {
      // Judge the position a little further down the road: both keep going
      // straight (stopping each one just before it would die).
      const at = STRIDE * 200;
      game.save(this.stack, at);
      const score = this.momentumScore(momentum);
      game.load(this.stack, at);
      return score;
    }
    return this.staticScore();
  }

  private momentumScore(ticks: number): number {
    const game = this.game;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    const turns = this.turns;
    turns[0] = 0;
    turns[1] = 0;
    const probe = this.stack;
    const at = STRIDE * 201;
    for (let t = 0; t < ticks; t++) {
      game.save(probe, at);
      const aliveMe = mine.alive;
      const aliveOpp = other.alive;
      game.step(turns, PRINT_ALL);
      if (mine.alive !== aliveMe || other.alive !== aliveOpp || game.done) {
        // Someone would die here: evaluate the last safe state instead.
        game.load(probe, at);
        break;
      }
    }
    return this.staticScore();
  }

  /** Territory, room and distance terms for the current engine state. */
  private staticScore(): number {
    const game = this.game;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    this.syncGrids();
    const t = this.territory.evaluate(me, opp, this.options.oppSlack);
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
    if (!t.contested && this.options.hugBonus) {
      // Dense filling: lanes next to existing trails or walls waste the least space.
      const wall = Math.min(mine.x, mine.y, ARENA - mine.x, ARENA - mine.y) - 0.6;
      const clearance = Math.min(wall, Math.sqrt(game.bodies.nearest2(mine.x, mine.y, 6)) - 1.2);
      if (clearance >= 0.1 && clearance <= 1.0) score += this.options.hugBonus;
      else if (clearance < 2.0) score += this.options.hugBonus * (2.0 - clearance);
    }
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
    this.curPath.length = 0;
    this.bestPath.length = 0;
    this.lastEndArea = -1;
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
        this.bestPath = this.curPath.slice();
      }
      if (oppDist && driven > 0) {
        const od = oppDist[fat.cellOf(mine.x, mine.y)];
        if (od <= this.options.oppReach && od + OPP_MARGIN < driven) {
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
      const memoGrid = this.memoGrid;
      const headings = this.headings;
      const cx = Math.min(memoGrid - 1, Math.max(0, Math.floor(mine.x / this.memoCell)));
      const cy = Math.min(memoGrid - 1, Math.max(0, Math.floor(mine.y / this.memoCell)));
      let h = Math.round((mine.angle / (2 * Math.PI)) * headings) % headings;
      if (h < 0) h += headings;
      const key = (cy * memoGrid + cx) * headings + h;
      const seen = memo[key];
      if ((seen >>> 12) === stamp && (seen & 0xfff) >= remaining) {
        if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) h${h} pruned: memo ${seen & 0xfff}`);
        return false;
      }
      memo[key] = (stamp << 12) | remaining;
      const here = at + STRIDE * (depth + 1);
      game.save(stack, here);
      const ticks = Math.min(seg, remaining);
      // Order the manoeuvres by where they end: "open" tries the most
      // clearance first, "lane" prefers staying about one lane away from the
      // nearest obstacle, which finds long paths in half-filled regions.
      const lane = this.options.dfsOrder === "lane";
      for (let i = 0; i < 3; i++) {
        const turn = TURNS[i];
        game.load(stack, here);
        if (!this.drive(turn, 0, ticks)) {
          clearance[i] = DEAD_MOVE;
          continue;
        }
        const wall = Math.min(6, mine.x, mine.y, ARENA - mine.x, ARENA - mine.y);
        const gap = Math.min(Math.sqrt(game.bodies.nearest2(mine.x, mine.y, 6)) - 1.2, wall - 0.6);
        clearance[i] = lane ? 10 - Math.abs(gap - 0.8) : gap;
      }
      for (let i = 0; i < 3; i++) order[i] = TURNS[i];
      order.sort((a, b) => clearance[TURNS.indexOf(b)] - clearance[TURNS.indexOf(a)]);
      if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) h${h} clearance S/R/L ${Array.from(clearance).map((c) => c.toFixed(1)).join("/")} order ${order.join(",")}`);
      for (const turn of order) {
        if (clearance[TURNS.indexOf(turn)] === DEAD_MOVE) continue;
        game.load(stack, here);
        this.curPath.push(turn);
        this.drive(turn, 0, ticks);
        if (game.done) {
          best = horizon; // survived to the tick cap
          this.bestPath = this.curPath.slice();
          return true;
        }
        if (dfs(remaining - ticks, depth + 1)) return true;
        this.curPath.pop();
        if (exhausted) return false;
      }
      return false;
    };
    const ok = dfs(horizon, 0);
    this.lastNodes = nodes;
    if (ok) this.bestPath = this.curPath.slice();
    if (exhausted) this.escapeBudgetHits++;
    game.load(stack, at);
    this.syncGrids();
    return ok ? horizon : Math.min(best, horizon - 1);
  }
}

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
const traceDfs = typeof process !== "undefined" && !!process.env?.TRACE_DFS;

export { WARMUP, MAX_TICKS, SPEED };

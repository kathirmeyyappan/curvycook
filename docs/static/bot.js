// Built from src/ by `npm run build`. Do not edit by hand.

// src/engine/game.ts
var ARENA = 88;
var RADIUS = 0.6;
var TICK_HZ = 60;
var SPEED = 16 / TICK_HZ;
var TURN = 2.8 / TICK_HZ;
var BODY_SPACING = RADIUS;
var COLLIDE = 2 * RADIUS;
var OWN_GRACE = 4;
var WARMUP = 180;
var MAX_TICKS = 3600;
var TURN_RADIUS = SPEED / TURN;
var CELL = COLLIDE;
var CELLS_PER_AXIS = Math.ceil(ARENA / CELL) + 2;
var MAX_BODIES = 8192;
var BodyStore = class _BodyStore {
  xs = new Float64Array(MAX_BODIES);
  ys = new Float64Array(MAX_BODIES);
  ticks = new Int32Array(MAX_BODIES);
  owners = new Int8Array(MAX_BODIES);
  count = 0;
  cells;
  constructor() {
    this.cells = new Array(CELLS_PER_AXIS * CELLS_PER_AXIS);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }
  static cellIndex(x, y) {
    let cx = Math.floor(x / CELL) + 1;
    let cy = Math.floor(y / CELL) + 1;
    if (cx < 0) cx = 0;
    else if (cx >= CELLS_PER_AXIS) cx = CELLS_PER_AXIS - 1;
    if (cy < 0) cy = 0;
    else if (cy >= CELLS_PER_AXIS) cy = CELLS_PER_AXIS - 1;
    return cy * CELLS_PER_AXIS + cx;
  }
  push(x, y, owner, tick) {
    const i = this.count++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.owners[i] = owner;
    this.ticks[i] = tick;
    this.cells[_BodyStore.cellIndex(x, y)].push(i);
  }
  /** Remove bodies until only `count` remain (search undo). */
  truncate(count) {
    while (this.count > count) {
      const i = --this.count;
      this.cells[_BodyStore.cellIndex(this.xs[i], this.ys[i])].pop();
    }
  }
  clear() {
    this.truncate(0);
  }
  /** True if the head of `player` at (x, y) on `tick` touches a body. */
  hits(x, y, player, tick) {
    const cx = Math.floor(x / CELL) + 1;
    const cy = Math.floor(y / CELL) + 1;
    const r2 = COLLIDE * COLLIDE;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= CELLS_PER_AXIS) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= CELLS_PER_AXIS) continue;
        const cell = this.cells[yy * CELLS_PER_AXIS + xx];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (this.owners[i] === player && tick - this.ticks[i] <= OWN_GRACE) continue;
          const ddx = this.xs[i] - x;
          const ddy = this.ys[i] - y;
          if (ddx * ddx + ddy * ddy < r2) return true;
        }
      }
    }
    return false;
  }
  /** Squared distance from (x, y) to the nearest body (any owner), capped at `maxDist`. */
  nearest2(x, y, maxDist) {
    const reach = Math.ceil(maxDist / CELL);
    const cx = Math.floor(x / CELL) + 1;
    const cy = Math.floor(y / CELL) + 1;
    let best = maxDist * maxDist;
    for (let dy = -reach; dy <= reach; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= CELLS_PER_AXIS) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= CELLS_PER_AXIS) continue;
        const cell = this.cells[yy * CELLS_PER_AXIS + xx];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          const ddx = this.xs[i] - x;
          const ddy = this.ys[i] - y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < best) best = d2;
        }
      }
    }
    return best;
  }
};
var Game = class {
  constructor(nPlayers = 2) {
    this.nPlayers = nPlayers;
    this.players = [];
    for (let p = 0; p < nPlayers; p++) {
      this.players.push({ x: 0, y: 0, angle: 0, alive: true, lastBodyX: 0, lastBodyY: 0, hasBody: false, outcome: 0 /* Ongoing */ });
    }
  }
  tick = 0;
  done = false;
  /**
   * The real game ends as soon as one player is left. A search engine sets
   * this to false so hypothetical rollouts keep simulating the survivor after
   * the other player dies (its trail stays, it just stops moving).
   */
  endsWhenOneLeft = true;
  players;
  bodies = new BodyStore();
  /** Reset to given head poses with an empty arena. */
  reset(poses) {
    this.tick = 0;
    this.done = false;
    this.bodies.clear();
    poses.forEach((pose, p) => {
      const s = this.players[p];
      s.x = pose.x;
      s.y = pose.y;
      s.angle = pose.angle;
      s.alive = true;
      s.hasBody = false;
      s.outcome = 0 /* Ongoing */;
    });
  }
  /** Load a mid-game state (used to sync the bot's engine with the real simulator). */
  loadWorld(tick, players, bodies) {
    this.tick = tick;
    this.done = false;
    this.bodies.clear();
    for (const s of this.players) {
      s.hasBody = false;
      s.outcome = 0 /* Ongoing */;
    }
    for (const b of bodies) {
      this.bodies.push(b.x, b.y, b.owner, b.tick ?? -1e3);
      const s = this.players[b.owner];
      s.lastBodyX = b.x;
      s.lastBodyY = b.y;
      s.hasBody = true;
    }
    players.forEach((pl, p) => {
      const s = this.players[p];
      s.x = pl.x;
      s.y = pl.y;
      s.angle = pl.angle;
      s.alive = pl.alive;
    });
  }
  /** Number of doubles `save` writes per game (2 players). */
  static SAVE_STRIDE = 3 + 2 * 8;
  /** Save the mutable state (not the bodies themselves, only their count) into a flat buffer. */
  save(buf, at) {
    buf[at] = this.tick;
    buf[at + 1] = this.done ? 1 : 0;
    buf[at + 2] = this.bodies.count;
    let i = at + 3;
    for (const s of this.players) {
      buf[i++] = s.x;
      buf[i++] = s.y;
      buf[i++] = s.angle;
      buf[i++] = s.alive ? 1 : 0;
      buf[i++] = s.lastBodyX;
      buf[i++] = s.lastBodyY;
      buf[i++] = s.hasBody ? 1 : 0;
      buf[i++] = s.outcome;
    }
  }
  /** Restore state saved with `save`; bodies laid since are discarded. */
  load(buf, at) {
    this.tick = buf[at];
    this.done = buf[at + 1] === 1;
    this.bodies.truncate(buf[at + 2]);
    let i = at + 3;
    for (const s of this.players) {
      s.x = buf[i++];
      s.y = buf[i++];
      s.angle = buf[i++];
      s.alive = buf[i++] === 1;
      s.lastBodyX = buf[i++];
      s.lastBodyY = buf[i++];
      s.hasBody = buf[i++] === 1;
      s.outcome = buf[i++];
    }
  }
  snapshot() {
    return { tick: this.tick, done: this.done, bodyCount: this.bodies.count, players: this.players.map((p) => ({ ...p })) };
  }
  /** Restore a snapshot taken from this same game (bodies are truncated to the snapshot's count). */
  restore(s) {
    this.tick = s.tick;
    this.done = s.done;
    this.bodies.truncate(s.bodyCount);
    for (let p = 0; p < this.players.length; p++) Object.assign(this.players[p], s.players[p]);
  }
  /**
   * Advance one tick. `turns[p]` is the turn of player p; `printing[p]` says
   * whether player p prints this tick (ignored during warmup).
   */
  step(turns, printing) {
    if (this.done) return;
    const tick = this.tick + 1;
    const players = this.players;
    const n = players.length;
    for (let p = 0; p < n; p++) {
      const s = players[p];
      if (!s.alive) continue;
      s.angle += turns[p] * TURN;
      s.x += SPEED * Math.cos(s.angle);
      s.y += SPEED * Math.sin(s.angle);
    }
    this.tick = tick;
    let alive = 0;
    for (let p = 0; p < n; p++) {
      const s = players[p];
      if (!s.alive) continue;
      if (s.x < RADIUS || s.x > ARENA - RADIUS || s.y < RADIUS || s.y > ARENA - RADIUS || this.bodies.hits(s.x, s.y, p, tick)) {
        s.alive = false;
      } else alive++;
    }
    if (tick > WARMUP) {
      for (let p = 0; p < n; p++) {
        const s = players[p];
        if (!s.alive || !printing[p]) continue;
        if (s.hasBody) {
          const dx = s.x - s.lastBodyX;
          const dy = s.y - s.lastBodyY;
          if (dx * dx + dy * dy < BODY_SPACING * BODY_SPACING) continue;
        }
        this.bodies.push(s.x, s.y, p, tick);
        s.lastBodyX = s.x;
        s.lastBodyY = s.y;
        s.hasBody = true;
      }
    }
    if (alive <= (this.endsWhenOneLeft ? 1 : 0) || tick >= MAX_TICKS) {
      this.done = true;
      for (let p = 0; p < n; p++) {
        const s = players[p];
        s.outcome = alive === 1 ? s.alive ? 1 /* Won */ : 2 /* Lost */ : 3 /* Tied */;
      }
    }
  }
  /** Would player p be dead at (x, y) on `tick`? (walls + bodies) */
  blocked(x, y, p, tick) {
    return x < RADIUS || x > ARENA - RADIUS || y < RADIUS || y > ARENA - RADIUS || this.bodies.hits(x, y, p, tick);
  }
};

// src/bot/territory.ts
var INF = 1073741823;
var Occupancy = class {
  // number of bodies reflected in the raster
  constructor(bodies, cell, radius, edgeMargin = RADIUS) {
    this.bodies = bodies;
    this.cell = cell;
    this.radius = radius;
    this.grid = Math.round(ARENA / cell);
    this.cells = this.grid * this.grid;
    this.blocker = new Int32Array(this.cells).fill(INF);
    this.stack = new Int32Array(1 << 20);
    this.edgeOk = new Uint8Array(this.cells);
    for (let cy = 0; cy < this.grid; cy++) {
      for (let cx = 0; cx < this.grid; cx++) {
        const x = (cx + 0.5) * cell;
        const y = (cy + 0.5) * cell;
        this.edgeOk[cy * this.grid + cx] = x > edgeMargin && x < ARENA - edgeMargin && y > edgeMargin && y < ARENA - edgeMargin ? 1 : 0;
      }
    }
  }
  grid;
  cells;
  /** Lowest body index that blocks each cell, or INF. */
  blocker;
  /** Cells whose centre is too close to the arena edge are never enterable. */
  edgeOk;
  stack;
  stackTop = 0;
  start = new Int32Array(8192 + 1);
  synced = 0;
  cellOf(x, y) {
    const g = this.grid;
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= g) cx = g - 1;
    if (cy < 0) cy = 0;
    else if (cy >= g) cy = g - 1;
    return cy * g + cx;
  }
  /** Bring the raster up to date with the body stack (handles both pushes and truncation). */
  sync() {
    const bodies = this.bodies;
    if (bodies.count < this.synced) {
      const keep = this.start[bodies.count];
      while (this.stackTop > keep) this.blocker[this.stack[--this.stackTop]] = INF;
      this.synced = bodies.count;
    }
    while (this.synced < bodies.count) {
      const i = this.synced;
      this.start[i] = this.stackTop;
      this.block(bodies.xs[i], bodies.ys[i], i);
      this.synced = i + 1;
    }
    this.start[this.synced] = this.stackTop;
  }
  block(x, y, body) {
    const r = this.radius;
    const cell = this.cell;
    const g = this.grid;
    const cx0 = Math.max(0, Math.floor((x - r) / cell));
    const cx1 = Math.min(g - 1, Math.floor((x + r) / cell));
    const cy0 = Math.max(0, Math.floor((y - r) / cell));
    const cy1 = Math.min(g - 1, Math.floor((y + r) / cell));
    const r2 = r * r;
    for (let cy = cy0; cy <= cy1; cy++) {
      const dy = (cy + 0.5) * cell - y;
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * cell - x;
        if (dx * dx + dy * dy >= r2) continue;
        const c = cy * g + cx;
        if (this.blocker[c] !== INF) continue;
        this.blocker[c] = body;
        this.stack[this.stackTop++] = c;
      }
    }
  }
  free(c) {
    return this.blocker[c] === INF && this.edgeOk[c] === 1;
  }
};
var BucketQueue = class {
  buckets = [];
  cursor = 0;
  push(cost, item) {
    (this.buckets[cost] ??= []).push(item);
    if (cost < this.cursor) this.cursor = cost;
  }
  pop(out) {
    while (this.cursor < this.buckets.length) {
      const b = this.buckets[this.cursor];
      if (b && b.length) {
        out[0] = this.cursor;
        out[1] = b.pop();
        return true;
      }
      this.cursor++;
    }
    return false;
  }
  clear() {
    for (const b of this.buckets) if (b) b.length = 0;
    this.cursor = 0;
  }
};
var ARC_TICKS = 24;
function arcSeeds(game, player, occ, out) {
  out.length = 0;
  const s = game.players[player];
  for (const turn of [-1, 0, 1]) {
    let x = s.x;
    let y = s.y;
    let a = s.angle;
    let last = -1;
    for (let t = 1; t <= ARC_TICKS; t++) {
      a += turn * TURN;
      x += SPEED * Math.cos(a);
      y += SPEED * Math.sin(a);
      if (game.blocked(x, y, player, game.tick + t)) break;
      const c = occ.cellOf(x, y);
      if (c !== last) {
        last = c;
        out.push({ cell: c, ticks: t });
      }
    }
  }
}
var Territory = class {
  constructor(game, occ) {
    this.game = game;
    this.occ = occ;
    this.dist = [new Int32Array(occ.cells), new Int32Array(occ.cells)];
    this.floodStack = new Int32Array(occ.cells);
    this.floodMark = new Int32Array(occ.cells);
    this.cellTicks = Math.max(1, Math.round(occ.cell / SPEED));
    this.diagTicks = Math.max(1, Math.round(occ.cell * Math.SQRT2 / SPEED));
  }
  dist;
  queue = new BucketQueue();
  popped = new Int32Array(2);
  seeds = [];
  floodStack;
  floodMark;
  floodStamp = 0;
  cellTicks;
  diagTicks;
  /** Dijkstra from one head; fills dist[player] (INF = unreachable). Returns the reachable cell count. */
  fill(player) {
    const occ = this.occ;
    const g = occ.grid;
    const dist = this.dist[player];
    dist.fill(INF);
    const q = this.queue;
    q.clear();
    arcSeeds(this.game, player, occ, this.seeds);
    if (!this.seeds.length) return 0;
    for (const seed of this.seeds) {
      if (seed.ticks < dist[seed.cell]) {
        dist[seed.cell] = seed.ticks;
        q.push(seed.ticks, seed.cell);
      }
    }
    let reached = 0;
    const out = this.popped;
    const blocker = occ.blocker;
    const edgeOk = occ.edgeOk;
    while (q.pop(out)) {
      const d = out[0];
      const c = out[1];
      if (d !== dist[c]) continue;
      reached++;
      const cx = c % g;
      const cy = (c - cx) / g;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= g) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= g) continue;
          const nc = ny * g + nx;
          if (!edgeOk[nc] || blocker[nc] !== INF) continue;
          if (dx && dy && !(blocker[cy * g + nx] === INF && blocker[ny * g + cx] === INF)) continue;
          const nd = d + (dx && dy ? this.diagTicks : this.cellTicks);
          if (nd < dist[nc]) {
            dist[nc] = nd;
            q.push(nd, nc);
          }
        }
      }
    }
    return reached;
  }
  /** Number of free cells connected to the head of `player` (ignores kinematics beyond the first arcs). */
  floodArea(player) {
    const occ = this.occ;
    const g = occ.grid;
    const blocker = occ.blocker;
    const edgeOk = occ.edgeOk;
    const mark = this.floodMark;
    const stamp = ++this.floodStamp;
    const stack = this.floodStack;
    let top = 0;
    arcSeeds(this.game, player, occ, this.seeds);
    for (const seed of this.seeds) {
      if (mark[seed.cell] !== stamp) {
        mark[seed.cell] = stamp;
        stack[top++] = seed.cell;
      }
    }
    let area = 0;
    while (top) {
      const c = stack[--top];
      area++;
      const cx = c % g;
      if (cx > 0) {
        const nc = c - 1;
        if (mark[nc] !== stamp && edgeOk[nc] && blocker[nc] === INF) {
          mark[nc] = stamp;
          stack[top++] = nc;
        }
      }
      if (cx < g - 1) {
        const nc = c + 1;
        if (mark[nc] !== stamp && edgeOk[nc] && blocker[nc] === INF) {
          mark[nc] = stamp;
          stack[top++] = nc;
        }
      }
      if (c >= g) {
        const nc = c - g;
        if (mark[nc] !== stamp && edgeOk[nc] && blocker[nc] === INF) {
          mark[nc] = stamp;
          stack[top++] = nc;
        }
      }
      if (c < occ.cells - g) {
        const nc = c + g;
        if (mark[nc] !== stamp && edgeOk[nc] && blocker[nc] === INF) {
          mark[nc] = stamp;
          stack[top++] = nc;
        }
      }
    }
    return area;
  }
  /**
   * Voronoi evaluation from `me`'s point of view. `oppSlack` scales the
   * opponent's travel times (> 1 assumes it contests space more slowly).
   */
  evaluate(me, opp, oppSlack = 1) {
    const reachMe = this.fill(me);
    const reachOpp = this.fill(opp);
    const a = this.dist[me];
    const b = this.dist[opp];
    let mine = 0;
    let theirs = 0;
    let contested = false;
    const n = this.occ.cells;
    for (let c = 0; c < n; c++) {
      const da = a[c];
      const db = b[c];
      if (da === INF && db === INF) continue;
      if (da !== INF && db !== INF) contested = true;
      const dbs = db === INF ? INF : db * oppSlack;
      if (da < dbs) mine++;
      else if (dbs < da) theirs++;
    }
    return { mine, theirs, reachMe, reachOpp, contested };
  }
};
var FAT_CELL = 2;
var FAT_RADIUS = COLLIDE + 0.6;
var FINE_CELL = 1;
var FINE_RADIUS = COLLIDE;

// src/bot/bot.ts
var DEFAULT_OPTIONS = {
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
  fillMode: false
};
var TURNS = [0, -1, 1];
var PRINT_ALL = [true, true];
var DEAD = -1e9;
var DEAD_MOVE = -1e9;
var STRIDE = Game.SAVE_STRIDE;
var MEMO_GRID_MAX = Math.ceil(ARENA / 0.5) + 1;
var OPP_MARGIN = 8;
var Bot = class {
  constructor(me, options = {}) {
    this.me = me;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fat = new Occupancy(this.game.bodies, FAT_CELL, this.options.fatRadius, 1.2);
    this.territory = new Territory(this.game, this.fat);
    this.memoCell = this.options.memoCell;
    this.memoGrid = Math.ceil(ARENA / this.memoCell) + 1;
    this.headings = this.options.memoHeadings;
    this.memo = new Int32Array(this.memoGrid * this.memoGrid * this.headings);
    this.game.endsWhenOneLeft = false;
  }
  game = new Game(2);
  options;
  fat;
  fine = new Occupancy(this.game.bodies, FINE_CELL, FINE_RADIUS, 0.6);
  territory;
  space = new Territory(this.game, this.fine);
  memoGrid;
  memoCell;
  headings;
  lastTurn = 0;
  /** Fill mode: the per-tick turns of a verified long continuation, from `fillFrom`. */
  fillPath = [];
  fillFrom = -1;
  plan = [];
  planFrom = -1;
  lastTick = -1;
  knownBodies = 0;
  /** The opponent's angles over the last few ticks, to estimate its current turn. */
  oppAngles = [];
  oppTurn = 0;
  stack = new Float64Array(STRIDE * 256);
  // search depth < 200; slots 200/201 are evaluation scratch
  turns = [0, 0];
  memo;
  dfsOrders = Array.from({ length: 128 }, () => [0, -1, 1]);
  dfsClearances = Array.from({ length: 128 }, () => new Float64Array(3));
  memoStamp = 0;
  /** Diagnostics from the last plan. */
  lastPlanMs = 0;
  lastScore = 0;
  lastEscape = 0;
  lastTerritory = 0;
  escapeBudgetHits = 0;
  /** When set, `search` fills `trace` with per-candidate details. */
  debug = false;
  trace = [];
  bestPath = [];
  curPath = [];
  lastNodes = 0;
  lastEndArea = 0;
  reset() {
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
  decide(obs) {
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
  currentPlan() {
    return this.plan.slice();
  }
  syncGrids() {
    this.fat.sync();
    this.fine.sync();
  }
  sync(obs) {
    const game = this.game;
    const bodies = obs.bodies;
    const columns = typeof bodies.count === "number";
    const count = columns ? bodies.count : bodies.length;
    if (obs.tick <= this.lastTick || count < this.knownBodies) {
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
      game.bodies.push(bx, by, owner, this.lastTick < 0 ? -1e3 : obs.tick);
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
  committedPlan(first) {
    const game = this.game;
    const offset = game.tick - this.fillFrom;
    if (this.fillFrom < 0 || offset < 0 || offset + first > this.fillPath.length) return null;
    const remaining = this.fillPath.length - offset;
    if (remaining < 96) return null;
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
  separated() {
    const other = this.game.players[1 - this.me];
    if (!other.alive) return true;
    this.syncGrids();
    this.space.fill(this.me);
    return this.space.dist[this.me][this.fine.cellOf(other.x, other.y)] === INF;
  }
  search() {
    const game = this.game;
    const { segment, escape } = this.options;
    const stack = this.stack;
    const first = segment - game.tick % segment;
    game.save(stack, 0);
    let bestTurn = 0;
    let bestScore = -Infinity;
    let bestEscape = 0;
    let bestTerritory = 0;
    if (this.debug) this.trace = [];
    if (this.options.fillMode && this.separated()) {
      const committed = this.committedPlan(first);
      if (committed) {
        this.lastScore = this.options.escape * 100;
        this.lastEscape = this.options.escape;
        this.lastTurn = committed[0];
        return committed;
      }
      let bestPath = [];
      for (const turn of TURNS) {
        game.load(stack, 0);
        let score;
        let esc = 0;
        let path = [];
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
      const plan2 = [];
      for (let i = 0; i < first; i++) plan2.push(bestTurn);
      if (bestEscape >= this.options.escape) {
        this.fillPath = plan2.slice();
        for (const t of bestPath) for (let i = 0; i < segment; i++) this.fillPath.push(t);
        this.fillFrom = game.tick;
      } else {
        this.fillPath = [];
        this.fillFrom = -1;
      }
      return plan2;
    }
    for (const turn of TURNS) {
      let worst = Infinity;
      let likely = 0;
      for (const oppTurn of TURNS) {
        game.load(stack, 0);
        const alive = this.drive(turn, oppTurn, first);
        const score2 = alive ? this.myBestReply(STRIDE, oppTurn) : DEAD + game.tick;
        if (score2 < worst) worst = score2;
        if (oppTurn === this.oppTurn) likely = score2;
      }
      let score = 0.5 * worst + 0.5 * likely;
      if (turn === 0) score += this.options.straightBonus;
      else if (this.lastTurn !== 0 && turn !== this.lastTurn) score -= this.options.reversalPenalty;
      let esc = 0;
      if (likely > DEAD + MAX_TICKS) {
        game.load(stack, 0);
        this.drive(turn, 0, first);
        esc = this.escape(STRIDE);
        if (esc < escape) score -= 2e4 + (escape - esc) * 40;
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
    const plan = [];
    for (let i = 0; i < first; i++) plan.push(bestTurn);
    return plan;
  }
  /** Drive `ticks` ticks with fixed turns; false if I die. */
  drive(myTurn, oppTurn, ticks) {
    const game = this.game;
    const turns = this.turns;
    turns[this.me] = myTurn;
    turns[1 - this.me] = oppTurn;
    const mine = game.players[this.me];
    for (let t = 0; t < ticks; t++) {
      game.step(turns, PRINT_ALL);
      if (!mine.alive) return false;
      if (game.done) return true;
    }
    return true;
  }
  /** Best tactical score over my second segment (opponent holds `oppTurn`). */
  myBestReply(at, oppTurn) {
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
  evaluate() {
    const game = this.game;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    if (!mine.alive) return DEAD + game.tick;
    if (!other.alive) return -DEAD - game.tick;
    const momentum = this.options.momentum;
    if (momentum > 0) {
      const at = STRIDE * 200;
      game.save(this.stack, at);
      const score = this.momentumScore(momentum);
      game.load(this.stack, at);
      return score;
    }
    return this.staticScore();
  }
  momentumScore(ticks) {
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
        game.load(probe, at);
        break;
      }
    }
    return this.staticScore();
  }
  /** Territory, room and distance terms for the current engine state. */
  staticScore() {
    const game = this.game;
    const me = this.me;
    const opp = 1 - me;
    const mine = game.players[me];
    const other = game.players[opp];
    this.syncGrids();
    const t = this.territory.evaluate(me, opp, this.options.oppSlack);
    const room = this.space.floodArea(me);
    let score = 0;
    if (t.contested) {
      score += (t.mine - t.theirs) * 6;
    } else {
      score += (t.reachMe - t.reachOpp) * 6;
    }
    score += room * 0.5;
    if (!t.contested && this.options.hugBonus) {
      const wall = Math.min(mine.x, mine.y, ARENA - mine.x, ARENA - mine.y) - 0.6;
      const clearance = Math.min(wall, Math.sqrt(game.bodies.nearest2(mine.x, mine.y, 6)) - 1.2);
      if (clearance >= 0.1 && clearance <= 1) score += this.options.hugBonus;
      else if (clearance < 2) score += this.options.hugBonus * (2 - clearance);
    }
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
  escape(at) {
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
    this.fat.sync();
    const oppDist = other.alive ? this.territory.fill(opp) && this.territory.dist[opp] : null;
    const fat = this.fat;
    const orders = this.dfsOrders;
    const clearances = this.dfsClearances;
    const dfs = (remaining, depth) => {
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
      let h = Math.round(mine.angle / (2 * Math.PI) * headings) % headings;
      if (h < 0) h += headings;
      const key = (cy * memoGrid + cx) * headings + h;
      const seen = memo[key];
      if (seen >>> 12 === stamp && (seen & 4095) >= remaining) {
        if (traceDfs) console.log(`    dfs d${depth} rem ${remaining} at (${mine.x.toFixed(1)},${mine.y.toFixed(1)}) h${h} pruned: memo ${seen & 4095}`);
        return false;
      }
      memo[key] = stamp << 12 | remaining;
      const here = at + STRIDE * (depth + 1);
      game.save(stack, here);
      const ticks = Math.min(seg, remaining);
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
          best = horizon;
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
};
var now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
var traceDfs = typeof process !== "undefined" && !!process.env?.TRACE_DFS;

// src/web/bot-policy.ts
function createBotPolicy(simulator, seat, options = {}) {
  const bot = new Bot(seat, options);
  const players = Array.from({ length: 2 }, () => ({ x: 0, y: 0, angle: 0, alive: true }));
  const bodies = { count: 0, x: [], y: [], owner: [] };
  return {
    observe: false,
    bot,
    reset: () => bot.reset(),
    decide: async () => {
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
      const turn = bot.decide({ tick, players, bodies });
      if (tick % 300 === 0 && bot.lastPlanMs) {
        console.log(`[curvycook] tick ${tick} seat ${seat} score ${bot.lastScore.toFixed(0)} escape ${bot.lastEscape} plan ${bot.lastPlanMs.toFixed(1)}ms bodies ${bodies.count}`);
      }
      return turn + 1;
    }
  };
}
export {
  Bot,
  DEFAULT_OPTIONS,
  createBotPolicy
};

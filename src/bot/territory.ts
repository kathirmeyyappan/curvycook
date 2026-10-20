/**
 * Grid-based spatial reasoning over the engine state.
 *
 * `Occupancy` rasterises the trail bodies at a chosen cell size and blocking
 * radius; it is kept in sync with the engine's body stack so it can be
 * truncated along with it during search.
 *
 * `Territory` runs multi-source Dijkstra from each head (seeded with the
 * short arcs the head can actually drive, so the turning radius is respected
 * near the head) and counts the cells each player reaches strictly first
 * (Voronoi partition), plus plain flood fills for region sizes.
 *
 * Two instances are used by the bot:
 *  - a "fat" grid (2-unit cells, bodies inflated to 1.8) whose cells are
 *    places a player can realistically manoeuvre through, for territory;
 *  - a "fine" grid (1-unit cells, bodies inflated to the exact 1.2 collision
 *    distance) for measuring how much free space is left in a region.
 */
import { ARENA, COLLIDE, RADIUS, SPEED, TURN, Game, BodyStore } from "../engine/game.js";

export const INF = 0x3fffffff;

export class Occupancy {
  readonly grid: number;
  readonly cells: number;
  /** Lowest body index that blocks each cell, or INF. */
  readonly blocker: Int32Array;
  /** Cells whose centre is too close to the arena edge are never enterable. */
  readonly edgeOk: Uint8Array;
  private readonly stack: Int32Array;
  private stackTop = 0;
  private readonly start = new Int32Array(8192 + 1);
  private synced = 0; // number of bodies reflected in the raster

  constructor(private readonly bodies: BodyStore, readonly cell: number, readonly radius: number, edgeMargin = RADIUS) {
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

  cellOf(x: number, y: number): number {
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
  sync(): void {
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

  private block(x: number, y: number, body: number): void {
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

  free(c: number): boolean {
    return this.blocker[c] === INF && this.edgeOk[c] === 1;
  }
}

/** Bucket queue for small integer tick costs. */
class BucketQueue {
  private buckets: number[][] = [];
  private cursor = 0;
  push(cost: number, item: number): void {
    (this.buckets[cost] ??= []).push(item);
    if (cost < this.cursor) this.cursor = cost;
  }
  pop(out: Int32Array): boolean {
    while (this.cursor < this.buckets.length) {
      const b = this.buckets[this.cursor];
      if (b && b.length) {
        out[0] = this.cursor;
        out[1] = b.pop()!;
        return true;
      }
      this.cursor++;
    }
    return false;
  }
  clear(): void {
    for (const b of this.buckets) if (b) b.length = 0;
    this.cursor = 0;
  }
}

export interface Seed {
  cell: number;
  ticks: number;
}

const ARC_TICKS = 24;

/**
 * The cells a head can drive to within ARC_TICKS ticks by holding one turn
 * (left / straight / right), with their arrival ticks. These seed the
 * searches so a cell just behind the head is not counted as adjacent.
 */
export function arcSeeds(game: Game, player: number, occ: Occupancy, out: Seed[]): void {
  out.length = 0;
  const s = game.players[player];
  for (const turn of [-1, 0, 1] as const) {
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

export interface TerritoryResult {
  /** Cells I reach strictly before the opponent. */
  mine: number;
  /** Cells the opponent reaches strictly before me. */
  theirs: number;
  /** Cells reachable by me / the opponent at all. */
  reachMe: number;
  reachOpp: number;
  /** True when some cell is reachable by both (regions not yet separated). */
  contested: boolean;
}

export class Territory {
  readonly dist: Int32Array[];
  private readonly queue = new BucketQueue();
  private readonly popped = new Int32Array(2);
  private readonly seeds: Seed[] = [];
  private readonly floodStack: Int32Array;
  private readonly floodMark: Int32Array;
  private floodStamp = 0;
  private readonly cellTicks: number;
  private readonly diagTicks: number;

  constructor(private readonly game: Game, readonly occ: Occupancy) {
    this.dist = [new Int32Array(occ.cells), new Int32Array(occ.cells)];
    this.floodStack = new Int32Array(occ.cells);
    this.floodMark = new Int32Array(occ.cells);
    this.cellTicks = Math.max(1, Math.round(occ.cell / SPEED));
    this.diagTicks = Math.max(1, Math.round((occ.cell * Math.SQRT2) / SPEED));
  }

  /** Dijkstra from one head; fills dist[player] (INF = unreachable). Returns the reachable cell count. */
  fill(player: number): number {
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
          // No corner cutting between two blocked orthogonal neighbours.
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
  floodArea(player: number): number {
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

  /** Voronoi evaluation from `me`'s point of view. */
  evaluate(me: number, opp: number): TerritoryResult {
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
      if (da < db) mine++;
      else if (db < da) theirs++;
    }
    return { mine, theirs, reachMe, reachOpp, contested };
  }
}

export const FAT_CELL = 2.0;
export const FAT_RADIUS = COLLIDE + 0.6;
export const FINE_CELL = 1.0;
export const FINE_RADIUS = COLLIDE;

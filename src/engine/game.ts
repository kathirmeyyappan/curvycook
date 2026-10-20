/**
 * A faithful TypeScript re-implementation of the curvytron-rl Warp simulator's
 * rules (no powerups). Every constant below was measured against the real
 * simulator (see src/harness/validate.ts, which replays random games in both
 * and checks they agree tick for tick).
 *
 * Rules:
 *  - Arena is ARENA x ARENA units, y grows upwards. A player is a disc of
 *    radius RADIUS that moves SPEED units per tick in direction `angle`.
 *  - Each tick a player first turns (+-TURN radians, or 0) and then moves
 *    along its *new* heading.
 *  - A player dies when its centre gets within RADIUS of an arena edge.
 *  - After WARMUP ticks players print a trail: whenever the head is at least
 *    BODY_SPACING away from the last body it laid, a new body disc is dropped
 *    at the head position. The simulator randomly interrupts printing to leave
 *    holes (16-25 ticks long, every ~70-220 ticks); the engine takes the
 *    printing flags as input because that randomness is not reproducible.
 *  - A player dies when its centre is within COLLIDE (= 2 * RADIUS) of any
 *    body, except its own bodies laid in the last OWN_GRACE ticks.
 *  - The round ends when at most one player is alive, or at MAX_TICKS.
 */

export const ARENA = 88;
export const RADIUS = 0.6;
export const TICK_HZ = 60;
export const SPEED = 16 / TICK_HZ; // 0.26667 units per tick
export const TURN = 2.8 / TICK_HZ; // 0.046667 rad per tick
export const BODY_SPACING = RADIUS; // measured: 0.533 < spacing <= 0.667
export const COLLIDE = 2 * RADIUS; // measured: 1.19 dies, 1.21 survives
export const OWN_GRACE = 4; // own bodies <= 4 ticks old are ignored
export const WARMUP = 180; // no trail is printed during the first 180 ticks
export const MAX_TICKS = 3600;
export const TURN_RADIUS = SPEED / TURN; // 5.714 units

/** -1 = right, 0 = straight, 1 = left (matches the simulator's code-0 actions 0/1/2 minus one). */
export type Turn = -1 | 0 | 1;

export const enum Outcome {
  Ongoing = 0,
  Won = 1,
  Lost = 2,
  Tied = 3,
}

const CELL = COLLIDE; // grid cell size: any body within COLLIDE lies in the 3x3 neighbourhood
const CELLS_PER_AXIS = Math.ceil(ARENA / CELL) + 2; // +2 for a border cell on each side
const MAX_BODIES = 8192;

/**
 * All trail bodies of all players in one stack-ordered store with a uniform
 * grid for proximity queries. Bodies are only ever pushed in time order and
 * popped in reverse (search undo), so each cell list is itself a stack.
 */
export class BodyStore {
  readonly xs = new Float64Array(MAX_BODIES);
  readonly ys = new Float64Array(MAX_BODIES);
  readonly ticks = new Int32Array(MAX_BODIES);
  readonly owners = new Int8Array(MAX_BODIES);
  count = 0;
  private readonly cells: number[][];

  constructor() {
    this.cells = new Array(CELLS_PER_AXIS * CELLS_PER_AXIS);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  static cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / CELL) + 1;
    let cy = Math.floor(y / CELL) + 1;
    if (cx < 0) cx = 0;
    else if (cx >= CELLS_PER_AXIS) cx = CELLS_PER_AXIS - 1;
    if (cy < 0) cy = 0;
    else if (cy >= CELLS_PER_AXIS) cy = CELLS_PER_AXIS - 1;
    return cy * CELLS_PER_AXIS + cx;
  }

  push(x: number, y: number, owner: number, tick: number): void {
    const i = this.count++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.owners[i] = owner;
    this.ticks[i] = tick;
    this.cells[BodyStore.cellIndex(x, y)].push(i);
  }

  /** Remove bodies until only `count` remain (search undo). */
  truncate(count: number): void {
    while (this.count > count) {
      const i = --this.count;
      this.cells[BodyStore.cellIndex(this.xs[i], this.ys[i])].pop();
    }
  }

  clear(): void {
    this.truncate(0);
  }

  /** True if the head of `player` at (x, y) on `tick` touches a body. */
  hits(x: number, y: number, player: number, tick: number): boolean {
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
  nearest2(x: number, y: number, maxDist: number): number {
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
}

export interface PlayerState {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  /** Position of the last body this player laid (valid when hasBody). */
  lastBodyX: number;
  lastBodyY: number;
  hasBody: boolean;
  outcome: Outcome;
}

export interface Snapshot {
  tick: number;
  done: boolean;
  bodyCount: number;
  players: PlayerState[];
}

export class Game {
  tick = 0;
  done = false;
  /**
   * The real game ends as soon as one player is left. A search engine sets
   * this to false so hypothetical rollouts keep simulating the survivor after
   * the other player dies (its trail stays, it just stops moving).
   */
  endsWhenOneLeft = true;
  readonly players: PlayerState[];
  readonly bodies = new BodyStore();

  constructor(public readonly nPlayers = 2) {
    this.players = [];
    for (let p = 0; p < nPlayers; p++) {
      this.players.push({ x: 0, y: 0, angle: 0, alive: true, lastBodyX: 0, lastBodyY: 0, hasBody: false, outcome: Outcome.Ongoing });
    }
  }

  /** Reset to given head poses with an empty arena. */
  reset(poses: { x: number; y: number; angle: number }[]): void {
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
      s.outcome = Outcome.Ongoing;
    });
  }

  /** Load a mid-game state (used to sync the bot's engine with the real simulator). */
  loadWorld(tick: number, players: { x: number; y: number; angle: number; alive: boolean }[], bodies: { x: number; y: number; owner: number; tick?: number }[]): void {
    this.tick = tick;
    this.done = false;
    this.bodies.clear();
    for (const s of this.players) {
      s.hasBody = false;
      s.outcome = Outcome.Ongoing;
    }
    for (const b of bodies) {
      // Unknown body ages are treated as old (tick 0 = long ago).
      this.bodies.push(b.x, b.y, b.owner, b.tick ?? -1000);
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
  static readonly SAVE_STRIDE = 3 + 2 * 8;

  /** Save the mutable state (not the bodies themselves, only their count) into a flat buffer. */
  save(buf: Float64Array, at: number): void {
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
  load(buf: Float64Array, at: number): void {
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

  snapshot(): Snapshot {
    return { tick: this.tick, done: this.done, bodyCount: this.bodies.count, players: this.players.map((p) => ({ ...p })) };
  }

  /** Restore a snapshot taken from this same game (bodies are truncated to the snapshot's count). */
  restore(s: Snapshot): void {
    this.tick = s.tick;
    this.done = s.done;
    this.bodies.truncate(s.bodyCount);
    for (let p = 0; p < this.players.length; p++) Object.assign(this.players[p], s.players[p]);
  }

  /**
   * Advance one tick. `turns[p]` is the turn of player p; `printing[p]` says
   * whether player p prints this tick (ignored during warmup).
   */
  step(turns: ArrayLike<Turn>, printing: ArrayLike<boolean>): void {
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
    // Bodies are laid after the collision check: a player dying this tick leaves no body.
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
        s.outcome = alive === 1 ? (s.alive ? Outcome.Won : Outcome.Lost) : Outcome.Tied;
      }
    }
  }

  /** Would player p be dead at (x, y) on `tick`? (walls + bodies) */
  blocked(x: number, y: number, p: number, tick: number): boolean {
    return x < RADIUS || x > ARENA - RADIUS || y < RADIUS || y > ARENA - RADIUS || this.bodies.hits(x, y, p, tick);
  }
}

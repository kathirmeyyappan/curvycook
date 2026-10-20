import { createBotPolicy } from "./bot.js";

// python/static/play-model.js
var RUNTIME_URL = new URL(
  "../modules/onnxruntime-web/dist/ort.wasm.min.mjs",
  import.meta.url
);
var WASM_URL = new URL("../modules/onnxruntime-web/dist/", import.meta.url);
async function loadOnnxRuntime(runtimeUrl = RUNTIME_URL, wasmUrl = WASM_URL) {
  const runtime = await import(runtimeUrl.href || runtimeUrl);
  runtime.env.wasm.wasmPaths = wasmUrl.href || wasmUrl;
  return runtime;
}
function concreteShape(spec, batch) {
  return spec.shape.map((dimension) => {
    if (dimension === "batch") return batch;
    if (Number.isInteger(dimension)) return dimension;
    throw new Error(`A ${dimension} dimension must be supplied with tensor data`);
  });
}
function elementCount(shape) {
  return shape.reduce((count, dimension) => count * dimension, 1);
}
function inferShape(spec, length) {
  const symbolic = spec.shape.filter((dimension) => !Number.isInteger(dimension));
  if (!symbolic.length) {
    if (elementCount(spec.shape) !== length) {
      throw new Error(`${spec.name} data does not fit its shape`);
    }
    return spec.shape;
  }
  if (symbolic.length !== 1 || symbolic[0] !== "batch") {
    throw new Error(`${spec.name} requires explicit dims`);
  }
  const itemSize = elementCount(spec.shape.slice(1));
  if (length % itemSize) throw new Error(`${spec.name} data does not fit its shape`);
  return concreteShape(spec, length / itemSize);
}
function typedData(dtype, data) {
  if (dtype === "float32") {
    return data instanceof Float32Array ? data : Float32Array.from(data);
  }
  if (dtype === "uint8") {
    return data instanceof Uint8Array ? data : Uint8Array.from(data);
  }
  if (dtype === "int64") {
    return data instanceof BigInt64Array ? data : BigInt64Array.from(data, BigInt);
  }
  throw new Error(`Unsupported ONNX tensor dtype ${dtype}`);
}
function createTensor(runtime, spec, value) {
  if (value instanceof runtime.Tensor) return value;
  const supplied = value?.data === void 0 ? { data: value } : value;
  const data = typedData(spec.dtype, supplied.data);
  const dims = supplied.dims || inferShape(spec, data.length);
  if (elementCount(dims) !== data.length) {
    throw new Error(`${spec.name} data length does not match dims`);
  }
  return new runtime.Tensor(spec.dtype, data, dims);
}
function selectAction(logits, sample, random) {
  const actions = logits.dims.at(-1);
  const offset = logits.data.length - actions;
  if (!sample) {
    let selected = 0;
    for (let action2 = 1; action2 < actions; action2 += 1) {
      if (logits.data[offset + action2] > logits.data[offset + selected]) {
        selected = action2;
      }
    }
    return selected;
  }
  let maximum = -Infinity;
  for (let action2 = 0; action2 < actions; action2 += 1) {
    maximum = Math.max(maximum, logits.data[offset + action2]);
  }
  const probabilities = new Float64Array(actions);
  let total = 0;
  for (let action2 = 0; action2 < actions; action2 += 1) {
    probabilities[action2] = Math.exp(logits.data[offset + action2] - maximum);
    total += probabilities[action2];
  }
  let draw = random() * total;
  for (let action2 = 0; action2 < actions; action2 += 1) {
    draw -= probabilities[action2];
    if (draw <= 0) return action2;
  }
  return actions - 1;
}
var ClientPolicy = class _ClientPolicy {
  static async load(manifest, options = {}) {
    const runtime = options.runtime || await loadOnnxRuntime(
      options.runtimeUrl,
      options.wasmUrl
    );
    const session = await runtime.InferenceSession.create(manifest.url, {
      executionProviders: ["wasm"],
      ...options.session
    });
    return { runtime, session, contract: manifest.contract };
  }
  static async create(manifest, options = {}) {
    const loaded = await _ClientPolicy.load(manifest, options);
    return new _ClientPolicy(loaded.runtime, loaded.session, loaded.contract);
  }
  constructor(runtime, session, contract) {
    this.runtime = runtime;
    this.session = session;
    this.contract = contract;
    this.inputSpecs = new Map(contract.inputs.map((spec) => [spec.name, spec]));
    this.state = {};
  }
  reset(batch = 1) {
    this.state = Object.fromEntries(this.contract.state.map(([input]) => {
      const spec = this.inputSpecs.get(input);
      const dims = concreteShape(spec, batch);
      return [input, new this.runtime.Tensor(spec.dtype, typedData(
        spec.dtype,
        new Array(elementCount(dims)).fill(0)
      ), dims)];
    }));
  }
  async infer(inputs, { sample = false, random = Math.random } = {}) {
    const feeds = {};
    for (const spec of this.contract.inputs) {
      if (inputs[spec.name] !== void 0) {
        feeds[spec.name] = createTensor(this.runtime, spec, inputs[spec.name]);
      }
    }
    const first = Object.values(feeds)[0];
    if (this.contract.state.length && !Object.keys(this.state).length) {
      this.reset(first?.dims[0] || 1);
    }
    Object.assign(feeds, this.state);
    const outputs = await this.session.run(feeds);
    for (const [input, output] of this.contract.state) {
      this.state[input] = outputs[output];
    }
    return {
      action: selectAction(outputs.logits, sample, random),
      logits: outputs.logits
    };
  }
};

// python/static/play-wasm-simulator.js
var ARRAY_TYPES = {
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
  float64: Float64Array
};
var size = (shape) => shape.reduce((product, value) => product * value, 1);
var BrowserSimulator = class {
  constructor(runtime, contract, graph) {
    this.runtime = runtime;
    this.contract = contract;
    this.operations = contract.operations;
    this.regionSpecs = new Map(
      contract.regions.map((region, index) => [region.name, { ...region, index }])
    );
    runtime.FS.writeFile("/runtime.wrp", new Uint8Array(graph));
    this.instance = runtime._runtime_create();
    if (!this.instance) throw new Error("unable to create Warp browser runtime");
    this.capacity = this.region("actions").length;
    this.nPlayers = this.capacity;
    this.config = null;
  }
  region(name) {
    const spec = this.regionSpecs.get(name);
    if (!spec) throw new Error(`unknown browser runtime region ${name}`);
    const ArrayType = ARRAY_TYPES[spec.dtype];
    if (!ArrayType) throw new Error(`unsupported browser runtime dtype ${spec.dtype}`);
    const pointer = Number(this.runtime._runtime_region(this.instance, spec.index));
    const length = size(spec.shape);
    const bytes = Number(this.runtime._runtime_region_size(this.instance, spec.index));
    if (!pointer || bytes !== length * ArrayType.BYTES_PER_ELEMENT) {
      throw new Error(`invalid browser runtime region ${name}`);
    }
    return new ArrayType(this.runtime.HEAPU8.buffer, pointer, length);
  }
  execute(operation) {
    this.region("command")[0] = this.operations[operation];
    if (!this.runtime._runtime_execute(this.instance)) {
      throw new Error(`Warp operation failed: ${operation}`);
    }
  }
  close() {
    if (!this.instance) return;
    this.runtime._runtime_destroy(this.instance);
    this.instance = 0;
  }
  init({
    n_players: nPlayers,
    arena_size: arenaSize,
    radius,
    max_ticks: maxTicks,
    action_schemes: actionSchemes,
    powerups,
    powerup_spawns: powerupSpawns
  }, seed = 0) {
    const expected = this.contract.constants;
    if (nPlayers < 1 || nPlayers > expected.player_capacity) {
      throw new RangeError(`runtime player capacity is ${expected.player_capacity}, not ${nPlayers}`);
    }
    if (actionSchemes && actionSchemes.length !== nPlayers) {
      throw new RangeError(`expected ${nPlayers} action schemes, got ${actionSchemes.length}`);
    }
    const received = {
      arena_size: arenaSize,
      radius,
      tick_cap: maxTicks
    };
    for (const [name, value] of Object.entries(received)) {
      if (value !== expected[name]) {
        throw new RangeError(`runtime ${name} is ${expected[name]}, not ${value}`);
      }
    }
    this.nPlayers = nPlayers;
    this.region("active_players")[0] = nPlayers;
    if (actionSchemes) {
      const codes = this.region("action_codes");
      const granularities = this.region("action_granularities");
      const windows = this.region("action_windows");
      actionSchemes.forEach((scheme, player) => {
        codes[player] = scheme.code;
        granularities[player] = scheme.granularity;
        windows[player] = scheme.window;
      });
    }
    this.config = { n_players: nPlayers, arena_size: arenaSize, radius, max_ticks: maxTicks, powerups };
    this.reset(seed);
    this.configurePowerupSpawns(
      powerupSpawns?.types ?? Object.keys(powerups || {}),
      powerupSpawns?.rate ?? 0
    );
    return this.snapshot();
  }
  reset(seed = 0) {
    this.region("seed")[0] = BigInt(seed);
    this.execute("reset");
    return this.snapshot();
  }
  setAction(player, action2) {
    if (player < 0 || player >= this.nPlayers) throw new RangeError(`invalid player ${player}`);
    this.region("actions")[player] = BigInt(action2);
  }
  advance() {
    this.execute("step");
    return this.snapshot();
  }
  step(actions) {
    if (actions.length !== this.nPlayers) {
      throw new RangeError(`expected ${this.nPlayers} actions, got ${actions.length}`);
    }
    actions.forEach((action2, player) => this.setAction(player, action2));
    return this.advance();
  }
  beginDecision() {
    this.execute("begin_decision");
  }
  activatePowerup(name, collector = 0) {
    const powerup = this.config.powerups?.[name];
    if (!powerup) throw new RangeError(`unknown powerup ${name}`);
    if (collector < 0 || collector >= this.nPlayers) {
      throw new RangeError(`invalid player ${collector}`);
    }
    this.region("powerup")[0] = powerup.code;
    this.region("powerup_collector")[0] = collector;
    this.region("powerup_duration")[0] = powerup.duration_ticks;
    this.execute("activate_powerup");
    return this.snapshot();
  }
  configurePowerupSpawns(names, rate = 0) {
    const mask = names.reduce((value, name) => {
      const powerup = this.config.powerups?.[name];
      if (!powerup) throw new RangeError(`unknown powerup ${name}`);
      return value | 1 << powerup.code;
    }, 0);
    this.region("powerup_spawn_types")[0] = mask;
    this.region("powerup_spawn_rate")[0] = Math.max(-1, Math.min(1, rate));
    this.execute("configure_powerup_spawns");
  }
  observe(player) {
    if (player < 0 || player >= this.nPlayers) throw new RangeError(`invalid player ${player}`);
    this.execute(`observe_${player}`);
    return this.region(`features_${player}`).slice();
  }
  snapshot() {
    const x = this.region("x");
    const y = this.region("y");
    const angle = this.region("angle");
    const alive = this.region("alive");
    const printing = this.region("printing");
    const outcomes = this.region("outcomes");
    const tick = this.region("ticks")[0];
    const fastUntil = this.region("fast_until");
    const slowUntil = this.region("slow_until");
    const rigidUntil = this.region("rigid_until");
    const pickupCount = Number(this.region("powerup_counts")[0]);
    const pickupX = this.region("powerup_x");
    const pickupY = this.region("powerup_y");
    const pickupTypes = this.region("powerup_types");
    const powerupNames = Object.fromEntries(
      Object.entries(this.config.powerups || {}).map(([name, powerup]) => [powerup.code, name])
    );
    const players = Array.from({ length: this.nPlayers }, (_, player) => ({
      x: x[player] / this.config.arena_size,
      y: y[player] / this.config.arena_size,
      angle: angle[player],
      alive: Boolean(alive[player]),
      printing: Boolean(printing[player]),
      trail_active: Boolean(printing[player]),
      outcome: outcomes[player],
      speed_multiplier: Math.max(
        0.5,
        1 + (fastUntil[player] > tick ? 0.75 : 0) - (slowUntil[player] > tick ? 0.5 : 0)
      ),
      rigid: rigidUntil[player] > tick
    }));
    return {
      tick,
      done: Boolean(this.region("done")[0]),
      borderless: this.region("borderless_until")[0] > tick,
      trail_generation: this.region("trail_generation")[0],
      powerups: Array.from({ length: pickupCount }, (_, pickup) => ({
        x: pickupX[pickup] / this.config.arena_size,
        y: pickupY[pickup] / this.config.arena_size,
        type: powerupNames[pickupTypes[pickup]]
      })),
      players
    };
  }
  bodies() {
    const count = Number(this.region("body_counts")[0]);
    const x = this.region("body_x");
    const y = this.region("body_y");
    const owner = this.region("body_owner");
    return Array.from({ length: count }, (_, body) => ({
      x: x[body],
      y: y[body],
      owner: owner[body]
    }));
  }
};
async function loadBrowserRuntime(url) {
  const runtime = await import(url);
  return runtime.default();
}
async function loadBrowserGraph(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`unable to load Warp graph: ${response.status}`);
  return response.arrayBuffer();
}

// python/static/play-client-worker.js
var action = 1;
var configuredSeed = 0n;
var game = null;
var running = false;
var simulator = null;
var configuration = 0;
var modelCache = /* @__PURE__ */ new Map();
var runtimeCache = /* @__PURE__ */ new Map();
var pythonCache = /* @__PURE__ */ new Map();
var controls = {
  action: () => action,
  now: () => performance.now() / 1e3,
  running: () => running
};
var absoluteUrl = (url) => new URL(url, import.meta.url).href;
function outcome(frame) {
  const winner = frame.players.findIndex((player) => player.outcome === 1);
  const names = ["ongoing", "won", "lost", "tied"];
  return { winner, outcome: names[frame.players[0].outcome] };
}
async function source(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`unable to load Python runtime source: ${response.status}`);
  return response.text();
}
async function loadPolicy(actor, onnxruntime) {
  if (!actor) return null;
  if (actor.bot) return { bot: actor.bot };
  const manifest = { ...actor.model, url: absoluteUrl(actor.model.url) };
  let loaded = modelCache.get(manifest.url);
  if (!loaded) {
    loaded = ClientPolicy.load(manifest, onnxruntime && {
      runtimeUrl: absoluteUrl(onnxruntime.runtime_url),
      wasmUrl: absoluteUrl(onnxruntime.wasm_url)
    });
    modelCache.set(manifest.url, loaded);
  }
  const model = await loaded;
  return new ClientPolicy(model.runtime, model.session, model.contract);
}
async function loadPython(config2) {
  const key = [config2.python.url, config2.schedule_url, config2.game_url].join("\n");
  let loaded = pythonCache.get(key);
  if (loaded) return loaded;
  loaded = (async () => {
    const [{ loadMicroPython }, scheduleSource, gameSource] = await Promise.all([
      import(absoluteUrl(config2.python.url)),
      source(absoluteUrl(config2.schedule_url)),
      source(absoluteUrl(config2.game_url))
    ]);
    const python = await loadMicroPython({
      url: absoluteUrl(config2.python.wasm_url),
      heapsize: 4 * 1024 * 1024
    });
    python.FS.writeFile("game_schedule.py", scheduleSource);
    python.FS.writeFile("browser_game.py", gameSource);
    return python.pyimport("browser_game");
  })();
  pythonCache.set(key, loaded);
  return loaded;
}
async function loadSimulator(config2) {
  const url = absoluteUrl(config2.simulator.url);
  let runtime = runtimeCache.get(url);
  if (!runtime) {
    runtime = loadBrowserRuntime(url);
    runtimeCache.set(url, runtime);
  }
  const [loadedRuntime, graph] = await Promise.all([
    runtime,
    loadBrowserGraph(absoluteUrl(config2.simulator.graph_url))
  ]);
  return new BrowserSimulator(loadedRuntime, config2.simulator.runtime, graph);
}
async function configure(config2, requestedConfiguration) {
  running = false;
  const [module, nextSimulator, policies] = await Promise.all([
    loadPython(config2),
    loadSimulator(config2),
    Promise.all(config2.actors.map((actor) => loadPolicy(actor, config2.onnxruntime)))
  ]);
  if (requestedConfiguration !== configuration) {
    nextSimulator.close();
    return;
  }
  game = null;
  simulator?.close();
  simulator = nextSimulator;
  simulator.init(config2.simulator.config, config2.seed);
  const policyAdapters = policies.map((policy, seat) => {
    if (!policy) return null;
    if (policy.bot) return createBotPolicy(simulator, seat, policy.bot);
    return {
      observe: true,
      reset: () => policy.reset(1),
      decide: async (features) => (await policy.infer({ features })).action
    };
  });
  const decisionWindows = config2.actors.map((actor) => actor?.decision_window || 1);
  game = module.BrowserGame(
    simulator,
    policyAdapters,
    decisionWindows,
    config2.human_seat
  );
  configuredSeed = BigInt(config2.seed);
  postMessage({ type: "local_ready" });
}
async function run(config2) {
  action = 1;
  running = true;
  game.reset(configuredSeed.toString());
  configuredSeed += 1n;
  const emit = (frame2) => postMessage({ type: "frame", ...frame2 });
  const frame = await game.run(controls, emit, config2.tick_hz);
  if (!running || !frame?.done) return;
  running = false;
  postMessage({ type: "end", ...outcome(frame), ticks: frame.tick, players: frame.players });
  postMessage({ type: "local_ready" });
}
var config;
self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "configure") {
      config = message.config;
      configuration += 1;
      await configure(config, configuration);
    } else if (message.type === "start" && game && !running) {
      await run(config);
    } else if (message.type === "input") {
      action = message.action;
    } else if (message.type === "powerup" && simulator && running) {
      simulator.activatePowerup(message.powerup, message.collector);
      postMessage({ type: "powerup" });
    } else if (message.type === "powerup_spawns" && simulator && !running) {
      simulator.configurePowerupSpawns(message.types, message.rate);
    } else if (message.type === "stop") {
      running = false;
    }
  } catch (error) {
    running = false;
    postMessage({ type: "error", message: error.message, stack: error.stack });
  }
};

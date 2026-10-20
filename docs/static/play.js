// python/static/play-replay.js
function createReplay({ end: end2, slider, time, playButton, render, tickHz }) {
  const card = end2.firstElementChild;
  let frames = [];
  let active = false;
  let playing = false;
  let animationFrame = 0;
  let lastTime = 0;
  let drag = null;
  function setPlaying(next) {
    playing = next && frames.length > 1;
    playButton.textContent = playing ? "Pause" : "Play";
    lastTime = 0;
    if (playing && !animationFrame) animationFrame = requestAnimationFrame(advance);
  }
  function advance(now) {
    animationFrame = 0;
    if (!playing) return;
    if (!lastTime || now - lastTime < 1e3 / tickHz()) {
      lastTime ||= now;
      animationFrame = requestAnimationFrame(advance);
      return;
    }
    slider.value = (Number(slider.value) + 1) % frames.length;
    render(Number(slider.value));
    lastTime = now;
    animationFrame = requestAnimationFrame(advance);
  }
  function show(nextFrames) {
    frames = nextFrames;
    active = true;
    const lastFrame = Math.max(frames.length - 1, 0);
    slider.max = lastFrame;
    requestAnimationFrame(() => {
      if (!active || frames !== nextFrames) return;
      slider.value = lastFrame;
    });
    end2.classList.remove("hidden");
    setPlaying(false);
    if (frames.length) render(lastFrame);
  }
  function hide2() {
    active = false;
    setPlaying(false);
    end2.classList.add("hidden");
  }
  slider.addEventListener("sl-input", () => render(Number(slider.value)));
  playButton.addEventListener("click", () => setPlaying(!playing));
  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input, button, sl-range")) return;
    const rect = card.getBoundingClientRect();
    const parent = end2.getBoundingClientRect();
    const left = rect.left - parent.left;
    const top = rect.top - parent.top;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.transform = "none";
    drag = { x: event.clientX, y: event.clientY, left, top };
    card.classList.add("dragging");
    card.setPointerCapture(event.pointerId);
  });
  card.addEventListener("pointermove", (event) => {
    if (!drag) return;
    card.style.left = `${drag.left + event.clientX - drag.x}px`;
    card.style.top = `${drag.top + event.clientY - drag.y}px`;
  });
  card.addEventListener("pointerup", () => {
    drag = null;
    card.classList.remove("dragging");
  });
  return {
    get active() {
      return active;
    },
    hide: hide2,
    show,
    step(direction) {
      setPlaying(false);
      slider.value = (Number(slider.value) + direction + frames.length) % frames.length;
      render(Number(slider.value));
    },
    toggle() {
      setPlaying(!playing);
    }
  };
}

// python/static/play-avatars.js
function createAvatarRenderer({ context, colors, size: size3, pixelRatio, simulator: simulator2 }) {
  let avatars = [];
  const clearedDeadHeads = /* @__PURE__ */ new Set();
  let renderSize2 = size3;
  let renderPixelRatio2 = pixelRatio;
  function position(player) {
    return [player.x * renderSize2, (1 - player.y) * renderSize2];
  }
  function make(index) {
    const radius = Math.max(2, simulator2().radius * renderSize2 / simulator2().arena_size);
    const width = Math.ceil(radius * 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * renderPixelRatio2);
    canvas.height = Math.ceil(width * renderPixelRatio2);
    const sprite = canvas.getContext("2d");
    sprite.scale(renderPixelRatio2, renderPixelRatio2);
    sprite.beginPath();
    sprite.arc(width / 2, width / 2, radius, 0, 2 * Math.PI);
    sprite.fillStyle = colors[index % colors.length];
    sprite.fill();
    return { canvas, radius: width / 2, width, clearX: 0, clearY: 0, clearWidth: width };
  }
  function setPlayers(count) {
    avatars = Array.from({ length: count }, (_2, index) => make(index));
    clearedDeadHeads.clear();
  }
  function reset() {
    context.clearRect(0, 0, renderSize2, renderSize2);
    clearedDeadHeads.clear();
    avatars.forEach((avatar) => {
      avatar.clearX = 0;
      avatar.clearY = 0;
      avatar.clearWidth = avatar.width;
    });
  }
  function clear() {
    avatars.forEach((avatar) => context.clearRect(avatar.clearX, avatar.clearY, avatar.clearWidth, avatar.clearWidth));
  }
  function clearDeadHeads(players) {
    players.forEach((player, index) => {
      if (!player.alive) clearedDeadHeads.add(index);
    });
  }
  function draw(players) {
    players.forEach((player, index) => {
      if (player.alive) clearedDeadHeads.delete(index);
      if (clearedDeadHeads.has(index)) return;
      const avatar = avatars[index];
      const [x2, y3] = position(player);
      const left = x2 - avatar.radius;
      const top = y3 - avatar.radius;
      context.drawImage(avatar.canvas, left, top, avatar.width, avatar.width);
      avatar.clearX = Math.floor(left) - 1;
      avatar.clearY = Math.floor(top) - 1;
      avatar.clearWidth = avatar.width + 2;
    });
  }
  function resize(size4, pixelRatio2) {
    renderSize2 = size4;
    renderPixelRatio2 = pixelRatio2;
    avatars = Array.from({ length: avatars.length }, (_2, index) => make(index));
  }
  return { clear, clearDeadHeads, draw, reset, resize, setPlayers };
}

// python/static/play-overlays.js
function createOverlayRenderer({ context, colors, size: size3, simulator: simulator2 }) {
  let renderSize2 = size3;
  let targetChoices = [];
  let selectedTargetChoice = -1;
  const reachableLayer = document.createElement("canvas");
  const reachableContext = reachableLayer.getContext("2d");
  function resizeReachableLayer() {
    reachableLayer.width = renderSize2;
    reachableLayer.height = renderSize2;
  }
  resizeReachableLayer();
  const powerupSprite = new Image();
  let lastFrame = null;
  powerupSprite.src = "https://www.curvytron.com/images/bonus.png";
  powerupSprite.addEventListener("load", () => draw(lastFrame));
  function position(player) {
    return [player.x * renderSize2, (1 - player.y) * renderSize2];
  }
  function drawLidar(lidar, color) {
    context.strokeStyle = color;
    context.fillStyle = color;
    const binWidth = 2 * Math.PI / lidar.distances[0].length;
    lidar.points.forEach(([px, py], point) => {
      const [forwardX, forwardY] = lidar.headings[point];
      const heading = Math.atan2(forwardY, forwardX);
      const cx = px * renderSize2 / simulator2().arena_size;
      const cy = (1 - py / simulator2().arena_size) * renderSize2;
      lidar.distances[point].forEach((distance, bin) => {
        const angle = heading - Math.PI + (bin + 0.5) * binWidth;
        const reach = distance * renderSize2 / simulator2().arena_size;
        context.globalAlpha = 0.05 + 0.18 * (distance / lidar.max_distance);
        context.beginPath();
        context.moveTo(cx, cy);
        context.arc(cx, cy, reach, -angle - binWidth / 2, -angle + binWidth / 2);
        context.closePath();
        context.fill();
        context.globalAlpha = 0.35;
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(cx + Math.cos(angle) * reach, cy - Math.sin(angle) * reach);
        context.stroke();
      });
      context.globalAlpha = 0.95;
      context.beginPath();
      context.arc(cx, cy, 2, 0, 2 * Math.PI);
      context.fill();
    });
  }
  function drawValue(value, player, color) {
    const positive = value >= 0;
    const strength = Math.tanh(Math.abs(value));
    const [x2, y3] = position(player);
    const radius = 30 + 42 * strength;
    const gradient = context.createRadialGradient(x2, y3, 0, x2, y3, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.28, color + "aa");
    gradient.addColorStop(1, color + "00");
    context.globalAlpha = positive ? 0.18 + 0.72 * strength : 0.08 + 0.18 * strength;
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x2, y3, radius, 0, 2 * Math.PI);
    context.fill();
    const label = `V ${positive ? "+" : "\u2212"}${Math.abs(value).toFixed(2)}`;
    context.globalAlpha = 1;
    context.font = "600 13px Lato, Helvetica, sans-serif";
    const width = context.measureText(label).width + 12;
    const labelX = Math.max(4, Math.min(renderSize2 - width - 4, x2 - width / 2));
    const labelY = y3 < 38 ? y3 + 42 : y3 - 30;
    context.fillStyle = "rgba(20, 20, 20, .8)";
    context.beginPath();
    context.roundRect(labelX, labelY - 15, width, 20, 5);
    context.fill();
    context.fillStyle = positive ? color : "#aeb6c2";
    context.fillText(label, labelX + 6, labelY);
  }
  function appendReachableCurve(path, curve, scale, move) {
    const start = curve.kind === "line" ? curve.start : [
      curve.center[0] + curve.radius * Math.cos(curve.start_angle),
      curve.center[1] + curve.radius * Math.sin(curve.start_angle)
    ];
    if (move) path.moveTo(start[0] * scale, renderSize2 - start[1] * scale);
    if (curve.kind === "line") {
      path.lineTo(curve.end[0] * scale, renderSize2 - curve.end[1] * scale);
      return;
    }
    path.arc(
      curve.center[0] * scale,
      renderSize2 - curve.center[1] * scale,
      curve.radius * scale,
      -curve.start_angle,
      -(curve.start_angle + curve.sweep),
      curve.sweep > 0
    );
  }
  function reachableCyclesPath(cycles, scale) {
    const path = new Path2D();
    cycles.forEach((cycle) => {
      cycle.forEach((curve, index) => appendReachableCurve(path, curve, scale, index === 0));
      path.closePath();
    });
    return path;
  }
  function drawReachable(reachable, color) {
    const scale = renderSize2 / reachable.arena_size;
    reachableContext.clearRect(0, 0, renderSize2, renderSize2);
    reachableContext.fillStyle = color;
    reachableContext.fill(reachableCyclesPath(reachable.cycles, scale), "evenodd");
    context.globalAlpha = 0.24;
    context.drawImage(reachableLayer, 0, 0, renderSize2, renderSize2);
  }
  function drawController(controller, player, color) {
    if (!controller?.target || !player) return;
    const [x2, y3] = position(player);
    const targetX = controller.target[0] * renderSize2 / simulator2().arena_size;
    const targetY = (1 - controller.target[1] / simulator2().arena_size) * renderSize2;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = 0.9;
    context.setLineDash([7, 5]);
    context.beginPath();
    context.moveTo(x2, y3);
    context.lineTo(targetX, targetY);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(targetX, targetY, 7, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(targetX - 11, targetY);
    context.lineTo(targetX + 11, targetY);
    context.moveTo(targetX, targetY - 11);
    context.lineTo(targetX, targetY + 11);
    context.stroke();
    if (Number.isInteger(controller.action)) {
      const labels = ["R", "S", "L"];
      context.font = "600 13px Lato, Helvetica, sans-serif";
      context.fillText(labels[controller.action], targetX + 12, targetY - 12);
    }
  }
  function drawTargetChoices() {
    targetChoices.forEach(([x2, y3], index) => {
      const targetX = x2 * renderSize2 / simulator2().arena_size;
      const targetY = (1 - y3 / simulator2().arena_size) * renderSize2;
      const selected = index === selectedTargetChoice;
      context.strokeStyle = colors[0];
      context.fillStyle = colors[0];
      context.globalAlpha = selected ? 1 : 0.42;
      context.lineWidth = selected ? 3 : 1.5;
      context.beginPath();
      context.arc(targetX, targetY, selected ? 8 : 4, 0, 2 * Math.PI);
      if (selected) context.fill();
      else context.stroke();
    });
    context.lineWidth = 1;
  }
  function drawPowerups(powerups) {
    const radius = Math.max(7, 3 * renderSize2 / simulator2().arena_size);
    powerups.forEach((powerup) => {
      const sprite = simulator2().powerups?.[powerup.type]?.sprite_index;
      if (sprite === void 0 || !powerupSprite.naturalWidth) return;
      const x2 = powerup.x * renderSize2;
      const y3 = (1 - powerup.y) * renderSize2;
      const column = sprite % 3;
      const row = Math.floor(sprite / 3);
      context.globalAlpha = 1;
      context.drawImage(
        powerupSprite,
        column * 100,
        row * 100,
        100,
        100,
        x2 - radius,
        y3 - radius,
        radius * 2,
        radius * 2
      );
    });
  }
  function reset() {
    context.clearRect(0, 0, renderSize2, renderSize2);
  }
  function draw(frame) {
    lastFrame = frame;
    reset();
    if (!frame) return;
    drawPowerups(frame.powerups || []);
    Object.entries(frame.overlays || {}).forEach(([seat, visual]) => {
      const index = Number(seat);
      const color = colors[index % colors.length];
      if (visual.lidar) drawLidar(visual.lidar, color);
      if (visual.reachable) drawReachable(visual.reachable, color);
      if (Number.isFinite(visual.value) && frame.players[index]) {
        drawValue(visual.value, frame.players[index], color);
      }
    });
    if (frame.controller) {
      drawController(frame.controller, frame.players[0], colors[0]);
    }
    drawTargetChoices();
    context.globalAlpha = 1;
  }
  function setTargetChoices(targets, selectedIndex) {
    targetChoices = targets;
    selectedTargetChoice = selectedIndex;
  }
  function resize(size4) {
    renderSize2 = size4;
    resizeReachableLayer();
  }
  return { draw, reset, resize, setTargetChoices };
}

// python/static/play-trails.js
function createTrailRenderer({ context, colors, size: size3, simulator: simulator2 }) {
  context.lineCap = "round";
  const queues = [];
  const connected = [];
  let renderSize2 = size3;
  function position(player) {
    return [player.x * renderSize2, (1 - player.y) * renderSize2];
  }
  function reset() {
    queues.length = 0;
    connected.length = 0;
    context.fillStyle = "#222222";
    context.fillRect(0, 0, renderSize2, renderSize2);
  }
  function appendSegment(previous, player, seat) {
    const active = player.alive && player.trail_active && previous?.alive && previous.trail_active;
    const wrapped = previous && (Math.abs(player.x - previous.x) > 0.5 || Math.abs(player.y - previous.y) > 0.5);
    if (!active || wrapped) {
      connected[seat] = false;
      return;
    }
    const paths = queues[seat] ??= [];
    if (!connected[seat] || !paths.length) paths.push([previous]);
    paths.at(-1).push(player);
    connected[seat] = true;
  }
  function appendFrame(previousPlayers, players) {
    players.forEach((player, seat) => appendSegment(previousPlayers[seat], player, seat));
  }
  function drawPaths(paths) {
    context.beginPath();
    paths.forEach((path) => {
      context.moveTo(...position(path[0]));
      for (let point = 1; point < path.length; point++) context.lineTo(...position(path[point]));
    });
    context.stroke();
  }
  function draw() {
    context.lineWidth = Math.max(2, simulator2().radius * renderSize2 / simulator2().arena_size * 2);
    queues.forEach((paths, seat) => {
      if (!paths.length) return;
      context.strokeStyle = colors[seat % colors.length];
      drawPaths(paths);
      queues[seat] = [];
    });
  }
  function resize(size4) {
    renderSize2 = size4;
    context.lineCap = "round";
  }
  return { appendFrame, draw, reset, resize };
}

// python/static/play-player-search.js
function createPlayerSearch({ input, options, locked, onSelect, initialCatalog: initialCatalog2 = [], playersUrl = "/players" }) {
  let catalog = [];
  let signature = "";
  let activeOption = -1;
  let labels = /* @__PURE__ */ new Map();
  function labelFor(spec) {
    return labels.get(spec);
  }
  function hide2() {
    activeOption = -1;
    options.replaceChildren();
    options.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
  }
  function render() {
    if (locked() || !catalog.length) {
      hide2();
      return;
    }
    const query = input.value.trim().toLowerCase();
    const matches = catalog.filter((option) => `${option.label} ${option.spec}`.toLowerCase().includes(query));
    options.replaceChildren(...matches.map((option, index) => {
      const button = document.createElement("button");
      button.className = "player-option";
      button.type = "button";
      button.dataset.spec = option.spec;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === activeOption ? "true" : "false");
      if (index === activeOption) button.classList.add("active");
      const name = document.createElement("span");
      name.className = "player-option-name";
      name.textContent = option.label;
      const kind = document.createElement("span");
      kind.className = "player-option-kind";
      kind.textContent = option.kind;
      button.title = option.label;
      button.append(name, kind);
      return button;
    }));
    options.classList.toggle("hidden", matches.length === 0);
    input.setAttribute("aria-expanded", matches.length > 0 ? "true" : "false");
  }
  function setCatalog(next) {
    if (!Array.isArray(next)) return;
    const nextSignature = next.map((option) => `${option.spec}
${option.label}
${option.kind}`).join("\n");
    if (nextSignature === signature) return;
    catalog = next;
    signature = nextSignature;
    labels = new Map(next.filter((option) => option.kind !== "human").map((option) => [option.spec, option.label]));
    activeOption = -1;
    if (!options.classList.contains("hidden")) render();
  }
  function select(spec) {
    onSelect(spec);
    input.blur();
  }
  async function refresh() {
    try {
      const response = await fetch(playersUrl, { cache: "no-store" });
      if (response.ok) setCatalog(await response.json());
    } catch (_2) {
    }
  }
  input.addEventListener("sl-focus", render);
  input.addEventListener("sl-input", () => {
    activeOption = -1;
    render();
  });
  input.addEventListener("keydown", (event) => {
    const matches = [...options.querySelectorAll(".player-option")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!matches.length) return;
      activeOption = (activeOption + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
      render();
      event.preventDefault();
    } else if (event.key === "Enter" && activeOption >= 0 && matches[activeOption]) {
      select(matches[activeOption].dataset.spec);
      event.preventDefault();
    } else if (event.key === "Escape") {
      hide2();
      input.blur();
      event.preventDefault();
      event.stopPropagation();
    }
  });
  input.addEventListener("sl-blur", () => setTimeout(hide2, 120));
  options.addEventListener("mousedown", (event) => event.preventDefault());
  options.addEventListener("click", (event) => {
    const option = event.target.closest(".player-option");
    if (option) select(option.dataset.spec);
  });
  setCatalog(initialCatalog2);
  if (playersUrl) {
    refresh();
    setInterval(() => {
      if (!locked()) refresh();
    }, 3e3);
  }
  return { hide: hide2, labelFor, setCatalog };
}

// python/static/play-client-game.js
var ClientGame = class _ClientGame {
  static create(config, receive) {
    const worker = new Worker(new URL(
      config.worker_url || "./play-client-worker.js",
      import.meta.url
    ), {
      type: "module"
    });
    const game = new _ClientGame(worker, receive);
    game.configure(config);
    return game;
  }
  constructor(worker, receive) {
    this.worker = worker;
    this.worker.onmessage = (event) => receive(event.data);
  }
  start() {
    this.worker.postMessage({ type: "start" });
  }
  configure(config) {
    this.worker.postMessage({ type: "configure", config });
  }
  input(action) {
    this.worker.postMessage({ type: "input", action });
  }
  activatePowerup(powerup, collector) {
    this.worker.postMessage({ type: "powerup", powerup, collector });
  }
  configurePowerupSpawns(types, rate) {
    this.worker.postMessage({ type: "powerup_spawns", types, rate });
  }
  close() {
    this.worker.postMessage({ type: "stop" });
    this.worker.terminate();
  }
};

// python/static/play-prediction.js
var MAX_PREDICTION_MS = 100;
function turnAction(previous, current, tickDelta) {
  if (Number.isInteger(current.action)) return current.action;
  if (!previous || tickDelta <= 0) return 1;
  const angleDelta = Math.atan2(
    Math.sin(current.angle - previous.angle),
    Math.cos(current.angle - previous.angle)
  );
  const angularStep = angleDelta / tickDelta;
  if (Math.abs(angularStep) < 1e-4) return 1;
  return angularStep > 0 ? 2 : 0;
}
function predictPlayer(player, action, elapsedSeconds, simulator2) {
  if (!player.alive || elapsedSeconds <= 0) return { ...player };
  const turn = action === 2 ? 1 : action === 0 ? -1 : 0;
  const speedMultiplier = player.speed_multiplier ?? 1;
  const curvedAngularVelocity = speedMultiplier * simulator2.angular_velocity_per_second + Math.log(1 / speedMultiplier);
  const angularVelocity = player.rigid ? 0 : turn * curvedAngularVelocity;
  const velocity = speedMultiplier * simulator2.velocity_per_second / simulator2.arena_size;
  const distance = velocity * elapsedSeconds;
  const angle = player.angle + angularVelocity * elapsedSeconds;
  let x2;
  let y3;
  if (angularVelocity === 0) {
    x2 = player.x + Math.cos(player.angle) * distance;
    y3 = player.y + Math.sin(player.angle) * distance;
  } else {
    const radius = velocity / angularVelocity;
    x2 = player.x + radius * (Math.sin(angle) - Math.sin(player.angle));
    y3 = player.y + radius * (Math.cos(player.angle) - Math.cos(angle));
  }
  const minimum = simulator2.radius / simulator2.arena_size;
  const maximum = 1 - minimum;
  const boundedX = simulator2.borderless ? (x2 + 1) % 1 : Math.max(minimum, Math.min(maximum, x2));
  const boundedY = simulator2.borderless ? (y3 + 1) % 1 : Math.max(minimum, Math.min(maximum, y3));
  return {
    ...player,
    x: boundedX,
    y: boundedY,
    angle
  };
}
function predictFrame(frame, previousFrame, elapsedMs, simulator2, humanAction, human2) {
  if (!frame || !simulator2.velocity_per_second || !simulator2.angular_velocity_per_second) return frame;
  const predictionMs = Math.max(0, Math.min(MAX_PREDICTION_MS, elapsedMs));
  const elapsedSeconds = predictionMs / 1e3;
  const tickDelta = previousFrame ? frame.tick - previousFrame.tick : 0;
  return {
    ...frame,
    players: frame.players.map((player, seat) => {
      const previous = previousFrame?.players[seat];
      const action = human2 && seat === 0 ? humanAction : turnAction(previous, player, tickDelta);
      return predictPlayer(player, action, elapsedSeconds, { ...simulator2, borderless: frame.borderless });
    })
  };
}
function createFramePredictor(enabled) {
  return enabled ? predictFrame : (frame) => frame;
}

// python/static/play-client-config.js
function clientGameKey({ human: human2, specs }) {
  return JSON.stringify([Boolean(human2), ...specs]);
}
function randomSeed() {
  const value = crypto.getRandomValues(new BigUint64Array(1))[0];
  return String(value & (1n << 63n) - 1n);
}
function resolveClientGame(games, configuration, seed = randomSeed()) {
  const template = games[clientGameKey(configuration)];
  if (!template) throw new Error("This player configuration was not exported.");
  const game = structuredClone(template);
  game.client_game.seed = String(seed);
  return game;
}

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = /* @__PURE__ */ Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t6, e9, o7) {
    if (this._$cssResult$ = true, o7 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t6, this.t = e9;
  }
  get styleSheet() {
    let t6 = this.o;
    const s4 = this.t;
    if (e && void 0 === t6) {
      const e9 = void 0 !== s4 && 1 === s4.length;
      e9 && (t6 = o.get(s4)), void 0 === t6 && ((this.o = t6 = new CSSStyleSheet()).replaceSync(this.cssText), e9 && o.set(s4, t6));
    }
    return t6;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t6) => new n("string" == typeof t6 ? t6 : t6 + "", void 0, s);
var i = (t6, ...e9) => {
  const o7 = 1 === t6.length ? t6[0] : e9.reduce((e10, s4, o8) => e10 + ((t7) => {
    if (true === t7._$cssResult$) return t7.cssText;
    if ("number" == typeof t7) return t7;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t7 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t6[o8 + 1], t6[0]);
  return new n(o7, t6, s);
};
var S = (s4, o7) => {
  if (e) s4.adoptedStyleSheets = o7.map((t6) => t6 instanceof CSSStyleSheet ? t6 : t6.styleSheet);
  else for (const e9 of o7) {
    const o8 = document.createElement("style"), n5 = t.litNonce;
    void 0 !== n5 && o8.setAttribute("nonce", n5), o8.textContent = e9.cssText, s4.appendChild(o8);
  }
};
var c = e ? (t6) => t6 : (t6) => t6 instanceof CSSStyleSheet ? ((t7) => {
  let e9 = "";
  for (const s4 of t7.cssRules) e9 += s4.cssText;
  return r(e9);
})(t6) : t6;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t6, s4) => t6;
var u = { toAttribute(t6, s4) {
  switch (s4) {
    case Boolean:
      t6 = t6 ? l : null;
      break;
    case Object:
    case Array:
      t6 = null == t6 ? t6 : JSON.stringify(t6);
  }
  return t6;
}, fromAttribute(t6, s4) {
  let i7 = t6;
  switch (s4) {
    case Boolean:
      i7 = null !== t6;
      break;
    case Number:
      i7 = null === t6 ? null : Number(t6);
      break;
    case Object:
    case Array:
      try {
        i7 = JSON.parse(t6);
      } catch (t7) {
        i7 = null;
      }
  }
  return i7;
} };
var f = (t6, s4) => !i2(t6, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t6) {
    this._$Ei(), (this.l ??= []).push(t6);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t6, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t6) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t6, s4), !s4.noAccessor) {
      const i7 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t6, i7, s4);
      void 0 !== h3 && e2(this.prototype, t6, h3);
    }
  }
  static getPropertyDescriptor(t6, s4, i7) {
    const { get: e9, set: r8 } = h(this.prototype, t6) ?? { get() {
      return this[s4];
    }, set(t7) {
      this[s4] = t7;
    } };
    return { get: e9, set(s5) {
      const h3 = e9?.call(this);
      r8?.call(this, s5), this.requestUpdate(t6, h3, i7);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t6) {
    return this.elementProperties.get(t6) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t6 = n2(this);
    t6.finalize(), void 0 !== t6.l && (this.l = [...t6.l]), this.elementProperties = new Map(t6.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t7 = this.properties, s4 = [...r2(t7), ...o2(t7)];
      for (const i7 of s4) this.createProperty(i7, t7[i7]);
    }
    const t6 = this[Symbol.metadata];
    if (null !== t6) {
      const s4 = litPropertyMetadata.get(t6);
      if (void 0 !== s4) for (const [t7, i7] of s4) this.elementProperties.set(t7, i7);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t7, s4] of this.elementProperties) {
      const i7 = this._$Eu(t7, s4);
      void 0 !== i7 && this._$Eh.set(i7, t7);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i7 = [];
    if (Array.isArray(s4)) {
      const e9 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e9) i7.unshift(c(s5));
    } else void 0 !== s4 && i7.push(c(s4));
    return i7;
  }
  static _$Eu(t6, s4) {
    const i7 = s4.attribute;
    return false === i7 ? void 0 : "string" == typeof i7 ? i7 : "string" == typeof t6 ? t6.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t6) => this.enableUpdating = t6), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t6) => t6(this));
  }
  addController(t6) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t6), void 0 !== this.renderRoot && this.isConnected && t6.hostConnected?.();
  }
  removeController(t6) {
    this._$EO?.delete(t6);
  }
  _$E_() {
    const t6 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i7 of s4.keys()) this.hasOwnProperty(i7) && (t6.set(i7, this[i7]), delete this[i7]);
    t6.size > 0 && (this._$Ep = t6);
  }
  createRenderRoot() {
    const t6 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t6, this.constructor.elementStyles), t6;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t6) => t6.hostConnected?.());
  }
  enableUpdating(t6) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t6) => t6.hostDisconnected?.());
  }
  attributeChangedCallback(t6, s4, i7) {
    this._$AK(t6, i7);
  }
  _$ET(t6, s4) {
    const i7 = this.constructor.elementProperties.get(t6), e9 = this.constructor._$Eu(t6, i7);
    if (void 0 !== e9 && true === i7.reflect) {
      const h3 = (void 0 !== i7.converter?.toAttribute ? i7.converter : u).toAttribute(s4, i7.type);
      this._$Em = t6, null == h3 ? this.removeAttribute(e9) : this.setAttribute(e9, h3), this._$Em = null;
    }
  }
  _$AK(t6, s4) {
    const i7 = this.constructor, e9 = i7._$Eh.get(t6);
    if (void 0 !== e9 && this._$Em !== e9) {
      const t7 = i7.getPropertyOptions(e9), h3 = "function" == typeof t7.converter ? { fromAttribute: t7.converter } : void 0 !== t7.converter?.fromAttribute ? t7.converter : u;
      this._$Em = e9;
      const r8 = h3.fromAttribute(s4, t7.type);
      this[e9] = r8 ?? this._$Ej?.get(e9) ?? r8, this._$Em = null;
    }
  }
  requestUpdate(t6, s4, i7, e9 = false, h3) {
    if (void 0 !== t6) {
      const r8 = this.constructor;
      if (false === e9 && (h3 = this[t6]), i7 ??= r8.getPropertyOptions(t6), !((i7.hasChanged ?? f)(h3, s4) || i7.useDefault && i7.reflect && h3 === this._$Ej?.get(t6) && !this.hasAttribute(r8._$Eu(t6, i7)))) return;
      this.C(t6, s4, i7);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t6, s4, { useDefault: i7, reflect: e9, wrapped: h3 }, r8) {
    i7 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t6) && (this._$Ej.set(t6, r8 ?? s4 ?? this[t6]), true !== h3 || void 0 !== r8) || (this._$AL.has(t6) || (this.hasUpdated || i7 || (s4 = void 0), this._$AL.set(t6, s4)), true === e9 && this._$Em !== t6 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t6));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t7) {
      Promise.reject(t7);
    }
    const t6 = this.scheduleUpdate();
    return null != t6 && await t6, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t8, s5] of this._$Ep) this[t8] = s5;
        this._$Ep = void 0;
      }
      const t7 = this.constructor.elementProperties;
      if (t7.size > 0) for (const [s5, i7] of t7) {
        const { wrapped: t8 } = i7, e9 = this[s5];
        true !== t8 || this._$AL.has(s5) || void 0 === e9 || this.C(s5, void 0, i7, e9);
      }
    }
    let t6 = false;
    const s4 = this._$AL;
    try {
      t6 = this.shouldUpdate(s4), t6 ? (this.willUpdate(s4), this._$EO?.forEach((t7) => t7.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t6 = false, this._$EM(), s5;
    }
    t6 && this._$AE(s4);
  }
  willUpdate(t6) {
  }
  _$AE(t6) {
    this._$EO?.forEach((t7) => t7.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t6)), this.updated(t6);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t6) {
    return true;
  }
  update(t6) {
    this._$Eq &&= this._$Eq.forEach((t7) => this._$ET(t7, this[t7])), this._$EM();
  }
  updated(t6) {
  }
  firstUpdated(t6) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t6) => t6;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t6) => t6 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t6) => null === t6 || "object" != typeof t6 && "function" != typeof t6;
var u2 = Array.isArray;
var d2 = (t6) => u2(t6) || "function" == typeof t6?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t6) => (i7, ...s4) => ({ _$litType$: t6, strings: i7, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t6, i7) {
  if (!u2(t6) || !t6.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i7) : i7;
}
var N = (t6, i7) => {
  const s4 = t6.length - 1, e9 = [];
  let n5, l5 = 2 === i7 ? "<svg>" : 3 === i7 ? "<math>" : "", c4 = v;
  for (let i8 = 0; i8 < s4; i8++) {
    const s5 = t6[i8];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n5 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n5 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n5 = void 0);
    const x2 = c4 === p2 && t6[i8 + 1].startsWith("/>") ? " " : "";
    l5 += c4 === v ? s5 + r3 : d3 >= 0 ? (e9.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i8 : x2);
  }
  return [V(t6, l5 + (t6[s4] || "<?>") + (2 === i7 ? "</svg>" : 3 === i7 ? "</math>" : "")), e9];
};
var S2 = class _S {
  constructor({ strings: t6, _$litType$: i7 }, e9) {
    let r8;
    this.parts = [];
    let l5 = 0, a3 = 0;
    const u3 = t6.length - 1, d3 = this.parts, [f3, v2] = N(t6, i7);
    if (this.el = _S.createElement(f3, e9), P.currentNode = this.el.content, 2 === i7 || 3 === i7) {
      const t7 = this.el.content.firstChild;
      t7.replaceWith(...t7.childNodes);
    }
    for (; null !== (r8 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r8.nodeType) {
        if (r8.hasAttributes()) for (const t7 of r8.getAttributeNames()) if (t7.endsWith(h2)) {
          const i8 = v2[a3++], s4 = r8.getAttribute(t7).split(o3), e10 = /([.?@])?(.*)/.exec(i8);
          d3.push({ type: 1, index: l5, name: e10[2], strings: s4, ctor: "." === e10[1] ? I : "?" === e10[1] ? L : "@" === e10[1] ? z : H }), r8.removeAttribute(t7);
        } else t7.startsWith(o3) && (d3.push({ type: 6, index: l5 }), r8.removeAttribute(t7));
        if (y2.test(r8.tagName)) {
          const t7 = r8.textContent.split(o3), i8 = t7.length - 1;
          if (i8 > 0) {
            r8.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i8; s4++) r8.append(t7[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l5 });
            r8.append(t7[i8], c3());
          }
        }
      } else if (8 === r8.nodeType) if (r8.data === n3) d3.push({ type: 2, index: l5 });
      else {
        let t7 = -1;
        for (; -1 !== (t7 = r8.data.indexOf(o3, t7 + 1)); ) d3.push({ type: 7, index: l5 }), t7 += o3.length - 1;
      }
      l5++;
    }
  }
  static createElement(t6, i7) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t6, s4;
  }
};
function M(t6, i7, s4 = t6, e9) {
  if (i7 === E) return i7;
  let h3 = void 0 !== e9 ? s4._$Co?.[e9] : s4._$Cl;
  const o7 = a2(i7) ? void 0 : i7._$litDirective$;
  return h3?.constructor !== o7 && (h3?._$AO?.(false), void 0 === o7 ? h3 = void 0 : (h3 = new o7(t6), h3._$AT(t6, s4, e9)), void 0 !== e9 ? (s4._$Co ??= [])[e9] = h3 : s4._$Cl = h3), void 0 !== h3 && (i7 = M(t6, h3._$AS(t6, i7.values), h3, e9)), i7;
}
var R = class {
  constructor(t6, i7) {
    this._$AV = [], this._$AN = void 0, this._$AD = t6, this._$AM = i7;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t6) {
    const { el: { content: i7 }, parts: s4 } = this._$AD, e9 = (t6?.creationScope ?? l2).importNode(i7, true);
    P.currentNode = e9;
    let h3 = P.nextNode(), o7 = 0, n5 = 0, r8 = s4[0];
    for (; void 0 !== r8; ) {
      if (o7 === r8.index) {
        let i8;
        2 === r8.type ? i8 = new k(h3, h3.nextSibling, this, t6) : 1 === r8.type ? i8 = new r8.ctor(h3, r8.name, r8.strings, this, t6) : 6 === r8.type && (i8 = new Z(h3, this, t6)), this._$AV.push(i8), r8 = s4[++n5];
      }
      o7 !== r8?.index && (h3 = P.nextNode(), o7++);
    }
    return P.currentNode = l2, e9;
  }
  p(t6) {
    let i7 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t6, s4, i7), i7 += s4.strings.length - 2) : s4._$AI(t6[i7])), i7++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t6, i7, s4, e9) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t6, this._$AB = i7, this._$AM = s4, this.options = e9, this._$Cv = e9?.isConnected ?? true;
  }
  get parentNode() {
    let t6 = this._$AA.parentNode;
    const i7 = this._$AM;
    return void 0 !== i7 && 11 === t6?.nodeType && (t6 = i7.parentNode), t6;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t6, i7 = this) {
    t6 = M(this, t6, i7), a2(t6) ? t6 === A || null == t6 || "" === t6 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t6 !== this._$AH && t6 !== E && this._(t6) : void 0 !== t6._$litType$ ? this.$(t6) : void 0 !== t6.nodeType ? this.T(t6) : d2(t6) ? this.k(t6) : this._(t6);
  }
  O(t6) {
    return this._$AA.parentNode.insertBefore(t6, this._$AB);
  }
  T(t6) {
    this._$AH !== t6 && (this._$AR(), this._$AH = this.O(t6));
  }
  _(t6) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t6 : this.T(l2.createTextNode(t6)), this._$AH = t6;
  }
  $(t6) {
    const { values: i7, _$litType$: s4 } = t6, e9 = "number" == typeof s4 ? this._$AC(t6) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e9) this._$AH.p(i7);
    else {
      const t7 = new R(e9, this), s5 = t7.u(this.options);
      t7.p(i7), this.T(s5), this._$AH = t7;
    }
  }
  _$AC(t6) {
    let i7 = C.get(t6.strings);
    return void 0 === i7 && C.set(t6.strings, i7 = new S2(t6)), i7;
  }
  k(t6) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i7 = this._$AH;
    let s4, e9 = 0;
    for (const h3 of t6) e9 === i7.length ? i7.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i7[e9], s4._$AI(h3), e9++;
    e9 < i7.length && (this._$AR(s4 && s4._$AB.nextSibling, e9), i7.length = e9);
  }
  _$AR(t6 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t6 !== this._$AB; ) {
      const s5 = i3(t6).nextSibling;
      i3(t6).remove(), t6 = s5;
    }
  }
  setConnected(t6) {
    void 0 === this._$AM && (this._$Cv = t6, this._$AP?.(t6));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t6, i7, s4, e9, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t6, this.name = i7, this._$AM = e9, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t6, i7 = this, s4, e9) {
    const h3 = this.strings;
    let o7 = false;
    if (void 0 === h3) t6 = M(this, t6, i7, 0), o7 = !a2(t6) || t6 !== this._$AH && t6 !== E, o7 && (this._$AH = t6);
    else {
      const e10 = t6;
      let n5, r8;
      for (t6 = h3[0], n5 = 0; n5 < h3.length - 1; n5++) r8 = M(this, e10[s4 + n5], i7, n5), r8 === E && (r8 = this._$AH[n5]), o7 ||= !a2(r8) || r8 !== this._$AH[n5], r8 === A ? t6 = A : t6 !== A && (t6 += (r8 ?? "") + h3[n5 + 1]), this._$AH[n5] = r8;
    }
    o7 && !e9 && this.j(t6);
  }
  j(t6) {
    t6 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t6 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t6) {
    this.element[this.name] = t6 === A ? void 0 : t6;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t6) {
    this.element.toggleAttribute(this.name, !!t6 && t6 !== A);
  }
};
var z = class extends H {
  constructor(t6, i7, s4, e9, h3) {
    super(t6, i7, s4, e9, h3), this.type = 5;
  }
  _$AI(t6, i7 = this) {
    if ((t6 = M(this, t6, i7, 0) ?? A) === E) return;
    const s4 = this._$AH, e9 = t6 === A && s4 !== A || t6.capture !== s4.capture || t6.once !== s4.once || t6.passive !== s4.passive, h3 = t6 !== A && (s4 === A || e9);
    e9 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t6), this._$AH = t6;
  }
  handleEvent(t6) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t6) : this._$AH.handleEvent(t6);
  }
};
var Z = class {
  constructor(t6, i7, s4) {
    this.element = t6, this.type = 6, this._$AN = void 0, this._$AM = i7, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t6) {
    M(this, t6);
  }
};
var j = { M: h2, P: o3, A: n3, C: 1, L: N, R, D: d2, V: M, I: k, H, N: L, U: z, B: I, F: Z };
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t6, i7, s4) => {
  const e9 = s4?.renderBefore ?? i7;
  let h3 = e9._$litPart$;
  if (void 0 === h3) {
    const t7 = s4?.renderBefore ?? null;
    e9._$litPart$ = h3 = new k(i7.insertBefore(c3(), t7), t7, void 0, s4 ?? {});
  }
  return h3._$AI(t6), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t6 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t6.firstChild, t6;
  }
  update(t6) {
    const r8 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t6), this._$Do = D(r8, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.LXP7GVU3.js
var dropdown_styles_default = i`
  :host {
    display: inline-block;
  }

  .dropdown::part(popup) {
    z-index: var(--sl-z-index-dropdown);
  }

  .dropdown[data-current-placement^='top']::part(popup) {
    transform-origin: bottom;
  }

  .dropdown[data-current-placement^='bottom']::part(popup) {
    transform-origin: top;
  }

  .dropdown[data-current-placement^='left']::part(popup) {
    transform-origin: right;
  }

  .dropdown[data-current-placement^='right']::part(popup) {
    transform-origin: left;
  }

  .dropdown__trigger {
    display: block;
  }

  .dropdown__panel {
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-medium);
    font-weight: var(--sl-font-weight-normal);
    box-shadow: var(--sl-shadow-large);
    border-radius: var(--sl-border-radius-medium);
    pointer-events: none;
  }

  .dropdown--open .dropdown__panel {
    display: block;
    pointer-events: all;
  }

  /* When users slot a menu, make sure it conforms to the popup's auto-size */
  ::slotted(sl-menu) {
    max-width: var(--auto-size-available-width) !important;
    max-height: var(--auto-size-available-height) !important;
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.KAW7D32O.js
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg2) => {
  throw TypeError(msg2);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a3, b3) => {
  for (var prop in b3 || (b3 = {}))
    if (__hasOwnProp.call(b3, prop))
      __defNormalProp(a3, prop, b3[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b3)) {
      if (__propIsEnum.call(b3, prop))
        __defNormalProp(a3, prop, b3[prop]);
    }
  return a3;
};
var __spreadProps = (a3, b3) => __defProps(a3, __getOwnPropDescs(b3));
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
var __accessCheck = (obj, member, msg2) => member.has(obj) || __typeError("Cannot " + msg2);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __await = function(promise, isYieldStar) {
  this[0] = promise;
  this[1] = isYieldStar;
};
var __yieldStar = (value) => {
  var obj = value[__knownSymbol("asyncIterator")], isAwait = false, method, it = {};
  if (obj == null) {
    obj = value[__knownSymbol("iterator")]();
    method = (k2) => it[k2] = (x2) => obj[k2](x2);
  } else {
    obj = obj.call(value);
    method = (k2) => it[k2] = (v2) => {
      if (isAwait) {
        isAwait = false;
        if (k2 === "throw") throw v2;
        return v2;
      }
      isAwait = true;
      return {
        done: false,
        value: new __await(new Promise((resolve) => {
          var x2 = obj[k2](v2);
          if (!(x2 instanceof Object)) __typeError("Object expected");
          resolve(x2);
        }), 1)
      };
    };
  }
  return it[__knownSymbol("iterator")] = () => it, method("next"), "throw" in obj ? method("throw") : it.throw = (x2) => {
    throw x2;
  }, "return" in obj && method("return"), it;
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.VESXC477.js
function* activeElements(activeElement = document.activeElement) {
  if (activeElement === null || activeElement === void 0) return;
  yield activeElement;
  if ("shadowRoot" in activeElement && activeElement.shadowRoot && activeElement.shadowRoot.mode !== "closed") {
    yield* __yieldStar(activeElements(activeElement.shadowRoot.activeElement));
  }
}
function getDeepestActiveElement() {
  return [...activeElements()].pop();
}
var computedStyleMap = /* @__PURE__ */ new WeakMap();
function getCachedComputedStyle(el) {
  let computedStyle = computedStyleMap.get(el);
  if (!computedStyle) {
    computedStyle = window.getComputedStyle(el, null);
    computedStyleMap.set(el, computedStyle);
  }
  return computedStyle;
}
function isVisible(el) {
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  const computedStyle = getCachedComputedStyle(el);
  return computedStyle.visibility !== "hidden" && computedStyle.display !== "none";
}
function isOverflowingAndTabbable(el) {
  const computedStyle = getCachedComputedStyle(el);
  const { overflowY, overflowX } = computedStyle;
  if (overflowY === "scroll" || overflowX === "scroll") {
    return true;
  }
  if (overflowY !== "auto" || overflowX !== "auto") {
    return false;
  }
  const isOverflowingY = el.scrollHeight > el.clientHeight;
  if (isOverflowingY && overflowY === "auto") {
    return true;
  }
  const isOverflowingX = el.scrollWidth > el.clientWidth;
  if (isOverflowingX && overflowX === "auto") {
    return true;
  }
  return false;
}
function isTabbable(el) {
  const tag = el.tagName.toLowerCase();
  const tabindex = Number(el.getAttribute("tabindex"));
  const hasTabindex = el.hasAttribute("tabindex");
  if (hasTabindex && (isNaN(tabindex) || tabindex <= -1)) {
    return false;
  }
  if (el.hasAttribute("disabled")) {
    return false;
  }
  if (el.closest("[inert]")) {
    return false;
  }
  if (tag === "input" && el.getAttribute("type") === "radio") {
    const rootNode = el.getRootNode();
    const findRadios = `input[type='radio'][name="${el.getAttribute("name")}"]`;
    const firstChecked = rootNode.querySelector(`${findRadios}:checked`);
    if (firstChecked) {
      return firstChecked === el;
    }
    const firstRadio = rootNode.querySelector(findRadios);
    return firstRadio === el;
  }
  if (!isVisible(el)) {
    return false;
  }
  if ((tag === "audio" || tag === "video") && el.hasAttribute("controls")) {
    return true;
  }
  if (el.hasAttribute("tabindex")) {
    return true;
  }
  if (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") {
    return true;
  }
  const isNativelyTabbable = [
    "button",
    "input",
    "select",
    "textarea",
    "a",
    "audio",
    "video",
    "summary",
    "iframe"
  ].includes(tag);
  if (isNativelyTabbable) {
    return true;
  }
  return isOverflowingAndTabbable(el);
}
function getTabbableBoundary(root) {
  var _a, _b;
  const tabbableElements = getTabbableElements(root);
  const start = (_a = tabbableElements[0]) != null ? _a : null;
  const end2 = (_b = tabbableElements[tabbableElements.length - 1]) != null ? _b : null;
  return { start, end: end2 };
}
function getSlottedChildrenOutsideRootElement(slotElement, root) {
  var _a;
  return ((_a = slotElement.getRootNode({ composed: true })) == null ? void 0 : _a.host) !== root;
}
function getTabbableElements(root) {
  const walkedEls = /* @__PURE__ */ new WeakMap();
  const tabbableElements = [];
  function walk(el) {
    if (el instanceof Element) {
      if (el.hasAttribute("inert") || el.closest("[inert]")) {
        return;
      }
      if (walkedEls.has(el)) {
        return;
      }
      walkedEls.set(el, true);
      if (!tabbableElements.includes(el) && isTabbable(el)) {
        tabbableElements.push(el);
      }
      if (el instanceof HTMLSlotElement && getSlottedChildrenOutsideRootElement(el, root)) {
        el.assignedElements({ flatten: true }).forEach((assignedEl) => {
          walk(assignedEl);
        });
      }
      if (el.shadowRoot !== null && el.shadowRoot.mode === "open") {
        walk(el.shadowRoot);
      }
    }
    for (const e9 of el.children) {
      walk(e9);
    }
  }
  walk(root);
  return tabbableElements.sort((a3, b3) => {
    const aTabindex = Number(a3.getAttribute("tabindex")) || 0;
    const bTabindex = Number(b3.getAttribute("tabindex")) || 0;
    return bTabindex - aTabindex;
  });
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3KSWVBQ5.js
var popup_styles_default = i`
  :host {
    --arrow-color: var(--sl-color-neutral-1000);
    --arrow-size: 6px;

    /*
     * These properties are computed to account for the arrow's dimensions after being rotated 45º. The constant
     * 0.7071 is derived from sin(45), which is the diagonal size of the arrow's container after rotating.
     */
    --arrow-size-diagonal: calc(var(--arrow-size) * 0.7071);
    --arrow-padding-offset: calc(var(--arrow-size-diagonal) - var(--arrow-size));

    display: contents;
  }

  .popup {
    position: absolute;
    isolation: isolate;
    max-width: var(--auto-size-available-width, none);
    max-height: var(--auto-size-available-height, none);
  }

  .popup--fixed {
    position: fixed;
  }

  .popup:not(.popup--active) {
    display: none;
  }

  .popup__arrow {
    position: absolute;
    width: calc(var(--arrow-size-diagonal) * 2);
    height: calc(var(--arrow-size-diagonal) * 2);
    rotate: 45deg;
    background: var(--arrow-color);
    z-index: -1;
  }

  /* Hover bridge */
  .popup-hover-bridge:not(.popup-hover-bridge--visible) {
    display: none;
  }

  .popup-hover-bridge {
    position: fixed;
    z-index: calc(var(--sl-z-index-dropdown) - 1);
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    clip-path: polygon(
      var(--hover-bridge-top-left-x, 0) var(--hover-bridge-top-left-y, 0),
      var(--hover-bridge-top-right-x, 0) var(--hover-bridge-top-right-y, 0),
      var(--hover-bridge-bottom-right-x, 0) var(--hover-bridge-bottom-right-y, 0),
      var(--hover-bridge-bottom-left-x, 0) var(--hover-bridge-bottom-left-y, 0)
    );
  }
`;

// node_modules/@shoelace-style/localize/dist/index.js
var connectedElements = /* @__PURE__ */ new Set();
var translations = /* @__PURE__ */ new Map();
var fallback;
var documentDirection = "ltr";
var documentLanguage = "en";
var isClient = typeof MutationObserver !== "undefined" && typeof document !== "undefined" && typeof document.documentElement !== "undefined";
if (isClient) {
  const documentElementObserver = new MutationObserver(update);
  documentDirection = document.documentElement.dir || "ltr";
  documentLanguage = document.documentElement.lang || navigator.language;
  documentElementObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dir", "lang"]
  });
}
function registerTranslation(...translation2) {
  translation2.map((t6) => {
    const code = t6.$code.toLowerCase();
    if (translations.has(code)) {
      translations.set(code, Object.assign(Object.assign({}, translations.get(code)), t6));
    } else {
      translations.set(code, t6);
    }
    if (!fallback) {
      fallback = t6;
    }
  });
  update();
}
function update() {
  if (isClient) {
    documentDirection = document.documentElement.dir || "ltr";
    documentLanguage = document.documentElement.lang || navigator.language;
  }
  [...connectedElements.keys()].map((el) => {
    if (typeof el.requestUpdate === "function") {
      el.requestUpdate();
    }
  });
}
var LocalizeController = class {
  constructor(host) {
    this.host = host;
    this.host.addController(this);
  }
  hostConnected() {
    connectedElements.add(this.host);
  }
  hostDisconnected() {
    connectedElements.delete(this.host);
  }
  dir() {
    return `${this.host.dir || documentDirection}`.toLowerCase();
  }
  lang() {
    const lang = `${this.host.lang || documentLanguage}`.toLowerCase().replace(/_/g, "-");
    try {
      new Intl.Locale(lang);
      return lang;
    } catch (_a) {
      return fallback ? fallback.$code.toLowerCase() : "en";
    }
  }
  getTranslationData(lang) {
    var _a, _b;
    let locale;
    try {
      locale = new Intl.Locale(lang.replace(/_/g, "-"));
    } catch (_c) {
      return { locale: void 0, language: "", region: "", primary: void 0, secondary: void 0 };
    }
    const language = locale.language.toLowerCase();
    const region = (_b = (_a = locale.region) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : "";
    const primary = translations.get(`${language}-${region}`);
    const secondary = translations.get(language);
    return { locale, language, region, primary, secondary };
  }
  exists(key, options) {
    var _a;
    const { primary, secondary } = this.getTranslationData((_a = options.lang) !== null && _a !== void 0 ? _a : this.lang());
    options = Object.assign({ includeFallback: false }, options);
    if (primary && primary[key] || secondary && secondary[key] || options.includeFallback && fallback && fallback[key]) {
      return true;
    }
    return false;
  }
  term(key, ...args) {
    const { primary, secondary } = this.getTranslationData(this.lang());
    let term;
    if (primary && primary[key]) {
      term = primary[key];
    } else if (secondary && secondary[key]) {
      term = secondary[key];
    } else if (fallback && fallback[key]) {
      term = fallback[key];
    } else {
      console.error(`No translation found for: ${String(key)}`);
      return String(key);
    }
    if (typeof term === "function") {
      return term(...args);
    }
    return term;
  }
  date(dateToFormat, options) {
    dateToFormat = new Date(dateToFormat);
    return new Intl.DateTimeFormat(this.lang(), options).format(dateToFormat);
  }
  number(numberToFormat, options) {
    numberToFormat = Number(numberToFormat);
    return isNaN(numberToFormat) ? "" : new Intl.NumberFormat(this.lang(), options).format(numberToFormat);
  }
  relativeTime(value, unit, options) {
    return new Intl.RelativeTimeFormat(this.lang(), options).format(value, unit);
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.7BTDLTNI.js
var translation = {
  $code: "en",
  $name: "English",
  $dir: "ltr",
  carousel: "Carousel",
  clearEntry: "Clear entry",
  close: "Close",
  copied: "Copied",
  copy: "Copy",
  currentValue: "Current value",
  error: "Error",
  goToSlide: (slide, count) => `Go to slide ${slide} of ${count}`,
  hidePassword: "Hide password",
  loading: "Loading",
  nextSlide: "Next slide",
  numOptionsSelected: (num) => {
    if (num === 0) return "No options selected";
    if (num === 1) return "1 option selected";
    return `${num} options selected`;
  },
  previousSlide: "Previous slide",
  progress: "Progress",
  remove: "Remove",
  resize: "Resize",
  scrollToEnd: "Scroll to end",
  scrollToStart: "Scroll to start",
  selectAColorFromTheScreen: "Select a color from the screen",
  showPassword: "Show password",
  slideNum: (slide) => `Slide ${slide}`,
  toggleColorFormat: "Toggle color format"
};
registerTranslation(translation);
var en_default = translation;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.6CTB5ZDJ.js
var LocalizeController2 = class extends LocalizeController {
};
registerTranslation(en_default);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.TUVJKY7S.js
var component_styles_default = i`
  :host {
    box-sizing: border-box;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }

  [hidden] {
    display: none !important;
  }
`;

// node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t6 = o5, e9, r8) => {
  const { kind: n5, metadata: i7 } = r8;
  let s4 = globalThis.litPropertyMetadata.get(i7);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i7, s4 = /* @__PURE__ */ new Map()), "setter" === n5 && ((t6 = Object.create(t6)).wrapped = true), s4.set(r8.name, t6), "accessor" === n5) {
    const { name: o7 } = r8;
    return { set(r9) {
      const n6 = e9.get.call(this);
      e9.set.call(this, r9), this.requestUpdate(o7, n6, t6, true, r9);
    }, init(e10) {
      return void 0 !== e10 && this.C(o7, void 0, t6, e10), e10;
    } };
  }
  if ("setter" === n5) {
    const { name: o7 } = r8;
    return function(r9) {
      const n6 = this[o7];
      e9.call(this, r9), this.requestUpdate(o7, n6, t6, true, r9);
    };
  }
  throw Error("Unsupported decorator location: " + n5);
};
function n4(t6) {
  return (e9, o7) => "object" == typeof o7 ? r4(t6, e9, o7) : ((t7, e10, o8) => {
    const r8 = e10.hasOwnProperty(o8);
    return e10.constructor.createProperty(o8, t7), r8 ? Object.getOwnPropertyDescriptor(e10, o8) : void 0;
  })(t6, e9, o7);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r5(r8) {
  return n4({ ...r8, state: true, attribute: false });
}

// node_modules/@lit/reactive-element/decorators/event-options.js
function t3(t6) {
  return (n5, o7) => {
    const c4 = "function" == typeof n5 ? n5 : n5[o7];
    Object.assign(c4, t6);
  };
}

// node_modules/@lit/reactive-element/decorators/base.js
var e4 = (e9, t6, c4) => (c4.configurable = true, c4.enumerable = true, Reflect.decorate && "object" != typeof t6 && Object.defineProperty(e9, t6, c4), c4);

// node_modules/@lit/reactive-element/decorators/query.js
function e5(e9, r8) {
  return (n5, s4, i7) => {
    const o7 = (t6) => t6.renderRoot?.querySelector(e9) ?? null;
    if (r8) {
      const { get: e10, set: r9 } = "object" == typeof s4 ? n5 : i7 ?? /* @__PURE__ */ (() => {
        const t6 = /* @__PURE__ */ Symbol();
        return { get() {
          return this[t6];
        }, set(e11) {
          this[t6] = e11;
        } };
      })();
      return e4(n5, s4, { get() {
        let t6 = e10.call(this);
        return void 0 === t6 && (t6 = o7(this), (null !== t6 || this.hasUpdated) && r9.call(this, t6)), t6;
      } });
    }
    return e4(n5, s4, { get() {
      return o7(this);
    } });
  };
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.4TUIT776.js
var _hasRecordedInitialProperties;
var ShoelaceElement = class extends i4 {
  constructor() {
    super();
    __privateAdd(this, _hasRecordedInitialProperties, false);
    this.initialReflectedProperties = /* @__PURE__ */ new Map();
    Object.entries(this.constructor.dependencies).forEach(([name, component]) => {
      this.constructor.define(name, component);
    });
  }
  emit(name, options) {
    const event = new CustomEvent(name, __spreadValues({
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {}
    }, options));
    this.dispatchEvent(event);
    return event;
  }
  /* eslint-enable */
  static define(name, elementConstructor = this, options = {}) {
    const currentlyRegisteredConstructor = customElements.get(name);
    if (!currentlyRegisteredConstructor) {
      try {
        customElements.define(name, elementConstructor, options);
      } catch (_err) {
        customElements.define(name, class extends elementConstructor {
        }, options);
      }
      return;
    }
    let newVersion = " (unknown version)";
    let existingVersion = newVersion;
    if ("version" in elementConstructor && elementConstructor.version) {
      newVersion = " v" + elementConstructor.version;
    }
    if ("version" in currentlyRegisteredConstructor && currentlyRegisteredConstructor.version) {
      existingVersion = " v" + currentlyRegisteredConstructor.version;
    }
    if (newVersion && existingVersion && newVersion === existingVersion) {
      return;
    }
    console.warn(
      `Attempted to register <${name}>${newVersion}, but <${name}>${existingVersion} has already been registered.`
    );
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (!__privateGet(this, _hasRecordedInitialProperties)) {
      this.constructor.elementProperties.forEach(
        (obj, prop) => {
          if (obj.reflect && this[prop] != null) {
            this.initialReflectedProperties.set(prop, this[prop]);
          }
        }
      );
      __privateSet(this, _hasRecordedInitialProperties, true);
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }
  willUpdate(changedProperties) {
    super.willUpdate(changedProperties);
    this.initialReflectedProperties.forEach((value, prop) => {
      if (changedProperties.has(prop) && this[prop] == null) {
        this[prop] = value;
      }
    });
  }
};
_hasRecordedInitialProperties = /* @__PURE__ */ new WeakMap();
ShoelaceElement.version = "2.20.1";
ShoelaceElement.dependencies = {};
__decorateClass([
  n4()
], ShoelaceElement.prototype, "dir", 2);
__decorateClass([
  n4()
], ShoelaceElement.prototype, "lang", 2);

// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var min = Math.min;
var max = Math.max;
var round = Math.round;
var floor = Math.floor;
var createCoords = (v2) => ({
  x: v2,
  y: v2
});
var oppositeSideMap = {
  left: "right",
  right: "left",
  bottom: "top",
  top: "bottom"
};
function clamp(start, value, end2) {
  return max(start, min(value, end2));
}
function evaluate(value, param) {
  return typeof value === "function" ? value(param) : value;
}
function getSide(placement) {
  return placement.split("-")[0];
}
function getAlignment(placement) {
  return placement.split("-")[1];
}
function getOppositeAxis(axis) {
  return axis === "x" ? "y" : "x";
}
function getAxisLength(axis) {
  return axis === "y" ? "height" : "width";
}
function getSideAxis(placement) {
  const firstChar = placement[0];
  return firstChar === "t" || firstChar === "b" ? "y" : "x";
}
function getAlignmentAxis(placement) {
  return getOppositeAxis(getSideAxis(placement));
}
function getAlignmentSides(placement, rects, rtl) {
  if (rtl === void 0) {
    rtl = false;
  }
  const alignment = getAlignment(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const length = getAxisLength(alignmentAxis);
  let mainAlignmentSide = alignmentAxis === "x" ? alignment === (rtl ? "end" : "start") ? "right" : "left" : alignment === "start" ? "bottom" : "top";
  if (rects.reference[length] > rects.floating[length]) {
    mainAlignmentSide = getOppositePlacement(mainAlignmentSide);
  }
  return [mainAlignmentSide, getOppositePlacement(mainAlignmentSide)];
}
function getExpandedPlacements(placement) {
  const oppositePlacement = getOppositePlacement(placement);
  return [getOppositeAlignmentPlacement(placement), oppositePlacement, getOppositeAlignmentPlacement(oppositePlacement)];
}
function getOppositeAlignmentPlacement(placement) {
  return placement.includes("start") ? placement.replace("start", "end") : placement.replace("end", "start");
}
var lrPlacement = ["left", "right"];
var rlPlacement = ["right", "left"];
var tbPlacement = ["top", "bottom"];
var btPlacement = ["bottom", "top"];
function getSideList(side, isStart, rtl) {
  switch (side) {
    case "top":
    case "bottom":
      if (rtl) return isStart ? rlPlacement : lrPlacement;
      return isStart ? lrPlacement : rlPlacement;
    case "left":
    case "right":
      return isStart ? tbPlacement : btPlacement;
    default:
      return [];
  }
}
function getOppositeAxisPlacements(placement, flipAlignment, direction, rtl) {
  const alignment = getAlignment(placement);
  let list = getSideList(getSide(placement), direction === "start", rtl);
  if (alignment) {
    list = list.map((side) => side + "-" + alignment);
    if (flipAlignment) {
      list = list.concat(list.map(getOppositeAlignmentPlacement));
    }
  }
  return list;
}
function getOppositePlacement(placement) {
  const side = getSide(placement);
  return oppositeSideMap[side] + placement.slice(side.length);
}
function expandPaddingObject(padding) {
  var _padding$top, _padding$right, _padding$bottom, _padding$left;
  return {
    top: (_padding$top = padding.top) != null ? _padding$top : 0,
    right: (_padding$right = padding.right) != null ? _padding$right : 0,
    bottom: (_padding$bottom = padding.bottom) != null ? _padding$bottom : 0,
    left: (_padding$left = padding.left) != null ? _padding$left : 0
  };
}
function getPaddingObject(padding) {
  return typeof padding !== "number" ? expandPaddingObject(padding) : {
    top: padding,
    right: padding,
    bottom: padding,
    left: padding
  };
}
function rectToClientRect(rect) {
  const {
    x: x2,
    y: y3,
    width,
    height
  } = rect;
  return {
    width,
    height,
    top: y3,
    left: x2,
    right: x2 + width,
    bottom: y3 + height,
    x: x2,
    y: y3
  };
}

// node_modules/@floating-ui/core/dist/floating-ui.core.mjs
function computeCoordsFromPlacement(_ref, placement, rtl) {
  let {
    reference,
    floating
  } = _ref;
  const sideAxis = getSideAxis(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const alignLength = getAxisLength(alignmentAxis);
  const side = getSide(placement);
  const isVertical = sideAxis === "y";
  const commonX = reference.x + reference.width / 2 - floating.width / 2;
  const commonY = reference.y + reference.height / 2 - floating.height / 2;
  const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;
  let coords;
  switch (side) {
    case "top":
      coords = {
        x: commonX,
        y: reference.y - floating.height
      };
      break;
    case "bottom":
      coords = {
        x: commonX,
        y: reference.y + reference.height
      };
      break;
    case "right":
      coords = {
        x: reference.x + reference.width,
        y: commonY
      };
      break;
    case "left":
      coords = {
        x: reference.x - floating.width,
        y: commonY
      };
      break;
    default:
      coords = {
        x: reference.x,
        y: reference.y
      };
  }
  const alignment = getAlignment(placement);
  if (alignment) {
    coords[alignmentAxis] += commonAlign * (alignment === "end" ? 1 : -1) * (rtl && isVertical ? -1 : 1);
  }
  return coords;
}
async function detectOverflow(state, options) {
  var _await$platform$isEle;
  if (options === void 0) {
    options = {};
  }
  const {
    x: x2,
    y: y3,
    platform: platform2,
    rects,
    elements,
    strategy
  } = state;
  const {
    boundary = "clippingAncestors",
    rootBoundary = "viewport",
    elementContext = "floating",
    altBoundary = false,
    padding = 0
  } = evaluate(options, state);
  const paddingObject = getPaddingObject(padding);
  const altContext = elementContext === "floating" ? "reference" : "floating";
  const element = elements[altBoundary ? altContext : elementContext];
  const clippingClientRect = rectToClientRect(await platform2.getClippingRect({
    element: ((_await$platform$isEle = await (platform2.isElement == null ? void 0 : platform2.isElement(element))) != null ? _await$platform$isEle : true) ? element : element.contextElement || await (platform2.getDocumentElement == null ? void 0 : platform2.getDocumentElement(elements.floating)),
    boundary,
    rootBoundary,
    strategy
  }));
  const rect = elementContext === "floating" ? {
    x: x2,
    y: y3,
    width: rects.floating.width,
    height: rects.floating.height
  } : rects.reference;
  const offsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(elements.floating));
  const offsetScale = await (platform2.isElement == null ? void 0 : platform2.isElement(offsetParent)) && await (platform2.getScale == null ? void 0 : platform2.getScale(offsetParent)) || {
    x: 1,
    y: 1
  };
  const elementClientRect = rectToClientRect(platform2.convertOffsetParentRelativeRectToViewportRelativeRect ? await platform2.convertOffsetParentRelativeRectToViewportRelativeRect({
    elements,
    rect,
    offsetParent,
    strategy
  }) : rect);
  return {
    top: (clippingClientRect.top - elementClientRect.top + paddingObject.top) / offsetScale.y,
    bottom: (elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom) / offsetScale.y,
    left: (clippingClientRect.left - elementClientRect.left + paddingObject.left) / offsetScale.x,
    right: (elementClientRect.right - clippingClientRect.right + paddingObject.right) / offsetScale.x
  };
}
var MAX_RESET_COUNT = 50;
var computePosition = async (reference, floating, config) => {
  const {
    placement = "bottom",
    strategy = "absolute",
    middleware = [],
    platform: platform2
  } = config;
  const platformWithDetectOverflow = platform2.detectOverflow ? platform2 : {
    ...platform2,
    detectOverflow
  };
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(floating));
  let rects = await platform2.getElementRects({
    reference,
    floating,
    strategy
  });
  let {
    x: x2,
    y: y3
  } = computeCoordsFromPlacement(rects, placement, rtl);
  let statefulPlacement = placement;
  let resetCount = 0;
  const middlewareData = {};
  for (let i7 = 0; i7 < middleware.length; i7++) {
    const currentMiddleware = middleware[i7];
    if (!currentMiddleware) {
      continue;
    }
    const {
      name,
      fn
    } = currentMiddleware;
    const {
      x: nextX,
      y: nextY,
      data,
      reset
    } = await fn({
      x: x2,
      y: y3,
      initialPlacement: placement,
      placement: statefulPlacement,
      strategy,
      middlewareData,
      rects,
      platform: platformWithDetectOverflow,
      elements: {
        reference,
        floating
      }
    });
    x2 = nextX != null ? nextX : x2;
    y3 = nextY != null ? nextY : y3;
    middlewareData[name] = {
      ...middlewareData[name],
      ...data
    };
    if (reset && resetCount < MAX_RESET_COUNT) {
      resetCount++;
      if (typeof reset === "object") {
        if (reset.placement) {
          statefulPlacement = reset.placement;
        }
        if (reset.rects) {
          rects = reset.rects === true ? await platform2.getElementRects({
            reference,
            floating,
            strategy
          }) : reset.rects;
        }
        ({
          x: x2,
          y: y3
        } = computeCoordsFromPlacement(rects, statefulPlacement, rtl));
      }
      i7 = -1;
    }
  }
  return {
    x: x2,
    y: y3,
    placement: statefulPlacement,
    strategy,
    middlewareData
  };
};
var arrow = (options) => ({
  name: "arrow",
  options,
  async fn(state) {
    const {
      x: x2,
      y: y3,
      placement,
      rects,
      platform: platform2,
      elements,
      middlewareData
    } = state;
    const {
      element,
      padding = 0
    } = evaluate(options, state) || {};
    if (element == null) {
      return {};
    }
    const paddingObject = getPaddingObject(padding);
    const coords = {
      x: x2,
      y: y3
    };
    const axis = getAlignmentAxis(placement);
    const length = getAxisLength(axis);
    const arrowDimensions = await platform2.getDimensions(element);
    const isYAxis = axis === "y";
    const minProp = isYAxis ? "top" : "left";
    const maxProp = isYAxis ? "bottom" : "right";
    const clientProp = isYAxis ? "clientHeight" : "clientWidth";
    const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
    const startDiff = coords[axis] - rects.reference[axis];
    const arrowOffsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(element));
    let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
    if (!clientSize || !await (platform2.isElement == null ? void 0 : platform2.isElement(arrowOffsetParent))) {
      clientSize = elements.floating[clientProp] || rects.floating[length];
    }
    const centerToReference = endDiff / 2 - startDiff / 2;
    const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
    const minPadding = min(paddingObject[minProp], largestPossiblePadding);
    const maxPadding = min(paddingObject[maxProp], largestPossiblePadding);
    const max2 = clientSize - arrowDimensions[length] - maxPadding;
    const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
    const offset3 = clamp(minPadding, center, max2);
    const shouldAddOffset = !middlewareData.arrow && getAlignment(placement) != null && center !== offset3 && rects.reference[length] / 2 - (center < minPadding ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;
    const alignmentOffset = shouldAddOffset ? center < minPadding ? center - minPadding : center - max2 : 0;
    return {
      [axis]: coords[axis] + alignmentOffset,
      data: {
        [axis]: offset3,
        centerOffset: center - offset3 - alignmentOffset,
        ...shouldAddOffset && {
          alignmentOffset
        }
      },
      reset: shouldAddOffset
    };
  }
});
var flip = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "flip",
    options,
    async fn(state) {
      var _middlewareData$arrow, _middlewareData$flip;
      const {
        placement,
        middlewareData,
        rects,
        initialPlacement,
        platform: platform2,
        elements
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = true,
        fallbackPlacements: specifiedFallbackPlacements,
        fallbackStrategy = "bestFit",
        fallbackAxisSideDirection = "none",
        flipAlignment = true,
        ...detectOverflowOptions
      } = evaluate(options, state);
      if ((_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      const side = getSide(placement);
      const initialSideAxis = getSideAxis(initialPlacement);
      const isBasePlacement = getSide(initialPlacement) === initialPlacement;
      const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
      const fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipAlignment ? [getOppositePlacement(initialPlacement)] : getExpandedPlacements(initialPlacement));
      const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== "none";
      if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) {
        fallbackPlacements.push(...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl));
      }
      const placements2 = [initialPlacement, ...fallbackPlacements];
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const overflows = [];
      let overflowsData = ((_middlewareData$flip = middlewareData.flip) == null ? void 0 : _middlewareData$flip.overflows) || [];
      if (checkMainAxis) {
        overflows.push(overflow[side]);
      }
      if (checkCrossAxis) {
        const sides2 = getAlignmentSides(placement, rects, rtl);
        overflows.push(overflow[sides2[0]], overflow[sides2[1]]);
      }
      overflowsData = [...overflowsData, {
        placement,
        overflows
      }];
      if (!overflows.every((side2) => side2 <= 0)) {
        var _middlewareData$flip2, _overflowsData$filter;
        const nextIndex = (((_middlewareData$flip2 = middlewareData.flip) == null ? void 0 : _middlewareData$flip2.index) || 0) + 1;
        const nextPlacement = placements2[nextIndex];
        if (nextPlacement) {
          const ignoreCrossAxisOverflow = checkCrossAxis === "alignment" ? initialSideAxis !== getSideAxis(nextPlacement) : false;
          if (!ignoreCrossAxisOverflow || // We leave the current main axis only if every placement on that axis
          // overflows the main axis.
          overflowsData.every((d3) => getSideAxis(d3.placement) === initialSideAxis ? d3.overflows[0] > 0 : true)) {
            return {
              data: {
                index: nextIndex,
                overflows: overflowsData
              },
              reset: {
                placement: nextPlacement
              }
            };
          }
        }
        let resetPlacement = (_overflowsData$filter = overflowsData.filter((d3) => d3.overflows[0] <= 0).sort((a3, b3) => a3.overflows[1] - b3.overflows[1])[0]) == null ? void 0 : _overflowsData$filter.placement;
        if (!resetPlacement) {
          switch (fallbackStrategy) {
            case "bestFit": {
              var _overflowsData$filter2;
              const placement2 = (_overflowsData$filter2 = overflowsData.filter((d3) => {
                if (hasFallbackAxisSideDirection) {
                  const currentSideAxis = getSideAxis(d3.placement);
                  return currentSideAxis === initialSideAxis || // Create a bias to the `y` side axis due to horizontal
                  // reading directions favoring greater width.
                  currentSideAxis === "y";
                }
                return true;
              }).map((d3) => [d3.placement, d3.overflows.filter((overflow2) => overflow2 > 0).reduce((acc, overflow2) => acc + overflow2, 0)]).sort((a3, b3) => a3[1] - b3[1])[0]) == null ? void 0 : _overflowsData$filter2[0];
              if (placement2) {
                resetPlacement = placement2;
              }
              break;
            }
            case "initialPlacement":
              resetPlacement = initialPlacement;
              break;
          }
        }
        if (placement !== resetPlacement) {
          return {
            reset: {
              placement: resetPlacement
            }
          };
        }
      }
      return {};
    }
  };
};
var originSides = /* @__PURE__ */ new Set(["left", "top"]);
async function convertValueToCoords(state, options) {
  const {
    placement,
    platform: platform2,
    elements
  } = state;
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
  const side = getSide(placement);
  const alignment = getAlignment(placement);
  const isVertical = getSideAxis(placement) === "y";
  const mainAxisMulti = originSides.has(side) ? -1 : 1;
  const crossAxisMulti = rtl && isVertical ? -1 : 1;
  const rawValue = evaluate(options, state);
  let {
    mainAxis,
    crossAxis,
    alignmentAxis
  } = typeof rawValue === "number" ? {
    mainAxis: rawValue,
    crossAxis: 0,
    alignmentAxis: null
  } : {
    mainAxis: rawValue.mainAxis || 0,
    crossAxis: rawValue.crossAxis || 0,
    alignmentAxis: rawValue.alignmentAxis
  };
  if (alignment && typeof alignmentAxis === "number") {
    crossAxis = alignment === "end" ? alignmentAxis * -1 : alignmentAxis;
  }
  return isVertical ? {
    x: crossAxis * crossAxisMulti,
    y: mainAxis * mainAxisMulti
  } : {
    x: mainAxis * mainAxisMulti,
    y: crossAxis * crossAxisMulti
  };
}
var offset = function(options) {
  if (options === void 0) {
    options = 0;
  }
  return {
    name: "offset",
    options,
    async fn(state) {
      var _middlewareData$offse, _middlewareData$arrow;
      const {
        x: x2,
        y: y3,
        placement,
        middlewareData
      } = state;
      const diffCoords = await convertValueToCoords(state, options);
      if (placement === ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse.placement) && (_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      return {
        x: x2 + diffCoords.x,
        y: y3 + diffCoords.y,
        data: {
          ...diffCoords,
          placement
        }
      };
    }
  };
};
var shift = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "shift",
    options,
    async fn(state) {
      const {
        x: x2,
        y: y3,
        placement,
        platform: platform2
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = false,
        limiter = {
          fn: (_ref) => {
            let {
              x: x3,
              y: y4
            } = _ref;
            return {
              x: x3,
              y: y4
            };
          }
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const coords = {
        x: x2,
        y: y3
      };
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const crossAxis = getSideAxis(placement);
      const mainAxis = getOppositeAxis(crossAxis);
      let mainAxisCoord = coords[mainAxis];
      let crossAxisCoord = coords[crossAxis];
      const clampCoord = (axis, coord) => clamp(coord + overflow[axis === "y" ? "top" : "left"], coord, coord - overflow[axis === "y" ? "bottom" : "right"]);
      if (checkMainAxis) {
        mainAxisCoord = clampCoord(mainAxis, mainAxisCoord);
      }
      if (checkCrossAxis) {
        crossAxisCoord = clampCoord(crossAxis, crossAxisCoord);
      }
      const limitedCoords = limiter.fn({
        ...state,
        [mainAxis]: mainAxisCoord,
        [crossAxis]: crossAxisCoord
      });
      return {
        ...limitedCoords,
        data: {
          x: limitedCoords.x - x2,
          y: limitedCoords.y - y3,
          enabled: {
            [mainAxis]: checkMainAxis,
            [crossAxis]: checkCrossAxis
          }
        }
      };
    }
  };
};
var size = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "size",
    options,
    async fn(state) {
      const {
        placement,
        rects,
        platform: platform2,
        elements
      } = state;
      const {
        apply = () => {
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const side = getSide(placement);
      const alignment = getAlignment(placement);
      const isYAxis = getSideAxis(placement) === "y";
      const {
        width,
        height
      } = rects.floating;
      let heightSide;
      let widthSide;
      if (side === "top" || side === "bottom") {
        heightSide = side;
        widthSide = alignment === (await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating)) ? "start" : "end") ? "left" : "right";
      } else {
        widthSide = side;
        heightSide = alignment === "end" ? "top" : "bottom";
      }
      const maximumClippingHeight = height - overflow.top - overflow.bottom;
      const maximumClippingWidth = width - overflow.left - overflow.right;
      const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
      const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);
      const shiftData = state.middlewareData.shift;
      const noShift = !shiftData;
      let availableHeight = overflowAvailableHeight;
      let availableWidth = overflowAvailableWidth;
      if (shiftData != null && shiftData.enabled.x) {
        availableWidth = maximumClippingWidth;
      }
      if (shiftData != null && shiftData.enabled.y) {
        availableHeight = maximumClippingHeight;
      }
      if (noShift && !alignment) {
        if (isYAxis) {
          availableWidth = width - 2 * max(overflow.left, overflow.right);
        } else {
          availableHeight = height - 2 * max(overflow.top, overflow.bottom);
        }
      }
      await apply({
        ...state,
        availableWidth,
        availableHeight
      });
      const nextDimensions = await platform2.getDimensions(elements.floating);
      if (width !== nextDimensions.width || height !== nextDimensions.height) {
        return {
          reset: {
            rects: true
          }
        };
      }
      return {};
    }
  };
};

// node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
function hasWindow() {
  return typeof window !== "undefined";
}
function getNodeName(node) {
  if (isNode(node)) {
    return (node.nodeName || "").toLowerCase();
  }
  return "#document";
}
function getWindow(node) {
  var _node$ownerDocument;
  return (node == null || (_node$ownerDocument = node.ownerDocument) == null ? void 0 : _node$ownerDocument.defaultView) || window;
}
function getDocumentElement(node) {
  var _ref;
  return (_ref = (isNode(node) ? node.ownerDocument : node.document) || window.document) == null ? void 0 : _ref.documentElement;
}
function isNode(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Node || value instanceof getWindow(value).Node;
}
function isElement(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Element || value instanceof getWindow(value).Element;
}
function isHTMLElement(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof HTMLElement || value instanceof getWindow(value).HTMLElement;
}
function isShadowRoot(value) {
  if (!hasWindow() || typeof ShadowRoot === "undefined") {
    return false;
  }
  return value instanceof ShadowRoot || value instanceof getWindow(value).ShadowRoot;
}
function isOverflowElement(element) {
  const {
    overflow,
    overflowX,
    overflowY,
    display
  } = getComputedStyle2(element);
  return /auto|scroll|overlay|hidden|clip/.test(overflow + overflowY + overflowX) && display !== "inline" && display !== "contents";
}
function isTableElement(element) {
  return /^(table|td|th)$/.test(getNodeName(element));
}
function isTopLayer(element) {
  try {
    if (element.matches(":popover-open")) {
      return true;
    }
  } catch (_e) {
  }
  try {
    return element.matches(":modal");
  } catch (_e) {
    return false;
  }
}
var willChangeRe = /transform|translate|scale|rotate|perspective|filter/;
var containRe = /paint|layout|strict|content/;
var isNotNone = (value) => !!value && value !== "none";
var isWebKitValue;
function isContainingBlock(elementOrCss) {
  const css = isElement(elementOrCss) ? getComputedStyle2(elementOrCss) : elementOrCss;
  return isNotNone(css.transform) || isNotNone(css.translate) || isNotNone(css.scale) || isNotNone(css.rotate) || isNotNone(css.perspective) || !isWebKit() && (isNotNone(css.backdropFilter) || isNotNone(css.filter)) || willChangeRe.test(css.willChange || "") || containRe.test(css.contain || "");
}
function getContainingBlock(element) {
  let currentNode = getParentNode(element);
  while (isHTMLElement(currentNode) && !isLastTraversableNode(currentNode)) {
    if (isContainingBlock(currentNode)) {
      return currentNode;
    } else if (isTopLayer(currentNode)) {
      return null;
    }
    currentNode = getParentNode(currentNode);
  }
  return null;
}
function isWebKit() {
  if (isWebKitValue == null) {
    isWebKitValue = typeof CSS !== "undefined" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none");
  }
  return isWebKitValue;
}
function isLastTraversableNode(node) {
  return /^(html|body|#document)$/.test(getNodeName(node));
}
function getComputedStyle2(element) {
  return getWindow(element).getComputedStyle(element);
}
function getNodeScroll(element) {
  if (isElement(element)) {
    return {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop
    };
  }
  return {
    scrollLeft: element.scrollX,
    scrollTop: element.scrollY
  };
}
function getParentNode(node) {
  if (getNodeName(node) === "html") {
    return node;
  }
  const result = (
    // Step into the shadow DOM of the parent of a slotted node.
    node.assignedSlot || // DOM Element detected.
    node.parentNode || // ShadowRoot detected.
    isShadowRoot(node) && node.host || // Fallback.
    getDocumentElement(node)
  );
  return isShadowRoot(result) ? result.host : result;
}
function getNearestOverflowAncestor(node) {
  const parentNode = getParentNode(node);
  if (isLastTraversableNode(parentNode)) {
    return (node.ownerDocument || node).body;
  }
  if (isHTMLElement(parentNode) && isOverflowElement(parentNode)) {
    return parentNode;
  }
  return getNearestOverflowAncestor(parentNode);
}
function getOverflowAncestors(node, list, traverseIframes) {
  var _node$ownerDocument2;
  if (list === void 0) {
    list = [];
  }
  if (traverseIframes === void 0) {
    traverseIframes = true;
  }
  const scrollableAncestor = getNearestOverflowAncestor(node);
  const isBody = scrollableAncestor === ((_node$ownerDocument2 = node.ownerDocument) == null ? void 0 : _node$ownerDocument2.body);
  const win = getWindow(scrollableAncestor);
  if (isBody) {
    const frameElement = getFrameElement(win);
    return list.concat(win, win.visualViewport || [], isOverflowElement(scrollableAncestor) ? scrollableAncestor : [], frameElement && traverseIframes ? getOverflowAncestors(frameElement) : []);
  } else {
    return list.concat(scrollableAncestor, getOverflowAncestors(scrollableAncestor, [], traverseIframes));
  }
}
function getFrameElement(win) {
  return win.parent && Object.getPrototypeOf(win.parent) ? win.frameElement : null;
}

// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function getCssDimensions(element) {
  const css = getComputedStyle2(element);
  let width = parseFloat(css.width) || 0;
  let height = parseFloat(css.height) || 0;
  const hasOffset = isHTMLElement(element);
  const offsetWidth = hasOffset ? element.offsetWidth : width;
  const offsetHeight = hasOffset ? element.offsetHeight : height;
  const shouldFallback = round(width) !== offsetWidth || round(height) !== offsetHeight;
  if (shouldFallback) {
    width = offsetWidth;
    height = offsetHeight;
  }
  return {
    width,
    height,
    $: shouldFallback
  };
}
function unwrapElement(element) {
  return !isElement(element) ? element.contextElement : element;
}
function getScale(element) {
  const domElement = unwrapElement(element);
  if (!isHTMLElement(domElement)) {
    return createCoords(1);
  }
  const rect = domElement.getBoundingClientRect();
  const {
    width,
    height,
    $: $2
  } = getCssDimensions(domElement);
  let x2 = ($2 ? round(rect.width) : rect.width) / width;
  let y3 = ($2 ? round(rect.height) : rect.height) / height;
  if (!x2 || !Number.isFinite(x2)) {
    x2 = 1;
  }
  if (!y3 || !Number.isFinite(y3)) {
    y3 = 1;
  }
  return {
    x: x2,
    y: y3
  };
}
var noOffsets = /* @__PURE__ */ createCoords(0);
function getVisualOffsets(element) {
  const win = getWindow(element);
  if (!isWebKit() || !win.visualViewport) {
    return noOffsets;
  }
  return {
    x: win.visualViewport.offsetLeft,
    y: win.visualViewport.offsetTop
  };
}
function shouldAddVisualOffsets(element, isFixed, floatingOffsetParent) {
  if (isFixed === void 0) {
    isFixed = false;
  }
  return !!floatingOffsetParent && isFixed && floatingOffsetParent === getWindow(element);
}
function getBoundingClientRect(element, includeScale, isFixedStrategy, offsetParent) {
  if (includeScale === void 0) {
    includeScale = false;
  }
  if (isFixedStrategy === void 0) {
    isFixedStrategy = false;
  }
  const clientRect = element.getBoundingClientRect();
  const domElement = unwrapElement(element);
  let scale = createCoords(1);
  if (includeScale) {
    if (offsetParent) {
      if (isElement(offsetParent)) {
        scale = getScale(offsetParent);
      }
    } else {
      scale = getScale(element);
    }
  }
  const visualOffsets = shouldAddVisualOffsets(domElement, isFixedStrategy, offsetParent) ? getVisualOffsets(domElement) : createCoords(0);
  let x2 = (clientRect.left + visualOffsets.x) / scale.x;
  let y3 = (clientRect.top + visualOffsets.y) / scale.y;
  let width = clientRect.width / scale.x;
  let height = clientRect.height / scale.y;
  if (domElement && offsetParent) {
    const win = getWindow(domElement);
    const offsetWin = isElement(offsetParent) ? getWindow(offsetParent) : offsetParent;
    let currentWin = win;
    let currentIFrame = getFrameElement(currentWin);
    while (currentIFrame && offsetWin !== currentWin) {
      const iframeScale = getScale(currentIFrame);
      const iframeRect = currentIFrame.getBoundingClientRect();
      const css = getComputedStyle2(currentIFrame);
      const left = iframeRect.left + (currentIFrame.clientLeft + parseFloat(css.paddingLeft)) * iframeScale.x;
      const top = iframeRect.top + (currentIFrame.clientTop + parseFloat(css.paddingTop)) * iframeScale.y;
      x2 *= iframeScale.x;
      y3 *= iframeScale.y;
      width *= iframeScale.x;
      height *= iframeScale.y;
      x2 += left;
      y3 += top;
      currentWin = getWindow(currentIFrame);
      currentIFrame = getFrameElement(currentWin);
    }
  }
  return rectToClientRect({
    width,
    height,
    x: x2,
    y: y3
  });
}
function getWindowScrollBarX(element, rect) {
  const leftScroll = getNodeScroll(element).scrollLeft;
  if (!rect) {
    return getBoundingClientRect(getDocumentElement(element)).left + leftScroll;
  }
  return rect.left + leftScroll;
}
function getHTMLOffset(documentElement, scroll) {
  const htmlRect = documentElement.getBoundingClientRect();
  const x2 = htmlRect.left + scroll.scrollLeft - getWindowScrollBarX(documentElement, htmlRect);
  const y3 = htmlRect.top + scroll.scrollTop;
  return {
    x: x2,
    y: y3
  };
}
function convertOffsetParentRelativeRectToViewportRelativeRect(_ref) {
  let {
    elements,
    rect,
    offsetParent,
    strategy
  } = _ref;
  const isFixed = strategy === "fixed";
  const documentElement = getDocumentElement(offsetParent);
  const topLayer = elements ? isTopLayer(elements.floating) : false;
  if (offsetParent === documentElement || topLayer && isFixed) {
    return rect;
  }
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  let scale = createCoords(1);
  const offsets = createCoords(0);
  const isOffsetParentAnElement = isHTMLElement(offsetParent);
  if (isOffsetParentAnElement || !isFixed) {
    if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent);
      scale = getScale(offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    }
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  return {
    width: rect.width * scale.x,
    height: rect.height * scale.y,
    x: rect.x * scale.x - scroll.scrollLeft * scale.x + offsets.x + htmlOffset.x,
    y: rect.y * scale.y - scroll.scrollTop * scale.y + offsets.y + htmlOffset.y
  };
}
function getClientRects(element) {
  return element.getClientRects ? Array.from(element.getClientRects()) : [];
}
function getDocumentRect(html) {
  const scroll = getNodeScroll(html);
  const body = html.ownerDocument.body;
  const width = max(html.scrollWidth, html.clientWidth, body.scrollWidth, body.clientWidth);
  const height = max(html.scrollHeight, html.clientHeight, body.scrollHeight, body.clientHeight);
  let x2 = -scroll.scrollLeft + getWindowScrollBarX(html);
  const y3 = -scroll.scrollTop;
  if (getComputedStyle2(body).direction === "rtl") {
    x2 += max(html.clientWidth, body.clientWidth) - width;
  }
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
var SCROLLBAR_MAX = 25;
function getViewportRect(element, strategy, rootBoundary) {
  if (rootBoundary === void 0) {
    rootBoundary = "viewport";
  }
  const isLayoutViewport = rootBoundary === "layoutViewport";
  const win = getWindow(element);
  const html = getDocumentElement(element);
  const visualViewport = win.visualViewport;
  let width = html.clientWidth;
  let height = html.clientHeight;
  let x2 = 0;
  let y3 = 0;
  if (visualViewport) {
    const layoutRelativeClientCoords = !isWebKit() || strategy === "fixed";
    if (isLayoutViewport) {
      if (!layoutRelativeClientCoords) {
        x2 = -visualViewport.offsetLeft;
        y3 = -visualViewport.offsetTop;
      }
    } else {
      width = visualViewport.width;
      height = visualViewport.height;
      if (layoutRelativeClientCoords) {
        x2 = visualViewport.offsetLeft;
        y3 = visualViewport.offsetTop;
      }
    }
  }
  const windowScrollbarX = getWindowScrollBarX(html);
  if (windowScrollbarX <= 0) {
    const doc = html.ownerDocument;
    const body = doc.body;
    const bodyStyles = getComputedStyle(body);
    const bodyMarginInline = doc.compatMode === "CSS1Compat" ? parseFloat(bodyStyles.marginLeft) + parseFloat(bodyStyles.marginRight) || 0 : 0;
    const reservedWidth = Math.abs(html.clientWidth - body.clientWidth - bodyMarginInline);
    const gutter = getComputedStyle(html).scrollbarGutter === "stable both-edges" ? reservedWidth / 2 : reservedWidth;
    if (gutter <= SCROLLBAR_MAX) {
      width -= gutter;
    }
  }
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
function getInnerBoundingClientRect(element, strategy) {
  const clientRect = getBoundingClientRect(element, true, strategy === "fixed");
  const top = clientRect.top + element.clientTop;
  const left = clientRect.left + element.clientLeft;
  const scale = getScale(element);
  const width = element.clientWidth * scale.x;
  const height = element.clientHeight * scale.y;
  const x2 = left * scale.x;
  const y3 = top * scale.y;
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
function getClientRectFromClippingAncestor(element, clippingAncestor, strategy) {
  let rect;
  if (clippingAncestor === "viewport" || clippingAncestor === "layoutViewport") {
    rect = getViewportRect(element, strategy, clippingAncestor);
  } else if (clippingAncestor === "document") {
    rect = getDocumentRect(getDocumentElement(element));
  } else if (isElement(clippingAncestor)) {
    rect = getInnerBoundingClientRect(clippingAncestor, strategy);
  } else {
    const visualOffsets = getVisualOffsets(element);
    rect = {
      x: clippingAncestor.x - visualOffsets.x,
      y: clippingAncestor.y - visualOffsets.y,
      width: clippingAncestor.width,
      height: clippingAncestor.height
    };
  }
  return rectToClientRect(rect);
}
function getClippingElementAncestors(element, cache) {
  const cachedResult = cache.get(element);
  if (cachedResult) {
    return cachedResult;
  }
  let result = getOverflowAncestors(element, [], false).filter((el) => isElement(el) && getNodeName(el) !== "body");
  let lastKeptComputedStyle = null;
  const elementIsFixed = getComputedStyle2(element).position === "fixed";
  let currentNode = elementIsFixed ? getParentNode(element) : element;
  while (isElement(currentNode) && !isLastTraversableNode(currentNode)) {
    const computedStyle = getComputedStyle2(currentNode);
    const currentNodeIsContaining = isContainingBlock(currentNode);
    const lastPosition = lastKeptComputedStyle ? lastKeptComputedStyle.position : elementIsFixed ? "fixed" : "";
    const shouldDropCurrentNode = !currentNodeIsContaining && (lastPosition === "fixed" || lastPosition === "absolute" && computedStyle.position === "static");
    if (shouldDropCurrentNode) {
      result = result.filter((ancestor) => ancestor !== currentNode);
    } else {
      lastKeptComputedStyle = computedStyle;
    }
    currentNode = getParentNode(currentNode);
  }
  cache.set(element, result);
  return result;
}
function getClippingRect(_ref) {
  let {
    element,
    boundary,
    rootBoundary,
    strategy
  } = _ref;
  const elementClippingAncestors = boundary === "clippingAncestors" ? isTopLayer(element) ? [] : getClippingElementAncestors(element, this._c) : [].concat(boundary);
  const clippingAncestors = [...elementClippingAncestors, rootBoundary];
  const firstRect = getClientRectFromClippingAncestor(element, clippingAncestors[0], strategy);
  let top = firstRect.top;
  let right = firstRect.right;
  let bottom = firstRect.bottom;
  let left = firstRect.left;
  for (let i7 = 1; i7 < clippingAncestors.length; i7++) {
    const rect = getClientRectFromClippingAncestor(element, clippingAncestors[i7], strategy);
    top = max(rect.top, top);
    right = min(rect.right, right);
    bottom = min(rect.bottom, bottom);
    left = max(rect.left, left);
  }
  return {
    width: right - left,
    height: bottom - top,
    x: left,
    y: top
  };
}
function getDimensions(element) {
  const {
    width,
    height
  } = getCssDimensions(element);
  return {
    width,
    height
  };
}
function getRectRelativeToOffsetParent(element, offsetParent, strategy) {
  const isOffsetParentAnElement = isHTMLElement(offsetParent);
  const documentElement = getDocumentElement(offsetParent);
  const isFixed = strategy === "fixed";
  const rect = getBoundingClientRect(element, true, isFixed, offsetParent);
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  const offsets = createCoords(0);
  if (isOffsetParentAnElement || !isFixed) {
    if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent, true, isFixed, offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    }
  }
  if (!isOffsetParentAnElement && documentElement) {
    offsets.x = getWindowScrollBarX(documentElement);
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  const x2 = rect.left + scroll.scrollLeft - offsets.x - htmlOffset.x;
  const y3 = rect.top + scroll.scrollTop - offsets.y - htmlOffset.y;
  return {
    x: x2,
    y: y3,
    width: rect.width,
    height: rect.height
  };
}
function isStaticPositioned(element) {
  return getComputedStyle2(element).position === "static";
}
function getTrueOffsetParent(element, polyfill) {
  if (!isHTMLElement(element) || getComputedStyle2(element).position === "fixed") {
    return null;
  }
  if (polyfill) {
    return polyfill(element);
  }
  let rawOffsetParent = element.offsetParent;
  if (getDocumentElement(element) === rawOffsetParent) {
    rawOffsetParent = rawOffsetParent.ownerDocument.body;
  }
  return rawOffsetParent;
}
function getOffsetParent(element, polyfill) {
  const win = getWindow(element);
  if (isTopLayer(element)) {
    return win;
  }
  if (!isHTMLElement(element)) {
    let svgOffsetParent = getParentNode(element);
    while (svgOffsetParent && !isLastTraversableNode(svgOffsetParent)) {
      if (isElement(svgOffsetParent) && !isStaticPositioned(svgOffsetParent)) {
        return svgOffsetParent;
      }
      svgOffsetParent = getParentNode(svgOffsetParent);
    }
    return win;
  }
  let offsetParent = getTrueOffsetParent(element, polyfill);
  while (offsetParent && isTableElement(offsetParent) && isStaticPositioned(offsetParent)) {
    offsetParent = getTrueOffsetParent(offsetParent, polyfill);
  }
  if (offsetParent && isLastTraversableNode(offsetParent) && isStaticPositioned(offsetParent) && !isContainingBlock(offsetParent)) {
    return win;
  }
  return offsetParent || getContainingBlock(element) || win;
}
var getElementRects = async function(data) {
  const getOffsetParentFn = this.getOffsetParent || getOffsetParent;
  const getDimensionsFn = this.getDimensions;
  const floatingDimensions = await getDimensionsFn(data.floating);
  return {
    reference: getRectRelativeToOffsetParent(data.reference, await getOffsetParentFn(data.floating), data.strategy),
    floating: {
      x: 0,
      y: 0,
      width: floatingDimensions.width,
      height: floatingDimensions.height
    }
  };
};
function isRTL(element) {
  return getComputedStyle2(element).direction === "rtl";
}
var platform = {
  convertOffsetParentRelativeRectToViewportRelativeRect,
  getDocumentElement,
  getClippingRect,
  getOffsetParent,
  getElementRects,
  getClientRects,
  getDimensions,
  getScale,
  isElement,
  isRTL
};
function rectsAreEqual(a3, b3) {
  return a3.x === b3.x && a3.y === b3.y && a3.width === b3.width && a3.height === b3.height;
}
function observeMove(element, onMove, ancestorResize) {
  let io = null;
  let timeoutId;
  const root = getDocumentElement(element);
  function cleanup() {
    var _io;
    clearTimeout(timeoutId);
    (_io = io) == null || _io.disconnect();
    io = null;
  }
  function refresh(skip, threshold) {
    if (skip === void 0) {
      skip = false;
    }
    if (threshold === void 0) {
      threshold = 1;
    }
    cleanup();
    const elementRectForRootMargin = element.getBoundingClientRect();
    const {
      left,
      top,
      width,
      height
    } = elementRectForRootMargin;
    if (!skip) {
      onMove();
    }
    if (!width || !height) {
      return;
    }
    const insetTop = floor(top);
    const insetRight = floor(root.clientWidth - (left + width));
    const insetBottom = floor(root.clientHeight - (top + height));
    const insetLeft = floor(left);
    const rootMargin = -insetTop + "px " + -insetRight + "px " + -insetBottom + "px " + -insetLeft + "px";
    const options = {
      rootMargin,
      threshold: max(0, min(1, threshold)) || 1
    };
    let isFirstUpdate = true;
    function handleObserve(entries) {
      const ratio = entries[0].intersectionRatio;
      if (!rectsAreEqual(elementRectForRootMargin, element.getBoundingClientRect())) {
        return refresh();
      }
      if (ratio !== threshold) {
        if (!isFirstUpdate) {
          return refresh();
        }
        if (!ratio) {
          timeoutId = setTimeout(() => {
            refresh(false, 1e-7);
          }, 1e3);
        } else {
          refresh(false, ratio);
        }
      }
      isFirstUpdate = false;
    }
    try {
      io = new IntersectionObserver(handleObserve, {
        ...options,
        // Handle <iframe>s
        root: root.ownerDocument
      });
    } catch (_e) {
      io = new IntersectionObserver(handleObserve, options);
    }
    io.observe(element);
  }
  const win = getWindow(element);
  const handleResize = () => refresh(ancestorResize);
  win.addEventListener("resize", handleResize);
  refresh(true);
  return () => {
    win.removeEventListener("resize", handleResize);
    cleanup();
  };
}
function autoUpdate(reference, floating, update2, options) {
  if (options === void 0) {
    options = {};
  }
  const {
    ancestorScroll = true,
    ancestorResize = true,
    elementResize = typeof ResizeObserver === "function",
    layoutShift = typeof IntersectionObserver === "function",
    animationFrame = false
  } = options;
  const referenceEl = unwrapElement(reference);
  const ancestors = ancestorScroll || ancestorResize ? [...referenceEl ? getOverflowAncestors(referenceEl) : [], ...floating ? getOverflowAncestors(floating) : []] : [];
  ancestors.forEach((ancestor) => {
    ancestorScroll && ancestor.addEventListener("scroll", update2);
    ancestorResize && ancestor.addEventListener("resize", update2);
  });
  const cleanupIo = referenceEl && layoutShift ? observeMove(referenceEl, update2, ancestorResize) : null;
  let reobserveFrame = -1;
  let resizeObserver = null;
  if (elementResize) {
    resizeObserver = new ResizeObserver((_ref) => {
      let [firstEntry] = _ref;
      if (firstEntry && firstEntry.target === referenceEl && resizeObserver && floating) {
        resizeObserver.unobserve(floating);
        cancelAnimationFrame(reobserveFrame);
        reobserveFrame = requestAnimationFrame(() => {
          var _resizeObserver;
          (_resizeObserver = resizeObserver) == null || _resizeObserver.observe(floating);
        });
      }
      update2();
    });
    if (referenceEl && !animationFrame) {
      resizeObserver.observe(referenceEl);
    }
    if (floating) {
      resizeObserver.observe(floating);
    }
  }
  let frameId;
  let prevRefRect = animationFrame ? getBoundingClientRect(reference) : null;
  if (animationFrame) {
    frameLoop();
  }
  function frameLoop() {
    const nextRefRect = getBoundingClientRect(reference);
    if (prevRefRect && !rectsAreEqual(prevRefRect, nextRefRect)) {
      update2();
    }
    prevRefRect = nextRefRect;
    frameId = requestAnimationFrame(frameLoop);
  }
  update2();
  return () => {
    var _resizeObserver2;
    ancestors.forEach((ancestor) => {
      ancestorScroll && ancestor.removeEventListener("scroll", update2);
      ancestorResize && ancestor.removeEventListener("resize", update2);
    });
    cleanupIo == null || cleanupIo();
    (_resizeObserver2 = resizeObserver) == null || _resizeObserver2.disconnect();
    resizeObserver = null;
    if (animationFrame) {
      cancelAnimationFrame(frameId);
    }
  };
}
var offset2 = offset;
var shift2 = shift;
var flip2 = flip;
var size2 = size;
var arrow2 = arrow;
var computePosition2 = (reference, floating, options) => {
  const cache = /* @__PURE__ */ new Map();
  const mergedOptions = options != null ? options : {};
  const platformWithCache = {
    ...platform,
    ...mergedOptions.platform,
    _c: cache
  };
  return computePosition(reference, floating, {
    ...mergedOptions,
    platform: platformWithCache
  });
};

// node_modules/lit-html/directive.js
var t4 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e6 = (t6) => (...e9) => ({ _$litDirective$: t6, values: e9 });
var i5 = class {
  constructor(t6) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t6, e9, i7) {
    this._$Ct = t6, this._$AM = e9, this._$Ci = i7;
  }
  _$AS(t6, e9) {
    return this.update(t6, e9);
  }
  update(t6, e9) {
    return this.render(...e9);
  }
};

// node_modules/lit-html/directives/class-map.js
var e7 = e6(class extends i5 {
  constructor(t6) {
    if (super(t6), t6.type !== t4.ATTRIBUTE || "class" !== t6.name || t6.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
  }
  render(t6) {
    return " " + Object.keys(t6).filter((s4) => t6[s4]).join(" ") + " ";
  }
  update(s4, [i7]) {
    if (void 0 === this.st) {
      this.st = /* @__PURE__ */ new Set(), void 0 !== s4.strings && (this.nt = new Set(s4.strings.join(" ").split(/\s/).filter((t6) => "" !== t6)));
      for (const t6 in i7) i7[t6] && !this.nt?.has(t6) && this.st.add(t6);
      return this.render(i7);
    }
    const r8 = s4.element.classList;
    for (const t6 of this.st) t6 in i7 || (r8.remove(t6), this.st.delete(t6));
    for (const t6 in i7) {
      const s5 = !!i7[t6];
      s5 === this.st.has(t6) || this.nt?.has(t6) || (s5 ? (r8.add(t6), this.st.add(t6)) : (r8.remove(t6), this.st.delete(t6)));
    }
    return E;
  }
});

// node_modules/composed-offset-position/dist/composed-offset-position.browser.min.mjs
function e8(t6) {
  return i6(t6);
}
function r6(t6) {
  return t6.assignedSlot ? t6.assignedSlot : t6.parentNode instanceof ShadowRoot ? t6.parentNode.host : t6.parentNode;
}
function i6(e9) {
  for (let t6 = e9; t6; t6 = r6(t6)) if (t6 instanceof Element && "none" === getComputedStyle(t6).display) return null;
  for (let n5 = r6(e9); n5; n5 = r6(n5)) {
    if (!(n5 instanceof Element)) continue;
    const e10 = getComputedStyle(n5);
    if ("contents" !== e10.display) {
      if ("static" !== e10.position || isContainingBlock(e10)) return n5;
      if ("BODY" === n5.tagName) return n5;
    }
  }
  return null;
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.5JY5FUCG.js
function isVirtualElement(e9) {
  return e9 !== null && typeof e9 === "object" && "getBoundingClientRect" in e9 && ("contextElement" in e9 ? e9.contextElement instanceof Element : true);
}
var SlPopup = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.active = false;
    this.placement = "top";
    this.strategy = "absolute";
    this.distance = 0;
    this.skidding = 0;
    this.arrow = false;
    this.arrowPlacement = "anchor";
    this.arrowPadding = 10;
    this.flip = false;
    this.flipFallbackPlacements = "";
    this.flipFallbackStrategy = "best-fit";
    this.flipPadding = 0;
    this.shift = false;
    this.shiftPadding = 0;
    this.autoSizePadding = 0;
    this.hoverBridge = false;
    this.updateHoverBridge = () => {
      if (this.hoverBridge && this.anchorEl) {
        const anchorRect = this.anchorEl.getBoundingClientRect();
        const popupRect = this.popup.getBoundingClientRect();
        const isVertical = this.placement.includes("top") || this.placement.includes("bottom");
        let topLeftX = 0;
        let topLeftY = 0;
        let topRightX = 0;
        let topRightY = 0;
        let bottomLeftX = 0;
        let bottomLeftY = 0;
        let bottomRightX = 0;
        let bottomRightY = 0;
        if (isVertical) {
          if (anchorRect.top < popupRect.top) {
            topLeftX = anchorRect.left;
            topLeftY = anchorRect.bottom;
            topRightX = anchorRect.right;
            topRightY = anchorRect.bottom;
            bottomLeftX = popupRect.left;
            bottomLeftY = popupRect.top;
            bottomRightX = popupRect.right;
            bottomRightY = popupRect.top;
          } else {
            topLeftX = popupRect.left;
            topLeftY = popupRect.bottom;
            topRightX = popupRect.right;
            topRightY = popupRect.bottom;
            bottomLeftX = anchorRect.left;
            bottomLeftY = anchorRect.top;
            bottomRightX = anchorRect.right;
            bottomRightY = anchorRect.top;
          }
        } else {
          if (anchorRect.left < popupRect.left) {
            topLeftX = anchorRect.right;
            topLeftY = anchorRect.top;
            topRightX = popupRect.left;
            topRightY = popupRect.top;
            bottomLeftX = anchorRect.right;
            bottomLeftY = anchorRect.bottom;
            bottomRightX = popupRect.left;
            bottomRightY = popupRect.bottom;
          } else {
            topLeftX = popupRect.right;
            topLeftY = popupRect.top;
            topRightX = anchorRect.left;
            topRightY = anchorRect.top;
            bottomLeftX = popupRect.right;
            bottomLeftY = popupRect.bottom;
            bottomRightX = anchorRect.left;
            bottomRightY = anchorRect.bottom;
          }
        }
        this.style.setProperty("--hover-bridge-top-left-x", `${topLeftX}px`);
        this.style.setProperty("--hover-bridge-top-left-y", `${topLeftY}px`);
        this.style.setProperty("--hover-bridge-top-right-x", `${topRightX}px`);
        this.style.setProperty("--hover-bridge-top-right-y", `${topRightY}px`);
        this.style.setProperty("--hover-bridge-bottom-left-x", `${bottomLeftX}px`);
        this.style.setProperty("--hover-bridge-bottom-left-y", `${bottomLeftY}px`);
        this.style.setProperty("--hover-bridge-bottom-right-x", `${bottomRightX}px`);
        this.style.setProperty("--hover-bridge-bottom-right-y", `${bottomRightY}px`);
      }
    };
  }
  async connectedCallback() {
    super.connectedCallback();
    await this.updateComplete;
    this.start();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.stop();
  }
  async updated(changedProps) {
    super.updated(changedProps);
    if (changedProps.has("active")) {
      if (this.active) {
        this.start();
      } else {
        this.stop();
      }
    }
    if (changedProps.has("anchor")) {
      this.handleAnchorChange();
    }
    if (this.active) {
      await this.updateComplete;
      this.reposition();
    }
  }
  async handleAnchorChange() {
    await this.stop();
    if (this.anchor && typeof this.anchor === "string") {
      const root = this.getRootNode();
      this.anchorEl = root.getElementById(this.anchor);
    } else if (this.anchor instanceof Element || isVirtualElement(this.anchor)) {
      this.anchorEl = this.anchor;
    } else {
      this.anchorEl = this.querySelector('[slot="anchor"]');
    }
    if (this.anchorEl instanceof HTMLSlotElement) {
      this.anchorEl = this.anchorEl.assignedElements({ flatten: true })[0];
    }
    if (this.anchorEl && this.active) {
      this.start();
    }
  }
  start() {
    if (!this.anchorEl || !this.active) {
      return;
    }
    this.cleanup = autoUpdate(this.anchorEl, this.popup, () => {
      this.reposition();
    });
  }
  async stop() {
    return new Promise((resolve) => {
      if (this.cleanup) {
        this.cleanup();
        this.cleanup = void 0;
        this.removeAttribute("data-current-placement");
        this.style.removeProperty("--auto-size-available-width");
        this.style.removeProperty("--auto-size-available-height");
        requestAnimationFrame(() => resolve());
      } else {
        resolve();
      }
    });
  }
  /** Forces the popup to recalculate and reposition itself. */
  reposition() {
    if (!this.active || !this.anchorEl) {
      return;
    }
    const middleware = [
      // The offset middleware goes first
      offset2({ mainAxis: this.distance, crossAxis: this.skidding })
    ];
    if (this.sync) {
      middleware.push(
        size2({
          apply: ({ rects }) => {
            const syncWidth = this.sync === "width" || this.sync === "both";
            const syncHeight = this.sync === "height" || this.sync === "both";
            this.popup.style.width = syncWidth ? `${rects.reference.width}px` : "";
            this.popup.style.height = syncHeight ? `${rects.reference.height}px` : "";
          }
        })
      );
    } else {
      this.popup.style.width = "";
      this.popup.style.height = "";
    }
    if (this.flip) {
      middleware.push(
        flip2({
          boundary: this.flipBoundary,
          // @ts-expect-error - We're converting a string attribute to an array here
          fallbackPlacements: this.flipFallbackPlacements,
          fallbackStrategy: this.flipFallbackStrategy === "best-fit" ? "bestFit" : "initialPlacement",
          padding: this.flipPadding
        })
      );
    }
    if (this.shift) {
      middleware.push(
        shift2({
          boundary: this.shiftBoundary,
          padding: this.shiftPadding
        })
      );
    }
    if (this.autoSize) {
      middleware.push(
        size2({
          boundary: this.autoSizeBoundary,
          padding: this.autoSizePadding,
          apply: ({ availableWidth, availableHeight }) => {
            if (this.autoSize === "vertical" || this.autoSize === "both") {
              this.style.setProperty("--auto-size-available-height", `${availableHeight}px`);
            } else {
              this.style.removeProperty("--auto-size-available-height");
            }
            if (this.autoSize === "horizontal" || this.autoSize === "both") {
              this.style.setProperty("--auto-size-available-width", `${availableWidth}px`);
            } else {
              this.style.removeProperty("--auto-size-available-width");
            }
          }
        })
      );
    } else {
      this.style.removeProperty("--auto-size-available-width");
      this.style.removeProperty("--auto-size-available-height");
    }
    if (this.arrow) {
      middleware.push(
        arrow2({
          element: this.arrowEl,
          padding: this.arrowPadding
        })
      );
    }
    const getOffsetParent2 = this.strategy === "absolute" ? (element) => platform.getOffsetParent(element, e8) : platform.getOffsetParent;
    computePosition2(this.anchorEl, this.popup, {
      placement: this.placement,
      middleware,
      strategy: this.strategy,
      platform: __spreadProps(__spreadValues({}, platform), {
        getOffsetParent: getOffsetParent2
      })
    }).then(({ x: x2, y: y3, middlewareData, placement }) => {
      const isRtl = this.localize.dir() === "rtl";
      const staticSide = { top: "bottom", right: "left", bottom: "top", left: "right" }[placement.split("-")[0]];
      this.setAttribute("data-current-placement", placement);
      Object.assign(this.popup.style, {
        left: `${x2}px`,
        top: `${y3}px`
      });
      if (this.arrow) {
        const arrowX = middlewareData.arrow.x;
        const arrowY = middlewareData.arrow.y;
        let top = "";
        let right = "";
        let bottom = "";
        let left = "";
        if (this.arrowPlacement === "start") {
          const value = typeof arrowX === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          top = typeof arrowY === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          right = isRtl ? value : "";
          left = isRtl ? "" : value;
        } else if (this.arrowPlacement === "end") {
          const value = typeof arrowX === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          right = isRtl ? "" : value;
          left = isRtl ? value : "";
          bottom = typeof arrowY === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
        } else if (this.arrowPlacement === "center") {
          left = typeof arrowX === "number" ? `calc(50% - var(--arrow-size-diagonal))` : "";
          top = typeof arrowY === "number" ? `calc(50% - var(--arrow-size-diagonal))` : "";
        } else {
          left = typeof arrowX === "number" ? `${arrowX}px` : "";
          top = typeof arrowY === "number" ? `${arrowY}px` : "";
        }
        Object.assign(this.arrowEl.style, {
          top,
          right,
          bottom,
          left,
          [staticSide]: "calc(var(--arrow-size-diagonal) * -1)"
        });
      }
    });
    requestAnimationFrame(() => this.updateHoverBridge());
    this.emit("sl-reposition");
  }
  render() {
    return b2`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${e7({
      "popup-hover-bridge": true,
      "popup-hover-bridge--visible": this.hoverBridge && this.active
    })}
      ></span>

      <div
        part="popup"
        class=${e7({
      popup: true,
      "popup--active": this.active,
      "popup--fixed": this.strategy === "fixed",
      "popup--has-arrow": this.arrow
    })}
      >
        <slot></slot>
        ${this.arrow ? b2`<div part="arrow" class="popup__arrow" role="presentation"></div>` : ""}
      </div>
    `;
  }
};
SlPopup.styles = [component_styles_default, popup_styles_default];
__decorateClass([
  e5(".popup")
], SlPopup.prototype, "popup", 2);
__decorateClass([
  e5(".popup__arrow")
], SlPopup.prototype, "arrowEl", 2);
__decorateClass([
  n4()
], SlPopup.prototype, "anchor", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlPopup.prototype, "active", 2);
__decorateClass([
  n4({ reflect: true })
], SlPopup.prototype, "placement", 2);
__decorateClass([
  n4({ reflect: true })
], SlPopup.prototype, "strategy", 2);
__decorateClass([
  n4({ type: Number })
], SlPopup.prototype, "distance", 2);
__decorateClass([
  n4({ type: Number })
], SlPopup.prototype, "skidding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "arrow", 2);
__decorateClass([
  n4({ attribute: "arrow-placement" })
], SlPopup.prototype, "arrowPlacement", 2);
__decorateClass([
  n4({ attribute: "arrow-padding", type: Number })
], SlPopup.prototype, "arrowPadding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "flip", 2);
__decorateClass([
  n4({
    attribute: "flip-fallback-placements",
    converter: {
      fromAttribute: (value) => {
        return value.split(" ").map((p4) => p4.trim()).filter((p4) => p4 !== "");
      },
      toAttribute: (value) => {
        return value.join(" ");
      }
    }
  })
], SlPopup.prototype, "flipFallbackPlacements", 2);
__decorateClass([
  n4({ attribute: "flip-fallback-strategy" })
], SlPopup.prototype, "flipFallbackStrategy", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "flipBoundary", 2);
__decorateClass([
  n4({ attribute: "flip-padding", type: Number })
], SlPopup.prototype, "flipPadding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "shift", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "shiftBoundary", 2);
__decorateClass([
  n4({ attribute: "shift-padding", type: Number })
], SlPopup.prototype, "shiftPadding", 2);
__decorateClass([
  n4({ attribute: "auto-size" })
], SlPopup.prototype, "autoSize", 2);
__decorateClass([
  n4()
], SlPopup.prototype, "sync", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "autoSizeBoundary", 2);
__decorateClass([
  n4({ attribute: "auto-size-padding", type: Number })
], SlPopup.prototype, "autoSizePadding", 2);
__decorateClass([
  n4({ attribute: "hover-bridge", type: Boolean })
], SlPopup.prototype, "hoverBridge", 2);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.K7JGTRV7.js
var defaultAnimationRegistry = /* @__PURE__ */ new Map();
var customAnimationRegistry = /* @__PURE__ */ new WeakMap();
function ensureAnimation(animation) {
  return animation != null ? animation : { keyframes: [], options: { duration: 0 } };
}
function getLogicalAnimation(animation, dir) {
  if (dir.toLowerCase() === "rtl") {
    return {
      keyframes: animation.rtlKeyframes || animation.keyframes,
      options: animation.options
    };
  }
  return animation;
}
function setDefaultAnimation(animationName, animation) {
  defaultAnimationRegistry.set(animationName, ensureAnimation(animation));
}
function getAnimation(el, animationName, options) {
  const customAnimation = customAnimationRegistry.get(el);
  if (customAnimation == null ? void 0 : customAnimation[animationName]) {
    return getLogicalAnimation(customAnimation[animationName], options.dir);
  }
  const defaultAnimation = defaultAnimationRegistry.get(animationName);
  if (defaultAnimation) {
    return getLogicalAnimation(defaultAnimation, options.dir);
  }
  return {
    keyframes: [],
    options: { duration: 0 }
  };
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.B4BZKR24.js
function waitForEvent(el, eventName) {
  return new Promise((resolve) => {
    function done(event) {
      if (event.target === el) {
        el.removeEventListener(eventName, done);
        resolve();
      }
    }
    el.addEventListener(eventName, done);
  });
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.AJ3ENQ5C.js
function animateTo(el, keyframes, options) {
  return new Promise((resolve) => {
    if ((options == null ? void 0 : options.duration) === Infinity) {
      throw new Error("Promise-based animations must be finite.");
    }
    const animation = el.animate(keyframes, __spreadProps(__spreadValues({}, options), {
      duration: prefersReducedMotion() ? 0 : options.duration
    }));
    animation.addEventListener("cancel", resolve, { once: true });
    animation.addEventListener("finish", resolve, { once: true });
  });
}
function prefersReducedMotion() {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  return query.matches;
}
function stopAnimations(el) {
  return Promise.all(
    el.getAnimations().map((animation) => {
      return new Promise((resolve) => {
        animation.cancel();
        requestAnimationFrame(resolve);
      });
    })
  );
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GMYPQTFK.js
function watch(propertyName, options) {
  const resolvedOptions = __spreadValues({
    waitUntilFirstUpdate: false
  }, options);
  return (proto, decoratedFnName) => {
    const { update: update2 } = proto;
    const watchedProperties = Array.isArray(propertyName) ? propertyName : [propertyName];
    proto.update = function(changedProps) {
      watchedProperties.forEach((property) => {
        const key = property;
        if (changedProps.has(key)) {
          const oldValue = changedProps.get(key);
          const newValue = this[key];
          if (oldValue !== newValue) {
            if (!resolvedOptions.waitUntilFirstUpdate || this.hasUpdated) {
              this[decoratedFnName](oldValue, newValue);
            }
          }
        }
      });
      update2.call(this, changedProps);
    };
  };
}

// node_modules/lit-html/directives/if-defined.js
var o6 = (o7) => o7 ?? A;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.C56A5M6T.js
var SlDropdown = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.open = false;
    this.placement = "bottom-start";
    this.disabled = false;
    this.stayOpenOnSelect = false;
    this.distance = 0;
    this.skidding = 0;
    this.hoist = false;
    this.sync = void 0;
    this.handleKeyDown = (event) => {
      if (this.open && event.key === "Escape") {
        event.stopPropagation();
        this.hide();
        this.focusOnTrigger();
      }
    };
    this.handleDocumentKeyDown = (event) => {
      var _a;
      if (event.key === "Escape" && this.open && !this.closeWatcher) {
        event.stopPropagation();
        this.focusOnTrigger();
        this.hide();
        return;
      }
      if (event.key === "Tab") {
        if (this.open && ((_a = document.activeElement) == null ? void 0 : _a.tagName.toLowerCase()) === "sl-menu-item") {
          event.preventDefault();
          this.hide();
          this.focusOnTrigger();
          return;
        }
        const computeClosestContaining = (element, tagName) => {
          if (!element) return null;
          const closest = element.closest(tagName);
          if (closest) return closest;
          const rootNode = element.getRootNode();
          if (rootNode instanceof ShadowRoot) {
            return computeClosestContaining(rootNode.host, tagName);
          }
          return null;
        };
        setTimeout(() => {
          var _a2;
          const activeElement = ((_a2 = this.containingElement) == null ? void 0 : _a2.getRootNode()) instanceof ShadowRoot ? getDeepestActiveElement() : document.activeElement;
          if (!this.containingElement || computeClosestContaining(activeElement, this.containingElement.tagName.toLowerCase()) !== this.containingElement) {
            this.hide();
          }
        });
      }
    };
    this.handleDocumentMouseDown = (event) => {
      const path = event.composedPath();
      if (this.containingElement && !path.includes(this.containingElement)) {
        this.hide();
      }
    };
    this.handlePanelSelect = (event) => {
      const target = event.target;
      if (!this.stayOpenOnSelect && target.tagName.toLowerCase() === "sl-menu") {
        this.hide();
        this.focusOnTrigger();
      }
    };
  }
  connectedCallback() {
    super.connectedCallback();
    if (!this.containingElement) {
      this.containingElement = this;
    }
  }
  firstUpdated() {
    this.panel.hidden = !this.open;
    if (this.open) {
      this.addOpenListeners();
      this.popup.active = true;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeOpenListeners();
    this.hide();
  }
  focusOnTrigger() {
    const trigger = this.trigger.assignedElements({ flatten: true })[0];
    if (typeof (trigger == null ? void 0 : trigger.focus) === "function") {
      trigger.focus();
    }
  }
  getMenu() {
    return this.panel.assignedElements({ flatten: true }).find((el) => el.tagName.toLowerCase() === "sl-menu");
  }
  handleTriggerClick() {
    if (this.open) {
      this.hide();
    } else {
      this.show();
      this.focusOnTrigger();
    }
  }
  async handleTriggerKeyDown(event) {
    if ([" ", "Enter"].includes(event.key)) {
      event.preventDefault();
      this.handleTriggerClick();
      return;
    }
    const menu = this.getMenu();
    if (menu) {
      const menuItems = menu.getAllItems();
      const firstMenuItem = menuItems[0];
      const lastMenuItem = menuItems[menuItems.length - 1];
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!this.open) {
          this.show();
          await this.updateComplete;
        }
        if (menuItems.length > 0) {
          this.updateComplete.then(() => {
            if (event.key === "ArrowDown" || event.key === "Home") {
              menu.setCurrentItem(firstMenuItem);
              firstMenuItem.focus();
            }
            if (event.key === "ArrowUp" || event.key === "End") {
              menu.setCurrentItem(lastMenuItem);
              lastMenuItem.focus();
            }
          });
        }
      }
    }
  }
  handleTriggerKeyUp(event) {
    if (event.key === " ") {
      event.preventDefault();
    }
  }
  handleTriggerSlotChange() {
    this.updateAccessibleTrigger();
  }
  //
  // Slotted triggers can be arbitrary content, but we need to link them to the dropdown panel with `aria-haspopup` and
  // `aria-expanded`. These must be applied to the "accessible trigger" (the tabbable portion of the trigger element
  // that gets slotted in) so screen readers will understand them. The accessible trigger could be the slotted element,
  // a child of the slotted element, or an element in the slotted element's shadow root.
  //
  // For example, the accessible trigger of an <sl-button> is a <button> located inside its shadow root.
  //
  // To determine this, we assume the first tabbable element in the trigger slot is the "accessible trigger."
  //
  updateAccessibleTrigger() {
    const assignedElements = this.trigger.assignedElements({ flatten: true });
    const accessibleTrigger = assignedElements.find((el) => getTabbableBoundary(el).start);
    let target;
    if (accessibleTrigger) {
      switch (accessibleTrigger.tagName.toLowerCase()) {
        // Shoelace buttons have to update the internal button so it's announced correctly by screen readers
        case "sl-button":
        case "sl-icon-button":
          target = accessibleTrigger.button;
          break;
        default:
          target = accessibleTrigger;
      }
      target.setAttribute("aria-haspopup", "true");
      target.setAttribute("aria-expanded", this.open ? "true" : "false");
    }
  }
  /** Shows the dropdown panel. */
  async show() {
    if (this.open) {
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the dropdown panel */
  async hide() {
    if (!this.open) {
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  /**
   * Instructs the dropdown menu to reposition. Useful when the position or size of the trigger changes when the menu
   * is activated.
   */
  reposition() {
    this.popup.reposition();
  }
  addOpenListeners() {
    var _a;
    this.panel.addEventListener("sl-select", this.handlePanelSelect);
    if ("CloseWatcher" in window) {
      (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
      this.closeWatcher = new CloseWatcher();
      this.closeWatcher.onclose = () => {
        this.hide();
        this.focusOnTrigger();
      };
    } else {
      this.panel.addEventListener("keydown", this.handleKeyDown);
    }
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    document.addEventListener("mousedown", this.handleDocumentMouseDown);
  }
  removeOpenListeners() {
    var _a;
    if (this.panel) {
      this.panel.removeEventListener("sl-select", this.handlePanelSelect);
      this.panel.removeEventListener("keydown", this.handleKeyDown);
    }
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    document.removeEventListener("mousedown", this.handleDocumentMouseDown);
    (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
  }
  async handleOpenChange() {
    if (this.disabled) {
      this.open = false;
      return;
    }
    this.updateAccessibleTrigger();
    if (this.open) {
      this.emit("sl-show");
      this.addOpenListeners();
      await stopAnimations(this);
      this.panel.hidden = false;
      this.popup.active = true;
      const { keyframes, options } = getAnimation(this, "dropdown.show", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      this.emit("sl-after-show");
    } else {
      this.emit("sl-hide");
      this.removeOpenListeners();
      await stopAnimations(this);
      const { keyframes, options } = getAnimation(this, "dropdown.hide", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      this.panel.hidden = true;
      this.popup.active = false;
      this.emit("sl-after-hide");
    }
  }
  render() {
    return b2`
      <sl-popup
        part="base"
        exportparts="popup:base__popup"
        id="dropdown"
        placement=${this.placement}
        distance=${this.distance}
        skidding=${this.skidding}
        strategy=${this.hoist ? "fixed" : "absolute"}
        flip
        shift
        auto-size="vertical"
        auto-size-padding="10"
        sync=${o6(this.sync ? this.sync : void 0)}
        class=${e7({
      dropdown: true,
      "dropdown--open": this.open
    })}
      >
        <slot
          name="trigger"
          slot="anchor"
          part="trigger"
          class="dropdown__trigger"
          @click=${this.handleTriggerClick}
          @keydown=${this.handleTriggerKeyDown}
          @keyup=${this.handleTriggerKeyUp}
          @slotchange=${this.handleTriggerSlotChange}
        ></slot>

        <div aria-hidden=${this.open ? "false" : "true"} aria-labelledby="dropdown">
          <slot part="panel" class="dropdown__panel"></slot>
        </div>
      </sl-popup>
    `;
  }
};
SlDropdown.styles = [component_styles_default, dropdown_styles_default];
SlDropdown.dependencies = { "sl-popup": SlPopup };
__decorateClass([
  e5(".dropdown")
], SlDropdown.prototype, "popup", 2);
__decorateClass([
  e5(".dropdown__trigger")
], SlDropdown.prototype, "trigger", 2);
__decorateClass([
  e5(".dropdown__panel")
], SlDropdown.prototype, "panel", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlDropdown.prototype, "open", 2);
__decorateClass([
  n4({ reflect: true })
], SlDropdown.prototype, "placement", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlDropdown.prototype, "disabled", 2);
__decorateClass([
  n4({ attribute: "stay-open-on-select", type: Boolean, reflect: true })
], SlDropdown.prototype, "stayOpenOnSelect", 2);
__decorateClass([
  n4({ attribute: false })
], SlDropdown.prototype, "containingElement", 2);
__decorateClass([
  n4({ type: Number })
], SlDropdown.prototype, "distance", 2);
__decorateClass([
  n4({ type: Number })
], SlDropdown.prototype, "skidding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlDropdown.prototype, "hoist", 2);
__decorateClass([
  n4({ reflect: true })
], SlDropdown.prototype, "sync", 2);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], SlDropdown.prototype, "handleOpenChange", 1);
setDefaultAnimation("dropdown.show", {
  keyframes: [
    { opacity: 0, scale: 0.9 },
    { opacity: 1, scale: 1 }
  ],
  options: { duration: 100, easing: "ease" }
});
setDefaultAnimation("dropdown.hide", {
  keyframes: [
    { opacity: 1, scale: 1 },
    { opacity: 0, scale: 0.9 }
  ],
  options: { duration: 100, easing: "ease" }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.UDWRA64J.js
SlDropdown.define("sl-dropdown");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GGT72J62.js
var input_styles_default = i`
  :host {
    display: block;
  }

  .input {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: stretch;
    justify-content: start;
    position: relative;
    width: 100%;
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-input-font-weight);
    letter-spacing: var(--sl-input-letter-spacing);
    vertical-align: middle;
    overflow: hidden;
    cursor: text;
    transition:
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) border,
      var(--sl-transition-fast) box-shadow,
      var(--sl-transition-fast) background-color;
  }

  /* Standard inputs */
  .input--standard {
    background-color: var(--sl-input-background-color);
    border: solid var(--sl-input-border-width) var(--sl-input-border-color);
  }

  .input--standard:hover:not(.input--disabled) {
    background-color: var(--sl-input-background-color-hover);
    border-color: var(--sl-input-border-color-hover);
  }

  .input--standard.input--focused:not(.input--disabled) {
    background-color: var(--sl-input-background-color-focus);
    border-color: var(--sl-input-border-color-focus);
    box-shadow: 0 0 0 var(--sl-focus-ring-width) var(--sl-input-focus-ring-color);
  }

  .input--standard.input--focused:not(.input--disabled) .input__control {
    color: var(--sl-input-color-focus);
  }

  .input--standard.input--disabled {
    background-color: var(--sl-input-background-color-disabled);
    border-color: var(--sl-input-border-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input--standard.input--disabled .input__control {
    color: var(--sl-input-color-disabled);
  }

  .input--standard.input--disabled .input__control::placeholder {
    color: var(--sl-input-placeholder-color-disabled);
  }

  /* Filled inputs */
  .input--filled {
    border: none;
    background-color: var(--sl-input-filled-background-color);
    color: var(--sl-input-color);
  }

  .input--filled:hover:not(.input--disabled) {
    background-color: var(--sl-input-filled-background-color-hover);
  }

  .input--filled.input--focused:not(.input--disabled) {
    background-color: var(--sl-input-filled-background-color-focus);
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .input--filled.input--disabled {
    background-color: var(--sl-input-filled-background-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input__control {
    flex: 1 1 auto;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    min-width: 0;
    height: 100%;
    color: var(--sl-input-color);
    border: none;
    background: inherit;
    box-shadow: none;
    padding: 0;
    margin: 0;
    cursor: inherit;
    -webkit-appearance: none;
  }

  .input__control::-webkit-search-decoration,
  .input__control::-webkit-search-cancel-button,
  .input__control::-webkit-search-results-button,
  .input__control::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }

  .input__control:-webkit-autofill,
  .input__control:-webkit-autofill:hover,
  .input__control:-webkit-autofill:focus,
  .input__control:-webkit-autofill:active {
    box-shadow: 0 0 0 var(--sl-input-height-large) var(--sl-input-background-color-hover) inset !important;
    -webkit-text-fill-color: var(--sl-color-primary-500);
    caret-color: var(--sl-input-color);
  }

  .input--filled .input__control:-webkit-autofill,
  .input--filled .input__control:-webkit-autofill:hover,
  .input--filled .input__control:-webkit-autofill:focus,
  .input--filled .input__control:-webkit-autofill:active {
    box-shadow: 0 0 0 var(--sl-input-height-large) var(--sl-input-filled-background-color) inset !important;
  }

  .input__control::placeholder {
    color: var(--sl-input-placeholder-color);
    user-select: none;
    -webkit-user-select: none;
  }

  .input:hover:not(.input--disabled) .input__control {
    color: var(--sl-input-color-hover);
  }

  .input__control:focus {
    outline: none;
  }

  .input__prefix,
  .input__suffix {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    cursor: default;
  }

  .input__prefix ::slotted(sl-icon),
  .input__suffix ::slotted(sl-icon) {
    color: var(--sl-input-icon-color);
  }

  /*
   * Size modifiers
   */

  .input--small {
    border-radius: var(--sl-input-border-radius-small);
    font-size: var(--sl-input-font-size-small);
    height: var(--sl-input-height-small);
  }

  .input--small .input__control {
    height: calc(var(--sl-input-height-small) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-small);
  }

  .input--small .input__clear,
  .input--small .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-small) * 2);
  }

  .input--small .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-small);
  }

  .input--small .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-small);
  }

  .input--medium {
    border-radius: var(--sl-input-border-radius-medium);
    font-size: var(--sl-input-font-size-medium);
    height: var(--sl-input-height-medium);
  }

  .input--medium .input__control {
    height: calc(var(--sl-input-height-medium) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-medium);
  }

  .input--medium .input__clear,
  .input--medium .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-medium) * 2);
  }

  .input--medium .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-medium);
  }

  .input--medium .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-medium);
  }

  .input--large {
    border-radius: var(--sl-input-border-radius-large);
    font-size: var(--sl-input-font-size-large);
    height: var(--sl-input-height-large);
  }

  .input--large .input__control {
    height: calc(var(--sl-input-height-large) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-large);
  }

  .input--large .input__clear,
  .input--large .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-large) * 2);
  }

  .input--large .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-large);
  }

  .input--large .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-large);
  }

  /*
   * Pill modifier
   */

  .input--pill.input--small {
    border-radius: var(--sl-input-height-small);
  }

  .input--pill.input--medium {
    border-radius: var(--sl-input-height-medium);
  }

  .input--pill.input--large {
    border-radius: var(--sl-input-height-large);
  }

  /*
   * Clearable + Password Toggle
   */

  .input__clear,
  .input__password-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: inherit;
    color: var(--sl-input-icon-color);
    border: none;
    background: none;
    padding: 0;
    transition: var(--sl-transition-fast) color;
    cursor: pointer;
  }

  .input__clear:hover,
  .input__password-toggle:hover {
    color: var(--sl-input-icon-color-hover);
  }

  .input__clear:focus,
  .input__password-toggle:focus {
    outline: none;
  }

  /* Don't show the browser's password toggle in Edge */
  ::-ms-reveal {
    display: none;
  }

  /* Hide the built-in number spinner */
  .input--no-spin-buttons input[type='number']::-webkit-outer-spin-button,
  .input--no-spin-buttons input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    display: none;
  }

  .input--no-spin-buttons input[type='number'] {
    -moz-appearance: textfield;
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GI7VDIWX.js
var defaultValue = (propertyName = "value") => (proto, key) => {
  const ctor = proto.constructor;
  const attributeChangedCallback = ctor.prototype.attributeChangedCallback;
  ctor.prototype.attributeChangedCallback = function(name, old, value) {
    var _a;
    const options = ctor.getPropertyOptions(propertyName);
    const attributeName = typeof options.attribute === "string" ? options.attribute : propertyName;
    if (name === attributeName) {
      const converter = options.converter || u;
      const fromAttribute = typeof converter === "function" ? converter : (_a = converter == null ? void 0 : converter.fromAttribute) != null ? _a : u.fromAttribute;
      const newValue = fromAttribute(value, options.type);
      if (this[propertyName] !== newValue) {
        this[key] = newValue;
      }
    }
    attributeChangedCallback.call(this, name, old, value);
  };
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.SI4ACBFK.js
var form_control_styles_default = i`
  .form-control .form-control__label {
    display: none;
  }

  .form-control .form-control__help-text {
    display: none;
  }

  /* Label */
  .form-control--has-label .form-control__label {
    display: inline-block;
    color: var(--sl-input-label-color);
    margin-bottom: var(--sl-spacing-3x-small);
  }

  .form-control--has-label.form-control--small .form-control__label {
    font-size: var(--sl-input-label-font-size-small);
  }

  .form-control--has-label.form-control--medium .form-control__label {
    font-size: var(--sl-input-label-font-size-medium);
  }

  .form-control--has-label.form-control--large .form-control__label {
    font-size: var(--sl-input-label-font-size-large);
  }

  :host([required]) .form-control--has-label .form-control__label::after {
    content: var(--sl-input-required-content);
    margin-inline-start: var(--sl-input-required-content-offset);
    color: var(--sl-input-required-content-color);
  }

  /* Help text */
  .form-control--has-help-text .form-control__help-text {
    display: block;
    color: var(--sl-input-help-text-color);
    margin-top: var(--sl-spacing-3x-small);
  }

  .form-control--has-help-text.form-control--small .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-small);
  }

  .form-control--has-help-text.form-control--medium .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-medium);
  }

  .form-control--has-help-text.form-control--large .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-large);
  }

  .form-control--has-help-text.form-control--radio-group .form-control__help-text {
    margin-top: var(--sl-spacing-2x-small);
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3RPBFEDE.js
var formCollections = /* @__PURE__ */ new WeakMap();
var reportValidityOverloads = /* @__PURE__ */ new WeakMap();
var checkValidityOverloads = /* @__PURE__ */ new WeakMap();
var userInteractedControls = /* @__PURE__ */ new WeakSet();
var interactions = /* @__PURE__ */ new WeakMap();
var FormControlController = class {
  constructor(host, options) {
    this.handleFormData = (event) => {
      const disabled = this.options.disabled(this.host);
      const name = this.options.name(this.host);
      const value = this.options.value(this.host);
      const isButton = this.host.tagName.toLowerCase() === "sl-button";
      if (this.host.isConnected && !disabled && !isButton && typeof name === "string" && name.length > 0 && typeof value !== "undefined") {
        if (Array.isArray(value)) {
          value.forEach((val) => {
            event.formData.append(name, val.toString());
          });
        } else {
          event.formData.append(name, value.toString());
        }
      }
    };
    this.handleFormSubmit = (event) => {
      var _a;
      const disabled = this.options.disabled(this.host);
      const reportValidity = this.options.reportValidity;
      if (this.form && !this.form.noValidate) {
        (_a = formCollections.get(this.form)) == null ? void 0 : _a.forEach((control) => {
          this.setUserInteracted(control, true);
        });
      }
      if (this.form && !this.form.noValidate && !disabled && !reportValidity(this.host)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    this.handleFormReset = () => {
      this.options.setValue(this.host, this.options.defaultValue(this.host));
      this.setUserInteracted(this.host, false);
      interactions.set(this.host, []);
    };
    this.handleInteraction = (event) => {
      const emittedEvents = interactions.get(this.host);
      if (!emittedEvents.includes(event.type)) {
        emittedEvents.push(event.type);
      }
      if (emittedEvents.length === this.options.assumeInteractionOn.length) {
        this.setUserInteracted(this.host, true);
      }
    };
    this.checkFormValidity = () => {
      if (this.form && !this.form.noValidate) {
        const elements = this.form.querySelectorAll("*");
        for (const element of elements) {
          if (typeof element.checkValidity === "function") {
            if (!element.checkValidity()) {
              return false;
            }
          }
        }
      }
      return true;
    };
    this.reportFormValidity = () => {
      if (this.form && !this.form.noValidate) {
        const elements = this.form.querySelectorAll("*");
        for (const element of elements) {
          if (typeof element.reportValidity === "function") {
            if (!element.reportValidity()) {
              return false;
            }
          }
        }
      }
      return true;
    };
    (this.host = host).addController(this);
    this.options = __spreadValues({
      form: (input) => {
        const formId = input.form;
        if (formId) {
          const root = input.getRootNode();
          const form = root.querySelector(`#${formId}`);
          if (form) {
            return form;
          }
        }
        return input.closest("form");
      },
      name: (input) => input.name,
      value: (input) => input.value,
      defaultValue: (input) => input.defaultValue,
      disabled: (input) => {
        var _a;
        return (_a = input.disabled) != null ? _a : false;
      },
      reportValidity: (input) => typeof input.reportValidity === "function" ? input.reportValidity() : true,
      checkValidity: (input) => typeof input.checkValidity === "function" ? input.checkValidity() : true,
      setValue: (input, value) => input.value = value,
      assumeInteractionOn: ["sl-input"]
    }, options);
  }
  hostConnected() {
    const form = this.options.form(this.host);
    if (form) {
      this.attachForm(form);
    }
    interactions.set(this.host, []);
    this.options.assumeInteractionOn.forEach((event) => {
      this.host.addEventListener(event, this.handleInteraction);
    });
  }
  hostDisconnected() {
    this.detachForm();
    interactions.delete(this.host);
    this.options.assumeInteractionOn.forEach((event) => {
      this.host.removeEventListener(event, this.handleInteraction);
    });
  }
  hostUpdated() {
    const form = this.options.form(this.host);
    if (!form) {
      this.detachForm();
    }
    if (form && this.form !== form) {
      this.detachForm();
      this.attachForm(form);
    }
    if (this.host.hasUpdated) {
      this.setValidity(this.host.validity.valid);
    }
  }
  attachForm(form) {
    if (form) {
      this.form = form;
      if (formCollections.has(this.form)) {
        formCollections.get(this.form).add(this.host);
      } else {
        formCollections.set(this.form, /* @__PURE__ */ new Set([this.host]));
      }
      this.form.addEventListener("formdata", this.handleFormData);
      this.form.addEventListener("submit", this.handleFormSubmit);
      this.form.addEventListener("reset", this.handleFormReset);
      if (!reportValidityOverloads.has(this.form)) {
        reportValidityOverloads.set(this.form, this.form.reportValidity);
        this.form.reportValidity = () => this.reportFormValidity();
      }
      if (!checkValidityOverloads.has(this.form)) {
        checkValidityOverloads.set(this.form, this.form.checkValidity);
        this.form.checkValidity = () => this.checkFormValidity();
      }
    } else {
      this.form = void 0;
    }
  }
  detachForm() {
    if (!this.form) return;
    const formCollection = formCollections.get(this.form);
    if (!formCollection) {
      return;
    }
    formCollection.delete(this.host);
    if (formCollection.size <= 0) {
      this.form.removeEventListener("formdata", this.handleFormData);
      this.form.removeEventListener("submit", this.handleFormSubmit);
      this.form.removeEventListener("reset", this.handleFormReset);
      if (reportValidityOverloads.has(this.form)) {
        this.form.reportValidity = reportValidityOverloads.get(this.form);
        reportValidityOverloads.delete(this.form);
      }
      if (checkValidityOverloads.has(this.form)) {
        this.form.checkValidity = checkValidityOverloads.get(this.form);
        checkValidityOverloads.delete(this.form);
      }
      this.form = void 0;
    }
  }
  setUserInteracted(el, hasInteracted) {
    if (hasInteracted) {
      userInteractedControls.add(el);
    } else {
      userInteractedControls.delete(el);
    }
    el.requestUpdate();
  }
  doAction(type, submitter) {
    if (this.form) {
      const button = document.createElement("button");
      button.type = type;
      button.style.position = "absolute";
      button.style.width = "0";
      button.style.height = "0";
      button.style.clipPath = "inset(50%)";
      button.style.overflow = "hidden";
      button.style.whiteSpace = "nowrap";
      if (submitter) {
        button.name = submitter.name;
        button.value = submitter.value;
        ["formaction", "formenctype", "formmethod", "formnovalidate", "formtarget"].forEach((attr) => {
          if (submitter.hasAttribute(attr)) {
            button.setAttribute(attr, submitter.getAttribute(attr));
          }
        });
      }
      this.form.append(button);
      button.click();
      button.remove();
    }
  }
  /** Returns the associated `<form>` element, if one exists. */
  getForm() {
    var _a;
    return (_a = this.form) != null ? _a : null;
  }
  /** Resets the form, restoring all the control to their default value */
  reset(submitter) {
    this.doAction("reset", submitter);
  }
  /** Submits the form, triggering validation and form data injection. */
  submit(submitter) {
    this.doAction("submit", submitter);
  }
  /**
   * Synchronously sets the form control's validity. Call this when you know the future validity but need to update
   * the host element immediately, i.e. before Lit updates the component in the next update.
   */
  setValidity(isValid) {
    const host = this.host;
    const hasInteracted = Boolean(userInteractedControls.has(host));
    const required = Boolean(host.required);
    host.toggleAttribute("data-required", required);
    host.toggleAttribute("data-optional", !required);
    host.toggleAttribute("data-invalid", !isValid);
    host.toggleAttribute("data-valid", isValid);
    host.toggleAttribute("data-user-invalid", !isValid && hasInteracted);
    host.toggleAttribute("data-user-valid", isValid && hasInteracted);
  }
  /**
   * Updates the form control's validity based on the current value of `host.validity.valid`. Call this when anything
   * that affects constraint validation changes so the component receives the correct validity states.
   */
  updateValidity() {
    const host = this.host;
    this.setValidity(host.validity.valid);
  }
  /**
   * Dispatches a non-bubbling, cancelable custom event of type `sl-invalid`.
   * If the `sl-invalid` event will be cancelled then the original `invalid`
   * event (which may have been passed as argument) will also be cancelled.
   * If no original `invalid` event has been passed then the `sl-invalid`
   * event will be cancelled before being dispatched.
   */
  emitInvalidEvent(originalInvalidEvent) {
    const slInvalidEvent = new CustomEvent("sl-invalid", {
      bubbles: false,
      composed: false,
      cancelable: true,
      detail: {}
    });
    if (!originalInvalidEvent) {
      slInvalidEvent.preventDefault();
    }
    if (!this.host.dispatchEvent(slInvalidEvent)) {
      originalInvalidEvent == null ? void 0 : originalInvalidEvent.preventDefault();
    }
  }
};
var validValidityState = Object.freeze({
  badInput: false,
  customError: false,
  patternMismatch: false,
  rangeOverflow: false,
  rangeUnderflow: false,
  stepMismatch: false,
  tooLong: false,
  tooShort: false,
  typeMismatch: false,
  valid: true,
  valueMissing: false
});
var valueMissingValidityState = Object.freeze(__spreadProps(__spreadValues({}, validValidityState), {
  valid: false,
  valueMissing: true
}));
var customErrorValidityState = Object.freeze(__spreadProps(__spreadValues({}, validValidityState), {
  valid: false,
  customError: true
}));

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.NYIIDP5N.js
var HasSlotController = class {
  constructor(host, ...slotNames) {
    this.slotNames = [];
    this.handleSlotChange = (event) => {
      const slot = event.target;
      if (this.slotNames.includes("[default]") && !slot.name || slot.name && this.slotNames.includes(slot.name)) {
        this.host.requestUpdate();
      }
    };
    (this.host = host).addController(this);
    this.slotNames = slotNames;
  }
  hasDefaultSlot() {
    return [...this.host.childNodes].some((node) => {
      if (node.nodeType === node.TEXT_NODE && node.textContent.trim() !== "") {
        return true;
      }
      if (node.nodeType === node.ELEMENT_NODE) {
        const el = node;
        const tagName = el.tagName.toLowerCase();
        if (tagName === "sl-visually-hidden") {
          return false;
        }
        if (!el.hasAttribute("slot")) {
          return true;
        }
      }
      return false;
    });
  }
  hasNamedSlot(name) {
    return this.host.querySelector(`:scope > [slot="${name}"]`) !== null;
  }
  test(slotName) {
    return slotName === "[default]" ? this.hasDefaultSlot() : this.hasNamedSlot(slotName);
  }
  hostConnected() {
    this.host.shadowRoot.addEventListener("slotchange", this.handleSlotChange);
  }
  hostDisconnected() {
    this.host.shadowRoot.removeEventListener("slotchange", this.handleSlotChange);
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3Y6SB6QS.js
var basePath = "";
function setBasePath(path) {
  basePath = path;
}
function getBasePath(subpath = "") {
  if (!basePath) {
    const scripts = [...document.getElementsByTagName("script")];
    const configScript = scripts.find((script) => script.hasAttribute("data-shoelace"));
    if (configScript) {
      setBasePath(configScript.getAttribute("data-shoelace"));
    } else {
      const fallbackScript = scripts.find((s4) => {
        return /shoelace(\.min)?\.js($|\?)/.test(s4.src) || /shoelace-autoloader(\.min)?\.js($|\?)/.test(s4.src);
      });
      let path = "";
      if (fallbackScript) {
        path = fallbackScript.getAttribute("src");
      }
      setBasePath(path.split("/").slice(0, -1).join("/"));
    }
  }
  return basePath.replace(/\/$/, "") + (subpath ? `/${subpath.replace(/^\//, "")}` : ``);
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.P7ZG6EMR.js
var library = {
  name: "default",
  resolver: (name) => getBasePath(`assets/icons/${name}.svg`)
};
var library_default_default = library;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3TFKS637.js
var icons = {
  caret: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `,
  check: `
    <svg part="checked-icon" class="checkbox__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round">
        <g stroke="currentColor">
          <g transform="translate(3.428571, 3.428571)">
            <path d="M0,5.71428571 L3.42857143,9.14285714"></path>
            <path d="M9.14285714,0 L3.42857143,9.14285714"></path>
          </g>
        </g>
      </g>
    </svg>
  `,
  "chevron-down": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-down" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,
  "chevron-left": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-left" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
    </svg>
  `,
  "chevron-right": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-right" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,
  copy: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z"/>
    </svg>
  `,
  eye: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16">
      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
    </svg>
  `,
  "eye-slash": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-slash" viewBox="0 0 16 16">
      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
      <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
    </svg>
  `,
  eyedropper: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eyedropper" viewBox="0 0 16 16">
      <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v1.793l-.854.853a.5.5 0 1 0 .708.707L1.707 15H3.5a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"></path>
    </svg>
  `,
  "grip-vertical": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-grip-vertical" viewBox="0 0 16 16">
      <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"></path>
    </svg>
  `,
  indeterminate: `
    <svg part="indeterminate-icon" class="checkbox__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round">
        <g stroke="currentColor" stroke-width="2">
          <g transform="translate(2.285714, 6.857143)">
            <path d="M10.2857143,1.14285714 L1.14285714,1.14285714"></path>
          </g>
        </g>
      </g>
    </svg>
  `,
  "person-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-person-fill" viewBox="0 0 16 16">
      <path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
    </svg>
  `,
  "play-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
      <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"></path>
    </svg>
  `,
  "pause-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16">
      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"></path>
    </svg>
  `,
  radio: `
    <svg part="checked-icon" class="radio__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g fill="currentColor">
          <circle cx="8" cy="8" r="3.42857143"></circle>
        </g>
      </g>
    </svg>
  `,
  "star-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
      <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
    </svg>
  `,
  "x-lg": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
    </svg>
  `,
  "x-circle-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"></path>
    </svg>
  `
};
var systemLibrary = {
  name: "system",
  resolver: (name) => {
    if (name in icons) {
      return `data:image/svg+xml,${encodeURIComponent(icons[name])}`;
    }
    return "";
  }
};
var library_system_default = systemLibrary;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.ZL53POKZ.js
var registry = [library_default_default, library_system_default];
var watchedIcons = [];
function watchIcon(icon) {
  watchedIcons.push(icon);
}
function unwatchIcon(icon) {
  watchedIcons = watchedIcons.filter((el) => el !== icon);
}
function getIconLibrary(name) {
  return registry.find((lib) => lib.name === name);
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.QLXRCYS4.js
var icon_styles_default = i`
  :host {
    display: inline-block;
    width: 1em;
    height: 1em;
    box-sizing: content-box !important;
  }

  svg {
    display: block;
    height: 100%;
    width: 100%;
  }
`;

// node_modules/lit-html/directive-helpers.js
var { I: t5 } = j;
var l3 = (o7, t6) => void 0 === t6 ? void 0 !== o7?._$litType$ : o7?._$litType$ === t6;
var r7 = (o7) => void 0 === o7.strings;
var m2 = {};
var p3 = (o7, t6 = m2) => o7._$AH = t6;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.YHLNUJ7P.js
var CACHEABLE_ERROR = /* @__PURE__ */ Symbol();
var RETRYABLE_ERROR = /* @__PURE__ */ Symbol();
var parser;
var iconCache = /* @__PURE__ */ new Map();
var SlIcon = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.initialRender = false;
    this.svg = null;
    this.label = "";
    this.library = "default";
  }
  /** Given a URL, this function returns the resulting SVG element or an appropriate error symbol. */
  async resolveIcon(url, library2) {
    var _a;
    let fileData;
    if (library2 == null ? void 0 : library2.spriteSheet) {
      this.svg = b2`<svg part="svg">
        <use part="use" href="${url}"></use>
      </svg>`;
      return this.svg;
    }
    try {
      fileData = await fetch(url, { mode: "cors" });
      if (!fileData.ok) return fileData.status === 410 ? CACHEABLE_ERROR : RETRYABLE_ERROR;
    } catch (e9) {
      return RETRYABLE_ERROR;
    }
    try {
      const div = document.createElement("div");
      div.innerHTML = await fileData.text();
      const svg = div.firstElementChild;
      if (((_a = svg == null ? void 0 : svg.tagName) == null ? void 0 : _a.toLowerCase()) !== "svg") return CACHEABLE_ERROR;
      if (!parser) parser = new DOMParser();
      const doc = parser.parseFromString(svg.outerHTML, "text/html");
      const svgEl = doc.body.querySelector("svg");
      if (!svgEl) return CACHEABLE_ERROR;
      svgEl.part.add("svg");
      return document.adoptNode(svgEl);
    } catch (e9) {
      return CACHEABLE_ERROR;
    }
  }
  connectedCallback() {
    super.connectedCallback();
    watchIcon(this);
  }
  firstUpdated() {
    this.initialRender = true;
    this.setIcon();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    unwatchIcon(this);
  }
  getIconSource() {
    const library2 = getIconLibrary(this.library);
    if (this.name && library2) {
      return {
        url: library2.resolver(this.name),
        fromLibrary: true
      };
    }
    return {
      url: this.src,
      fromLibrary: false
    };
  }
  handleLabelChange() {
    const hasLabel = typeof this.label === "string" && this.label.length > 0;
    if (hasLabel) {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", this.label);
      this.removeAttribute("aria-hidden");
    } else {
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
      this.setAttribute("aria-hidden", "true");
    }
  }
  async setIcon() {
    var _a;
    const { url, fromLibrary } = this.getIconSource();
    const library2 = fromLibrary ? getIconLibrary(this.library) : void 0;
    if (!url) {
      this.svg = null;
      return;
    }
    let iconResolver = iconCache.get(url);
    if (!iconResolver) {
      iconResolver = this.resolveIcon(url, library2);
      iconCache.set(url, iconResolver);
    }
    if (!this.initialRender) {
      return;
    }
    const svg = await iconResolver;
    if (svg === RETRYABLE_ERROR) {
      iconCache.delete(url);
    }
    if (url !== this.getIconSource().url) {
      return;
    }
    if (l3(svg)) {
      this.svg = svg;
      if (library2) {
        await this.updateComplete;
        const shadowSVG = this.shadowRoot.querySelector("[part='svg']");
        if (typeof library2.mutator === "function" && shadowSVG) {
          library2.mutator(shadowSVG);
        }
      }
      return;
    }
    switch (svg) {
      case RETRYABLE_ERROR:
      case CACHEABLE_ERROR:
        this.svg = null;
        this.emit("sl-error");
        break;
      default:
        this.svg = svg.cloneNode(true);
        (_a = library2 == null ? void 0 : library2.mutator) == null ? void 0 : _a.call(library2, this.svg);
        this.emit("sl-load");
    }
  }
  render() {
    return this.svg;
  }
};
SlIcon.styles = [component_styles_default, icon_styles_default];
__decorateClass([
  r5()
], SlIcon.prototype, "svg", 2);
__decorateClass([
  n4({ reflect: true })
], SlIcon.prototype, "name", 2);
__decorateClass([
  n4()
], SlIcon.prototype, "src", 2);
__decorateClass([
  n4()
], SlIcon.prototype, "label", 2);
__decorateClass([
  n4({ reflect: true })
], SlIcon.prototype, "library", 2);
__decorateClass([
  watch("label")
], SlIcon.prototype, "handleLabelChange", 1);
__decorateClass([
  watch(["name", "src", "library"])
], SlIcon.prototype, "setIcon", 1);

// node_modules/lit-html/directives/live.js
var l4 = e6(class extends i5 {
  constructor(r8) {
    if (super(r8), r8.type !== t4.PROPERTY && r8.type !== t4.ATTRIBUTE && r8.type !== t4.BOOLEAN_ATTRIBUTE) throw Error("The `live` directive is not allowed on child or event bindings");
    if (!r7(r8)) throw Error("`live` bindings can only contain a single expression");
  }
  render(r8) {
    return r8;
  }
  update(i7, [t6]) {
    if (t6 === E || t6 === A) return t6;
    const o7 = i7.element, l5 = i7.name;
    if (i7.type === t4.PROPERTY) {
      if (t6 === o7[l5]) return E;
    } else if (i7.type === t4.BOOLEAN_ATTRIBUTE) {
      if (!!t6 === o7.hasAttribute(l5)) return E;
    } else if (i7.type === t4.ATTRIBUTE && o7.getAttribute(l5) === t6 + "") return E;
    return p3(i7), t6;
  }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.VM65NPGC.js
var SlInput = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      assumeInteractionOn: ["sl-blur", "sl-input"]
    });
    this.hasSlotController = new HasSlotController(this, "help-text", "label");
    this.localize = new LocalizeController2(this);
    this.hasFocus = false;
    this.title = "";
    this.__numberInput = Object.assign(document.createElement("input"), { type: "number" });
    this.__dateInput = Object.assign(document.createElement("input"), { type: "date" });
    this.type = "text";
    this.name = "";
    this.value = "";
    this.defaultValue = "";
    this.size = "medium";
    this.filled = false;
    this.pill = false;
    this.label = "";
    this.helpText = "";
    this.clearable = false;
    this.disabled = false;
    this.placeholder = "";
    this.readonly = false;
    this.passwordToggle = false;
    this.passwordVisible = false;
    this.noSpinButtons = false;
    this.form = "";
    this.required = false;
    this.spellcheck = true;
  }
  //
  // NOTE: We use an in-memory input for these getters/setters instead of the one in the template because the properties
  // can be set before the component is rendered.
  //
  /**
   * Gets or sets the current value as a `Date` object. Returns `null` if the value can't be converted. This will use the native `<input type="{{type}}">` implementation and may result in an error.
   */
  get valueAsDate() {
    var _a;
    this.__dateInput.type = this.type;
    this.__dateInput.value = this.value;
    return ((_a = this.input) == null ? void 0 : _a.valueAsDate) || this.__dateInput.valueAsDate;
  }
  set valueAsDate(newValue) {
    this.__dateInput.type = this.type;
    this.__dateInput.valueAsDate = newValue;
    this.value = this.__dateInput.value;
  }
  /** Gets or sets the current value as a number. Returns `NaN` if the value can't be converted. */
  get valueAsNumber() {
    var _a;
    this.__numberInput.value = this.value;
    return ((_a = this.input) == null ? void 0 : _a.valueAsNumber) || this.__numberInput.valueAsNumber;
  }
  set valueAsNumber(newValue) {
    this.__numberInput.valueAsNumber = newValue;
    this.value = this.__numberInput.value;
  }
  /** Gets the validity state object */
  get validity() {
    return this.input.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.input.validationMessage;
  }
  firstUpdated() {
    this.formControlController.updateValidity();
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleChange() {
    this.value = this.input.value;
    this.emit("sl-change");
  }
  handleClearClick(event) {
    event.preventDefault();
    if (this.value !== "") {
      this.value = "";
      this.emit("sl-clear");
      this.emit("sl-input");
      this.emit("sl-change");
    }
    this.input.focus();
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleInput() {
    this.value = this.input.value;
    this.formControlController.updateValidity();
    this.emit("sl-input");
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  handleKeyDown(event) {
    const hasModifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.key === "Enter" && !hasModifier) {
      setTimeout(() => {
        if (!event.defaultPrevented && !event.isComposing) {
          this.formControlController.submit();
        }
      });
    }
  }
  handlePasswordToggle() {
    this.passwordVisible = !this.passwordVisible;
  }
  handleDisabledChange() {
    this.formControlController.setValidity(this.disabled);
  }
  handleStepChange() {
    this.input.step = String(this.step);
    this.formControlController.updateValidity();
  }
  async handleValueChange() {
    await this.updateComplete;
    this.formControlController.updateValidity();
  }
  /** Sets focus on the input. */
  focus(options) {
    this.input.focus(options);
  }
  /** Removes focus from the input. */
  blur() {
    this.input.blur();
  }
  /** Selects all the text in the input. */
  select() {
    this.input.select();
  }
  /** Sets the start and end positions of the text selection (0-based). */
  setSelectionRange(selectionStart, selectionEnd, selectionDirection = "none") {
    this.input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  }
  /** Replaces a range of text with a new string. */
  setRangeText(replacement, start, end2, selectMode = "preserve") {
    const selectionStart = start != null ? start : this.input.selectionStart;
    const selectionEnd = end2 != null ? end2 : this.input.selectionEnd;
    this.input.setRangeText(replacement, selectionStart, selectionEnd, selectMode);
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Displays the browser picker for an input element (only works if the browser supports it for the input type). */
  showPicker() {
    if ("showPicker" in HTMLInputElement.prototype) {
      this.input.showPicker();
    }
  }
  /** Increments the value of a numeric input type by the value of the step attribute. */
  stepUp() {
    this.input.stepUp();
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Decrements the value of a numeric input type by the value of the step attribute. */
  stepDown() {
    this.input.stepDown();
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.input.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.input.reportValidity();
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    this.input.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  render() {
    const hasLabelSlot = this.hasSlotController.test("label");
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasLabel = this.label ? true : !!hasLabelSlot;
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    const hasClearIcon = this.clearable && !this.disabled && !this.readonly;
    const isClearIconVisible = hasClearIcon && (typeof this.value === "number" || this.value.length > 0);
    return b2`
      <div
        part="form-control"
        class=${e7({
      "form-control": true,
      "form-control--small": this.size === "small",
      "form-control--medium": this.size === "medium",
      "form-control--large": this.size === "large",
      "form-control--has-label": hasLabel,
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${hasLabel ? "false" : "true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${e7({
      input: true,
      // Sizes
      "input--small": this.size === "small",
      "input--medium": this.size === "medium",
      "input--large": this.size === "large",
      // States
      "input--pill": this.pill,
      "input--standard": !this.filled,
      "input--filled": this.filled,
      "input--disabled": this.disabled,
      "input--focused": this.hasFocus,
      "input--empty": !this.value,
      "input--no-spin-buttons": this.noSpinButtons
    })}
          >
            <span part="prefix" class="input__prefix">
              <slot name="prefix"></slot>
            </span>

            <input
              part="input"
              id="input"
              class="input__control"
              type=${this.type === "password" && this.passwordVisible ? "text" : this.type}
              title=${this.title}
              name=${o6(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${o6(this.placeholder)}
              minlength=${o6(this.minlength)}
              maxlength=${o6(this.maxlength)}
              min=${o6(this.min)}
              max=${o6(this.max)}
              step=${o6(this.step)}
              .value=${l4(this.value)}
              autocapitalize=${o6(this.autocapitalize)}
              autocomplete=${o6(this.autocomplete)}
              autocorrect=${o6(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${o6(this.pattern)}
              enterkeyhint=${o6(this.enterkeyhint)}
              inputmode=${o6(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${isClearIconVisible ? b2`
                  <button
                    part="clear-button"
                    class="input__clear"
                    type="button"
                    aria-label=${this.localize.term("clearEntry")}
                    @click=${this.handleClearClick}
                    tabindex="-1"
                  >
                    <slot name="clear-icon">
                      <sl-icon name="x-circle-fill" library="system"></sl-icon>
                    </slot>
                  </button>
                ` : ""}
            ${this.passwordToggle && !this.disabled ? b2`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible ? "hidePassword" : "showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible ? b2`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        ` : b2`
                          <slot name="hide-password-icon">
                            <sl-icon name="eye" library="system"></sl-icon>
                          </slot>
                        `}
                  </button>
                ` : ""}

            <span part="suffix" class="input__suffix">
              <slot name="suffix"></slot>
            </span>
          </div>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${hasHelpText ? "false" : "true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlInput.styles = [component_styles_default, form_control_styles_default, input_styles_default];
SlInput.dependencies = { "sl-icon": SlIcon };
__decorateClass([
  e5(".input__control")
], SlInput.prototype, "input", 2);
__decorateClass([
  r5()
], SlInput.prototype, "hasFocus", 2);
__decorateClass([
  n4()
], SlInput.prototype, "title", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "type", 2);
__decorateClass([
  n4()
], SlInput.prototype, "name", 2);
__decorateClass([
  n4()
], SlInput.prototype, "value", 2);
__decorateClass([
  defaultValue()
], SlInput.prototype, "defaultValue", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "filled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "pill", 2);
__decorateClass([
  n4()
], SlInput.prototype, "label", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlInput.prototype, "helpText", 2);
__decorateClass([
  n4({ type: Boolean })
], SlInput.prototype, "clearable", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "disabled", 2);
__decorateClass([
  n4()
], SlInput.prototype, "placeholder", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "readonly", 2);
__decorateClass([
  n4({ attribute: "password-toggle", type: Boolean })
], SlInput.prototype, "passwordToggle", 2);
__decorateClass([
  n4({ attribute: "password-visible", type: Boolean })
], SlInput.prototype, "passwordVisible", 2);
__decorateClass([
  n4({ attribute: "no-spin-buttons", type: Boolean })
], SlInput.prototype, "noSpinButtons", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "form", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "required", 2);
__decorateClass([
  n4()
], SlInput.prototype, "pattern", 2);
__decorateClass([
  n4({ type: Number })
], SlInput.prototype, "minlength", 2);
__decorateClass([
  n4({ type: Number })
], SlInput.prototype, "maxlength", 2);
__decorateClass([
  n4()
], SlInput.prototype, "min", 2);
__decorateClass([
  n4()
], SlInput.prototype, "max", 2);
__decorateClass([
  n4()
], SlInput.prototype, "step", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocapitalize", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocorrect", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocomplete", 2);
__decorateClass([
  n4({ type: Boolean })
], SlInput.prototype, "autofocus", 2);
__decorateClass([
  n4()
], SlInput.prototype, "enterkeyhint", 2);
__decorateClass([
  n4({
    type: Boolean,
    converter: {
      // Allow "true|false" attribute values but keep the property boolean
      fromAttribute: (value) => !value || value === "false" ? false : true,
      toAttribute: (value) => value ? "true" : "false"
    }
  })
], SlInput.prototype, "spellcheck", 2);
__decorateClass([
  n4()
], SlInput.prototype, "inputmode", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch("step", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleStepChange", 1);
__decorateClass([
  watch("value", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleValueChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XA43ZQPC.js
SlInput.define("sl-input");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.R3NF57O3.js
var checkbox_styles_default = i`
  :host {
    display: inline-block;
  }

  .checkbox {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-input-font-weight);
    color: var(--sl-input-label-color);
    vertical-align: middle;
    cursor: pointer;
  }

  .checkbox--small {
    --toggle-size: var(--sl-toggle-size-small);
    font-size: var(--sl-input-font-size-small);
  }

  .checkbox--medium {
    --toggle-size: var(--sl-toggle-size-medium);
    font-size: var(--sl-input-font-size-medium);
  }

  .checkbox--large {
    --toggle-size: var(--sl-toggle-size-large);
    font-size: var(--sl-input-font-size-large);
  }

  .checkbox__control {
    flex: 0 0 auto;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--toggle-size);
    height: var(--toggle-size);
    border: solid var(--sl-input-border-width) var(--sl-input-border-color);
    border-radius: 2px;
    background-color: var(--sl-input-background-color);
    color: var(--sl-color-neutral-0);
    transition:
      var(--sl-transition-fast) border-color,
      var(--sl-transition-fast) background-color,
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) box-shadow;
  }

  .checkbox__input {
    position: absolute;
    opacity: 0;
    padding: 0;
    margin: 0;
    pointer-events: none;
  }

  .checkbox__checked-icon,
  .checkbox__indeterminate-icon {
    display: inline-flex;
    width: var(--toggle-size);
    height: var(--toggle-size);
  }

  /* Hover */
  .checkbox:not(.checkbox--checked):not(.checkbox--disabled) .checkbox__control:hover {
    border-color: var(--sl-input-border-color-hover);
    background-color: var(--sl-input-background-color-hover);
  }

  /* Focus */
  .checkbox:not(.checkbox--checked):not(.checkbox--disabled) .checkbox__input:focus-visible ~ .checkbox__control {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  /* Checked/indeterminate */
  .checkbox--checked .checkbox__control,
  .checkbox--indeterminate .checkbox__control {
    border-color: var(--sl-color-primary-600);
    background-color: var(--sl-color-primary-600);
  }

  /* Checked/indeterminate + hover */
  .checkbox.checkbox--checked:not(.checkbox--disabled) .checkbox__control:hover,
  .checkbox.checkbox--indeterminate:not(.checkbox--disabled) .checkbox__control:hover {
    border-color: var(--sl-color-primary-500);
    background-color: var(--sl-color-primary-500);
  }

  /* Checked/indeterminate + focus */
  .checkbox.checkbox--checked:not(.checkbox--disabled) .checkbox__input:focus-visible ~ .checkbox__control,
  .checkbox.checkbox--indeterminate:not(.checkbox--disabled) .checkbox__input:focus-visible ~ .checkbox__control {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  /* Disabled */
  .checkbox--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkbox__label {
    display: inline-block;
    color: var(--sl-input-label-color);
    line-height: var(--toggle-size);
    margin-inline-start: 0.5em;
    user-select: none;
    -webkit-user-select: none;
  }

  :host([required]) .checkbox__label::after {
    content: var(--sl-input-required-content);
    color: var(--sl-input-required-content-color);
    margin-inline-start: var(--sl-input-required-content-offset);
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XSFJLY2D.js
var SlCheckbox = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      value: (control) => control.checked ? control.value || "on" : void 0,
      defaultValue: (control) => control.defaultChecked,
      setValue: (control, checked) => control.checked = checked
    });
    this.hasSlotController = new HasSlotController(this, "help-text");
    this.hasFocus = false;
    this.title = "";
    this.name = "";
    this.size = "medium";
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.defaultChecked = false;
    this.form = "";
    this.required = false;
    this.helpText = "";
  }
  /** Gets the validity state object */
  get validity() {
    return this.input.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.input.validationMessage;
  }
  firstUpdated() {
    this.formControlController.updateValidity();
  }
  handleClick() {
    this.checked = !this.checked;
    this.indeterminate = false;
    this.emit("sl-change");
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleInput() {
    this.emit("sl-input");
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleDisabledChange() {
    this.formControlController.setValidity(this.disabled);
  }
  handleStateChange() {
    this.input.checked = this.checked;
    this.input.indeterminate = this.indeterminate;
    this.formControlController.updateValidity();
  }
  /** Simulates a click on the checkbox. */
  click() {
    this.input.click();
  }
  /** Sets focus on the checkbox. */
  focus(options) {
    this.input.focus(options);
  }
  /** Removes focus from the checkbox. */
  blur() {
    this.input.blur();
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.input.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.input.reportValidity();
  }
  /**
   * Sets a custom validation message. The value provided will be shown to the user when the form is submitted. To clear
   * the custom validation message, call this method with an empty string.
   */
  setCustomValidity(message) {
    this.input.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  render() {
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    return b2`
      <div
        class=${e7({
      "form-control": true,
      "form-control--small": this.size === "small",
      "form-control--medium": this.size === "medium",
      "form-control--large": this.size === "large",
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          part="base"
          class=${e7({
      checkbox: true,
      "checkbox--checked": this.checked,
      "checkbox--disabled": this.disabled,
      "checkbox--focused": this.hasFocus,
      "checkbox--indeterminate": this.indeterminate,
      "checkbox--small": this.size === "small",
      "checkbox--medium": this.size === "medium",
      "checkbox--large": this.size === "large"
    })}
        >
          <input
            class="checkbox__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${o6(this.value)}
            .indeterminate=${l4(this.indeterminate)}
            .checked=${l4(this.checked)}
            .disabled=${this.disabled}
            .required=${this.required}
            aria-checked=${this.checked ? "true" : "false"}
            aria-describedby="help-text"
            @click=${this.handleClick}
            @input=${this.handleInput}
            @invalid=${this.handleInvalid}
            @blur=${this.handleBlur}
            @focus=${this.handleFocus}
          />

          <span
            part="control${this.checked ? " control--checked" : ""}${this.indeterminate ? " control--indeterminate" : ""}"
            class="checkbox__control"
          >
            ${this.checked ? b2`
                  <sl-icon part="checked-icon" class="checkbox__checked-icon" library="system" name="check"></sl-icon>
                ` : ""}
            ${!this.checked && this.indeterminate ? b2`
                  <sl-icon
                    part="indeterminate-icon"
                    class="checkbox__indeterminate-icon"
                    library="system"
                    name="indeterminate"
                  ></sl-icon>
                ` : ""}
          </span>

          <div part="label" class="checkbox__label">
            <slot></slot>
          </div>
        </label>

        <div
          aria-hidden=${hasHelpText ? "false" : "true"}
          class="form-control__help-text"
          id="help-text"
          part="form-control-help-text"
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlCheckbox.styles = [component_styles_default, form_control_styles_default, checkbox_styles_default];
SlCheckbox.dependencies = { "sl-icon": SlIcon };
__decorateClass([
  e5('input[type="checkbox"]')
], SlCheckbox.prototype, "input", 2);
__decorateClass([
  r5()
], SlCheckbox.prototype, "hasFocus", 2);
__decorateClass([
  n4()
], SlCheckbox.prototype, "title", 2);
__decorateClass([
  n4()
], SlCheckbox.prototype, "name", 2);
__decorateClass([
  n4()
], SlCheckbox.prototype, "value", 2);
__decorateClass([
  n4({ reflect: true })
], SlCheckbox.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlCheckbox.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlCheckbox.prototype, "checked", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlCheckbox.prototype, "indeterminate", 2);
__decorateClass([
  defaultValue("checked")
], SlCheckbox.prototype, "defaultChecked", 2);
__decorateClass([
  n4({ reflect: true })
], SlCheckbox.prototype, "form", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlCheckbox.prototype, "required", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlCheckbox.prototype, "helpText", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlCheckbox.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch(["checked", "indeterminate"], { waitUntilFirstUpdate: true })
], SlCheckbox.prototype, "handleStateChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.D5YQDJ7X.js
SlCheckbox.define("sl-checkbox");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.5D6IT2SR.js
var range_styles_default = i`
  :host {
    --thumb-size: 20px;
    --tooltip-offset: 10px;
    --track-color-active: var(--sl-color-neutral-200);
    --track-color-inactive: var(--sl-color-neutral-200);
    --track-active-offset: 0%;
    --track-height: 6px;

    display: block;
  }

  .range {
    position: relative;
  }

  .range__control {
    --percent: 0%;
    -webkit-appearance: none;
    border-radius: 3px;
    width: 100%;
    height: var(--track-height);
    background: transparent;
    line-height: var(--sl-input-height-medium);
    vertical-align: middle;
    margin: 0;

    background-image: linear-gradient(
      to right,
      var(--track-color-inactive) 0%,
      var(--track-color-inactive) min(var(--percent), var(--track-active-offset)),
      var(--track-color-active) min(var(--percent), var(--track-active-offset)),
      var(--track-color-active) max(var(--percent), var(--track-active-offset)),
      var(--track-color-inactive) max(var(--percent), var(--track-active-offset)),
      var(--track-color-inactive) 100%
    );
  }

  .range--rtl .range__control {
    background-image: linear-gradient(
      to left,
      var(--track-color-inactive) 0%,
      var(--track-color-inactive) min(var(--percent), var(--track-active-offset)),
      var(--track-color-active) min(var(--percent), var(--track-active-offset)),
      var(--track-color-active) max(var(--percent), var(--track-active-offset)),
      var(--track-color-inactive) max(var(--percent), var(--track-active-offset)),
      var(--track-color-inactive) 100%
    );
  }

  /* Webkit */
  .range__control::-webkit-slider-runnable-track {
    width: 100%;
    height: var(--track-height);
    border-radius: 3px;
    border: none;
  }

  .range__control::-webkit-slider-thumb {
    border: none;
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: 50%;
    background-color: var(--sl-color-primary-600);
    border: solid var(--sl-input-border-width) var(--sl-color-primary-600);
    -webkit-appearance: none;
    margin-top: calc(var(--thumb-size) / -2 + var(--track-height) / 2);
    cursor: pointer;
  }

  .range__control:enabled::-webkit-slider-thumb:hover {
    background-color: var(--sl-color-primary-500);
    border-color: var(--sl-color-primary-500);
  }

  .range__control:enabled:focus-visible::-webkit-slider-thumb {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .range__control:enabled::-webkit-slider-thumb:active {
    background-color: var(--sl-color-primary-500);
    border-color: var(--sl-color-primary-500);
    cursor: grabbing;
  }

  /* Firefox */
  .range__control::-moz-focus-outer {
    border: 0;
  }

  .range__control::-moz-range-progress {
    background-color: var(--track-color-active);
    border-radius: 3px;
    height: var(--track-height);
  }

  .range__control::-moz-range-track {
    width: 100%;
    height: var(--track-height);
    background-color: var(--track-color-inactive);
    border-radius: 3px;
    border: none;
  }

  .range__control::-moz-range-thumb {
    border: none;
    height: var(--thumb-size);
    width: var(--thumb-size);
    border-radius: 50%;
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
    transition:
      var(--sl-transition-fast) border-color,
      var(--sl-transition-fast) background-color,
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) box-shadow;
    cursor: pointer;
  }

  .range__control:enabled::-moz-range-thumb:hover {
    background-color: var(--sl-color-primary-500);
    border-color: var(--sl-color-primary-500);
  }

  .range__control:enabled:focus-visible::-moz-range-thumb {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .range__control:enabled::-moz-range-thumb:active {
    background-color: var(--sl-color-primary-500);
    border-color: var(--sl-color-primary-500);
    cursor: grabbing;
  }

  /* States */
  .range__control:focus-visible {
    outline: none;
  }

  .range__control:disabled {
    opacity: 0.5;
  }

  .range__control:disabled::-webkit-slider-thumb {
    cursor: not-allowed;
  }

  .range__control:disabled::-moz-range-thumb {
    cursor: not-allowed;
  }

  /* Tooltip output */
  .range__tooltip {
    position: absolute;
    z-index: var(--sl-z-index-tooltip);
    left: 0;
    border-radius: var(--sl-tooltip-border-radius);
    background-color: var(--sl-tooltip-background-color);
    font-family: var(--sl-tooltip-font-family);
    font-size: var(--sl-tooltip-font-size);
    font-weight: var(--sl-tooltip-font-weight);
    line-height: var(--sl-tooltip-line-height);
    color: var(--sl-tooltip-color);
    opacity: 0;
    padding: var(--sl-tooltip-padding);
    transition: var(--sl-transition-fast) opacity;
    pointer-events: none;
  }

  .range__tooltip:after {
    content: '';
    position: absolute;
    width: 0;
    height: 0;
    left: 50%;
    translate: calc(-1 * var(--sl-tooltip-arrow-size));
  }

  .range--tooltip-visible .range__tooltip {
    opacity: 1;
  }

  /* Tooltip on top */
  .range--tooltip-top .range__tooltip {
    top: calc(-1 * var(--thumb-size) - var(--tooltip-offset));
  }

  .range--tooltip-top .range__tooltip:after {
    border-top: var(--sl-tooltip-arrow-size) solid var(--sl-tooltip-background-color);
    border-left: var(--sl-tooltip-arrow-size) solid transparent;
    border-right: var(--sl-tooltip-arrow-size) solid transparent;
    top: 100%;
  }

  /* Tooltip on bottom */
  .range--tooltip-bottom .range__tooltip {
    bottom: calc(-1 * var(--thumb-size) - var(--tooltip-offset));
  }

  .range--tooltip-bottom .range__tooltip:after {
    border-bottom: var(--sl-tooltip-arrow-size) solid var(--sl-tooltip-background-color);
    border-left: var(--sl-tooltip-arrow-size) solid transparent;
    border-right: var(--sl-tooltip-arrow-size) solid transparent;
    bottom: 100%;
  }

  @media (forced-colors: active) {
    .range__control,
    .range__tooltip {
      border: solid 1px transparent;
    }

    .range__control::-webkit-slider-thumb {
      border: solid 1px transparent;
    }

    .range__control::-moz-range-thumb {
      border: solid 1px transparent;
    }

    .range__tooltip:after {
      display: none;
    }
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.HRYVEIKV.js
var SlRange = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this);
    this.hasSlotController = new HasSlotController(this, "help-text", "label");
    this.localize = new LocalizeController2(this);
    this.hasFocus = false;
    this.hasTooltip = false;
    this.title = "";
    this.name = "";
    this.value = 0;
    this.label = "";
    this.helpText = "";
    this.disabled = false;
    this.min = 0;
    this.max = 100;
    this.step = 1;
    this.tooltip = "top";
    this.tooltipFormatter = (value) => value.toString();
    this.form = "";
    this.defaultValue = 0;
  }
  /** Gets the validity state object */
  get validity() {
    return this.input.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.input.validationMessage;
  }
  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => this.syncRange());
    if (this.value < this.min) {
      this.value = this.min;
    }
    if (this.value > this.max) {
      this.value = this.max;
    }
    this.updateComplete.then(() => {
      this.syncRange();
      this.resizeObserver.observe(this.input);
    });
  }
  disconnectedCallback() {
    var _a;
    super.disconnectedCallback();
    (_a = this.resizeObserver) == null ? void 0 : _a.unobserve(this.input);
  }
  handleChange() {
    this.emit("sl-change");
  }
  handleInput() {
    this.value = parseFloat(this.input.value);
    this.emit("sl-input");
    this.syncRange();
  }
  handleBlur() {
    this.hasFocus = false;
    this.hasTooltip = false;
    this.emit("sl-blur");
  }
  handleFocus() {
    this.hasFocus = true;
    this.hasTooltip = true;
    this.emit("sl-focus");
  }
  handleThumbDragStart() {
    this.hasTooltip = true;
  }
  handleThumbDragEnd() {
    this.hasTooltip = false;
  }
  syncProgress(percent) {
    this.input.style.setProperty("--percent", `${percent * 100}%`);
  }
  syncTooltip(percent) {
    if (this.output !== null) {
      const inputWidth = this.input.offsetWidth;
      const tooltipWidth = this.output.offsetWidth;
      const thumbSize = getComputedStyle(this.input).getPropertyValue("--thumb-size");
      const isRtl = this.localize.dir() === "rtl";
      const percentAsWidth = inputWidth * percent;
      if (isRtl) {
        const x2 = `${inputWidth - percentAsWidth}px + ${percent} * ${thumbSize}`;
        this.output.style.translate = `calc((${x2} - ${tooltipWidth / 2}px - ${thumbSize} / 2))`;
      } else {
        const x2 = `${percentAsWidth}px - ${percent} * ${thumbSize}`;
        this.output.style.translate = `calc(${x2} - ${tooltipWidth / 2}px + ${thumbSize} / 2)`;
      }
    }
  }
  handleValueChange() {
    this.formControlController.updateValidity();
    this.input.value = this.value.toString();
    this.value = parseFloat(this.input.value);
    this.syncRange();
  }
  handleDisabledChange() {
    this.formControlController.setValidity(this.disabled);
  }
  syncRange() {
    const percent = Math.max(0, (this.value - this.min) / (this.max - this.min));
    this.syncProgress(percent);
    if (this.tooltip !== "none" && this.hasTooltip) {
      this.updateComplete.then(() => this.syncTooltip(percent));
    }
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  /** Sets focus on the range. */
  focus(options) {
    this.input.focus(options);
  }
  /** Removes focus from the range. */
  blur() {
    this.input.blur();
  }
  /** Increments the value of the range by the value of the step attribute. */
  stepUp() {
    this.input.stepUp();
    if (this.value !== Number(this.input.value)) {
      this.value = Number(this.input.value);
    }
  }
  /** Decrements the value of the range by the value of the step attribute. */
  stepDown() {
    this.input.stepDown();
    if (this.value !== Number(this.input.value)) {
      this.value = Number(this.input.value);
    }
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.input.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.input.reportValidity();
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    this.input.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  render() {
    const hasLabelSlot = this.hasSlotController.test("label");
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasLabel = this.label ? true : !!hasLabelSlot;
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    return b2`
      <div
        part="form-control"
        class=${e7({
      "form-control": true,
      "form-control--medium": true,
      // range only has one size
      "form-control--has-label": hasLabel,
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${hasLabel ? "false" : "true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${e7({
      range: true,
      "range--disabled": this.disabled,
      "range--focused": this.hasFocus,
      "range--rtl": this.localize.dir() === "rtl",
      "range--tooltip-visible": this.hasTooltip,
      "range--tooltip-top": this.tooltip === "top",
      "range--tooltip-bottom": this.tooltip === "bottom"
    })}
            @mousedown=${this.handleThumbDragStart}
            @mouseup=${this.handleThumbDragEnd}
            @touchstart=${this.handleThumbDragStart}
            @touchend=${this.handleThumbDragEnd}
          >
            <input
              part="input"
              id="input"
              class="range__control"
              title=${this.title}
              type="range"
              name=${o6(this.name)}
              ?disabled=${this.disabled}
              min=${o6(this.min)}
              max=${o6(this.max)}
              step=${o6(this.step)}
              .value=${l4(this.value.toString())}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @focus=${this.handleFocus}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @blur=${this.handleBlur}
            />
            ${this.tooltip !== "none" && !this.disabled ? b2`
                  <output part="tooltip" class="range__tooltip">
                    ${typeof this.tooltipFormatter === "function" ? this.tooltipFormatter(this.value) : this.value}
                  </output>
                ` : ""}
          </div>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${hasHelpText ? "false" : "true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlRange.styles = [component_styles_default, form_control_styles_default, range_styles_default];
__decorateClass([
  e5(".range__control")
], SlRange.prototype, "input", 2);
__decorateClass([
  e5(".range__tooltip")
], SlRange.prototype, "output", 2);
__decorateClass([
  r5()
], SlRange.prototype, "hasFocus", 2);
__decorateClass([
  r5()
], SlRange.prototype, "hasTooltip", 2);
__decorateClass([
  n4()
], SlRange.prototype, "title", 2);
__decorateClass([
  n4()
], SlRange.prototype, "name", 2);
__decorateClass([
  n4({ type: Number })
], SlRange.prototype, "value", 2);
__decorateClass([
  n4()
], SlRange.prototype, "label", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlRange.prototype, "helpText", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlRange.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Number })
], SlRange.prototype, "min", 2);
__decorateClass([
  n4({ type: Number })
], SlRange.prototype, "max", 2);
__decorateClass([
  n4({ type: Number })
], SlRange.prototype, "step", 2);
__decorateClass([
  n4()
], SlRange.prototype, "tooltip", 2);
__decorateClass([
  n4({ attribute: false })
], SlRange.prototype, "tooltipFormatter", 2);
__decorateClass([
  n4({ reflect: true })
], SlRange.prototype, "form", 2);
__decorateClass([
  defaultValue()
], SlRange.prototype, "defaultValue", 2);
__decorateClass([
  t3({ passive: true })
], SlRange.prototype, "handleThumbDragStart", 1);
__decorateClass([
  watch("value", { waitUntilFirstUpdate: true })
], SlRange.prototype, "handleValueChange", 1);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlRange.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch("hasTooltip", { waitUntilFirstUpdate: true })
], SlRange.prototype, "syncRange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.CKH4GVK3.js
SlRange.define("sl-range");

// python/static/play.js
var COLORS = ["#00aaff", "#ff4444", "#44dd44", "#ffaa00", "#cc44ff", "#ff44aa"];
var renderSize = 600;
var renderPixelRatio = 1;
var bg = document.getElementById("bg").getContext("2d", {
  alpha: false
});
var fg = document.getElementById("fg").getContext("2d", {
  alpha: true
});
var overlays = document.getElementById("overlays").getContext("2d");
var msg = document.getElementById("msg");
var waiting = document.getElementById("waiting");
var waitingPlayers = document.getElementById("waiting-players");
var end = document.getElementById("end");
var endLabel = document.getElementById("end-label");
var endWinner = document.getElementById("end-winner");
var endDetail = document.getElementById("end-detail");
var replayControls = document.getElementById("replay-controls");
var replaySlider = document.getElementById("replay-slider");
var replayTime = document.getElementById("replay-time");
var replayPlay = document.getElementById("replay-play");
var resultLabel = document.getElementById("result-label");
var resultWinner = document.getElementById("result-winner");
var playerSearchInput = document.getElementById("player-search-input");
var playerOptions = document.getElementById("player-options");
var playerList = document.getElementById("player-list");
var gameInfos = document.getElementById("game-infos");
var gameArea = document.getElementById("col-right");
var gameRender = document.getElementById("render");
var decisionIntervalInput = document.getElementById("decision-interval");
var targetGranularityInput = document.getElementById("target-granularity");
var victoryScoreInput = document.getElementById("victory-score");
var deterministicInput = document.getElementById("deterministic");
var powerupSpawnRateInput = document.getElementById("powerup-spawn-rate");
var powerupPresets = document.getElementById("powerup-presets");
var powerupIncluded = document.getElementById("powerup-included");
var powerupExcluded = document.getElementById("powerup-excluded");
var debugTick = document.getElementById("debug-tick");
var inspectionHelp = document.getElementById("inspection-help");
var configuredServer = document.querySelector('meta[name="play-server"]').content.trim();
var bootstrap = JSON.parse(document.getElementById("play-bootstrap")?.textContent || "{}");
var clientExecution = bootstrap.execution === "client";
var staticGames = bootstrap.games || null;
var initialCatalog = JSON.parse(document.getElementById("play-catalog")?.textContent || "[]");
var initialHuman = initialCatalog.find((option) => option.kind === "human");
var initialOpponent = initialCatalog.find((option) => option.kind !== "human");
var human = bootstrap.human ?? (initialCatalog.length ? Boolean(initialHuman) : true);
var initialSpecs = bootstrap.specs?.length ? bootstrap.specs : [initialOpponent?.spec].filter(Boolean);
var seats = human ? [initialHuman?.spec || "you", ...initialSpecs] : [...initialSpecs];
var scores = seats.map(() => 0);
var victoryScore = 10;
var matchFinished = false;
var roundScored = false;
var running = false;
var ready = false;
var paused = false;
var rewindEnabled = true;
var latestFrame = null;
var trailFrame = null;
var lastReceivedFrame = null;
var renderFrameId = 0;
var predictionFrame = null;
var previousPredictionFrame = null;
var predictionStartedAt = 0;
var framePredictor = createFramePredictor(true);
var latestFrameReceivedAt = 0;
var frameQueue = [];
var roundFrames = [];
var replay;
var avatarRenderer;
var overlayRenderer;
var trailRenderer;
var playerRows = [];
var visualCapabilities = [];
var visualSelections = {};
var simulator = { arena_size: 80, radius: 0.6, tick_hz: 60 };
var lastWinner = null;
var pickingControllerTarget = false;
var clientGame = null;
var clientGameReady = true;
var serverReady = false;
var controllerTargets = [];
var selectedControllerTarget = -1;
var powerupCatalog = {};
var powerupPresetCatalog = {};
var powerupSpawnTypes = /* @__PURE__ */ new Set();
var START_KEY = "s";
var REPLAY_KEYS = /* @__PURE__ */ new Set([" ", "arrowleft", "arrowright", "r"]);
var playerSearch;
var serverUrl = new URL(configuredServer || location.origin);
var websocketUrl = new URL("/ws", serverUrl);
websocketUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
var ws;
var receivedServerMessage = false;
var startWhenReady = false;
var desiredConfiguration = initialSpecs.length ? { human, specs: [...initialSpecs] } : null;
var desiredConfigurationSent = false;
var desiredConfigurationApplied = false;
var currentAction = 1;
fg.imageSmoothingEnabled = true;
function selectedPowerupTypes() {
  return Object.keys(powerupCatalog).filter((name) => powerupSpawnTypes.has(name));
}
function matchingPowerupPreset() {
  const selected = selectedPowerupTypes();
  return Object.entries(powerupPresetCatalog).find(([, names]) => names.length === selected.length && names.every((name) => powerupSpawnTypes.has(name)))?.[0];
}
function powerupIcon(name, ariaLabel) {
  const powerup = powerupCatalog[name];
  const button = document.createElement("button");
  const column = powerup.sprite_index % 3;
  const row = Math.floor(powerup.sprite_index / 3);
  button.type = "button";
  button.className = "powerup-option";
  button.title = powerup.label;
  button.setAttribute("aria-label", ariaLabel);
  button.style.backgroundPosition = `${-32 * column}px ${-32 * row}px`;
  return button;
}
function powerupOption(name) {
  const button = powerupIcon(name, powerupCatalog[name].label);
  button.addEventListener("click", () => {
    if (powerupSpawnTypes.has(name)) powerupSpawnTypes.delete(name);
    else powerupSpawnTypes.add(name);
    renderPowerupConfiguration();
    sendGameSettings();
  });
  return button;
}
function renderPowerupConfiguration() {
  const preset = matchingPowerupPreset();
  const presetButtons = Object.entries(powerupPresetCatalog).map(([label, names]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.classList.toggle("active", label === preset);
    button.addEventListener("click", () => {
      powerupSpawnTypes = new Set(names);
      renderPowerupConfiguration();
      sendGameSettings();
    });
    return button;
  });
  if (!preset && Object.keys(powerupCatalog).length) {
    const custom = document.createElement("button");
    custom.type = "button";
    custom.textContent = "Custom";
    custom.className = "active";
    presetButtons.push(custom);
  }
  powerupPresets.replaceChildren(...presetButtons);
  powerupIncluded.replaceChildren(...selectedPowerupTypes().map(powerupOption));
  powerupExcluded.replaceChildren(...Object.keys(powerupCatalog).filter((name) => !powerupSpawnTypes.has(name)).map(powerupOption));
}
function resizeBitmap(context, size3, pixelRatio, preserve) {
  const bitmapSize = Math.ceil(size3 * pixelRatio);
  if (context.canvas.width === bitmapSize && context.canvas.height === bitmapSize) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return;
  }
  let previous;
  if (preserve) {
    previous = document.createElement("canvas");
    previous.width = context.canvas.width;
    previous.height = context.canvas.height;
    previous.getContext("2d").drawImage(context.canvas, 0, 0);
  }
  context.canvas.width = bitmapSize;
  context.canvas.height = bitmapSize;
  if (previous) context.drawImage(previous, 0, 0, bitmapSize, bitmapSize);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}
function resizeCanvases() {
  const size3 = Math.max(1, Math.floor(Math.min(
    window.innerWidth - gameInfos.clientWidth - 8,
    window.innerHeight - 8
  )));
  const pixelRatio = window.devicePixelRatio || 1;
  gameRender.style.width = `${size3 + 8}px`;
  gameRender.style.height = `${size3 + 8}px`;
  if (size3 === renderSize && pixelRatio === renderPixelRatio) return;
  renderSize = size3;
  renderPixelRatio = pixelRatio;
  resizeBitmap(bg, size3, pixelRatio, true);
  resizeBitmap(fg, size3, pixelRatio, false);
  resizeBitmap(overlays, size3, pixelRatio, false);
  fg.imageSmoothingEnabled = true;
  trailRenderer?.resize(size3);
  avatarRenderer?.resize(size3, pixelRatio);
  overlayRenderer?.resize(size3);
  if (latestFrame) {
    avatarRenderer?.draw(latestFrame.players);
    overlayRenderer?.draw(latestFrame);
  }
}
function resetCanvas() {
  gameRender.classList.remove("borderless");
  if (trailRenderer) trailRenderer.reset();
  else {
    bg.fillStyle = "#222222";
    bg.fillRect(0, 0, renderSize, renderSize);
  }
  if (avatarRenderer) avatarRenderer.reset();
  else fg.clearRect(0, 0, renderSize, renderSize);
  if (overlayRenderer) overlayRenderer.reset();
  else overlays.clearRect(0, 0, renderSize, renderSize);
  latestFrame = null;
  trailFrame = null;
  lastReceivedFrame = null;
  frameQueue = [];
  predictionFrame = null;
  previousPredictionFrame = null;
  predictionStartedAt = 0;
  latestFrameReceivedAt = 0;
  pickingControllerTarget = false;
  controllerTargets = [];
  selectedControllerTarget = -1;
  fg.canvas.style.cursor = "";
  overlayRenderer?.setTargetChoices([], -1);
}
function clearControllerTargetPicker() {
  pickingControllerTarget = false;
  controllerTargets = [];
  selectedControllerTarget = -1;
  fg.canvas.style.cursor = "";
  overlayRenderer?.setTargetChoices([], -1);
  overlayRenderer?.draw(latestFrame);
}
function nearestControllerTarget(event) {
  const bounds = fg.canvas.getBoundingClientRect();
  const x2 = (event.clientX - bounds.left) / bounds.width * simulator.arena_size;
  const y3 = (1 - (event.clientY - bounds.top) / bounds.height) * simulator.arena_size;
  let nearest = -1;
  let nearestDistance = Infinity;
  controllerTargets.forEach(([targetX, targetY], index) => {
    const distance = (x2 - targetX) ** 2 + (y3 - targetY) ** 2;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}
function setDebugTick(tick = null) {
  debugTick.textContent = tick === null ? "" : `\xB7 tick ${tick}`;
  debugTick.classList.toggle("hidden", tick === null);
}
function seatName(seat) {
  if (seat === "you") return "You";
  if (playerSearch.labelFor(seat)) return playerSearch.labelFor(seat);
  if (seat.startsWith("ckpt:")) {
    return seat.slice(5).split(/[\\/]/).pop().replace(/\.safetensors$/, "");
  }
  return seat.replaceAll("_", " ");
}
function renderHud() {
  playerRows = seats.map((seat, i7) => {
    const row = document.createElement("div");
    row.className = `player${human && seat === "you" ? " local" : ""}`;
    row.style.setProperty("--player-color", COLORS[i7 % COLORS.length]);
    const line = document.createElement("span");
    line.className = "line-color-preview";
    const dropdown = document.createElement("sl-dropdown");
    dropdown.className = "player-settings-dropdown";
    dropdown.placement = "bottom-start";
    dropdown.hoist = true;
    dropdown.stayOpenOnSelect = true;
    const settings = document.createElement("button");
    settings.className = "player-settings";
    settings.type = "button";
    settings.textContent = "\u2699";
    settings.title = `Options for ${seatName(seat)}`;
    settings.setAttribute("aria-label", `Options for ${seatName(seat)}`);
    settings.slot = "trigger";
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = seatName(seat);
    name.title = seatName(seat);
    name.addEventListener("wheel", (e9) => {
      if (name.scrollWidth <= name.clientWidth) return;
      const delta = e9.deltaX || e9.deltaY;
      const limit = name.scrollWidth - name.clientWidth;
      const next = Math.max(0, Math.min(limit, name.scrollLeft + delta));
      if (next === name.scrollLeft) return;
      name.scrollLeft = next;
      e9.preventDefault();
    }, { passive: false });
    const remove = document.createElement("button");
    remove.className = `player-remove${seats.length > 1 ? "" : " hidden"}`;
    remove.type = "button";
    remove.textContent = "\xD7";
    remove.title = `Remove ${seatName(seat)}`;
    remove.setAttribute("aria-label", `Remove ${seatName(seat)}`);
    remove.addEventListener("click", () => removeSeat(i7));
    const score = document.createElement("span");
    score.className = "player-score";
    score.textContent = scores[i7] ?? 0;
    score.setAttribute("aria-label", `${seatName(seat)} score`);
    dropdown.append(settings, makePlayerSettings(i7));
    row.append(line, dropdown, name, remove, score);
    return { element: row, score, dead: null };
  });
  playerList.replaceChildren(...playerRows.map((row) => row.element));
  waitingPlayers.replaceChildren(...seats.map((seat, i7) => {
    const item = document.createElement("li");
    item.textContent = seatName(seat);
    item.style.color = COLORS[i7 % COLORS.length];
    return item;
  }));
  playerList.classList.toggle("locked", running);
}
function makePlayerSettings(seat) {
  const menu = document.createElement("div");
  menu.className = "player-settings-menu";
  const capability = visualCapabilities[seat] || {};
  const settings = [
    ["reachable", "Show reachable region"],
    ["value", "Show value glow"]
  ];
  settings.forEach(([name, label]) => {
    const input = document.createElement("sl-checkbox");
    input.checked = Boolean(visualSelections[seat]?.[name]);
    input.disabled = !capability[name];
    input.textContent = capability[name] ? label : `${label} unavailable`;
    input.addEventListener("sl-change", () => {
      visualSelections[seat] = { ...visualSelections[seat], [name]: input.checked };
      sendVisualSelections();
      overlayRenderer.draw(latestFrame);
    });
    menu.append(input);
  });
  const powerups = document.createElement("div");
  powerups.className = "powerup-controls";
  const title = document.createElement("span");
  title.textContent = "Collect a powerup";
  powerups.append(title);
  Object.entries(powerupCatalog).forEach(([name, powerup]) => {
    const button = powerupIcon(
      name,
      `Collect ${powerup.label} as ${seatName(seats[seat])}`
    );
    button.addEventListener("click", () => activatePowerup(name, seat));
    powerups.append(button);
  });
  menu.append(powerups);
  return menu;
}
function sendServer(message) {
  if (clientExecution || ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}
function activatePowerup(powerup, collector = 0) {
  if (!running) return;
  if (clientGame) clientGame.activatePowerup(powerup, collector);
  else sendServer({ type: "powerup", powerup, collector });
}
function sendVisualSelections() {
  sendServer({ type: "visuals", visuals: visualSelections });
}
function setLobbyLocked(locked) {
  playerSearchInput.disabled = locked;
  playerList.classList.toggle("locked", locked);
  if (locked) playerSearch.hide();
}
function configureSeats(humanEnabled, opponents) {
  if (running || !humanEnabled && !opponents.length) return;
  human = humanEnabled;
  seats = human ? ["you", ...opponents] : [...opponents];
  resetMatch();
  ready = false;
  lastWinner = null;
  desiredConfiguration = { human, specs: [...opponents] };
  desiredConfigurationSent = false;
  desiredConfigurationApplied = false;
  renderHud();
  hideEnd();
  showLoadingPlayers();
  sendDesiredConfiguration();
}
function resetMatch() {
  scores = seats.map(() => 0);
  matchFinished = false;
  roundScored = false;
  playerRows.forEach((row, seat) => {
    row.score.textContent = scores[seat] ?? 0;
  });
}
function scoreRound(winner) {
  if (roundScored) return;
  roundScored = true;
  if (winner < 0 || winner >= scores.length) return;
  scores[winner] += 1;
  matchFinished = scores[winner] >= victoryScore;
  playerRows[winner].score.textContent = scores[winner];
}
function sendDesiredConfiguration() {
  if (!desiredConfiguration || desiredConfigurationSent) return;
  if (clientExecution) {
    requestClientGame(desiredConfiguration);
    return;
  }
  if (!sendServer({ type: "configure", ...desiredConfiguration })) return;
  desiredConfigurationSent = true;
}
function requestClientGame(configuration) {
  desiredConfigurationSent = true;
  try {
    const fixedSeed = new URLSearchParams(location.search).get("seed");
    const message = fixedSeed === null ? resolveClientGame(staticGames, configuration) : resolveClientGame(staticGames, configuration, fixedSeed);
    if (configuration !== desiredConfiguration) return;
    handleServerMessage({ data: JSON.stringify(message) });
    handleServerMessage({ data: JSON.stringify({ type: "ready" }) });
  } catch (error) {
    if (configuration !== desiredConfiguration) return;
    handleServerMessage({
      data: JSON.stringify({ type: "error", message: error.message })
    });
  }
}
function serverConfigurationMatchesDesired(serverSeats) {
  if (!desiredConfiguration) return false;
  const desiredSeats = desiredConfiguration.human ? ["you", ...desiredConfiguration.specs] : desiredConfiguration.specs;
  return desiredSeats.length === serverSeats.length && desiredSeats.every((seat, index) => seat === serverSeats[index]);
}
function addSeat(spec) {
  playerSearchInput.value = "";
  playerSearch.hide();
  const opponents = human ? seats.slice(1) : seats.slice();
  // The local simulator seats two players: adding one replaces the last opponent.
  if (spec === "you") {
    if (!human) configureSeats(true, opponents.slice(0, 1));
    return;
  }
  const kept = human ? opponents.slice(0, 0) : opponents.slice(0, 1);
  configureSeats(human, [...kept, spec]);
}
function removeSeat(index) {
  if (running || seats.length <= 1) return;
  if (human && seats[index] === "you") {
    configureSeats(false, seats.slice(1));
    return;
  }
  const opponents = human ? seats.slice(1) : seats.slice();
  opponents.splice(human ? index - 1 : index, 1);
  configureSeats(human, opponents);
}
function updatePlayerRows(players) {
  players.forEach((player, i7) => {
    const row = playerRows[i7];
    if (!row) return;
    const dead = !player.alive;
    if (row.dead === dead) return;
    row.dead = dead;
    row.element.classList.toggle("dead", dead);
  });
}
function setWinnerDisplay(label, winner, winnerIndex, outcome = null) {
  if (outcome === "won") {
    label.textContent = "WIN";
    winner.textContent = "";
  } else if (outcome === "lost") {
    label.textContent = "LOST";
    winner.textContent = "";
  } else if (outcome === "tied") {
    label.textContent = "TIE";
    winner.textContent = "";
  } else {
    label.textContent = winnerIndex < 0 ? "TIE" : "WINNER: ";
    winner.textContent = winnerIndex < 0 ? "" : seatName(seats[winnerIndex]);
  }
  winner.style.color = winnerIndex < 0 ? "" : COLORS[winnerIndex % COLORS.length];
}
function clearWinnerDisplay(label, winner) {
  label.textContent = "";
  winner.textContent = "";
  winner.style.color = "";
}
function makeKeycap(value) {
  const key = document.createElement("kbd");
  key.className = "game-key";
  key.textContent = value.toUpperCase();
  return key;
}
function showWaiting(text, winnerIndex = null) {
  if (winnerIndex === null) clearWinnerDisplay(resultLabel, resultWinner);
  else setWinnerDisplay(resultLabel, resultWinner, winnerIndex);
  msg.textContent = text;
  waiting.classList.remove("ready", "waking", "loading", "client-runtime-loading");
  waiting.classList.toggle("has-result", winnerIndex !== null);
  waiting.classList.remove("hidden");
}
function showReady(winnerIndex = null) {
  showWaiting("", winnerIndex);
  msg.append("Press ", makeKeycap(START_KEY), " to start");
  if (matchMedia("(pointer: coarse)").matches) msg.append(" or tap to start");
  waiting.classList.add("ready");
}
function showWaking() {
  showWaiting("Waking Shai Hulud \u2014 usually a few seconds");
  waiting.classList.add("waking");
}
function showLoadingPlayers() {
  showWaiting("Loading players...");
  waiting.classList.add("loading");
}
function showClientRuntimeLoading() {
  showWaiting("Preparing local play\u2026");
  waiting.classList.add("client-runtime-loading");
}
function showWakeReady() {
  showWaiting("");
  msg.append("Press ", makeKeycap(START_KEY), " to wake Shai Hulud");
  if (matchMedia("(pointer: coarse)").matches) msg.append(" or tap to wake");
  waiting.classList.add("ready");
}
function hideWaiting() {
  waiting.classList.add("hidden");
}
function showEnd(winnerIndex, ticks, outcome, wonMatch = false) {
  setWinnerDisplay(endLabel, endWinner, winnerIndex, outcome);
  if (wonMatch) endLabel.textContent = `MATCH ${endLabel.textContent}`;
  endDetail.replaceChildren(
    wonMatch ? `${victoryScore} points. Drag the timeline to review, or press ` : `${ticks} ticks. Drag the timeline to review, or press `,
    makeKeycap(START_KEY),
    wonMatch ? " to start a new match." : " to play again."
  );
  if (matchMedia("(pointer: coarse)").matches) endDetail.append(" Tap to continue.");
  replayControls.classList.toggle("hidden", roundFrames.length === 0);
  replay.show(roundFrames);
}
function hideEnd() {
  replay.hide();
}
function clearRenderedTrails(players) {
  trailRenderer.reset();
  avatarRenderer.clearDeadHeads(players);
}
function renderReplay(index) {
  const frame = roundFrames[index];
  if (!frame) return;
  resetCanvas();
  for (let tick = 1; tick <= index; tick++) {
    const previous = roundFrames[tick - 1];
    const current = roundFrames[tick];
    if (current.trail_generation !== previous.trail_generation) {
      clearRenderedTrails(current.players);
    }
    trailRenderer.appendFrame(previous.players, current.players);
  }
  trailRenderer.draw();
  gameRender.classList.toggle("borderless", Boolean(frame.borderless));
  avatarRenderer.draw(frame.players);
  overlayRenderer.draw(frame);
  latestFrame = frame;
  trailFrame = frame;
  updatePlayerRows(frame.players);
  replayTime.textContent = `${(frame.tick / simulator.tick_hz).toFixed(1)}s \xB7 tick ${frame.tick}`;
}
replay = createReplay({
  end,
  slider: replaySlider,
  time: replayTime,
  playButton: replayPlay,
  render: renderReplay,
  tickHz: () => simulator.tick_hz
});
function inheritCachedReachable(frame) {
  const inherited = { ...frame.overlays || {} };
  Object.entries(visualSelections).forEach(([seat, selection]) => {
    if (!selection.reachable || inherited[seat]?.reachable) return;
    const reachable = lastReceivedFrame?.overlays?.[seat]?.reachable;
    if (!reachable) return;
    inherited[seat] = { ...inherited[seat] || {}, reachable };
  });
  return { ...frame, overlays: inherited };
}
function ingestFrame(f3) {
  f3 = inheritCachedReachable(f3);
  lastReceivedFrame = f3;
  latestFrameReceivedAt = performance.now();
  if (trailFrame && f3.trail_generation !== trailFrame.trail_generation) {
    clearRenderedTrails(f3.players);
  } else if (trailFrame) {
    trailRenderer.appendFrame(trailFrame.players, f3.players);
  }
  trailFrame = f3;
  frameQueue[0] = f3;
  frameQueue.length = 1;
  roundFrames.push(f3);
  startRenderLoop();
}
function renderLoop(timestamp) {
  renderFrameId = 0;
  if (!running) return;
  const frame = frameQueue.pop();
  if (frame) {
    trailRenderer.draw();
    gameRender.classList.toggle("borderless", Boolean(frame.borderless));
    previousPredictionFrame = predictionFrame;
    predictionFrame = frame;
    predictionStartedAt = latestFrameReceivedAt;
    overlayRenderer.draw(frame);
    latestFrame = frame;
    updatePlayerRows(frame.players);
  }
  if (!predictionFrame) return;
  const displayFrame = framePredictor(
    predictionFrame,
    previousPredictionFrame,
    paused ? 0 : timestamp - predictionStartedAt,
    simulator,
    currentAction,
    human
  );
  avatarRenderer.clear();
  avatarRenderer.draw(displayFrame.players);
  if (!paused) startRenderLoop();
}
function startRenderLoop() {
  if (!renderFrameId) {
    renderFrameId = requestAnimationFrame(renderLoop);
  }
}
function handleServerMessage(e9) {
  receivedServerMessage = true;
  const m3 = JSON.parse(e9.data);
  if (m3.type === "config") {
    clientGameReady = !m3.client_game;
    serverReady = false;
    if (m3.client_game) {
      if (clientGame) {
        clientGame.configure(m3.client_game);
      } else {
        clientGame = ClientGame.create(m3.client_game, handleClientGameMessage);
      }
    } else if (clientGame) {
      clientGame.close();
      clientGame = null;
    }
    framePredictor = createFramePredictor(m3.predict_frames ?? true);
    if (!desiredConfiguration) {
      seats = m3.seats;
      resetMatch();
      human = m3.human ?? seats.includes("you");
      desiredConfiguration = {
        human,
        specs: human ? seats.slice(1) : seats.slice()
      };
    }
    desiredConfigurationApplied = serverConfigurationMatchesDesired(m3.seats);
    rewindEnabled = m3.rewind ?? true;
    inspectionHelp.textContent = rewindEnabled ? "Space stops at the next boundary. Then \u2190, \u2191, \u2192, N, and R inspect one tick at a time. V refreshes reachability; C lets you click a controller target." : "Space stops at the next boundary. Then \u2190, \u2191, \u2192, and N inspect one tick at a time. V refreshes reachability; C lets you click a controller target.";
    if (m3.catalog) playerSearch.setCatalog(m3.catalog);
    simulator = { ...simulator, ...m3.simulator };
    decisionIntervalInput.value = m3.decision_interval ?? 16;
    targetGranularityInput.value = m3.target_granularity ?? 16;
    deterministicInput.checked = m3.deterministic ?? true;
    powerupCatalog = m3.simulator.powerups || {};
    powerupPresetCatalog = m3.simulator.powerup_presets || {};
    powerupSpawnTypes = new Set(m3.powerup_spawn_types ?? Object.keys(powerupCatalog));
    powerupSpawnRateInput.value = m3.powerup_spawn_rate ?? 0;
    renderPowerupConfiguration();
    visualCapabilities = m3.visuals || [];
    visualSelections = {};
    replay.hide();
    avatarRenderer = createAvatarRenderer({
      context: fg,
      colors: COLORS,
      size: renderSize,
      pixelRatio: renderPixelRatio,
      simulator: () => simulator
    });
    overlayRenderer = createOverlayRenderer({
      context: overlays,
      colors: COLORS,
      size: renderSize,
      simulator: () => simulator
    });
    trailRenderer = createTrailRenderer({
      context: bg,
      colors: COLORS,
      size: renderSize,
      simulator: () => simulator
    });
    avatarRenderer.setPlayers(seats.length);
    resetCanvas();
    setDebugTick();
    renderHud();
    setLobbyLocked(false);
    lastWinner = null;
    if (!desiredConfigurationApplied) {
      showLoadingPlayers();
      sendDesiredConfiguration();
    } else {
      showWaiting("Waiting for players...");
    }
  } else if (m3.type === "ready") {
    serverReady = true;
    if (!clientGameReady) {
      showClientRuntimeLoading();
      return;
    }
    applyReady();
  } else if (m3.type === "local_ready") {
    clientGameReady = true;
    if (serverReady) applyReady();
  } else if (m3.type === "error") {
    ready = false;
    startWhenReady = false;
    setLobbyLocked(false);
    showWaiting(m3.message || "Unable to configure players.");
  } else if (m3.type === "frame") {
    ingestFrame(m3);
  } else if (m3.type === "paused") {
    paused = true;
    setDebugTick(m3.ticks);
    hideWaiting();
  } else if (m3.type === "controller_targets") {
    controllerTargets = m3.targets;
    selectedControllerTarget = Math.floor(controllerTargets.length / 2);
    pickingControllerTarget = true;
    fg.canvas.style.cursor = "crosshair";
    overlayRenderer.setTargetChoices(controllerTargets, selectedControllerTarget);
    overlayRenderer.draw(latestFrame);
  } else if (m3.type === "resumed") {
    clearControllerTargetPicker();
    paused = false;
    setDebugTick();
    hideWaiting();
    startRenderLoop();
  } else if (m3.type === "visuals_refreshed") {
    if (!latestFrame) return;
    latestFrame = { ...latestFrame, overlays: m3.overlays || {} };
    overlayRenderer.draw(latestFrame);
  } else if (m3.type === "rewound") {
    running = true;
    paused = true;
    ready = false;
    setLobbyLocked(true);
    hideWaiting();
    hideEnd();
    const frame = m3.frame;
    roundFrames = roundFrames.filter((previous) => previous.tick <= frame.tick);
    if (!roundFrames.length || roundFrames.at(-1).tick !== frame.tick) roundFrames.push(frame);
    renderReplay(roundFrames.length - 1);
    setDebugTick(frame.tick);
  } else if (m3.type === "end") {
    running = false;
    paused = false;
    setDebugTick();
    setLobbyLocked(false);
    updatePlayerRows(m3.players || latestFrame?.players || []);
    lastWinner = m3.winner;
    scoreRound(m3.winner);
    showEnd(m3.winner, m3.ticks, m3.outcome, matchFinished);
    if (m3.seed !== void 0) endDetail.append(` Seed ${m3.seed}.`);
  }
}
function applyReady() {
  if (!desiredConfigurationApplied) return;
  ready = true;
  setLobbyLocked(false);
  if (!replay.active) {
    hideEnd();
    showReady(lastWinner);
  }
  lastWinner = null;
  if (startWhenReady) {
    startWhenReady = false;
    startRound();
  }
}
function handleClientGameMessage(message) {
  handleServerMessage({ data: JSON.stringify(message) });
}
function handleServerClose() {
  if (clientExecution) return;
  if (clientGame) return;
  ready = false;
  if (!receivedServerMessage) {
    showWaking();
    setTimeout(connectWebSocket, 1e3);
    return;
  }
  running = false;
  paused = false;
  setDebugTick();
  setLobbyLocked(false);
  showWakeReady();
}
function connectWebSocket() {
  if (clientExecution) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  receivedServerMessage = false;
  desiredConfigurationSent = false;
  desiredConfigurationApplied = false;
  ws = new WebSocket(websocketUrl);
  ws.onmessage = handleServerMessage;
  ws.onclose = handleServerClose;
}
function connectTransport() {
  if (clientExecution) sendDesiredConfiguration();
  else connectWebSocket();
}
var held = /* @__PURE__ */ new Set();
var touchDirections = /* @__PURE__ */ new Map();
var touchGestures = /* @__PURE__ */ new Map();
function sendAction() {
  const l5 = held.has("ArrowLeft") || [...touchDirections.values()].includes("left");
  const r8 = held.has("ArrowRight") || [...touchDirections.values()].includes("right");
  currentAction = held.has("ArrowUp") || l5 && r8 ? 1 : l5 ? 2 : r8 ? 0 : 1;
  if (clientGame) clientGame.input(currentAction);
  else sendServer({ type: "input", action: currentAction });
}
function startRound() {
  if (!ready || running) return;
  if (matchFinished) resetMatch();
  running = true;
  paused = false;
  setDebugTick();
  setLobbyLocked(true);
  ready = false;
  lastWinner = null;
  roundScored = false;
  roundFrames = [];
  replay.hide();
  resetCanvas();
  hideWaiting();
  hideEnd();
  startRenderLoop();
  if (clientGame) clientGame.start();
  else sendServer({ type: "start" });
}
function wakeAndStart() {
  resetCanvas();
  startWhenReady = true;
  if (clientExecution) showLoadingPlayers();
  else showWaking();
  connectTransport();
}
fg.canvas.addEventListener("click", (event) => {
  if (!pickingControllerTarget || !paused || !human) return;
  const selected = controllerTargets[selectedControllerTarget];
  if (!selected) return;
  const [x2, y3] = selected;
  clearControllerTargetPicker();
  sendServer({ type: "controller_target", x: x2, y: y3 });
  event.preventDefault();
});
fg.canvas.addEventListener("mousemove", (event) => {
  if (!pickingControllerTarget || !controllerTargets.length) return;
  const nearest = nearestControllerTarget(event);
  if (nearest === selectedControllerTarget) return;
  selectedControllerTarget = nearest;
  overlayRenderer.setTargetChoices(controllerTargets, selectedControllerTarget);
  overlayRenderer.draw(latestFrame);
});
playerSearch = createPlayerSearch({
  input: playerSearchInput,
  options: playerOptions,
  locked: () => running,
  onSelect: addSeat,
  initialCatalog,
  playersUrl: initialCatalog.length ? null : new URL("/players", serverUrl)
});
renderHud();
function sendGameSettings() {
  const decisionInterval = Math.max(1, Math.min(1e4, Number.parseInt(decisionIntervalInput.value, 10) || 16));
  const targetGranularity = Math.max(1, Math.min(256, Number.parseInt(targetGranularityInput.value, 10) || 16));
  decisionIntervalInput.value = decisionInterval;
  targetGranularityInput.value = targetGranularity;
  const powerupSpawnRate = Math.max(-1, Math.min(1, Number.parseFloat(powerupSpawnRateInput.value) || 0));
  powerupSpawnRateInput.value = powerupSpawnRate;
  const powerupTypes = selectedPowerupTypes();
  if (clientGame) {
    clientGame.configurePowerupSpawns(powerupTypes, powerupSpawnRate);
  }
  sendServer({
    type: "settings",
    decision_interval: decisionInterval,
    target_granularity: targetGranularity,
    deterministic: deterministicInput.checked,
    powerup_spawn_types: powerupTypes,
    powerup_spawn_rate: powerupSpawnRate
  });
}
decisionIntervalInput.addEventListener("sl-change", sendGameSettings);
targetGranularityInput.addEventListener("sl-change", sendGameSettings);
deterministicInput.addEventListener("sl-change", sendGameSettings);
powerupSpawnRateInput.addEventListener("sl-change", sendGameSettings);
victoryScoreInput.addEventListener("sl-change", () => {
  victoryScore = Math.max(1, Math.min(100, Number.parseInt(victoryScoreInput.value, 10) || 10));
  victoryScoreInput.value = victoryScore;
  resetMatch();
});
function eventTargetsControl(event) {
  return event.composedPath().some((target) => target instanceof Element && target.matches("input, textarea, select, a, button, [contenteditable], sl-input, sl-range, sl-checkbox, sl-dropdown, sl-button"));
}
function eventTargetsScrollbar(event) {
  return event.composedPath().some((target) => {
    if (!(target instanceof Element)) return false;
    const bounds = target.getBoundingClientRect();
    return target.scrollHeight > target.clientHeight && event.clientX >= bounds.left + target.clientWidth || target.scrollWidth > target.clientWidth && event.clientY >= bounds.top + target.clientHeight;
  });
}
function requestStart() {
  if (running || startWhenReady) return;
  hideEnd();
  if (ready) startRound();
  else wakeAndStart();
}
addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || eventTargetsControl(event) || eventTargetsScrollbar(event)) return;
  touchGestures.set(event.pointerId, { x: event.clientX, y: event.clientY, steering: running });
  if (!running || paused || !human) return;
  touchDirections.set(event.pointerId, event.clientX < innerWidth / 2 ? "left" : "right");
  sendAction();
});
addEventListener("pointermove", (event) => {
  if (!touchDirections.has(event.pointerId)) return;
  const direction = event.clientX < innerWidth / 2 ? "left" : "right";
  if (touchDirections.get(event.pointerId) === direction) return;
  touchDirections.set(event.pointerId, direction);
  sendAction();
});
function endTouch(event) {
  const gesture = touchGestures.get(event.pointerId);
  touchGestures.delete(event.pointerId);
  if (touchDirections.delete(event.pointerId)) sendAction();
  if (event.type === "pointercancel" || !gesture || gesture.steering) return;
  if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12) return;
  requestStart();
}
addEventListener("pointerup", endTouch);
addEventListener("pointercancel", endTouch);
addEventListener("blur", () => {
  if (!held.size && !touchDirections.size) return;
  held.clear();
  touchDirections.clear();
  touchGestures.clear();
  sendAction();
});
gameRender.style.touchAction = "none";
waiting.style.touchAction = "none";
end.style.touchAction = "none";
gameArea.style.userSelect = "none";
gameArea.style.webkitUserSelect = "none";
gameArea.style.webkitTouchCallout = "none";
gameArea.addEventListener("contextmenu", (event) => {
  if (event.pointerType === "touch" || matchMedia("(pointer: coarse)").matches) event.preventDefault();
});
function isHeldReplayCommand(event) {
  return replay.active && event.repeat && REPLAY_KEYS.has(event.key.toLowerCase());
}
addEventListener("keydown", (e9) => {
  if (eventTargetsControl(e9)) return;
  if (isHeldReplayCommand(e9)) {
    e9.preventDefault();
    return;
  }
  if (e9.key.toLowerCase() === START_KEY && !running) {
    hideEnd();
    if (ready) startRound();
    else wakeAndStart();
    e9.preventDefault();
  }
  if (e9.key === " ") {
    if (pickingControllerTarget) {
      clearControllerTargetPicker();
      e9.preventDefault();
      return;
    }
    if (replay.active) replay.toggle();
    else if (running) sendServer({ type: paused ? "continue" : "break" });
    e9.preventDefault();
    return;
  }
  if (replay.active && (e9.key === "ArrowLeft" || e9.key === "ArrowRight")) {
    replay.step(e9.key === "ArrowLeft" ? -1 : 1);
    e9.preventDefault();
    return;
  }
  if (e9.key.toLowerCase() === "r" && rewindEnabled && replay.active && !running) {
    running = true;
    ready = false;
    sendServer({ type: "rewind" });
    e9.preventDefault();
    return;
  }
  if (running && paused) {
    if (e9.key.toLowerCase() === "v" && !e9.repeat) {
      sendServer({ type: "refresh_visuals" });
      e9.preventDefault();
      return;
    }
    if (e9.key.toLowerCase() === "c" && human && !e9.repeat) {
      sendServer({ type: "controller_targets" });
      e9.preventDefault();
      return;
    }
    const action = { ArrowLeft: 2, ArrowUp: 1, ArrowRight: 0 }[e9.key];
    if (action !== void 0) {
      sendServer({ type: "step", action });
      e9.preventDefault();
      return;
    }
    if (e9.key.toLowerCase() === "n" && !e9.repeat) {
      sendServer({ type: "next" });
      e9.preventDefault();
      return;
    }
    if (e9.key.toLowerCase() === "r" && rewindEnabled) {
      sendServer({ type: "rewind" });
      e9.preventDefault();
      return;
    }
  }
  if (e9.key === "ArrowLeft" || e9.key === "ArrowUp" || e9.key === "ArrowRight") {
    if (!held.has(e9.key)) {
      held.add(e9.key);
      sendAction();
    }
    e9.preventDefault();
  }
});
addEventListener("keyup", (e9) => {
  if (held.delete(e9.key)) sendAction();
});
addEventListener("resize", resizeCanvases);
resizeCanvases();
if (configuredServer && !clientExecution) showWaking();
connectTransport();
resetCanvas();
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
@lit/reactive-element/decorators/custom-element.js:
@lit/reactive-element/decorators/property.js:
@lit/reactive-element/decorators/state.js:
@lit/reactive-element/decorators/event-options.js:
@lit/reactive-element/decorators/base.js:
@lit/reactive-element/decorators/query.js:
@lit/reactive-element/decorators/query-all.js:
@lit/reactive-element/decorators/query-async.js:
@lit/reactive-element/decorators/query-assigned-nodes.js:
lit-html/directive.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/decorators/query-assigned-elements.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directives/class-map.js:
lit-html/directives/if-defined.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directive-helpers.js:
lit-html/directives/live.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/

// Rewrites the play-bootstrap / play-catalog blocks of docs/index.html so the
// site serves the bot alongside the RL checkpoint, with all assets local.
//   node scripts/site-config.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "docs/index.html");
let html = fs.readFileSync(file, "utf8");

const bootMatch = /<script id="play-bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
const boot = JSON.parse(bootMatch[1]);
const base = Object.values(boot.games).find((g) => g.seats.length === 2 && g.seats.every((s) => s === "model")) ?? Object.values(boot.games)[0];

const MODEL_ACTOR = structuredClone(base.client_game.actors[0]);
MODEL_ACTOR.model.url = "../vendor/model/model.ort";
const BOT_ACTOR = { bot: {}, decision_window: 1 };
const PER_TICK = { code: 0, granularity: 1, window: 1 };
const MODEL_SCHEME = structuredClone(base.simulator.action_schemes[0]);

function gameFor(human, specs) {
  const g = structuredClone(base);
  const seats = human ? ["you", ...specs] : [...specs];
  g.human = human;
  g.seats = seats;
  g.simulator.n_players = seats.length;
  g.simulator.action_schemes = seats.map((s) => (s === "model" ? MODEL_SCHEME : PER_TICK));
  g.visuals = seats.map(() => ({ lidar: false, reachable: false, value: false }));
  const cg = g.client_game;
  cg.human_seat = human ? 0 : null;
  cg.actors = seats.map((s) => (s === "you" ? null : s === "model" ? structuredClone(MODEL_ACTOR) : structuredClone(BOT_ACTOR)));
  cg.python = { url: "../vendor/micropython/micropython.mjs", wasm_url: "../vendor/micropython/micropython.wasm" };
  cg.schedule_url = "../runtime/game_schedule.py";
  cg.game_url = "../runtime/browser_game.py";
  cg.worker_url = "./play-client-worker.js";
  cg.simulator.url = "../vendor/simulator/simulator.mjs";
  cg.simulator.graph_url = "../vendor/simulator/simulator.wrp";
  cg.simulator.config = g.simulator;
  cg.onnxruntime = { runtime_url: "../vendor/onnxruntime/ort.wasm.min.mjs", wasm_url: "../vendor/onnxruntime/" };
  return g;
}

const games = {};
for (const [human, specs] of [
  [false, ["bot", "model"]],
  [false, ["model", "bot"]],
  [false, ["model", "model"]],
  [false, ["bot", "bot"]],
  [true, ["bot"]],
  [true, ["model"]],
]) {
  games[JSON.stringify([human, ...specs])] = gameFor(human, specs);
}
const newBoot = { execution: "client", human: false, specs: ["bot", "model"], games };
html = html.replace(bootMatch[0], `<script id="play-bootstrap" type="application/json">${JSON.stringify(newBoot)}</script>`);

const catalog = [
  { spec: "you", label: "You", kind: "human" },
  { spec: "bot", label: "Curvycook", kind: "bot" },
  { spec: "model", label: "Shai Hulud", kind: "checkpoint" },
];
html = html.replace(/<script id="play-catalog" type="application\/json">[\s\S]*?<\/script>/, `<script id="play-catalog" type="application/json">${JSON.stringify(catalog)}</script>`);
fs.writeFileSync(file, html);
console.log(`wrote ${Object.keys(games).length} game configurations and ${catalog.length} catalog entries to docs/index.html`);

# curvycook

A geometric search bot for [Curvytron](https://www.curvytron.com/) that plays
against the reinforcement-learning checkpoint from
[cyrilsharma.github.io/curvytron-rl](https://cyrilsharma.github.io/curvytron-rl/),
plus a self-contained copy of that site so both can be watched (or played
against) on GitHub Pages.

The original site's source repository is private; everything here was rebuilt
from the published site: its HTML/JS/CSS, the Python game loop it runs in
MicroPython, the Warp-compiled simulator (`simulator.wasm` + `simulator.wrp`),
the ONNX runtime and the 30 MB checkpoint. All of it is vendored under
`docs/vendor/` so the page has no external dependencies.

## Layout

```
docs/                  the website (GitHub Pages serves this folder)
  index.html           UI + exported game configurations (see scripts/site-config.mjs)
  static/play.js       original front end (one-line patch: label non-checkpoint players)
  static/play-client-worker.js   original worker, extended to host bot actors
  static/bot.js        the bot, bundled from src/ by `npm run build`
  runtime/*.py         original MicroPython game loop (skips feature extraction for bots)
  vendor/              simulator, MicroPython, onnxruntime-web, model.ort
src/engine/game.ts     TypeScript re-implementation of the simulator's rules
src/engine/validate.ts replays random games in both and checks they agree tick for tick
src/bot/               the bot: territory grids + search
src/harness/           Node harness: real simulator + ONNX checkpoint + bot
src/web/bot-policy.ts  browser entry point (worker policy adapter)
scripts/               build, site config, match analysis, browser end-to-end test
```

## How the game works (measured, not guessed)

Everything below was measured against the real simulator and is enforced by
`npm test`, which replays hundreds of random games in both the Warp simulator
and the TypeScript engine and requires identical deaths, bodies and outcomes.

| Quantity | Value |
| --- | --- |
| Arena | 88 × 88 units, y up |
| Tick rate | 60 Hz, round ends at 3600 ticks (tie) |
| Speed | 16 units/s = 0.2667 units/tick |
| Turn rate | 2.8 rad/s = 0.0467 rad/tick, i.e. a 5.71-unit turning radius |
| Head | disc of radius 0.6; dies when its centre is within 0.6 of an edge |
| Trail | a body disc (radius 0.6) is laid every time the head is ≥ 0.6 from the last one (0.8 apart at normal speed) |
| Collision | head centre within 1.2 of any body, except the player's own bodies laid in the last 4 ticks |
| Warmup | no trail during the first 180 ticks |
| Holes | printing runs of ~70–220 ticks separated by 16–25 tick gaps (random, seeded) |
| Order within a tick | turn, move, collision check, then lay a body (a dying player leaves none) |

The checkpoint does not steer tick by tick. Every 16 ticks it picks one of 33
targets and a built-in controller turns that into a 16-tick turn sequence;
the controller only avoids collisions inside that window. A human (and the
bot) steer every tick with left / straight / right.

## What the checkpoint does

Playing the checkpoint against itself (`npm run match -- --p0=model --p1=model`)
shows a consistent style: both players rush to the centre during the warmup,
then separate and each fills its own half with concentric laps along the
walls, heads typically 50 units apart. It almost never contests the opponent
and dies after ~2000 ticks on average by trapping itself; about a third of its
games against itself are ties at 3600 ticks.

So the game against it is a partition game: claim the larger region when the
trails separate, never trap yourself, and fill your region more tightly than
it fills its own.

## How the bot plays

Every 4 ticks (`src/bot/bot.ts`):

1. It syncs a private copy of the engine with the observed world.
2. For each first manoeuvre (hold left / straight / right until the next
   8-tick boundary) it runs a small minimax: the checkpoint commits to one
   manoeuvre per 16-tick window, so the opponent's three options are each held
   over the bot's two segments. The worst case is blended with the likely case
   (the opponent keeps its current turn).
3. Positions are scored by territory on a "fat" 2-unit grid (cells reached
   strictly first, with trails inflated so corridors too narrow to turn in do
   not count) and by the free area left on a fine 1-unit grid (so it hugs
   walls instead of wasting space).
4. Each first manoeuvre must also pass an escape search: a depth-first
   search over the bot's own manoeuvres, memoised by position and heading,
   that must find a 640-tick collision-free continuation ending in open
   space. For its first 160 ticks the continuation may only use space the
   bot reaches at least 16 ticks before the opponent could (space within 32
   ticks of the opponent is held to the same rule along the whole path): a
   cut-off is nothing more than the opponent getting somewhere on the bot's
   path first, so a path it could seal is not an escape. Moves without an
   escape are heavily penalised.
   In these rollouts the opponent follows a projection computed at plan time
   the way the checkpoint actually drives: straight until a wall or trail is
   ahead, then turning along it. A lap along a wall that would seal the bot
   into a pocket therefore shows up in the search instead of being missed
   because the opponent was assumed to stop at the first wall.

It is deterministic, takes 25–40 ms per plan in Node (up to ~200 ms in the
worst positions), and runs in real time in the browser worker.

Every weight above is a `BotOptions` field, so variants can be measured
without code changes (`--bot-opts='{"proximityRange":18}'`).

## Results

All numbers come from `npm run match` in the real simulator with the real
checkpoint, both seat orders per seed, deterministic (greedy) checkpoint play.

| Configuration | Seeds 0–15 (32 games) | Seeds 16–31 (32 games) | Overall |
| --- | --- | --- | --- |
| distance keeping range 14 / weight 300, opponent assumed straight | 26–6 | 15–17 | 41–23, 64% |
| range 18 / weight 200, opponent assumed straight | 22–10 | 20–12 | 42–22, 66% |
| range 18 / weight 200, opponent projected along walls (first release) | 21–11–1 | 20–11–2 | 41–22–3, 64% |
| **shipped**: no distance keeping, reach rule over the first 160 ticks, 16-tick margin | 25–7 | 19–12–1 | 44–19–1, 69% |
| same with an 8-tick margin | 23–9 | 21–11 | 44–20, 69% |
| same with a 24-tick margin | 18–14 | – | – |
| no distance keeping, no reach rule | 19–13 | – | – |

The two seed batches differ by 10–30 points for every configuration tried,
so differences of less than ~10 points between configurations are noise at
this sample size.

### Against a hunter

A human beat the first release 10–0 by doing what the checkpoint never does:
following the bot, running parallel to it on the inside and turning in ahead
of it. The harness reproduces this with the `hunter` player, the bot with a
hunting evaluation (it closes in on the point some distance ahead of its
opponent's head instead of playing territory). Seeds 0–7, both seat orders:

| Bot | vs hunter (aims 24 ahead) | vs hunter (12 ahead) | vs chaser (0 ahead) |
| --- | --- | --- | --- |
| first release (distance keeping) | 0–15–1 | 3–13 | 6–9–1 |
| **shipped** | 9–7 (and 7–9 on seeds 8–15) | 9–7 | 13–3 |

Distance keeping was the problem: fleeing a same-speed opponent means running
straight into a wall and then along it with the hunter parallel on the
inside; once it turns in ahead, the strip is a dead end and the bot dies at
the wall within 300–400 ticks. The reach rule alone could not fix that (2–14
even when applied over the full 640 ticks), because by the time the bot is
in the strip it is already lost: the losing decision is the flight itself.
Without distance keeping the bot stays in the open and keeps the opponent
from getting ahead of it on the inside, and the games become space races it
wins about as often as it loses against the hunter, and mostly against the
checkpoint.

The hunting evaluation itself is not a better style for the bot: a hunter
beats the checkpoint 21–11 (as often as the bot does) and the first release
15–0, but hunters cut each other off within a few hundred ticks, and with
the reach rule added it only scores 16–16 against the checkpoint.

Where the bot still loses (from the recorded games, `scripts/doomed.mjs` and
`scripts/debug/partition.mts`):

- Space races: both players end up in separate regions and the bot's region
  is the smaller or less efficiently filled one, so it runs out of room first
  (it dies on its own trail after 1500–3000 ticks). This is now nearly the
  only way it loses to the checkpoint (15 of the 19 losses above) and the
  usual way it loses to a hunter.
- Close encounters: an opponent crossing the bot's path 10–15 units ahead
  and then turning towards it can still close the gap faster than the
  16-tick lookahead sees (3 of the 19 losses above ended on the checkpoint's
  trail).

Variants that were measured and did not help (seeds 0–15 unless noted):
straightness bonus (16–16), lane-following escape order with wall hugging
(16–15–1), longer opponent-reach horizon (16–16), a dedicated fill mode that
follows the escape search's own path once separated (11–21), momentum
evaluation (14–18), bolder territory claims (abandoned at 0–5), distance
keeping at a tenth of the weight (3–12–1 against the hunter) and the reach
rule over the full 640 ticks (8–8 against the hunter, no better than 160
ticks and far more pessimistic in the opening).

## Commands

```
npm install --onnxruntime-node-install-cuda=skip
npm test                       # engine vs simulator agreement (random games)
npm run match -- --games=10    # bot vs checkpoint, both seat orders, in the real simulator
npm run match -- --p0=model --p1=model --games=16 --record=/tmp/mvm
npm run match -- --p1=hunter --seeds=0,1,2,3,4,5,6,7 --swap --hunter-opts='{"huntAhead":12}'   # against the hunting opponent
node scripts/analyze.mjs /tmp/mvm           # behaviour profile of recorded games
node scripts/render.mjs /tmp/mvm/*.json     # PNG of each recorded game
node scripts/doomed.mjs /tmp/rec            # when did the bot's evaluation collapse
npm run build                  # bundle the bot into docs/static/bot.js
node scripts/site-config.mjs   # regenerate the game configurations in docs/index.html
node scripts/e2e.mjs --rounds=2            # play rounds in headless Chromium against docs/
```

## GitHub Pages

The `pages` workflow (`.github/workflows/pages.yml`) builds the bot bundle,
type-checks, and deploys `docs/` on every push to `main` or
`kathir/curvycook-bot`, and on manual dispatch. One-time setup by a repository
admin: Settings → Pages → Build and deployment → Source: "GitHub Actions"
(the workflow token is not allowed to create the Pages site itself); then
re-run the workflow. If the `github-pages` environment only allows the default branch, add the
branch under Settings → Environments → github-pages → Deployment branches,
or merge to `main`.

Without Actions the site also works as a plain branch deployment: Pages →
Source "Deploy from a branch", folder `/docs` (the built bundle is committed).

The page opens on Curvycook (the bot) vs Shai Hulud (the checkpoint). Use the
player search to add "You" to play either of them with the arrow keys.

Every round's end screen shows its seed, and `?seed=N` in the URL starts the
first round from seed N (later rounds use N+1, N+2, ...). The browser and the
Node harness play identical games for the same seed, so a round that looks
wrong can be reproduced and inspected with
`npm run match -- --seeds=N --p0=bot --p1=model --record=/tmp/r` followed by
`node scripts/render.mjs /tmp/r/*.json`, `node scripts/doomed.mjs /tmp/r` and
`npx tsx scripts/debug/replay.mts /tmp/r/seedN-bot-vs-model.json TICK --map`.

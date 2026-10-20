// Bundles the TypeScript bot for the browser worker: docs/static/bot.js
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "src/web/bot-policy.ts")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: path.join(root, "docs/static/bot.js"),
  minify: false,
  sourcemap: false,
  banner: { js: "// Built from src/ by `npm run build`. Do not edit by hand." },
  logLevel: "info",
});

// Bundles the desktop app into dist/: renderer (React, CSS, assets), Electron main and the sandboxed preload.
// Usage: node scripts/build.mjs [--watch] [--dev]
import { build, context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

const common = {
  absWorkingDir: root,
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
};

const copyIndexHtml = {
  name: "copy-index-html",
  setup(pluginBuild) {
    pluginBuild.onEnd(async (result) => {
      if (result.errors.length === 0) await copyFile(resolve(root, "apps/renderer/src/index.html"), resolve(dist, "renderer/index.html"));
    });
  },
};

const targets = [
  {
    ...common,
    entryPoints: { app: "apps/renderer/src/main.tsx" },
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
    target: "chrome140",
    jsx: "automatic",
    minify: !dev,
    define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
    loader: { ".png": "file", ".svg": "file", ".woff2": "file" },
    assetNames: "assets/[name]-[hash]",
    plugins: [copyIndexHtml],
  },
  {
    ...common,
    entryPoints: ["apps/desktop/src/main.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  },
  {
    // A sandboxed preload cannot require other files, so it must be one CommonJS bundle.
    ...common,
    entryPoints: ["apps/desktop/src/preload.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  },
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "renderer"), { recursive: true });

if (watch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("watching for changes (Ctrl+C to stop)");
} else {
  await Promise.all(targets.map((options) => build(options)));
}

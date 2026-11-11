// Launches the built app with Electron for development. All profile data stays inside the workspace.
// Usage: node scripts/run.mjs [extra electron/app arguments]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = resolve(root, "dist/main.cjs");
if (!existsSync(main)) {
  console.error("dist/main.cjs is missing. Run `npm run build` first.");
  process.exit(1);
}

const env = { ...process.env };
env.FACE_USER_DATA ??= resolve(root, ".runtime/user-data");
env.TMPDIR ??= resolve(root, ".cache/tmp");
mkdirSync(env.FACE_USER_DATA, { recursive: true });
mkdirSync(env.TMPDIR, { recursive: true });

// The electron package's CommonJS entry exports the path of the downloaded binary.
const electronBinary = createRequire(import.meta.url)("electron");
const child = spawn(electronBinary, [main, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

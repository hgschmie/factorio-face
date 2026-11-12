// Launches the built app with Electron for development. All profile data stays inside the workspace.
// Usage: node scripts/run.mjs [extra electron/app arguments]
import { execFileSync, spawn } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "../apps/desktop/src/ipc.ts";

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

const require = createRequire(import.meta.url);

/**
 * macOS takes the name in the menu bar and in the Dock from the Info.plist of the running bundle, and the downloaded one says
 * "Electron"; `app.setName` cannot change that. Development therefore runs a copy of the bundle that carries the app's name. The
 * copy lives in .cache (a clone on APFS, so it takes no space) and is made again when the Electron version or the name changes.
 */
function namedMacBinary(binary) {
  const bundle = resolve(binary, "../../..");
  const directory = resolve(root, ".cache/dev-app");
  const copy = resolve(directory, `${APP_NAME}.app`);
  const copiedBinary = resolve(copy, relative(bundle, binary));
  const stampFile = resolve(directory, "stamp");
  const stamp = `${require("electron/package.json").version} ${APP_NAME}`;
  if (existsSync(copiedBinary) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return copiedBinary;

  console.log(`Preparing ${relative(root, copy)} (once per Electron version)...`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  cpSync(bundle, copy, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  const plist = resolve(copy, "Contents/Info.plist");
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) execFileSync("/usr/bin/plutil", ["-replace", key, "-string", APP_NAME, plist]);
  // The signature covers Info.plist. Sign the changed bundle again, ad hoc as the download is, so that it stays valid.
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", copy], { stdio: ["ignore", "ignore", "inherit"] });
  writeFileSync(stampFile, stamp);
  return copiedBinary;
}

// The electron package's CommonJS entry exports the path of the downloaded binary.
let electronBinary = require("electron");
if (process.platform === "darwin") {
  try {
    electronBinary = namedMacBinary(electronBinary);
  } catch (error) {
    console.warn(`Could not prepare the named app bundle, the menu bar will say "Electron": ${error instanceof Error ? error.message : error}`);
  }
}
const child = spawn(electronBinary, [main, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

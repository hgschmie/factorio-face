// Starts every run from clean test profiles and project directories, and verifies that the app was built.
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { GAMES_DIR, MAIN_SCRIPT, PROJECTS_DIR, SCREENSHOT_DIR, USER_DATA_DIR } from "./app.ts";

export default async function globalSetup(): Promise<void> {
  if (!existsSync(MAIN_SCRIPT)) throw new Error(`${MAIN_SCRIPT} is missing. Run "npm run build" before the end-to-end tests.`);
  await rm(USER_DATA_DIR, { recursive: true, force: true });
  await rm(PROJECTS_DIR, { recursive: true, force: true });
  await rm(GAMES_DIR, { recursive: true, force: true });
  await Promise.all([USER_DATA_DIR, PROJECTS_DIR, GAMES_DIR, SCREENSHOT_DIR].map((directory) => mkdir(directory, { recursive: true })));
}

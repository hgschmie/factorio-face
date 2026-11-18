// Electron main process: one sandboxed window, a validated IPC surface, the native menu and the close handshake.
import { loadStandardIconTable } from "@face/catalog/icons/standard";
import { app, BrowserWindow, ipcMain, Menu, session, systemPreferences } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { APP_SETTINGS_FILE_NAME, AppSettingsStore, gameDirectoryFromEnv } from "./appSettings.ts";
import { registerAppSettingsIpc } from "./appSettingsIpc.ts";
import { registerBlueprintIpc } from "./blueprintIpc.ts";
import { buildTextContextMenu } from "./contextMenu.ts";
import { Examples } from "./examples.ts";
import { GAME_DATA_FILE_NAME, GameDataCache } from "./gameData/cache.ts";
import { modDirectoryFromEnv, userDataLocation } from "./gameData/refresh.ts";
import { GAME_DATA_RUNS_DIRECTORY, GameDataService, usableGameData } from "./gameData/service.ts";
import { confirmGameRead, registerGameDataIpc } from "./gameDataIpc.ts";
import { GameIcons } from "./gameIcons/gameIcons.ts";
import { GameSettings } from "./gameSettings.ts";
import { APP_ID, APP_NAME, CHANNELS, type MenuCommand } from "./ipc.ts";
import { createIpcHandle } from "./ipcHandle.ts";
import { buildMenuTemplate } from "./menu.ts";
import { profilePathsFromEnv, projectsDirectoryFromEnv, resolveAssetRoot, resolveExamplesDirectory } from "./paths.ts";
import { askUnsavedChanges, registerProjectIpc } from "./projectIpc.ts";
import { handleSchemes, registerSchemes, RENDERER_URL } from "./protocols.ts";
import { RecentProjects } from "./recentProjects.ts";
import { hardenSession, hardenWebContents } from "./security.ts";
// The scenario the game runs for its finished prototypes: text, bundled into this script.
import scenarioSource from "../../../tools/catalog/runtime-dump/control.lua";
// For the version of this application: `app.getVersion()` is Electron's own while the app is not packaged.
import packageInfo from "../../../package.json" with { type: "json" };

/** Problems with icons of one installation that are written to the log; a missing module alone accounts for hundreds. */
const LOGGED_ICON_PROBLEMS = 20;

// Matches --surface-window in apps/renderer/src/styles/tokens.css, so the window does not flash on launch.
const WINDOW_BACKGROUND = "#313031";

// Everything in this block must happen before `ready`: Electron resolves its profile directories on first use.
app.setName(APP_NAME);
const profile = profilePathsFromEnv(process.env);
if (profile) {
  for (const [name, path] of Object.entries(profile)) {
    mkdirSync(path, { recursive: true });
    app.setPath(name as keyof typeof profile, path);
  }
}
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
// Registered defaults live in memory only. With them AppKit neither restores nor keeps window state under
// ~/Library/Saved Application State (checked on macOS 27 with Electron 44: no savedState directory is left behind).
if (process.platform === "darwin") systemPreferences.registerDefaults({ ApplePersistenceIgnoreState: true, NSQuitAlwaysKeepsWindows: false });
registerSchemes();
hardenWebContents();

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";
  return new BrowserWindow({
    title: APP_NAME,
    width: 1510,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 23 } } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
}

/** Asks the renderer to save and resolves with its answer; false when the renderer goes away first. */
function requestSaveBeforeClose(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (saved: boolean): void => {
      ipcMain.removeListener(CHANNELS.saveBeforeCloseResult, onResult);
      window.webContents.removeListener("render-process-gone", onGone);
      resolve(saved);
    };
    const onResult = (event: Electron.IpcMainEvent, saved: unknown): void => {
      if (event.sender === window.webContents) finish(saved === true);
    };
    const onGone = (): void => finish(false);
    ipcMain.on(CHANNELS.saveBeforeCloseResult, onResult);
    window.webContents.once("render-process-gone", onGone);
    window.webContents.send(CHANNELS.saveBeforeClose);
  });
}

async function start(): Promise<void> {
  hardenSession(session.defaultSession);
  // Fails the start for a malformed value, like the other path variables, instead of leaving the app without its icons.
  gameDirectoryFromEnv(process.env);
  modDirectoryFromEnv(process.env);

  const window = createWindow();
  const userData = app.getPath("userData");
  const host = { platform: process.platform, env: process.env, home: app.getPath("home") };

  // The entity and signal data: what was read from the user's game earlier, when there is such a file and it can be used,
  // else the data that comes with the build. Reading the file starts nothing and is done before the window loads.
  const standardIcons = loadStandardIconTable();
  const gameDataCache = new GameDataCache(join(userData, GAME_DATA_FILE_NAME));
  const cached = usableGameData(await gameDataCache.load());
  if (cached.status === "damaged") console.warn(`[face] ${cached.message}`);

  // The icons come from the user's installation of the game. The search for it starts here and holds nothing up: the
  // window loads meanwhile, and the first icon requests wait for the answer.
  const iconTable = cached.status === "ok" ? cached.iconTable : standardIcons;
  let iconProblems = 0;
  const gameIcons = new GameIcons(iconTable, {
    onProblem: (id, error) => {
      if (++iconProblems > LOGGED_ICON_PROBLEMS) return;
      console.warn(`[face] icon ${id}: ${error instanceof Error ? error.message : String(error)}${iconProblems === LOGGED_ICON_PROBLEMS ? " (further problems are not logged)" : ""}`);
    },
    // Icons of mods come from the user's mod directory as it is when an icon is asked for; looking it up starts nothing.
    modDirectory: async (dataDirectory) => (await userDataLocation(dataDirectory, host))?.modDirectory,
  }, cached.status === "ok" ? cached.data.mods : []);
  const appSettings = new AppSettingsStore(join(userData, APP_SETTINGS_FILE_NAME));
  const gameSettings = new GameSettings({
    store: appSettings,
    icons: {
      reset: (dataDirectory) => {
        iconProblems = 0;
        gameIcons.reset(dataDirectory);
      },
    },
    host,
    catalogVersion: iconTable.game.version,
    onChange: (state) => {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.appSettingsChanged, state);
    },
  });
  const gameData = new GameDataService({
    cache: gameDataCache,
    cached,
    builtInIcons: standardIcons,
    installation: () => gameSettings.installation(),
    host,
    confirm: (confirmation) => confirmGameRead(window, confirmation),
    run: { runsDirectory: join(userData, GAME_DATA_RUNS_DIRECTORY), scenarioSource, generator: `${APP_NAME} ${packageInfo.version}` },
    onRun: (run) => {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.gameDataRunChanged, run);
    },
    onActivate: (data) => {
      iconProblems = 0;
      gameIcons.setTable(data?.iconTable ?? standardIcons, data?.mods);
      void gameSettings.setCatalogVersion(data?.version ?? standardIcons.game.version).catch((error: unknown) => console.error("[face] switching the game data failed:", error));
    },
  });
  // Other data is applied by loading the window again: the page asks for its data before it reads a circuit.
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) gameData.activate();
  });
  // A game that is being read is stopped before the app quits, and its folder removed.
  let stopped = false;
  app.on("before-quit", (event) => {
    if (stopped || !gameData.busy) return;
    event.preventDefault();
    void gameData.shutdown().finally(() => {
      stopped = true;
      app.quit();
    });
  });

  const locations = { env: process.env, packaged: app.isPackaged, mainDirectory: __dirname, resourcesPath: process.resourcesPath };
  handleSchemes(join(__dirname, "renderer"), resolveAssetRoot(locations), {
    ready: () => gameSettings.ready(),
    covers: (id) => gameIcons.covers(id),
    ofMod: (id) => gameIcons.ofMod(id),
    icon: (id) => gameIcons.icon(id),
  });

  const recentProjects = new RecentProjects(join(userData, "recent-projects.json"));
  const examples = new Examples(resolveExamplesDirectory(locations), (file, error) => console.warn(`[face] example ${file}: ${error instanceof Error ? error.message : String(error)}`));
  const sendCommand = (command: MenuCommand): void => {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.menuCommand, command);
  };

  const installMenu = async (): Promise<void> => {
    const template = buildMenuTemplate({
      platform: process.platform,
      developerTools: !app.isPackaged,
      recentProjects: await recentProjects.list(),
      examples: await examples.list(),
      send: sendCommand,
      clearRecentProjects: () => void recentProjects.clear().then(installMenu),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  await installMenu();

  const handle = createIpcHandle(window);
  const projectsDirectory = projectsDirectoryFromEnv(process.env);
  registerAppSettingsIpc(window, handle, gameSettings, appSettings);
  registerGameDataIpc(window, handle, gameData);
  registerBlueprintIpc(handle, { window, projectsDirectory });
  registerProjectIpc(handle, {
    window,
    recentProjects,
    examples,
    projectsDirectory,
    onRecentProjectsChanged: () => void installMenu(),
    onProjectPathChanged: (path) => {
      if (process.platform === "darwin" && !window.isDestroyed()) window.setRepresentedFilename(path ?? "");
    },
  });

  // Dirty-state handshake: the renderer reports unsaved changes; closing then asks Save / Discard / Cancel.
  let dirty = false;
  let closeApproved = false;
  let closePromptOpen = false;
  ipcMain.on(CHANNELS.setDirty, (event, value: unknown) => {
    if (event.sender !== window.webContents || typeof value !== "boolean") return;
    dirty = value;
    window.setDocumentEdited(dirty);
  });

  const confirmClose = async (): Promise<void> => {
    if (closePromptOpen) return;
    closePromptOpen = true;
    // Only the prompt is guarded: if the renderer never answers a save request, closing again offers Discard.
    const choice = await askUnsavedChanges(window).finally(() => {
      closePromptOpen = false;
    });
    if (choice === "cancel") return;
    if (choice === "save" && !(await requestSaveBeforeClose(window))) return;
    closeApproved = true;
    if (!window.isDestroyed()) window.close();
  };
  window.on("close", (event) => {
    if (closeApproved || !dirty) return;
    event.preventDefault();
    void confirmClose();
  });

  // Copy for selected text, the editing items in a text field. Where the page shows a menu of its own it prevents the event.
  window.webContents.on("context-menu", (_event, params) => {
    const template = buildTextContextMenu(params);
    if (template.length > 0 && !window.isDestroyed()) Menu.buildFromTemplate(template).popup({ window });
  });

  window.webContents.on("render-process-gone", (_event, details) => console.error("[face] renderer exited:", details.reason));
  window.once("ready-to-show", () => window.show());
  await window.loadURL(RENDERER_URL);
}

app.on("window-all-closed", () => app.quit());
app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error("[face] startup failed:", error);
    app.exit(1);
  });

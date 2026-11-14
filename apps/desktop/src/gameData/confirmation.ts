// What the user is asked before the game is started: which program, what it does, whose code runs in it and what it cannot
// touch. Pure; the native message box is shown by the caller. Everything in it is plain text of a message box.
import type { GameReadPlan } from "./refresh.ts";
import { isGameModule } from "./gameData.ts";

export const CONFIRM_BUTTONS = ["Cancel", "Run the Game"] as const;
/** The index of the button that agrees. Every other answer, closing the box included, declines. */
export const CONFIRM_RUN = 1;

export interface ReadConfirmation {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  /** Cancel: Return does not start the game. */
  readonly defaultId: number;
  readonly cancelId: number;
}

/** How many mods the game will load beside its own modules, as far as the files say. */
export const plannedMods = (plan: GameReadPlan): number => plan.key.mods.filter((mod) => !isGameModule(mod.name)).length;

function modsLine(plan: GameReadPlan): string {
  if (plan.modDirectory === null) return "Your game has no mods: there is no mod directory.";
  const count = plannedMods(plan);
  const mods = count === 0 ? "No mod is enabled" : count === 1 ? "1 mod is enabled, and its code runs in the game" : `${count} mods are enabled, and their code runs in the game`;
  return `${mods}. The mods are read from:\n${plan.modDirectory}`;
}

export function readConfirmation(plan: GameReadPlan, platform: NodeJS.Platform): ReadConfirmation {
  const paragraphs = [
    `The app will start this program:\n${plan.executable}`,
    "The game runs headless, without a window, three times in a row, and loads its data as it does when you play, with your mods and their settings. This usually takes less than a minute and can be cancelled.",
    modsLine(plan),
    `Nothing is written to the game's folders, your mods, saves or settings: the game works in a private folder of this app, with copies of your mod list and mod settings.${platform === "darwin" ? " Where the system's sandbox can be entered, as it normally can, the game runs in it and is denied every write elsewhere and all network access; the app says so afterwards if it could not." : ""}`,
    ...(plan.steam ? ["This installation is from Steam. Such a game may hand over to the Steam client instead of running; the app then reports that nothing was read."] : []),
    ...plan.problems,
  ];
  return { message: "Run Factorio to read its entities and signals?", detail: paragraphs.join("\n\n"), buttons: CONFIRM_BUTTONS, defaultId: 0, cancelId: 0 };
}

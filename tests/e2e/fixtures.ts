// Circuits the end-to-end tests open as projects.
import type { Page } from "@playwright/test";
import { openProject, writeProject } from "./app.ts";

/**
 * The example circuit extended with a selector, a second wire color between the same terminals and feedback in both colors:
 * the four combinators and the lamp (the kinds with a digit key) and every wire shape on one screen. Entity ids follow declaration order (e1 source ... e5 light).
 */
export const FIVE_KINDS_SOURCE = `circuit "Feedback example" {
    constant source at (40, 80) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) {
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic twice at (300, 260) {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    selector pick at (560, 260) {
        operation = select
        order = min
        index = virtual:signal-I
    }

    lamp light at (560, 80) {
        when virtual:signal-B > 8
    }

    wire red source.out <-> gate.in
    wire green source.out <-> gate.in
    wire red gate.out <-> gate.in
    wire green gate.out <-> gate.in
    wire red gate.out <-> twice.in
    wire green twice.out <-> light.in
    wire red twice.out <-> pick.in
}
`;

export const FIVE_KINDS = ["source", "gate", "twice", "pick", "light"];

/**
 * A signal on its way through every pole to a lamp and a speaker: source -> small -> medium -> big -> station -> light, with
 * the speaker on the last pole and a green wire beside the red one between the first two. Every entity has a tile and every
 * wire is within reach. Ids follow declaration order.
 */
export const RELAY_SOURCE = `circuit "Relay" {
    constant source at (40, 80) tile (0.5, 1.5) {
        virtual:signal-A = 3
    }

    pole small at (300, 80) tile (4.5, 1.5) {
    }

    pole medium at (560, 80) tile (10.5, 1.5) {
        prototype = medium-electric-pole
    }

    pole big at (820, 80) tile (16, 2) {
        prototype = big-electric-pole
    }

    pole station at (820, 300) tile (16, 8) {
        prototype = substation
    }

    lamp light at (1080, 300) tile (21.5, 7.5) {
        when virtual:signal-A > 0
    }

    speaker alarm at (1080, 80) tile (21.5, 1.5) {
        when virtual:signal-A > 2
        instrument = piano
        note = "F#3"
    }

    wire red source.out <-> small
    wire red small <-> medium
    wire green small <-> medium
    wire red medium <-> big
    wire red big <-> station
    wire red station <-> light.in
    wire red big <-> alarm.in
}
`;

export const RELAY = ["source", "small", "medium", "big", "station", "light", "alarm"];

/** Opens the relay circuit as a saved project. */
export async function openRelay(page: Page): Promise<void> {
  await openProject(page, await writeProject({ name: "Relay", source: RELAY_SOURCE }));
  await page.locator("g.card").nth(RELAY.length - 1).waitFor();
}

/** Opens the five-kinds circuit as a saved project. Returns the path of the project file. */
export async function openFiveKinds(page: Page): Promise<string> {
  const projectPath = await writeProject({ name: "Feedback example", source: FIVE_KINDS_SOURCE });
  await openProject(page, projectPath);
  await page.locator("g.card").nth(4).waitFor();
  return projectPath;
}

/** A chain of `count` arithmetic combinators in rows of `columns`, each wired to the next with alternating colors. */
export function gridSource(count: number, columns = 40): string {
  const lines = [`circuit "Grid of ${count}" {`];
  for (let i = 0; i < count; i++) {
    lines.push(`    arithmetic node${i} at (${(i % columns) * 240}, ${Math.floor(i / columns) * 180}) {`, "        virtual:signal-A = virtual:signal-A + 1", "    }", "");
  }
  for (let i = 1; i < count; i++) lines.push(`    wire ${i % 2 === 0 ? "red" : "green"} node${i - 1}.out <-> node${i}.in`);
  lines.push("}", "");
  return lines.join("\n");
}

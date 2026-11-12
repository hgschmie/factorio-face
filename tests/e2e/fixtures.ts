// Circuits the end-to-end tests open as projects.
import type { Page } from "@playwright/test";
import { openProject, writeProject } from "./app.ts";

/**
 * The example circuit extended with a selector, a second wire color between the same terminals and feedback in both colors:
 * every entity kind and every wire shape on one screen. Entity ids follow declaration order (e1 source ... e5 light).
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

/** Opens the five-kinds circuit as a saved project. Returns the project directory. */
export async function openFiveKinds(page: Page): Promise<string> {
  const directory = await writeProject({ name: "Feedback example", source: FIVE_KINDS_SOURCE });
  await openProject(page, directory);
  await page.locator("g.card").nth(4).waitFor();
  return directory;
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

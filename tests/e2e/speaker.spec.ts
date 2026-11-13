// The form of the programmable speaker: every setting of the language is a control that writes its statement to the source
// and shows what the source says, with the typing, validation, draft and undo behaviour of the other forms.
import type { Page } from "@playwright/test";
import { card, expect, selectEntity, sourceText, test } from "./app.ts";
import { inspector, setSource } from "./board.ts";

const SPEAKER = `circuit "Speaker" {
    constant source at (40, 80) {
        virtual:signal-A = 3
    }

    speaker alarm at (300, 80) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> alarm.in
}
`;

/** The statements of the speaker, as the source has them. */
async function statements(page: Page): Promise<string[]> {
  const source = await sourceText(page);
  const from = source.indexOf("speaker alarm");
  return source.slice(source.indexOf("{", from) + 1, source.indexOf("}", from)).split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

const field = (page: Page, label: string) => inspector(page).getByLabel(label, { exact: true });
const box = (page: Page, label: string) => inspector(page).getByRole("checkbox", { name: label, exact: true });
const summary = (page: Page) => card(page, "alarm").locator(".card-summary");
const stateRow = (page: Page) => card(page, "alarm").locator('.card-row[data-row="speaker"]');
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const options = (page: Page, label: string) => field(page, label).locator("option").evaluateAll((items) => items.map((item) => [(item as HTMLOptionElement).value, item.textContent]));

test.beforeEach(async ({ page }) => {
  await setSource(page, SPEAKER);
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await selectEntity(page, "alarm");
});

test("the speaker form writes every setting to the source", async ({ page }) => {
  await expect(inspector(page).locator(".eyebrow")).toHaveText("Condition indicator");
  await expect(inspector(page).locator("h2")).toHaveText("Speaker");
  await expect(inspector(page).locator(".form-section > .section-label")).toHaveText(["Plays", "Sound", "Playback", "Alert"]);
  await expect(field(page, "Description")).toHaveAttribute("title", "A speaker has no description in the game. This text stays in the project.");
  // A speaker does not turn.
  await expect(inspector(page).getByRole("group", { name: "Facing" })).toHaveCount(0);

  // The condition, as in the lamp's form. Wildcards as the language has them for a speaker: anything and everything on the left.
  await expect(field(page, "Plays when")).toHaveValue("condition");
  await expect(field(page, "Condition signal")).toHaveValue("virtual:signal-A");
  await field(page, "Comparator").selectOption(">=");
  await field(page, "Number").fill("3");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 3"]);
  await field(page, "Condition signal").fill("each");
  await expect(field(page, "Condition signal")).toHaveAttribute("aria-invalid", "true");
  await expect(inspector(page).getByRole("alert")).toHaveText("'each' is not allowed here; use 'anything' or 'everything'");
  await field(page, "Condition signal").fill("anything");
  expect(await statements(page)).toEqual(["when anything >= 3"]);
  await field(page, "Compare to").selectOption("signal");
  await field(page, "Other signal").fill("virtual:signal-B");
  expect(await statements(page)).toEqual(["when anything >= virtual:signal-B"]);
  await field(page, "Compare to").selectOption("constant");
  await field(page, "Condition signal").fill("virtual:signal-A");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0"]);
  await expect(summary(page)).toHaveText(["alarms alarm-1", "when A ≥ 0"]);

  // Instrument and note come from the game data: twelve instruments in the game's order, by their names in the game.
  expect((await options(page, "Instrument")).slice(0, 4)).toEqual([["alarms", "Alarms"], ["miscellaneous", "Miscellaneous"], ["drum-kit", "Drumkit"], ["piano", "Piano"]]);
  expect(await options(page, "Instrument")).toHaveLength(12);
  await expect(field(page, "Instrument")).toHaveValue("alarms");
  await expect(field(page, "Note")).toHaveValue("alarm-1");
  expect((await options(page, "Note")).map(([value]) => value)).toEqual(["alarm-1", "alarm-2", "buzzer-1", "buzzer-2", "buzzer-3", "ring", "siren"]);
  // The first note of the first instrument is what a speaker plays without saying so; any other choice is written.
  await field(page, "Note").selectOption("siren");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "note = siren"]);
  // Another instrument offers its own notes. It has no siren: the note becomes its first one, which is not written.
  await field(page, "Instrument").selectOption("piano");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = piano"]);
  await expect(field(page, "Note")).toHaveValue("F3");
  expect(await options(page, "Note")).toHaveLength(48);
  await field(page, "Note").selectOption("A3");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = piano", "note = A3"]);
  // The bass has an A3 as well: the note stays. The celesta starts at F5: its first note it is.
  await field(page, "Instrument").selectOption("bass");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = bass", "note = A3"]);
  await expect(field(page, "Note")).toHaveValue("A3");
  await field(page, "Instrument").selectOption("celesta");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = celesta"]);
  await expect(field(page, "Note")).toHaveValue("F5");
  // A sharp note is written quoted; the first instrument again is not written at all.
  await field(page, "Note").selectOption("F#5");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = celesta", 'note = "F#5"']);
  await expect(summary(page)).toHaveText(["celesta F#5", "when A ≥ 0"]);
  await field(page, "Instrument").selectOption("alarms");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0"]);
  await field(page, "Instrument").selectOption("piano");
  await field(page, "Note").selectOption("F#3");
  expect(await statements(page)).toEqual(["when virtual:signal-A >= 0", "instrument = piano", 'note = "F#3"']);

  // The volume in percent, with decimals; what is no percentage is not written and says why.
  await expect(field(page, "Volume")).toHaveValue("100");
  await field(page, "Volume").fill("62.5");
  expect(await statements(page)).toContain("volume = 62.5");
  await field(page, "Volume").fill("150");
  await expect(field(page, "Volume")).toHaveAttribute("aria-invalid", "true");
  await expect(inspector(page).getByRole("alert")).toHaveText("Must be from 0 to 100");
  await field(page, "Volume").fill("loud");
  await expect(inspector(page).getByRole("alert")).toHaveText("Enter a number");
  expect(await statements(page)).toContain("volume = 62.5");
  await field(page, "Volume").press("Escape");
  await expect(field(page, "Volume")).toHaveValue("62.5");
  // Volume from a signal takes the place of the number.
  await box(page, "Signal value is volume").check();
  expect(await statements(page)).toContain("volume-signal = virtual:signal-A");
  await expect(field(page, "Volume")).toHaveCount(0);
  await field(page, "Volume signal").fill("virtual:signal-V");
  expect(await statements(page)).toContain("volume-signal = virtual:signal-V");
  await field(page, "Volume signal").fill("");
  await expect(field(page, "Volume signal")).toHaveAttribute("aria-invalid", "true");
  expect(await statements(page)).toContain("volume-signal = virtual:signal-V");
  await field(page, "Volume signal").press("Escape");

  // Playback.
  expect((await options(page, "Playback mode")).map(([value]) => value)).toEqual(["local", "surface", "global"]);
  await field(page, "Playback mode").selectOption("global");
  await box(page, "Allow polyphony").check();
  await box(page, "Stop playing sounds when the input changes").check();
  // The alert.
  await box(page, "Show alert").check();
  await box(page, "Show icon on map").uncheck();
  await field(page, "Alert icon").fill("item:iron-plate");
  await field(page, "Alert message").pressSequentially('Iron is "low"');
  expect(await statements(page)).toEqual([
    "when virtual:signal-A >= 0",
    "instrument = piano",
    'note = "F#3"',
    "volume = 62.5",
    "volume-signal = virtual:signal-V",
    "playback = global",
    "polyphony = true",
    "stop-playing-sounds = true",
    "show-alert = true",
    "show-on-map = false",
    "alert-icon = item:iron-plate",
    'alert-message = "Iron is \\"low\\""',
  ]);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics)).toEqual([]);

  // Typing the message was one step, like typing in every field; each of the other controls was one as well.
  await undo(page).click();
  expect(await statements(page)).not.toContain('alert-message = "Iron is \\"low\\""');
  expect((await statements(page)).at(-1)).toBe("alert-icon = item:iron-plate");
  await undo(page).click();
  await expect(field(page, "Alert icon")).toHaveValue("");
  await undo(page).click();
  await expect(box(page, "Show icon on map")).toBeChecked();
  await undo(page).click();
  await expect(box(page, "Show alert")).not.toBeChecked();
  expect((await statements(page)).at(-1)).toBe("stop-playing-sounds = true");
});

test("the speaker form changes between a condition and a pitch signal, and the card says what plays", async ({ page }) => {
  // With the condition true the card is lit and names the sound; the dock traces it like a lamp.
  await expect(card(page, "alarm")).toHaveClass(/active/);
  await expect(stateRow(page)).toHaveText("playing alarms alarm-1");
  await expect(stateRow(page)).toHaveClass(/playing/);
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "playing alarms alarm-1");
  await expect(card(page, "alarm")).toHaveAttribute("data-in-red", "A 3");
  await expect(page.locator('tr.trace[data-trace="alarm sound"] .trace-value')).toHaveText("playing alarms alarm-1");

  // Signal value is pitch: the signal of the condition picks the note, and the condition is gone.
  await field(page, "Plays when").selectOption("pitch");
  expect(await statements(page)).toEqual(["pitch = virtual:signal-A"]);
  await expect(field(page, "Pitch signal")).toHaveValue("virtual:signal-A");
  await expect(field(page, "Condition signal")).toHaveCount(0);
  await expect(field(page, "Comparator")).toHaveCount(0);
  // The note is the signal's business now: no Note control, and the card names the signal and the instrument.
  await expect(field(page, "Note")).toHaveCount(0);
  await expect(summary(page)).toHaveText(["pitch from A", "alarms"]);
  // A value of 3 is the third note of the instrument.
  await expect(stateRow(page)).toHaveText("playing alarms buzzer-1");
  await field(page, "Instrument").selectOption("piano");
  await expect(stateRow(page)).toHaveText("playing piano G3");
  await expect(summary(page)).toHaveText(["pitch from A", "piano"]);
  await field(page, "Pitch signal").fill("virtual:signal-P");
  expect(await statements(page)).toEqual(["pitch = virtual:signal-P", "instrument = piano"]);
  // No value, no note: silent, and the card is not lit.
  await expect(stateRow(page)).toHaveText("silent");
  await expect(stateRow(page)).not.toHaveClass(/playing/);
  await expect(card(page, "alarm")).not.toHaveClass(/active/);
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "silent");
  await expect(page.locator('tr.trace[data-trace="alarm sound"]')).not.toHaveClass(/lit/);
  // A pitch signal is required and takes no wildcard.
  await field(page, "Pitch signal").fill("anything");
  await expect(inspector(page).getByRole("alert")).toHaveText("Wildcard signals are not allowed here");
  await field(page, "Pitch signal").fill("virtual:signal-A");

  // Back to a condition: the pitch signal becomes its signal.
  await field(page, "Plays when").selectOption("condition");
  expect(await statements(page)).toEqual(["when virtual:signal-A > 0", "instrument = piano"]);
  await expect(field(page, "Note")).toHaveValue("F3");
  await expect(stateRow(page)).toHaveText("playing piano F3");

  // The signal taken out of the condition: no condition, which the source says as nothing and the problems list as a warning.
  await field(page, "Condition signal").fill("");
  expect(await statements(page)).toEqual(["instrument = piano"]);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.map((diagnostic) => diagnostic.code))).toEqual(["unconfigured"]);
  await expect(summary(page)).toHaveText(["piano F3", "no condition"]);
  await expect(stateRow(page)).toHaveText("silent");
  // A comparator without a signal is not a condition yet: it waits as a draft, with the hint, and is written with the signal.
  await field(page, "Comparator").focus();
  await field(page, "Comparator").selectOption("!=");
  await expect(inspector(page).locator(".draft-hint")).toContainText("The condition needs a signal.");
  expect(await statements(page)).toEqual(["instrument = piano"]);
  await field(page, "Condition signal").fill("virtual:signal-A");
  await expect(inspector(page).locator(".draft-hint")).toHaveCount(0);
  expect(await statements(page)).toEqual(["when virtual:signal-A != 0", "instrument = piano"]);
  await undo(page).click();
  expect(await statements(page)).toEqual(["instrument = piano"]);
});

test("the speaker form shows what the source says", async ({ page }) => {
  const written = (body: string): string => SPEAKER.replace("        when virtual:signal-A > 0\n", body);
  await setSource(
    page,
    written(
      '        pitch = virtual:signal-B\n        instrument = drum-kit\n        volume = 40\n        playback = surface\n        polyphony = true\n        stop-playing-sounds = true\n        show-alert = true\n        show-on-map = false\n        alert-icon = item:copper-plate\n        alert-message = "Copper\\tis out"\n',
    ),
  );
  await expect(field(page, "Plays when")).toHaveValue("pitch");
  await expect(field(page, "Pitch signal")).toHaveValue("virtual:signal-B");
  await expect(field(page, "Instrument")).toHaveValue("drum-kit");
  await expect(field(page, "Note")).toHaveCount(0);
  await expect(field(page, "Volume")).toHaveValue("40");
  await expect(box(page, "Signal value is volume")).not.toBeChecked();
  await expect(field(page, "Playback mode")).toHaveValue("surface");
  await expect(box(page, "Allow polyphony")).toBeChecked();
  await expect(box(page, "Stop playing sounds when the input changes")).toBeChecked();
  await expect(box(page, "Show alert")).toBeChecked();
  await expect(box(page, "Show icon on map")).not.toBeChecked();
  await expect(field(page, "Alert icon")).toHaveValue("item:copper-plate");
  await expect(field(page, "Alert message")).toHaveValue("Copper\tis out");

  await setSource(page, written('        when everything < virtual:signal-C\n        instrument = piano\n        note = "A#4"\n        volume-signal = virtual:signal-V\n'));
  await expect(field(page, "Plays when")).toHaveValue("condition");
  await expect(field(page, "Condition signal")).toHaveValue("everything");
  await expect(field(page, "Comparator")).toHaveValue("<");
  await expect(field(page, "Compare to")).toHaveValue("signal");
  await expect(field(page, "Other signal")).toHaveValue("virtual:signal-C");
  await expect(field(page, "Instrument")).toHaveValue("piano");
  await expect(field(page, "Note")).toHaveValue("A#4");
  await expect(box(page, "Signal value is volume")).toBeChecked();
  await expect(field(page, "Volume signal")).toHaveValue("virtual:signal-V");
  await expect(field(page, "Volume")).toHaveCount(0);
  await expect(field(page, "Playback mode")).toHaveValue("local");
  for (const label of ["Allow polyphony", "Stop playing sounds when the input changes", "Show alert"]) await expect(box(page, label)).not.toBeChecked();
  await expect(box(page, "Show icon on map")).toBeChecked();
  await expect(field(page, "Alert icon")).toHaveValue("");
  await expect(field(page, "Alert message")).toHaveValue("");

  // A name the game data does not have stays what it is: selected, marked, and the others are still offered.
  await setSource(page, written("        when virtual:signal-A > 0\n        instrument = organ\n        note = C1\n"));
  await expect(field(page, "Instrument")).toHaveValue("organ");
  await expect(field(page, "Instrument").locator("option:checked")).toHaveText("organ (not in the game data)");
  expect(await options(page, "Instrument")).toHaveLength(13);
  // Its notes are unknown: the note is text.
  await expect(field(page, "Note")).toHaveValue("C1");
  await expect(field(page, "Note")).toHaveJSProperty("tagName", "INPUT");
  // An instrument of the game instead: it has no C1, so the note is its first one.
  await field(page, "Instrument").selectOption("alarms");
  expect(await statements(page)).toEqual(["when virtual:signal-A > 0"]);
  await expect(field(page, "Note")).toHaveValue("alarm-1");
  // A note its instrument does not have is offered as it is, next to the notes the instrument has.
  await setSource(page, written("        when virtual:signal-A > 0\n        note = C1\n"));
  await expect(field(page, "Note").locator("option:checked")).toHaveText("C1 (not in the game data)");
  expect(await options(page, "Note")).toHaveLength(8);
  await field(page, "Note").selectOption("ring");
  expect(await statements(page)).toEqual(["when virtual:signal-A > 0", "note = ring"]);

  // A setting that is in the source keeps its statement when it returns to the default, as in every form.
  await setSource(page, written("        when virtual:signal-A > 0\n        polyphony = true\n"));
  await box(page, "Allow polyphony").uncheck();
  expect(await statements(page)).toEqual(["when virtual:signal-A > 0", "polyphony = false"]);
});

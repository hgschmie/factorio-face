# Remaining work

Maintained by the coordinator. Scope reference: the milestones in `../../HANDOFF.md`. Items move out of this file when they are done and verified.

Milestone numbering: on 2026-11-11 the user inserted a usability milestone as Milestone 2. The handoff's milestones 2 to 4 (game-compatible editor, reusable project workbench, distributable release) are therefore Milestones 3 to 5 here.

## Milestone 1 (foundation and vertical slice)

Done: simulation engine, desktop shell and workbench, session integration (single history, source patches, catalog picker and module settings, real simulation, project save/reopen), single-file `.faceproj` project format (zip).

Native (OS-level) UI check: done on 2026-11-11 with computer use from the Claude desktop app, on top of the Playwright Electron suite (41 tests). Passed with the real pointer and keyboard: select, drag and delete a card; palette placement; wiring (click, click); typing in the source pane with the canvas and inspector following; inspector edits with the source following; signal picker with search; undo/redo across canvas and text; Run, Pause, Step, Reset; wheel zoom, pan, Fit; accelerators Cmd+Z, Shift+Cmd+Z, Cmd+1/3/0, Cmd+T, Cmd+R, Shift+Cmd+R, Shift+Cmd+S. Passed through the native menu: structure of File, Edit, View, Simulation, Window; Save As through the native panel; Save in place; Open Recent after quit and relaunch; Edit Delete and Select All; the unsaved-changes prompt with Cancel, Discard Changes and Save. Defects found are listed first under the workbench follow-ups.
  The same day, after the change to `.faceproj` files: Save As through the native panel (extension appended to a bare name), quit, reopen from Open Recent, a project edited and re-zipped with the `zip` command line tool, and the error shown for a stale recent entry that points at an old project folder.
  To repeat: `FACE_USER_DATA=$PWD/.runtime/native/user-data FACE_PROJECTS_DIR=$PWD/release/native-check node scripts/run.mjs`. Pointer scenarios need full-screen control (background accessibility clicks do not reach the canvas). The tooling refuses to confirm a save panel that shows a hidden or an empty folder, hence the visible, git-ignored `release/native-check` with a placeholder file instead of `.runtime/native/`.
  Not covered natively: View Source, Zoom In, Zoom Out and Actual Size (menu and keys), New Project, Open Project through the native panel, Cmd+S as a key press (File Save was used through the menu), full screen.

## Milestone 2 (usability)

Requested by the user on 2026-11-11. In progress since the same day; the user asked for the whole list to be built while away, so open points are decided by the coordinator and reported.

- Copy and paste for entities on the canvas: select, copy, paste gives a copy. The Edit menu has Cut, Copy and Paste, but they do nothing in the graphical editor. Open: what happens to wires between copied entities, naming of the copies, paste position, paste across projects.
- Rotation of entities: the card text stays as it is, the connection pins move around the card. A step towards real graphical placement. The model already has `placement.direction`; the canvas has one function for pin positions (`pinPoint` in `apps/renderer/src/canvas/geometry.ts`) as the place to start. With the entity facing right, red is above green.
- Done: description text. A multi-line Description box in the inspector for every entity, written as one source line (`description = "..."` with `\n`, `\t`, `\r` escapes), a marker on the card and the text in its tooltip. Save also writes text that is still being typed. Open for the user: lamps get the box although the game has a description on combinators only (`docs/factorio-audit.md` 3.2); no length limit is enforced because the audit states none.
- Done: the [R] and [G] boxes are grayed (dashed outline, no wire color, still operable) when no wire of that color is connected to the entity's input, as the game does.
- Done: both [R] and [G] can be unchecked, as the game allows. The language writes it as `[none]` after a signal and `networks = none` for the lamp (`none` is not a reserved word); a signal read from no network counts as absent (rule N-NONE in `packages/simulation/CONFORMANCE.md`, assumed).
- Card status: show input and output, not only the output, and split by red and green where possible. Today a card shows the first two output signals (`STATUS_SIGNALS` in `apps/renderer/src/session/simulationView.ts`); with icons the "+N more" marker of the text form is lost. The small gray square in front of the status is a leftover marker: it only changes for lamps (orange when lit, or the light's color) and means nothing on a combinator. Decide what replaces it.
- Done, not verified natively: on macOS the app no longer adds its own full screen entry to the View menu and relies on the one macOS adds. If macOS does not add it, View has no such entry (the green window button still works).

- Wire selection on the canvas, to build: a click on a wire selects it, and it can then be deleted like an entity (added by the user on 2026-11-11). Details under the workbench follow-ups. Open: what the inspector shows for a selected wire, and whether a marquee selects wires.
- Done: undo and redo from an inspector field (key, menu, or the browser's own undo) go through the shared document history. The first undo only takes back text that is not written yet (unparsable text, a name before Return, a pending draft); it never creates a history entry and never costs the redo.
- Keyboard shortcuts for the most common canvas operations: select tool, wire tools, rotate, delete and the like (added by the user on 2026-11-11 while the milestone was being built). Built as its own step after rotation, so the keys can be chosen together.

Not in this milestone, nice to have (user, 2026-11-11): drag-to-connect for wires, and Home and End moving the caret in inspector fields. Both stay in the workbench follow-ups.

## Workbench follow-ups (from the shell and integration reports)

- To verify natively on macOS: Cmd+Z and Shift+Cmd+Z in an inspector field undo exactly one step; the View menu shows one full screen entry. Also Cmd+Z, Cmd+Enter and Cmd+S as real key presses in the Description box.
- Unwritten field text (name, description) is lost when a window without unsaved changes is closed, because the main process only asks for a dirty document.
- The description marker on the card (glyph and place) is provisional until the card status rework.
- `integration.spec.ts` accepts a completion with Enter right after the list appears; CodeMirror ignores Enter for 75 ms after opening the list, so that test can race.
- Text fields outside the inspector (signal picker search, project name in the settings) have no undo of their own any more: the browser keeps one undo stack for all fields of the window, which let an undo there rewrite an inspector field. Undo from the toolbar button or with focus on the canvas does not discard a pending inspector draft.
- A menu command (all accelerators travel main process, then IPC) can be overtaken by input that arrives while the window is busy for 50 ms or more. Handling the shortcuts in the renderer's keydown would remove that, but needs a native check that the accelerator does not fire twice.
- Closing the signal picker with Escape leaves the focus on the body instead of the button that opened it.
- In Milestone 2. Wires cannot be selected on the canvas today. A wire is removed by repeating the wire gesture between its two terminals with the same color (as in the game, since 2026-11-11; the handoff's rule that a repeated connection is a no-op is superseded), from the Connections list of the inspector, or in the source.
- Pins (red above green per terminal side, since 2026-11-11): a pin dimmed by the other wire tool shows the end of its wire through it; on very steep forward curves the casings of a red and green pair touch near the pins; the network toggles inside a signal row are narrower (20px) than the standalone ones in decider outputs and the lamp form (24px).
- Wire routing (all wires axis-aligned with rounded corners since 2026-11-11): a fan-out from one output splits into two vertical legs 20 apart instead of a T; a red wire going down and a green wire going up from one output overlap for a few units at the pin level; routes do not avoid other cards, so a wire can pass behind a card and seem to start at it; same-side legs and detours share the lines 10 and 30 beside a card.
- Native check, defect: with a wire tool, press on a terminal, drag and release on a second terminal leaves a pending wire; only a second click connects. Drag-to-connect should complete the wire.
- Native check, to verify: Fit to Content right after switching to Split zoomed to 47% where the content would fit at roughly 70%; a card tooltip stayed visible above native sheets and after its card was deleted (the pointer may still have been over it).
- Native check, note: an accessibility press on a card does nothing (cards select on pointer events only); the macOS application menu title reads Electron with the stock development binary (items inside carry the product name).
- Theme (neutral grays, cream, orange, confirm green since 2026-11-11): decide whether the error toast should be red instead of the warm notice style; error and danger red on raised cards reaches only about 3.8:1 contrast; lamp yellow, warning yellow and accent orange are close in hue; the lint tooltip and hover on filled controls have not been reviewed visually.
- Decision open: on macOS, Home and End in an inspector field scroll the inspector first (system key binding) and move the caret only when nothing is left to scroll, while the source editor moves the caret. Making the inspector fields consistent needs a keydown handler that overrides the platform convention. The e2e helpers use Cmd+Left/Right (`CARET` in `tests/e2e/app.ts`) for this reason.
- Delete followed by undo gives the entity a new id, so the simulation resets and the entity is not reselected.
- Card configuration summaries are short text without signal icons.
- Dock traces are limited to 6 entities and 4 signals each; per-color inputs are only a tooltip.
- Completion matches prototype names, not display names.
- No canvas clipboard (copy/paste), wires do not route around other cards, keyboard accessibility is basic (cards not focusable, no keyboard wiring).
- Typing latency in a 1,000-entity document is not measured; analysis and simulation run on the main thread.
- `window.faceSession` test hook is present in production code.
- The stock Electron development binary writes outside the workspace on every launch: `~/Library/Preferences/com.github.Electron.plist` and a `com.github.Electron.savedState` directory in the per-user macOS temp directory. Contain it (sandbox wrapper or renamed bundle) or accept it.
- No packaging configuration; no single-instance lock.

## Project file follow-ups

- Custom icons: `assets/` entries must be read and preserved on save once they exist; today saving writes only `face.json` and the circuits, so any other entry of a hand-built archive is lost.
- No CRC check on read (fflate does not verify it): a deflated entry that declares less than it holds is cut at the declared size instead of being refused. Needs own central-directory parsing or a different reader.
- Archives made with Finder's Compress are refused (`__MACOSX/` entries, or everything below a top folder); so is any entry name containing `..`. Decide whether to ignore such entries instead.
- No file association and no `open-file` handling for `.faceproj` (double-click in Finder) until packaging.
- Stale entries stay in Open Recent after a failed load; with unsaved changes the Save/Discard prompt comes before the load fails. An error banner is not cleared by a later successful save.
- Zip and unzip run synchronously in the main process; the write-side size limits have no test.
- If projects should live in version control: a folder export/import.

## Language follow-ups (from the language package report)

- Model states the language cannot express are reported as `unrepresentable` by commands and silently normalized by the printer. Decide per case before blueprint import: a condition without a first signal (decider, lamp), an arithmetic combinator without output, lamp `colorMode` without `useColors`, a decider output constant other than 1 while copying input, network selection on a constant output or on a selector index signal.
- Hexadecimal literals above `0x7FFFFFFF` are rejected; consider two's-complement masks (`0xFFFFFFFF`).
- `docs/dsl.md` must absorb the implemented choices: header clauses in any order, separators between members, single-line strings, `source = signal` wording, the extra diagnostic codes (`invalid-statement`, `invalid-signal`, `duplicate-signal`, `contradictory-statement` for selector properties), wildcard legality per slot, canonical print rules.
- Shorthand for virtual signals (open point for the user's language review).
- Components: `import`, `component`, `port` are reserved only.

## Catalog follow-ups

- Entity picker rule is inferred from data (not hidden and not placed by an item); verify against the in-game signal picker.
- Picker tie-break for equal subgroup and order strings is by kind then name; engine rule unknown.
- Custom signals with uploaded icons, custom groups and their persistence in `face.json` (types are open for `origin: "custom"`, nothing implemented).
- Asset redistribution rights for Wube icons before any public release.

## Conformance (Milestone 3)

- A fixture for N-NONE (operand, decider output and lamp with both networks unchecked) is missing from the list below.
- Game-driven fixtures F-01 to F-23 from `factorio-audit.md` section 6.8, reusing the sandboxed runner in `tools/catalog/lib`. F-01 (exported blueprint shapes) blocks the blueprint exporter; F-13/F-16 fix the signal order comparator.
- Every assumption in `packages/simulation/CONFORMANCE.md` flips to verified or gets corrected.

## Later milestones (unchanged from the handoff)

- Blueprint import/export (`packages/blueprints`), including the decision on 1.x strings. Descriptions: write `player_description` for the four combinator types only and omit it when empty; decide what happens to a lamp's description; check the game for a length limit and for tabs and `\r\n`.
- Reusable components, library, instance identity across files, flattening.
- Debugging: probes, traces for arbitrary signals, stop conditions, scenarios.
- Packaging, recovery, accessibility and performance hardening; move parsing/simulation to a worker if measurements require it.
- Code review loop: in place since 2026-11-11 as a review before every code commit (`docs/agent-rules.md`).

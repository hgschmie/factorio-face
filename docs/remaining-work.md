# Remaining work

Maintained by the coordinator. Scope reference: the milestones in `../../HANDOFF.md`. Items move out of this file when they are done and verified.

## Milestone 1 (foundation and vertical slice)

Done: simulation engine, desktop shell and workbench, session integration (single history, source patches, catalog picker and module settings, real simulation, project save/reopen).

- [ ] Native (OS-level) UI check of the integrated app. Not done: the coordinating session had no OS-level input tooling. Covered so far by 40 Playwright Electron tests with real pointer and keyboard events and a launch/quit smoke test of `scripts/run.mjs`.
  Preferred route: a session in the Claude desktop app with Computer use turned on (Settings, Capabilities), access requested for the Electron app only.
  Scenarios: native menu bar (File, Edit, View, Simulation, Window) and its accelerators; select, drag and delete a card with the real pointer; wire two terminals; type in the source pane and see the canvas follow; undo/redo across text, canvas and inspector; signal picker; Run, Step, Reset; scroll and zoom; Save As through the native dialog into `.runtime/native/`, quit, reopen from Open Recent; the unsaved-changes prompt on quit. Launch with `FACE_USER_DATA=.runtime/native/user-data node scripts/run.mjs` and stop only that process.
  Shell fallback: drive the app from the shell with `osascript` (System Events for the native menu and element positions, posted mouse and key events for clicks, drags and typing) and `screencapture` for evidence, using a throwaway profile and project under `.runtime/native/`. Prerequisite: the terminal app needs the macOS Accessibility and Screen Recording permissions (both were missing on 2026-11-11; Automation of System Events already works).

## Workbench follow-ups (from the shell and integration reports)

- Delete followed by undo gives the entity a new id, so the simulation resets and the entity is not reselected.
- Card configuration summaries are short text without signal icons.
- Dock traces are limited to 6 entities and 4 signals each; per-color inputs are only a tooltip.
- Completion matches prototype names, not display names.
- No canvas clipboard (copy/paste), wires do not route around other cards, keyboard accessibility is basic (cards not focusable, no keyboard wiring).
- Typing latency in a 1,000-entity document is not measured; analysis and simulation run on the main thread.
- `window.faceSession` test hook is present in production code.
- The stock Electron development binary writes outside the workspace on every launch: `~/Library/Preferences/com.github.Electron.plist` and a `com.github.Electron.savedState` directory in the per-user macOS temp directory. Contain it (sandbox wrapper or renamed bundle) or accept it.
- No packaging configuration; no single-instance lock.

## Language follow-ups (from the language package report)

- Model states the language cannot express are reported as `unrepresentable` by commands and silently normalized by the printer. Decide per case before blueprint import: a condition without a first signal (decider, lamp), an arithmetic combinator without output, lamp `colorMode` without `useColors`, lamp with neither input network, a decider output constant other than 1 while copying input, network selection on a constant output or on a selector index signal.
- Hexadecimal literals above `0x7FFFFFFF` are rejected; consider two's-complement masks (`0xFFFFFFFF`).
- `docs/dsl.md` must absorb the implemented choices: header clauses in any order, separators between members, single-line strings, `source = signal` wording, the extra diagnostic codes (`invalid-statement`, `invalid-signal`, `duplicate-signal`, `contradictory-statement` for selector properties), wildcard legality per slot, canonical print rules.
- Shorthand for virtual signals (open point for the user's language review).
- Components: `import`, `component`, `port` are reserved only.

## Catalog follow-ups

- Entity picker rule is inferred from data (not hidden and not placed by an item); verify against the in-game signal picker.
- Picker tie-break for equal subgroup and order strings is by kind then name; engine rule unknown.
- Custom signals with uploaded icons, custom groups and their persistence in `face.json` (types are open for `origin: "custom"`, nothing implemented).
- Asset redistribution rights for Wube icons before any public release.

## Conformance (Milestone 2)

- Game-driven fixtures F-01 to F-23 from `factorio-audit.md` section 6.8, reusing the sandboxed runner in `tools/catalog/lib`. F-01 (exported blueprint shapes) blocks the blueprint exporter; F-13/F-16 fix the signal order comparator.
- Every assumption in `packages/simulation/CONFORMANCE.md` flips to verified or gets corrected.

## Later milestones (unchanged from the handoff)

- Blueprint import/export (`packages/blueprints`), including the decision on 1.x strings.
- Reusable components, library, instance identity across files, flattening.
- Debugging: probes, traces for arbitrary signals, stop conditions, scenarios.
- Packaging, recovery, accessibility and performance hardening; move parsing/simulation to a worker if measurements require it.
- Code review loop (requested by the user; to be set up).

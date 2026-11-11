# ADR 0001: Production architecture

Date: 2026-11-11. Status: accepted for Milestone 1; revisit items are marked.

## Context

The user selected a custom React/Electron desktop application and approved the visual design of the `prototypes/react-electron` experiment. The handoff left the parser/runtime, diagram rendering, project format and build tooling as implementation decisions.

## Decisions

1. **Language implementation: hand-written TypeScript, no Java/Xtext.** A lossless tokenizer and recursive-descent parser keep every byte of source (trivia attached to tokens), produce diagnostics with ranges, a semantic `Circuit` and a source map. Graphical edits are pure functions from (parse result, command) to minimal text changes. Consequence: no JRE to ship, the language runs in the renderer, a worker and tests alike; we own completion/navigation ourselves. The prototype's source-preservation cases (comments, irregular spacing, rename, deletion, duplicate and reversed wires, stale drafts) are the acceptance proof in `packages/language/test`.
2. **Text is the persisted form and the single undo authority.** The CodeMirror document owns history. Layout lives in the source (`at (x, y)`), so a move is an ordinary undoable edit. Simulation state, traces and selection never create source edits.
3. **Identity.** Source identifies entities by name. The language session assigns stable ids that survive renames by matching declarations across parses; ids are not written to the file. Revisit when reusable components need cross-file instance identity.
4. **Module layout: npm workspaces.** `packages/model` (types), `packages/language`, `packages/catalog`, `packages/simulation`, later `packages/blueprints` and `packages/components`; `apps/desktop` (Electron main/preload) and `apps/renderer` (React workbench). Core packages have no React/Electron/Node dependencies. Packages are consumed as TypeScript sources and bundled with esbuild; `tsc` only typechecks.
5. **Rendering: custom SVG canvas, CodeMirror 6 editor.** No diagram library. Culling and memoization are added from measurements.
6. **Project format v1: a directory.** `face.json` (format version, name, game version, enabled module groups, custom signal groups and signals, circuit files) plus `*.face` sources and `assets/` for custom icons. Runtime state is never persisted in it.
7. **Catalog: generated from the local game.** The generator runs the game's own data dump in an isolated write directory and records provenance. Catalog JSON is committed; icons are Wube artwork, generated into a git-ignored directory and bundled in local builds only. Redistribution rights must be resolved before any public release.
8. **Simulation: deterministic two-phase tick engine** over indexed red/green networks, independent of the UI, publishing immutable snapshots. It will move to a worker when measurements require it; the API is already message-friendly (plain data).
9. **Security posture:** `contextIsolation` and sandbox on, Node integration off, restrictive CSP, a small validated IPC surface; the main process owns filesystem access and dialogs.
10. **Containment during development:** `scripts/env.sh` redirects caches, temp files and app profiles into the repository; the app honours `FACE_USER_DATA` so development and test runs never touch the user's normal profile.
11. **Toolchain pins:** the versions proven by the prototype (React 19.3.1, Electron 44.9.1, TypeScript 6.0.3, esbuild 0.28.2, CodeMirror 6) plus vitest 5.1.0, Playwright 1.65.0, fflate 0.8.3, electron-builder 26.18.0. Upgrades (Electron 45, TypeScript 7) are deliberate later steps.

## Open

- Asset redistribution (item 7), packaging/signing targets, worker placement for parsing and simulation, shorthand for virtual signals in the language.

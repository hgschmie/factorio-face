# @face/renderer

The React workbench of FActorio Circuit Editor. It runs in the sandboxed Electron renderer and talks to the main process only through the
typed `window.face` API (`apps/desktop/src/ipc.ts`, imported type-only).

The views are presentational: they take plain props (types from `@face/model`, view state, callbacks) and contain no document logic. The one
place that knows where state comes from is `App.tsx`.

## Structure

```
src/
  App.tsx              composition root: picks the controller (today the demo) and the entity icon resolver
  main.tsx, index.html entry point; index.html carries the Content-Security-Policy
  workbench/
    controller.ts      the WorkbenchController seam (state, commands, shared view types)
    Workbench.tsx      shell: lays out the panels, routes callbacks to commands, wires the native menu and the close handshake
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, save state, undo, redo, fit, save)
    Palette.tsx        tools (select, red wire, green wire), the five building blocks, entity list
    SourcePane.tsx     file heading, SourceEditor, diagnostics list
    demoSession.ts     DEMO ONLY: in-memory controller (reducer, store, project commands, test hook)
    demoCircuit.ts     DEMO ONLY: the built-in example circuit and the 1,000 entity grid
    demoSource.ts      DEMO ONLY: prints a Circuit as face source text
  canvas/
    Canvas.tsx         SVG canvas: camera, gestures, pending wire, selection toolbar, context menu; emits callbacks only
    Scene.tsx          memoized wires and cards, culled to the visible area
    EntityCard.tsx     one memoized card (icon, name, summary, terminals per TERMINALS)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and terminal geometry, rectangles          (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes and SVG path data                   (pure)
  editor/
    SourceEditor.tsx   CodeMirror 6 wrapper (line numbers, history, external extensions, tokenize prop)
    theme.ts           editor chrome in the app palette
    tokenHighlight.ts  decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, settings slot, connections
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm
    SignalField.tsx    validated `kind:name[@quality]` input with a `renderPicker` slot
    fields.tsx, formParts.tsx, immutable.ts, validation.ts
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels, signal text forms, card summaries  (pure)
  icons/               interface glyphs, entity icons (placeholder pictograms, resolver, catalog probe)
  styles/              tokens.css and one stylesheet per area
test/                  vitest unit tests for the pure modules and the demo session
```

End-to-end tests live in `tests/e2e/` and drive the built app with Playwright's Electron support.

## The WorkbenchController seam

`workbench/controller.ts` defines what the workbench needs from the layer that owns the document:

```ts
interface WorkbenchController {
  readonly state: WorkbenchState;       // immutable snapshot; a new object per change, unchanged parts keep identity
  readonly commands: WorkbenchCommands; // stable object; commands never throw, failures arrive as state.error
  readonly editorExtensions?: readonly Extension[]; // CodeMirror extensions from the session
  readonly tokenize?: Tokenizer;        // (source) => { kind, from, to }[] for highlighting
}
```

`WorkbenchState`: `project` (name, path, fileName, dirty), `circuit` (last valid `Circuit`), `editable` (false while the source has errors),
`selection`, `mode`, `tool`, `source`, `diagnostics`, `canUndo` / `canRedo`, `simulation` (`SimulationView`: running, tick, speed, traces,
per-entity status, notice) and `error`.

`WorkbenchCommands`: view (`setMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `updateEntity`,
`renameEntity`, `deleteEntities`, `addWire`, `removeWire`, `setSource`, `undo`, `redo`), simulation (`run`, `pause`, `step`,
`resetSimulation`, `setSpeed`) and project (`newProject`, `openProject`, `loadProject`, `save`, `saveAs`).

To connect the real language session, implement these two objects and return them from a hook used in `App.tsx` in place of
`useDemoSession`. Nothing under `canvas/`, `inspector/`, `editor/`, `simulation/` or the other `workbench/` views needs to change. Notes
for that work:

- Entity identity is `Entity.id`; all commands and the selection use ids, never names.
- Document commands are expected to update `state` synchronously. The canvas clears its drag preview in the same event in which it calls
  `moveEntities`; an asynchronous update would show the old position for a frame.
- The source editor stays mounted while hidden, so its history survives mode switches. `SourceEditor` applies a changed `value` as a
  minimal replacement without a history entry. A session that owns the CodeMirror document should dispatch its own transactions on the
  view (`SourceEditorHandle.view`) and keep `state.source` equal to the document, in which case the wrapper applies nothing.
- `Workbench` routes Edit menu commands by focus: plain text fields get the native command, everything else goes to `commands`.
- `simulation.entityStatus` feeds the status line and the highlight of each card; the demo leaves it empty.

## Design tokens

`styles/tokens.css` holds the approved theme as CSS custom properties; the other stylesheets and the CodeMirror theme refer to them.

| Group | Tokens |
| --- | --- |
| Surfaces | `--surface-window`, `-editor`, `-inset`, `-well`, `-titlebar`, `-projectbar`, `-palette`, `-inspector`, `-dock`, `-statusbar`, `-raised`, `-selected`, `-active`, `-popover` |
| Canvas | `--canvas-center` / `-mid` / `-edge`, `--canvas-dot`, `--card-top` / `-bottom` / `-border` / `-lit`, `--terminal-*` |
| Borders | `--border-subtle`, `--border`, `--border-strong`, `--border-input` |
| Text | `--text`, `--text-strong`, `--text-soft`, `--text-muted`, `--text-dim`, `--text-label` |
| Amber accent | `--amber`, `--amber-strong`, `--amber-bright`, `--amber-ink`, `--amber-border`, `--focus-ring` |
| Wires | `--wire-red`, `--wire-green`, `--wire-casing` (canvas); `--wire-red-ui`, `--wire-green-ui` and their `-surface` / `-border` (controls) |
| Entity kinds | `--kind-constant`, `--kind-arithmetic`, `--kind-decider`, `--kind-selector`, `--kind-lamp`; a `kind-<kind>` class sets `--kind-color` |
| Status | `--status-ok`, `--status-warning`, `--status-error`, `--danger*`, `--notice-*` |
| Typography | `--font-ui`, `--font-mono`, `--text-xs` ... `--text-xl`, `--tracking-label` |
| Layout | `--titlebar-height`, `--projectbar-height`, `--palette-width`, `--inspector-width`, `--dock-height`, `--statusbar-height`, `--radius-*` |

Token classes for source highlighting (`face-tok-keyword`, `-string`, `-number`, `-comment`, `-signal`, `-atom`, `-name`, `-operator`,
`-punctuation`, `-color-red`, `-color-green`, `-invalid`) are in `styles/source.css`; `editor/tokens.ts` maps tokenizer kinds to them.

## Canvas behaviour worth knowing

- Grid 20 units; cards are 184 x 128 with both terminals 80 units below the top edge. Red attaches 5 units above the terminal center,
  green 5 below.
- Routes (`wireRouting.ts`): output to an input on its right is a bezier whose control points are shifted so the two colors stay apart on
  steep stretches; an input that is not to the right gets an orthogonal detour with exactly parallel colors; a feedback wire loops over
  the top of its own card with 30 (red) and 48 (green) units of clearance. Routes do not avoid other cards.
- A drop is computed from the press and release coordinates of the pointer, not from the rendered preview.
- The wheel listener is registered non-passive on the canvas container and cancels scrolling.
- Deletion: toolbar attached to the selection, context menu, Delete / Backspace while focus is inside the canvas, Edit > Delete, and the
  Delete button at the top of the inspector. Keys never delete while a text control or the source editor has focus.
- Rendering: the scene is memoized against a culling rectangle snapped to a 400 unit lattice, cards and wires are memoized individually,
  cards become outlines below 30 % zoom, and the drop shadow is skipped above 60 visible cards.

## Entity icons

`EntityIcon` / `EntityIconSvg` take an `EntityIconResolver` (`(kind) => url | undefined`). `icons/catalogEntityIcons.ts` probes the five
item icons of the generated catalog through `face-asset://catalog/icons/item/<name>.png` and resolves only those that load; every other
kind, and every kind when `packages/catalog/generated` is absent, shows an inline SVG pictogram.

## Demo only

Everything in `demoSession.ts`, `demoCircuit.ts` and `demoSource.ts` exists so the workbench can be used and tested before
`packages/language` and `packages/simulation` are wired in:

- The circuit is the source of truth and the text is printed from it. Typed text is kept and saved but not parsed; the next canvas edit
  replaces it (an info diagnostic says so).
- A project opened from disk is shown as source only (`editable` false, empty canvas): nothing here can parse it.
- Undo and redo are a stack of circuit snapshots, separate from the editor's own history.
- Simulation controls move a tick counter; the traces are a synthetic waveform, labelled as such in the dock. No entity status is shown.
- No tokenizer is supplied, so the source is not highlighted.
- `window.faceDemo` (`loadGrid`, `loadCircuit`, `getCircuit`) is a hook for the end-to-end tests and the scale measurement.

## Commands

```
source scripts/env.sh
npm run build                 # dist/renderer, dist/main.cjs, dist/preload.cjs   (node scripts/build.mjs --watch to rebuild on change)
npm start                     # run the built app; profile in .runtime/user-data
npx vitest run apps           # unit tests
npm run test:e2e              # Playwright against the built app; output in .runtime/
```

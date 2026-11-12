# @face/renderer

The React workbench of FActorio Circuit Editor. It runs in the sandboxed Electron renderer and talks to the main process only through the
typed `window.face` API (`apps/desktop/src/ipc.ts`, imported type-only).

Two layers:

- `session/` owns everything that is not a view: the source document with its history, the analysis, the selection, the simulation, the
  catalog services and the project file. It is plain TypeScript without React and runs headless (that is how it is tested).
- Everything else is presentational: views take plain props (types from `@face/model`, view state, callbacks) and contain no document
  logic. `App.tsx` is the one place that connects the two.

## Structure

```
src/
  App.tsx              composition root: session hook, catalog icons, signal picker and signal descriptions for the views
  main.tsx, index.html entry point; index.html carries the Content-Security-Policy
  session/
    projectSession.ts  ProjectSession: implements WorkbenchController, wires the parts below, batches change notifications
    document.ts        SourceDocument: the CodeMirror EditorState (text, history, selection) with or without a mounted view
    analysis.ts        runs the language per document version, drops stale results, keeps the last valid circuit, shares structure
    drafts.ts          inspector edits the language cannot write yet: normalization, completeness check, hints
    simulationRunner.ts  compile on change, keep state by semantic fingerprint, timer, bounded history, SimulationView
    simulationView.ts  snapshots to dock traces and card statuses                    (pure)
    catalogService.ts  per module set: SignalResolver, signal info, picker tree, module list for the settings
    environment.ts     simulation environment from the catalog (order, stack sizes, rocket capacity, qualities)   (pure)
    persistence.ts     project file mapping, dirty comparison, starter project      (pure)
    completion.ts      completion candidates from the language's expectations and the catalog   (pure)
    editorSupport.ts   CodeMirror glue: token kinds, lint transaction, completion source
    starter.ts         the example circuit of docs/dsl.md, the content of a new project
    useProjectSession.ts  React binding (useSyncExternalStore) and the `window.faceSession` probe
  workbench/
    controller.ts      the WorkbenchController seam (state, commands, shared view types)
    Workbench.tsx      shell: lays out the panels, routes callbacks to commands, wires the native menu and the close handshake
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, save state, undo, redo, fit, settings, save)
    Palette.tsx        tools (select, red wire, green wire), the five building blocks, entity list
    SourcePane.tsx     file heading, SourceEditor, problems list (errors first, a click selects the range)
  canvas/
    Canvas.tsx         SVG canvas: camera, gestures, pending wire, selection toolbar, context menu; emits callbacks only
    Scene.tsx          memoized wires and cards, culled to the visible area
    EntityCard.tsx     one memoized card (icon, name, summary, live status line, terminals per TERMINALS)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and terminal geometry, rectangles          (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes and SVG path data                   (pure)
  editor/
    SourceEditor.tsx   CodeMirror view over an `EditorBinding`; owns no state
    extensions.ts      editor chrome: gutters, selection, indentation, keys, theme
    theme.ts           editor colors in the app palette
    tokenHighlight.ts  viewport decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, draft hint, settings slot, connections
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm
    SignalField.tsx    validated `kind:name[@quality]` input with icon, name, warning and the picker slot
    fields.tsx, formParts.tsx, immutable.ts, validation.ts
  picker/
    SignalPicker.tsx   signal picker like the game's: group tabs, subgroup rows, search, quality row
  settings/
    ProjectSettings.tsx  project name and the five standard modules as signal groups
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels, signal text forms, card summaries  (pure)
  icons/               interface glyphs, entity icons, catalog icon resolvers (with probes for the git-ignored artwork)
  styles/              tokens.css and one stylesheet per area
test/                  vitest: pure view modules
test/session/          vitest: the session, headless (commands, invalid source, simulation, catalog, persistence, drafts)
```

End-to-end tests live in `tests/e2e/` and drive the built app with Playwright's Electron support.

## The WorkbenchController seam

`workbench/controller.ts` defines what the views get from the session:

```ts
interface WorkbenchController {
  readonly state: WorkbenchState;       // immutable snapshot; a new object per change, unchanged parts keep identity
  readonly commands: WorkbenchCommands; // stable object; commands never throw, failures arrive as state.error
  readonly editor: EditorBinding;       // the session-owned editor state: { state, apply(transactions), attach(view) }
}
```

`WorkbenchState`: `project` (name, path, fileName, dirty, epoch), `circuit` (last valid `Circuit`), `editable` (false while the source
has errors), `selection`, `mode`, `tool`, `source`, `diagnostics` (with line numbers), `canUndo` / `canRedo`, `simulation`
(`SimulationView`: running, tick, speed, traces, per-entity status, notice), `catalog` (`CatalogView`: modules, qualities, `picker()`,
`describe(signal)`), `draft` (pending inspector edit of the selected entity) and `error`.

`WorkbenchCommands`: view (`setMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `updateEntity`,
`discardDraft`, `renameEntity`, `deleteEntities`, `addWire`, `removeWire`, `setSource`, `undo`, `redo`), simulation (`run`, `pause`,
`step`, `resetSimulation`, `setSpeed`), settings (`setModuleEnabled`, `setProjectName`) and project (`newProject`, `openProject`,
`loadProject`, `save`, `saveAs`).

## How the session works

- **One document, one history.** `SourceDocument` holds a CodeMirror `EditorState`. A mounted `SourceEditor` is created from that state
  and hands every transaction to `EditorBinding.apply`; the session's own edits go through the same function. Mounting, hiding or
  unmounting the editor changes nothing about text, history or selection. Undo and redo are CodeMirror's, for typing, canvas and inspector
  alike.
- **Commands are source patches.** Every graphical command runs the matching `@face/language` edit command against the current analysis
  and dispatches its text changes as one transaction with `isolateHistory`, so it is exactly one undo step. A command without changes
  (a wire that exists, a move to the same place) dispatches nothing. Typing never merges into a command step.
- **Field edits are one step.** The inspector passes a `coalesce` key per focus of a text or color input; consecutive `updateEntity`
  calls with the same key, with nothing else touching the document in between, are merged into the previous history event.
- **Analysis.** Every document change bumps a version and runs `analyze(source, previous, { signals, version })` synchronously.
  `Analysis.accept` only takes the result of the latest request, so the same code path works when the analysis moves to a worker;
  `ProjectSession.acceptAnalysis` is the entry point for that. With errors, `editable` is false, the last valid circuit stays, and
  commands and simulation are blocked. Entities whose declaration text did not change keep their object identity, which is what lets the
  memoized cards skip rendering.
- **Selection** is a list of entity ids. Ids come from the language session and survive renames, by command or by typing. A caret the user
  places inside a declaration selects that entity.
- **Inspector drafts.** Forms emit complete entities. `drafts.ts` first sets fields without meaning to what the language implies (the
  output constant while copying the input count, the join of the first condition, ...). If the result is still not expressible (a
  condition without signal, an expression without output, a signal twice in a section), it is kept in `state.draft` with a hint; the
  inspector shows the draft instead of the entity, and the next edit that makes it valid writes all of it as one step. A draft is dropped
  when the selection moves on, when it is discarded, or when its entity changes in the source.
- **Diagnostics** go to `state.diagnostics` and, as a separate effect-only transaction, to the lint extension. Highlighting uses the tokens
  of the analysis the session already has; completion maps the language's `completionContext` to keywords, properties, enum values,
  entity terminals and the catalog signals of the enabled modules.
- **Catalog.** `CatalogService` is rebuilt when the project's module list changes. It is the language's `SignalResolver` (unknown and
  disabled signals are warnings; text is never touched), the source of names and icon ids, and the picker tree. `SignalField` receives
  the wildcards its slot accepts (`SIGNAL_SLOTS` of the language) and the picker offers no others.
- **Simulation.** `SimulationRunner` compiles each new valid circuit with the catalog environment. If `semanticFingerprint` is unchanged
  (moves, renames, comments) the running engine, its tick and its history stay; otherwise it starts at tick 0. It has no reference to the
  document, so no simulation activity can create an edit. While the source has errors it is blocked with a notice and resumes afterwards.
  The dock traces every output signal of the selected entities (the first three entities when nothing is selected); lamps trace their
  lit state; what an entity reads per wire color is in the row's tooltip.
- **Project files.** New project (the example circuit), open, save, save as and open recent go through `window.face`. Dirty means: the text
  or the settings (name, module set) differ from what was saved. Manifest fields this version does not edit (custom signal groups, unknown
  fields in `extras`, other circuit files) are written back as loaded.

`window.faceSession` (`getState()`, `commands`) exposes the controller for the end-to-end tests and measurements; it adds no behaviour.

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

## Icons

`EntityIcon` / `EntityIconSvg` take an `EntityIconResolver` (`(kind) => url | undefined`). `icons/catalogEntityIcons.ts` probes the five
item icons of the generated catalog through `face-asset://catalog/icons/item/<name>.png` and resolves only those that load.
`icons/catalogSignalIcons.ts` does the same for signal, group and quality icons with one probe. When `packages/catalog/generated` is absent
(it is git-ignored), entity kinds show inline pictograms and signals are shown by name, in the picker as well.

## Commands

```
source scripts/env.sh
npm run build                 # dist/renderer, dist/main.cjs, dist/preload.cjs   (node scripts/build.mjs --watch to rebuild on change)
npm start                     # run the built app; profile in .runtime/user-data
npx vitest run apps           # unit tests (session tests need no DOM)
npm run test:e2e              # Playwright against the built app; output in .runtime/
```

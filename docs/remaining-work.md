# Remaining work

Maintained by the coordinator. Scope reference: the milestones in `../../HANDOFF.md`. Items move out of this file when they are done and verified.

## Milestone 1 (foundation and vertical slice)

- [ ] Simulation engine package finished and verified (`packages/simulation`).
- [ ] Desktop shell and presentational workbench finished and verified (`apps/`, e2e harness).
- [ ] Session integration: CodeMirror document as the single history; parse/analyze per version with stale-result guards; canvas and inspector commands as source patches; catalog-backed signal resolver, picker and icons; simulation dock on the real engine; project save/reopen through IPC.
- [ ] Native (OS-level) UI check of the integrated app.

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

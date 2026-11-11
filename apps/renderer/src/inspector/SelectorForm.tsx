import { SELECTOR_OPERATIONS, type SelectorCombinator, type SelectorMode, type SelectorOperation } from "@face/model";
import { COMPARATOR_OPTIONS, IntField, SelectField, TextField, type SelectOption } from "./fields.tsx";
import { FormSection, OperandField } from "./formParts.tsx";
import { setOptional } from "./immutable.ts";
import { SignalField } from "./SignalField.tsx";

const OPERATION_LABELS: Readonly<Record<SelectorOperation, string>> = {
  select: "Select input",
  count: "Count inputs",
  random: "Random input",
  "stack-size": "Stack size",
  "rocket-capacity": "Rocket capacity",
  "quality-filter": "Quality filter",
  "quality-select": "Quality select",
  "quality-transfer": "Quality transfer",
  time: "Time",
};
const OPERATIONS: readonly SelectOption<SelectorOperation>[] = SELECTOR_OPERATIONS.map((value) => ({ value, label: OPERATION_LABELS[value] }));

/** The mode a selector gets when the user switches to `operation`; mirrors the language defaults in docs/dsl.md. */
const DEFAULT_MODES: { readonly [K in SelectorOperation]: Extract<SelectorMode, { operation: K }> } = {
  select: { operation: "select", max: true, index: { type: "constant", value: 0 }, indexComparator: "=" },
  count: { operation: "count" },
  random: { operation: "random", interval: 0 },
  "stack-size": { operation: "stack-size" },
  "rocket-capacity": { operation: "rocket-capacity" },
  "quality-filter": { operation: "quality-filter" },
  "quality-select": { operation: "quality-select", highest: true },
  "quality-transfer": { operation: "quality-transfer", source: { type: "signal" } },
  time: { operation: "time" },
};

const SORT_OPTIONS: readonly SelectOption<"max" | "min">[] = [
  { value: "max", label: "Descending (max first)" },
  { value: "min", label: "Ascending (min first)" },
];
const QUALITY_ORDER_OPTIONS: readonly SelectOption<"highest" | "lowest">[] = [
  { value: "highest", label: "Highest quality" },
  { value: "lowest", label: "Lowest quality" },
];
const TRANSFER_SOURCE_OPTIONS: readonly SelectOption<"quality" | "signal">[] = [
  { value: "signal", label: "From a signal" },
  { value: "quality", label: "Fixed quality" },
];

function ModeFields({ mode, onChange }: { readonly mode: SelectorMode; onChange(next: SelectorMode): void }) {
  switch (mode.operation) {
    case "select":
      return (
        <>
          <SelectField label="Order" wide value={mode.max ? "max" : "min"} options={SORT_OPTIONS} onChange={(order) => onChange({ ...mode, max: order === "max" })} />
          <OperandField label="Index" allowWildcards={false} value={mode.index} onChange={(index) => onChange({ ...mode, index })} />
          <SelectField label="Index comparator" wide value={mode.indexComparator} options={COMPARATOR_OPTIONS} onChange={(indexComparator) => onChange({ ...mode, indexComparator })} />
        </>
      );
    case "count":
      return <SignalField label="Output signal" wide allowWildcards={false} value={mode.output} onChange={(output) => onChange(setOptional(mode, "output", output))} />;
    case "random":
      return <IntField label="Update interval (ticks)" wide value={mode.interval} onChange={(interval) => onChange({ ...mode, interval })} />;
    case "quality-filter":
      return (
        <>
          <SelectField label="Comparator" value={mode.comparator ?? "="} options={COMPARATOR_OPTIONS} onChange={(comparator) => onChange({ ...mode, comparator })} />
          <TextField label="Quality" placeholder="normal" value={mode.quality ?? ""} onChange={(quality) => onChange(setOptional(mode, "quality", quality === "" ? undefined : quality))} />
        </>
      );
    case "quality-select":
      return <SelectField label="Order" wide value={mode.highest ? "highest" : "lowest"} options={QUALITY_ORDER_OPTIONS} onChange={(order) => onChange({ ...mode, highest: order === "highest" })} />;
    case "quality-transfer": {
      const source = mode.source;
      return (
        <>
          <SelectField
            label="Quality source"
            wide
            value={source.type}
            options={TRANSFER_SOURCE_OPTIONS}
            onChange={(type) => type !== source.type && onChange({ ...mode, source: type === "quality" ? { type: "quality", quality: "normal" } : { type: "signal" } })}
          />
          {source.type === "quality" ? (
            <TextField label="Quality" wide value={source.quality} onChange={(quality) => onChange({ ...mode, source: { type: "quality", quality } })} />
          ) : (
            <SignalField label="Source signal" wide value={source.signal} onChange={(next) => onChange({ ...mode, source: setOptional(source, "signal", next) })} />
          )}
          <SignalField label="Destination signal" wide value={mode.destination} onChange={(destination) => onChange(setOptional(mode, "destination", destination))} />
        </>
      );
    }
    case "time":
      return (
        <>
          <SignalField label="Day length signal" wide allowWildcards={false} value={mode.dayLength} onChange={(next) => onChange(setOptional(mode, "dayLength", next))} />
          <SignalField label="Day tick signal" wide allowWildcards={false} value={mode.dayTick} onChange={(next) => onChange(setOptional(mode, "dayTick", next))} />
          <SignalField label="Game tick signal" wide allowWildcards={false} value={mode.gameTick} onChange={(next) => onChange(setOptional(mode, "gameTick", next))} />
        </>
      );
    case "stack-size":
    case "rocket-capacity":
      return <p className="muted-note wide">This operation has no settings.</p>;
  }
}

export function SelectorForm({ entity, onChange }: { readonly entity: SelectorCombinator; onChange(next: SelectorCombinator): void }) {
  const setMode = (mode: SelectorMode): void => onChange({ ...entity, mode });
  return (
    <FormSection title="Operation">
      <div className="field-grid">
        <SelectField label="Operation" wide value={entity.mode.operation} options={OPERATIONS} onChange={(operation) => operation !== entity.mode.operation && setMode(DEFAULT_MODES[operation])} />
        <ModeFields mode={entity.mode} onChange={setMode} />
      </div>
    </FormSection>
  );
}

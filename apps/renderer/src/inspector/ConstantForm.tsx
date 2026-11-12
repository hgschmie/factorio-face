import { SIGNAL_SLOTS } from "@face/language";
import { sameSignal, signal, type ConstantCombinator, type ConstantFilter, type ConstantSection, type SignalId } from "@face/model";
import { CheckboxField, IntField, TextField } from "./fields.tsx";
import { AddButton, DEFAULT_SIGNAL, FormSection, ListItem } from "./formParts.tsx";
import { removeAt, replaceAt, setOptional } from "./immutable.ts";
import { SignalField } from "./SignalField.tsx";

const NEW_SECTION: ConstantSection = { active: true, multiplier: 1, filters: [{ signal: DEFAULT_SIGNAL, count: 1 }] };
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A signal may appear once per section, so a new row starts with the first letter signal the section does not use yet. */
function newFilter(section: ConstantSection): ConstantFilter {
  const used = (candidate: SignalId): boolean => section.filters.some((filter) => sameSignal(filter.signal, candidate));
  const free = [...LETTERS].map((letter) => signal("virtual", `signal-${letter}`)).find((candidate) => !used(candidate));
  return { signal: free ?? DEFAULT_SIGNAL, count: 1 };
}

function SectionEditor({ section, index, onChange, onRemove }: { readonly section: ConstantSection; readonly index: number; onChange(next: ConstantSection): void; onRemove(): void }) {
  const title = `Section ${index + 1}`;
  const setFilter = (filterIndex: number, filter: ConstantFilter): void => onChange({ ...section, filters: replaceAt(section.filters, filterIndex, filter) });
  return (
    <ListItem title={title} removeLabel={`Remove ${title.toLowerCase()}`} onRemove={onRemove}>
      <TextField
        label="Logistic group"
        wide
        placeholder="none"
        value={section.group ?? ""}
        onChange={(group) => onChange(setOptional(section, "group", group === "" ? undefined : group))}
      />
      <IntField label="Multiplier" value={section.multiplier} onChange={(multiplier) => onChange({ ...section, multiplier })} />
      <CheckboxField label="Active" checked={section.active} onChange={(active) => onChange({ ...section, active })} />
      {section.filters.map((filter, filterIndex) => (
        <div className="filter-row wide" key={filterIndex}>
          <SignalField label={`Signal ${filterIndex + 1}`} value={filter.signal} required wildcards={SIGNAL_SLOTS["constant.filter"]} onChange={(next) => next && setFilter(filterIndex, { ...filter, signal: next })} />
          <IntField label="Count" value={filter.count} onChange={(count) => setFilter(filterIndex, { ...filter, count })} />
          <button type="button" className="remove-button" aria-label={`Remove signal ${filterIndex + 1}`} title="Remove signal" onClick={() => onChange({ ...section, filters: removeAt(section.filters, filterIndex) })}>
            &times;
          </button>
        </div>
      ))}
      <AddButton label="Add signal" onClick={() => onChange({ ...section, filters: [...section.filters, newFilter(section)] })} />
    </ListItem>
  );
}

export function ConstantForm({ entity, onChange }: { readonly entity: ConstantCombinator; onChange(next: ConstantCombinator): void }) {
  return (
    <FormSection title="Signals">
      <CheckboxField label="Output enabled" checked={entity.enabled} onChange={(enabled) => onChange({ ...entity, enabled })} />
      {entity.sections.map((section, index) => (
        <SectionEditor
          key={index}
          section={section}
          index={index}
          onChange={(next) => onChange({ ...entity, sections: replaceAt(entity.sections, index, next) })}
          onRemove={() => onChange({ ...entity, sections: removeAt(entity.sections, index) })}
        />
      ))}
      <AddButton label={entity.sections.length === 0 ? "Add signal" : "Add section"} onClick={() => onChange({ ...entity, sections: [...entity.sections, NEW_SECTION] })} />
    </FormSection>
  );
}

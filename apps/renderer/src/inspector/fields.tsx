// Small controlled form fields used by the inspector forms.
import { COMPARATORS, WIRE_COLORS, type Comparator, type NetworkSelection, type WireColor } from "@face/model";
import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { parseInt32, parseNumberInRange, type ParseResult } from "./validation.ts";

/**
 * Counts the times the inspector dropped the text its fields hold on their own (it does on undo and redo). A field shows its
 * local text only while the count it was typed under is current; after that it shows its value again.
 */
export const FieldTextEpochContext = createContext(0);

/** The text of a field while it differs from the field's value: what the user typed and the field has not written, or keeps as typed. */
export function useFieldText(): readonly [text: string | null, setText: (text: string | null) => void] {
  const epoch = useContext(FieldTextEpochContext);
  const [typed, setTyped] = useState<{ readonly text: string; readonly epoch: number } | null>(null);
  return [typed?.epoch === epoch ? typed.text : null, (text) => setTyped(text === null ? null : { text, epoch })];
}

/**
 * Text editing over a typed value. While the text does not parse, it is kept as a local draft and nothing is emitted;
 * every valid text is emitted immediately. Escape drops the draft. An input showing text that was not emitted carries
 * `data-unwritten` (see `Inspector`: undo takes such text back before it touches the history).
 */
export function useDraft<T>(value: T, format: (value: T) => string, parse: (text: string) => ParseResult<T>, onCommit: (value: T) => void) {
  const [draft, setDraft] = useFieldText();
  const result = draft === null ? null : parse(draft);
  return {
    text: draft ?? format(value),
    error: result && !result.ok ? result.message : null,
    onChange: (text: string): void => {
      setDraft(text);
      const parsed = parse(text);
      if (parsed.ok) onCommit(parsed.value);
    },
    onBlur: (): void => {
      if (!result || result.ok) setDraft(null);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape" && draft !== null) {
        event.stopPropagation();
        setDraft(null);
      }
    },
  };
}

export function Field({ label, htmlFor, children, wide = false, error }: { readonly label: string; readonly htmlFor: string; readonly children: ReactNode; readonly wide?: boolean; readonly error?: string | null }) {
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/** `ariaLabel` names the control for assistive technology when the short visible label is ambiguous on its own. */
export function IntField({ label, ariaLabel = label, value, onChange, wide }: { readonly label: string; readonly ariaLabel?: string; readonly value: number; readonly wide?: boolean; onChange(value: number): void }) {
  const id = useId();
  const draft = useDraft(value, String, parseInt32, onChange);
  return (
    <Field label={label} htmlFor={id} wide={wide} error={draft.error}>
      <input id={id} type="text" inputMode="numeric" aria-label={ariaLabel} aria-invalid={draft.error !== null} data-unwritten={draft.error !== null || undefined} value={draft.text} onChange={(event) => draft.onChange(event.target.value)} onBlur={draft.onBlur} onKeyDown={draft.onKeyDown} />
    </Field>
  );
}

/** A number that may have decimals, from `min` to `max`: a percentage. Text outside the range is kept as typed and not written, like text that is no number. */
export function NumberField({ label, ariaLabel = label, value, min, max, onChange, wide }: { readonly label: string; readonly ariaLabel?: string; readonly value: number; readonly min: number; readonly max: number; readonly wide?: boolean; onChange(value: number): void }) {
  const id = useId();
  const draft = useDraft(value, String, (text) => parseNumberInRange(text, min, max), onChange);
  return (
    <Field label={label} htmlFor={id} wide={wide} error={draft.error}>
      <input id={id} type="text" inputMode="decimal" aria-label={ariaLabel} aria-invalid={draft.error !== null} data-unwritten={draft.error !== null || undefined} value={draft.text} onChange={(event) => draft.onChange(event.target.value)} onBlur={draft.onBlur} onKeyDown={draft.onKeyDown} />
    </Field>
  );
}

export function TextField(props: { readonly label: string; readonly ariaLabel?: string; readonly value: string; readonly placeholder?: string; readonly wide?: boolean; onChange(value: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id} wide={props.wide}>
      <input id={id} type="text" spellCheck={false} autoComplete="off" aria-label={props.ariaLabel ?? props.label} value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
    </Field>
  );
}

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function SelectField<T extends string>(props: { readonly label: string; readonly ariaLabel?: string; readonly value: T; readonly options: readonly SelectOption<T>[]; readonly wide?: boolean; onChange(value: T): void }) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id} wide={props.wide}>
      <select id={id} aria-label={props.ariaLabel ?? props.label} value={props.value} onChange={(event) => props.onChange(event.target.value as T)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const COMPARATOR_LABELS: Readonly<Record<Comparator, string>> = { "<": "<", ">": ">", "=": "=", "!=": "≠", "<=": "≤", ">=": "≥" };
export const COMPARATOR_OPTIONS: readonly SelectOption<Comparator>[] = COMPARATORS.map((value) => ({ value, label: COMPARATOR_LABELS[value] }));

export function CheckboxField({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** The wire colors connected to the input terminal of the entity a form edits. Undefined where that is not known. */
export const InputWiresContext = createContext<NetworkSelection | undefined>(undefined);

/**
 * Red/green input network selection. As in the game both may be off (the signal is then read from no network), and a color without
 * a wire on the input is grayed but stays operable.
 */
export function NetworkToggle({ label, value, onChange }: { readonly label: string; readonly value: NetworkSelection; onChange(value: NetworkSelection): void }) {
  const wired = useContext(InputWiresContext);
  const button = (color: WireColor) => {
    const unwired = wired !== undefined && !wired[color];
    return (
      <button
        key={color}
        type="button"
        className={unwired ? `${color} unwired` : color}
        aria-pressed={value[color]}
        aria-label={`${label}: ${color} network`}
        title={unwired ? `No ${color} wire connected to the input` : `Read the ${color} network`}
        onClick={() => onChange({ ...value, [color]: !value[color] })}
      >
        {color === "red" ? "R" : "G"}
      </button>
    );
  };
  return (
    <span className="network-toggle" role="group" aria-label={label}>
      {WIRE_COLORS.map(button)}
    </span>
  );
}

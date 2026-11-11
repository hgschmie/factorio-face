// Small controlled form fields used by the inspector forms.
import { COMPARATORS, type Comparator, type NetworkSelection } from "@face/model";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { parseInt32, type ParseResult } from "./validation.ts";

/**
 * Text editing over a typed value. While the text does not parse, it is kept as a local draft and nothing is emitted;
 * every valid text is emitted immediately. Escape drops the draft.
 */
export function useDraft<T>(value: T, format: (value: T) => string, parse: (text: string) => ParseResult<T>, onCommit: (value: T) => void) {
  const [draft, setDraft] = useState<string | null>(null);
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
      <input id={id} type="text" inputMode="numeric" aria-label={ariaLabel} aria-invalid={draft.error !== null} value={draft.text} onChange={(event) => draft.onChange(event.target.value)} onBlur={draft.onBlur} onKeyDown={draft.onKeyDown} />
    </Field>
  );
}

export function TextField(props: { readonly label: string; readonly value: string; readonly placeholder?: string; readonly wide?: boolean; onChange(value: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id} wide={props.wide}>
      <input id={id} type="text" aria-label={props.label} value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
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

/** Red/green input network selection. At least one network stays selected. */
export function NetworkToggle({ label, value, onChange }: { readonly label: string; readonly value: NetworkSelection; onChange(value: NetworkSelection): void }) {
  const toggle = (color: "red" | "green"): void => {
    const next = { ...value, [color]: !value[color] };
    if (next.red || next.green) onChange(next);
  };
  return (
    <span className="network-toggle" role="group" aria-label={label}>
      <button type="button" className="red" aria-pressed={value.red} aria-label={`${label}: red network`} title="Read the red network" onClick={() => toggle("red")}>
        R
      </button>
      <button type="button" className="green" aria-pressed={value.green} aria-label={`${label}: green network`} title="Read the green network" onClick={() => toggle("green")}>
        G
      </button>
    </span>
  );
}

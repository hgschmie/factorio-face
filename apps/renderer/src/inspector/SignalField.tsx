// Signal input: a validated text field for `kind:name[@quality]` (or a wildcard keyword the slot accepts), with the
// signal's icon and name from the catalog and a picker. Catalog knowledge arrives through two contexts, so the forms stay
// free of it: `SignalPickerContext` renders the picker, `SignalInfoContext` describes a signal.
import type { SignalId, Wildcard } from "@face/model";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { formatSignal } from "../entities/signalText.ts";
import { Field, useDraft } from "./fields.tsx";
import { parseSignalField, SIGNAL_FORMAT_HINT } from "./validation.ts";

export interface SignalPickerProps {
  readonly value: SignalId | undefined;
  /** The wildcards this slot accepts; the picker offers no others. */
  readonly wildcards: readonly Wildcard[];
  onSelect(signal: SignalId | undefined): void;
  close(): void;
}

export type SignalPickerRenderer = (props: SignalPickerProps) => ReactNode;

/** Default picker for every SignalField below the provider. */
export const SignalPickerContext = createContext<SignalPickerRenderer | undefined>(undefined);

/** How a signal is presented: its name in the game, its icon, and a note when the project's modules do not provide it. */
export interface SignalPresentation {
  readonly displayName?: string;
  readonly iconUrl?: string;
  readonly warning?: string;
}

export type SignalDescriber = (signal: SignalId) => SignalPresentation;

export const SignalInfoContext = createContext<SignalDescriber | undefined>(undefined);

const NO_WILDCARDS: readonly Wildcard[] = [];

export interface SignalFieldProps {
  readonly label: string;
  /** Accessible name when the visible label alone is ambiguous; defaults to `label`. */
  readonly ariaLabel?: string;
  readonly value: SignalId | undefined;
  /** When true the field may not be left empty. */
  readonly required?: boolean;
  /** Wildcards (`each`, `anything`, `everything`) this slot accepts; none by default. */
  readonly wildcards?: readonly Wildcard[];
  readonly wide?: boolean;
  /** Controls that belong to the signal, such as its network selection; placed at the end of the signal's row. */
  readonly trailing?: ReactNode;
  readonly renderPicker?: SignalPickerRenderer;
  onChange(value: SignalId | undefined): void;
}

export function SignalField({ label, ariaLabel = label, value, required = false, wildcards = NO_WILDCARDS, wide, trailing, renderPicker, onChange }: SignalFieldProps) {
  const id = useId();
  const contextPicker = useContext(SignalPickerContext);
  const describe = useContext(SignalInfoContext);
  const picker = renderPicker ?? contextPicker;
  const [pickerOpen, setPickerOpen] = useState(false);
  const draft = useDraft<SignalId | undefined>(
    value,
    (signal) => (signal ? formatSignal(signal) : ""),
    (text) => parseSignalField(text, required, wildcards),
    onChange,
  );
  const info = value && describe ? describe(value) : undefined;

  return (
    <Field label={label} htmlFor={id} wide={wide} error={draft.error}>
      <span className="signal-input">
        {info?.iconUrl && <img className="signal-icon" src={info.iconUrl} width={20} height={20} alt="" draggable={false} />}
        <input
          id={id}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={draft.error !== null}
          data-unwritten={draft.error !== null || undefined}
          placeholder={required ? "kind:name" : "none"}
          title={info?.displayName ?? SIGNAL_FORMAT_HINT}
          value={draft.text}
          onChange={(event) => draft.onChange(event.target.value)}
          onBlur={draft.onBlur}
          onKeyDown={draft.onKeyDown}
        />
        {picker && (
          <button type="button" className="signal-picker-button" aria-label={`Choose ${ariaLabel.toLowerCase()}`} aria-expanded={pickerOpen} title="Choose a signal" onClick={() => setPickerOpen((open) => !open)}>
            ...
          </button>
        )}
        {trailing}
      </span>
      {!draft.error && info?.warning && (
        <small className="field-warning" role="note">
          {info.warning}
        </small>
      )}
      {picker &&
        pickerOpen &&
        picker({
          value,
          wildcards,
          onSelect: (signal) => {
            onChange(signal);
            setPickerOpen(false);
          },
          close: () => setPickerOpen(false),
        })}
    </Field>
  );
}

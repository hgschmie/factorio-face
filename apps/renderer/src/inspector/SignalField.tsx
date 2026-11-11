// Signal input. For now a validated text field for `kind:name[@quality]` (or a wildcard keyword); the catalog-backed
// picker plugs in through `renderPicker` or, for a whole inspector at once, through `SignalPickerContext`.
import type { SignalId } from "@face/model";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { formatSignal } from "../entities/signalText.ts";
import { Field, useDraft } from "./fields.tsx";
import { parseSignalField, SIGNAL_FORMAT_HINT } from "./validation.ts";

export interface SignalPickerProps {
  readonly value: SignalId | undefined;
  readonly allowWildcards: boolean;
  onSelect(signal: SignalId | undefined): void;
  close(): void;
}

export type SignalPickerRenderer = (props: SignalPickerProps) => ReactNode;

/** Default picker for every SignalField below the provider. */
export const SignalPickerContext = createContext<SignalPickerRenderer | undefined>(undefined);

export interface SignalFieldProps {
  readonly label: string;
  /** Accessible name when the visible label alone is ambiguous; defaults to `label`. */
  readonly ariaLabel?: string;
  readonly value: SignalId | undefined;
  /** When true the field may not be left empty. */
  readonly required?: boolean;
  /** `each`, `anything` and `everything` are accepted unless this is false. */
  readonly allowWildcards?: boolean;
  readonly wide?: boolean;
  readonly renderPicker?: SignalPickerRenderer;
  onChange(value: SignalId | undefined): void;
}

export function SignalField({ label, ariaLabel = label, value, required = false, allowWildcards = true, wide, renderPicker, onChange }: SignalFieldProps) {
  const id = useId();
  const contextPicker = useContext(SignalPickerContext);
  const picker = renderPicker ?? contextPicker;
  const [pickerOpen, setPickerOpen] = useState(false);
  const draft = useDraft<SignalId | undefined>(
    value,
    (signal) => (signal ? formatSignal(signal) : ""),
    (text) => parseSignalField(text, required, allowWildcards),
    onChange,
  );

  return (
    <Field label={label} htmlFor={id} wide={wide} error={draft.error}>
      <span className="signal-input">
        <input
          id={id}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={draft.error !== null}
          placeholder={required ? "kind:name" : "none"}
          title={SIGNAL_FORMAT_HINT}
          value={draft.text}
          onChange={(event) => draft.onChange(event.target.value)}
          onBlur={draft.onBlur}
          onKeyDown={draft.onKeyDown}
        />
        {picker && (
          <button type="button" className="signal-picker-button" aria-label={`Choose ${ariaLabel.toLowerCase()}`} aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
            ...
          </button>
        )}
      </span>
      {picker &&
        pickerOpen &&
        picker({
          value,
          allowWildcards,
          onSelect: (signal) => {
            onChange(signal);
            setPickerOpen(false);
          },
          close: () => setPickerOpen(false),
        })}
    </Field>
  );
}

// The settings of a programmable speaker, as the game's dialog has them: when it plays (a circuit condition, or a signal
// whose value picks the note), what it plays, how loud and where it is heard, and the alert it shows.
import { SIGNAL_SLOTS } from "@face/language";
import { DEFAULT_ENTITY, SPEAKER_PLAYBACK_MODES, SPEAKER_VOLUME_RANGE, wildcardOf, type Condition, type Speaker, type SpeakerPlaybackMode } from "@face/model";
import { useContext } from "react";
import { CheckboxField, NumberField, SelectField, TextField, type SelectOption } from "./fields.tsx";
import { ConditionFields, DEFAULT_SIGNAL, FormSection } from "./formParts.tsx";
import { setOptional } from "./immutable.ts";
import { InstrumentsContext } from "./instruments.ts";
import { SignalField } from "./SignalField.tsx";
import { withSpeakerInstrument, withSpeakerNote } from "./speakerEdits.ts";

type Trigger = "condition" | "pitch";

const TRIGGERS: readonly SelectOption<Trigger>[] = [
  { value: "condition", label: "While a condition holds" },
  { value: "pitch", label: "Signal value is pitch" },
];
/** A condition nobody has filled in: the game's blank condition, which never holds. */
const BLANK_CONDITION: Condition = { comparator: "<", second: { type: "constant", value: 0 } };
const PLAYBACK_LABELS: Readonly<Record<SpeakerPlaybackMode, string>> = { local: "Local: near the speaker", surface: "Surface: on its whole surface", global: "Global: everywhere (Universe)" };
const PLAYBACK_MODES: readonly SelectOption<SpeakerPlaybackMode>[] = SPEAKER_PLAYBACK_MODES.map((value) => ({ value, label: PLAYBACK_LABELS[value] }));

/** The options of a select over names of the game data; a name the list does not have (another game version, a mod) stays selectable as it is. */
function nameOptions(known: readonly { readonly name: string; readonly displayName: string }[], current: string | undefined): SelectOption<string>[] {
  const options = known.map(({ name, displayName }) => ({ value: name, label: displayName }));
  return current === undefined || known.some((entry) => entry.name === current) ? options : [...options, { value: current, label: `${current} (not in the game data)` }];
}

export function SpeakerForm({ entity, onChange }: { readonly entity: Speaker; onChange(next: Speaker): void }) {
  const instruments = useContext(InstrumentsContext);
  const pitch = entity.pitchSignal !== undefined;
  const instrument = entity.instrument ?? instruments[0]?.name;
  const notes = instruments.find((candidate) => candidate.name === instrument)?.notes ?? [];
  const note = entity.note ?? notes[0]?.name;
  const setTrigger = (trigger: Trigger): void => {
    if ((trigger === "pitch") === pitch) return;
    // The signal goes along: the one of the condition picks the note, and the other way round. A wildcard cannot pick a note.
    const first = entity.condition?.first;
    if (trigger === "pitch") onChange(setOptional({ ...entity, pitchSignal: first && !wildcardOf(first) ? first : DEFAULT_SIGNAL }, "condition", undefined));
    else onChange(setOptional({ ...entity, condition: { first: entity.pitchSignal, comparator: ">", second: { type: "constant", value: 0 } } }, "pitchSignal", undefined));
  };
  // A condition whose signal is taken out is no condition any more; one that never had a signal waits for it as a draft.
  const setCondition = (condition: Condition): void => onChange(setOptional(entity, "condition", condition.first || !entity.condition?.first ? condition : undefined));
  return (
    <>
      <FormSection title="Plays">
        <SelectField label="When" ariaLabel="Plays when" value={pitch ? "pitch" : "condition"} options={TRIGGERS} onChange={setTrigger} />
        {pitch ? (
          <>
            <SignalField label="Pitch signal" required value={entity.pitchSignal} onChange={(next) => next && onChange({ ...entity, pitchSignal: next })} />
            <p className="muted-note">The value of the signal picks the note of the instrument: 1 is its first note. Any other value is silent.</p>
          </>
        ) : (
          <ConditionFields condition={entity.condition ?? BLANK_CONDITION} wildcards={SIGNAL_SLOTS["speaker.condition"]} operandWildcards={SIGNAL_SLOTS["speaker.operand"]} onChange={setCondition} />
        )}
      </FormSection>
      <FormSection title="Sound">
        {/* Where the game's lists do not name the instrument or its notes (no catalog, another game version, a mod), a name is text, as in the source. */}
        {instruments.length > 0 ? (
          <SelectField label="Instrument" value={instrument ?? ""} options={nameOptions(instruments, entity.instrument)} onChange={(name) => onChange(withSpeakerInstrument(entity, name, instruments))} />
        ) : (
          <TextField label="Instrument" placeholder="the first of the game" value={entity.instrument ?? ""} onChange={(name) => onChange(setOptional(entity, "instrument", name || undefined))} />
        )}
        {pitch ? null : notes.length > 0 ? (
          <SelectField label="Note" value={note ?? ""} options={nameOptions(notes, entity.note)} onChange={(name) => onChange(withSpeakerNote(entity, name, instruments))} />
        ) : (
          <TextField label="Note" placeholder="the first of the instrument" value={entity.note ?? ""} onChange={(name) => onChange(setOptional(entity, "note", name || undefined))} />
        )}
        {entity.volumeSignal === undefined && <NumberField label="Volume (%)" ariaLabel="Volume" min={SPEAKER_VOLUME_RANGE.min} max={SPEAKER_VOLUME_RANGE.max} value={entity.volume} onChange={(volume) => onChange({ ...entity, volume })} />}
        <CheckboxField label="Signal value is volume" checked={entity.volumeSignal !== undefined} onChange={(enabled) => onChange(setOptional(entity, "volumeSignal", enabled ? DEFAULT_SIGNAL : undefined))} />
        {entity.volumeSignal !== undefined && (
          <>
            <SignalField label="Volume signal" required value={entity.volumeSignal} onChange={(next) => next && onChange({ ...entity, volumeSignal: next })} />
            <p className="muted-note">The value of the signal is the volume in percent, from 0 to 100.</p>
          </>
        )}
      </FormSection>
      <FormSection title="Playback">
        <SelectField label="Heard" ariaLabel="Playback mode" value={entity.playbackMode} options={PLAYBACK_MODES} onChange={(playbackMode) => onChange({ ...entity, playbackMode })} />
        <CheckboxField label="Allow polyphony" checked={entity.allowPolyphony} onChange={(allowPolyphony) => onChange({ ...entity, allowPolyphony })} />
        <CheckboxField label="Stop playing sounds when the input changes" checked={entity.stopPlayingSounds} onChange={(stopPlayingSounds) => onChange({ ...entity, stopPlayingSounds })} />
      </FormSection>
      <FormSection title="Alert">
        <CheckboxField label="Show alert" checked={entity.showAlert} onChange={(showAlert) => onChange({ ...entity, showAlert })} />
        <CheckboxField label="Show icon on map" checked={entity.showOnMap} onChange={(showOnMap) => onChange({ ...entity, showOnMap })} />
        <SignalField label="Icon" ariaLabel="Alert icon" value={entity.alertIcon} onChange={(next) => onChange(setOptional(entity, "alertIcon", next))} />
        <TextField label="Message" ariaLabel="Alert message" placeholder="No message" value={entity.alertMessage} onChange={(alertMessage) => onChange({ ...entity, alertMessage })} />
        {!entity.showAlert && (entity.alertIcon !== undefined || entity.alertMessage !== DEFAULT_ENTITY.speaker.alertMessage) && <p className="muted-note">Icon and message are kept; they are shown once the alert is switched on.</p>}
      </FormSection>
    </>
  );
}

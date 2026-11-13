import { BOTH_NETWORKS, SPEAKER_VOLUME_RANGE, type Speaker } from "@face/model";
import { AGGREGATE, UNBOUND, conditionHolds, planCondition, type ConditionPlan } from "./decider.ts";
import type { SimulationEnvironment } from "./environment.ts";
import { RULES } from "./rules.ts";
import type { InputView, SignalTable } from "./signals.ts";
import type { SpeakerState } from "./types.ts";
import { speakerInstrument } from "./validate.ts";

export interface SpeakerPlan {
  /** `wired`: the speaker has at least one circuit wire. */
  evaluate(input: InputView, wired: boolean): SpeakerState;
}

const SILENT: SpeakerState = Object.freeze({ playing: false });
export const SILENT_SPEAKER: SpeakerPlan = { evaluate: () => SILENT };

/** SP-VOLUME-SIGNAL (F-25): the value of the volume signal is a percentage; values outside 0..100 are clamped. */
export function signalVolume(value: number): number {
  return Math.min(SPEAKER_VOLUME_RANGE.max, Math.max(SPEAKER_VOLUME_RANGE.min, value));
}

/**
 * Assumes a statically valid entity (see validate.ts). There is no sound and no time in a sound: the state says for every tick
 * whether the speaker is triggered and with what. SP-HELD (F-25): how often the game starts the sound again while the trigger
 * holds, how long a sample sounds, the limit of sounds at a time (polyphony) and stop-playing-sounds are not modelled.
 */
export function planSpeaker(entity: Speaker, signals: SignalTable, env: SimulationEnvironment): SpeakerPlan {
  // SP-NETWORKS: a speaker has no network selection; both operands read the sum of red and green.
  const condition: ConditionPlan | undefined =
    entity.condition &&
    planCondition(
      {
        first: entity.condition.first,
        firstNetworks: BOTH_NETWORKS,
        comparator: entity.condition.comparator,
        second: entity.condition.second.type === "signal" ? { ...entity.condition.second, networks: BOTH_NETWORKS } : entity.condition.second,
      },
      signals,
    );
  const pitch = entity.pitchSignal ? signals.intern(entity.pitchSignal) : -1;
  const volumeSignal = entity.volumeSignal ? signals.intern(entity.volumeSignal) : -1;
  // SP-DEFAULT-SOUND: without a name the first instrument and its first note, as the ids 0 of a blueprint say.
  const known = speakerInstrument(entity, env);
  const instrument = entity.instrument ?? known?.name;
  const fixedNote = entity.note ?? known?.notes[0];
  const first = RULES.speakerPitchStartsAtOne ? 1 : 0;

  let last: SpeakerState = SILENT;
  return {
    evaluate(input, wired) {
      // SP-UNWIRED (F-25): without a circuit wire a speaker makes no sound.
      if (!wired) return (last = SILENT);
      let note = fixedNote;
      if (pitch >= 0) {
        // SP-PITCH (F-25): the value picks the note by its place in the instrument's list; a value without a note plays nothing.
        note = known?.notes[(input.both.get(pitch) ?? 0) - first];
        if (note === undefined) return (last = SILENT);
      } else if (!condition || !conditionHolds(condition, input, UNBOUND, AGGREGATE)) return (last = SILENT);
      // SP-VOLUME (F-25): the signal takes the place of the fixed volume; a volume of 0 is still a sound that is played.
      const volume = volumeSignal >= 0 ? signalVolume(input.both.get(volumeSignal) ?? 0) : entity.volume;
      if (!last.playing || last.note !== note || last.volume !== volume) {
        // SP-ALERT (F-25): the alert is shown when a sound is played.
        last = Object.freeze({ playing: true, ...(instrument !== undefined && { instrument }), ...(note !== undefined && { note }), volume, alert: entity.showAlert });
      }
      return last;
    },
  };
}

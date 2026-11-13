// Edits of a speaker's sound that depend on the game's lists of instruments and notes. A name that is the game's default
// (the first instrument, the first note of the instrument) is not kept: the source then says nothing, as for every default. Pure.
import type { Speaker } from "@face/model";
import type { InstrumentNames } from "../entities/summary.ts";
import { setOptional } from "./immutable.ts";

/** The notes of an instrument, of the first one of the game for a speaker that names none. Empty for an instrument the lists do not have. */
function notesOf(instruments: InstrumentNames, instrument: string | undefined): readonly { readonly name: string }[] {
  return (instrument === undefined ? instruments[0] : instruments.find((candidate) => candidate.name === instrument))?.notes ?? [];
}

/** The speaker playing `note`, which goes without saying when it is the first note of the instrument. */
export function withSpeakerNote(speaker: Speaker, note: string, instruments: InstrumentNames): Speaker {
  return setOptional(speaker, "note", note === notesOf(instruments, speaker.instrument)[0]?.name ? undefined : note);
}

/**
 * The speaker with another instrument, which goes without saying when it is the first of the game. The note stays when the
 * new instrument has one of that name; otherwise it is the first note of the new instrument. For an instrument the lists do
 * not have, nothing is known about its notes and the note stays as it is written.
 */
export function withSpeakerInstrument(speaker: Speaker, instrument: string, instruments: InstrumentNames): Speaker {
  const next = setOptional(speaker, "instrument", instrument === instruments[0]?.name ? undefined : instrument);
  const notes = notesOf(instruments, instrument);
  const first = notes[0]?.name;
  if (first === undefined) return next;
  // What the speaker played so far: the note it names, or the first of its instrument.
  const played = speaker.note ?? notesOf(instruments, speaker.instrument)[0]?.name;
  return setOptional(next, "note", played !== first && notes.some((candidate) => candidate.name === played) ? played : undefined);
}

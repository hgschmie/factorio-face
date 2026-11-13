// The instruments of the programmable speaker with their notes, as the catalog has them for the enabled modules. The
// speaker form offers them, and a card names the sound of a speaker that leaves it to the game's default. Provided by
// the workbench; empty where nobody provides them.
import type { SpeakerInstrumentInfo } from "@face/catalog";
import { createContext } from "react";

const NONE: readonly SpeakerInstrumentInfo[] = [];

export const InstrumentsContext = createContext<readonly SpeakerInstrumentInfo[]>(NONE);

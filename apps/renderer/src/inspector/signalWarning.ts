// The note under a signal field of the inspector when the project does not provide the signal, in the words of the source's
// warning: a signal of modules that are switched off names them. Pure.
import { switchedOffText } from "@face/language";
import type { SignalInfo } from "../workbench/controller.ts";

export function signalWarning({ status, switchedOff = [] }: SignalInfo): string | undefined {
  if (status === "known") return undefined;
  if (status === "unknown") return "Not a signal of Factorio's catalog";
  // Without a module to name, another module of the project removes the signal.
  return switchedOff.length > 0 ? `Belongs to ${switchedOffText(switchedOff)}` : "Not available with the signal groups of this project";
}

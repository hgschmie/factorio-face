// Analysis of the source document: runs the language, guards against stale results and keeps the last valid circuit.
//
// `request` analyzes synchronously today. The result still passes through `accept`, which drops everything that is not the
// answer to the latest request, so the analysis can move to a worker without changing the callers.
import { analyze, type ParseResult, type SignalResolver } from "@face/language";
import type { Circuit, Entity, EntityId, SpeakerInstrument, Wire } from "@face/model";
import { wireKey } from "@face/model";

/** What the analysis takes from the game data: the status of signals and the instruments of the speaker. */
export type GameData = SignalResolver & { readonly instruments?: readonly SpeakerInstrument[] };

const EMPTY_CIRCUIT: Circuit = { name: "", entities: [], wires: [] };

interface SharedEntity {
  readonly text: string;
  readonly entity: Entity;
}

export class Analysis {
  private requested = 0;
  private requestedDocument = -1;
  private accepted: ParseResult | undefined;
  private acceptedDocument = -1;
  private valid: Circuit = EMPTY_CIRCUIT;
  private shared = new Map<EntityId, SharedEntity>();

  /** The latest accepted result; undefined before the first one. */
  get parse(): ParseResult | undefined {
    return this.accepted;
  }

  /** The circuit of the latest result without errors. Entities and wires that did not change keep their identity. */
  get circuit(): Circuit {
    return this.valid;
  }

  get hasErrors(): boolean {
    return this.accepted?.hasErrors ?? true;
  }

  /** True when the accepted result describes the document at `documentVersion` and can be used for edit commands. */
  isCurrent(documentVersion: number): boolean {
    return this.accepted !== undefined && this.acceptedDocument === documentVersion;
  }

  /** Analyzes `source` under the project settings and returns the result, tagged with a fresh request number. The caller hands it to `accept`. */
  request(source: string, documentVersion: number, game: GameData | undefined, wireReach?: number): ParseResult {
    this.requestedDocument = documentVersion;
    return analyze(source, this.accepted, { signals: game, instruments: game?.instruments, wireReach, version: ++this.requested });
  }

  /** Takes a result over unless a newer request was made in the meantime. Returns whether it was accepted. */
  accept(result: ParseResult): boolean {
    if (result.version !== this.requested) return false;
    this.accepted = result;
    this.acceptedDocument = this.requestedDocument;
    if (result.circuit) this.valid = this.share(result, result.circuit);
    return true;
  }

  /** Forgets everything: the next result starts a new document with new entity ids. */
  reset(): void {
    this.requested++;
    this.accepted = undefined;
    this.acceptedDocument = -1;
    this.valid = EMPTY_CIRCUIT;
    this.shared = new Map();
  }

  /**
   * Structural sharing between consecutive valid circuits. An entity is a function of its declaration text, its id and (when
   * it has no `at` clause) its automatic position, so equal text and position mean an equal entity.
   */
  private share(result: ParseResult, circuit: Circuit): Circuit {
    const previous = this.valid;
    const next = new Map<EntityId, SharedEntity>();
    let entitiesChanged = circuit.entities.length !== previous.entities.length;
    const entities = circuit.entities.map((entity, index) => {
      const range = result.sourceMap.entities.get(entity.id)?.range;
      const text = range ? result.source.slice(range.from, range.to) : "";
      const known = this.shared.get(entity.id);
      const same = known !== undefined && known.text === text && known.entity.position.x === entity.position.x && known.entity.position.y === entity.position.y;
      const kept = same ? known.entity : entity;
      next.set(entity.id, same ? known : { text, entity });
      if (kept !== previous.entities[index]) entitiesChanged = true;
      return kept;
    });
    this.shared = next;
    const sameWires = circuit.wires.length === previous.wires.length && circuit.wires.every((wire: Wire, index) => wireKey(wire) === wireKey(previous.wires[index]!));
    if (!entitiesChanged && sameWires && circuit.name === previous.name) return previous;
    return { name: circuit.name, entities: entitiesChanged ? entities : previous.entities, wires: sameWires ? previous.wires : circuit.wires };
  }
}

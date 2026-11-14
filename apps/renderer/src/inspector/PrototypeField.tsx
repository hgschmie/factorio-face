// Which entity of its kind an entity is, for a kind with several game prototypes (a pole): one button per prototype with its
// icon and what the choice decides, the tiles it covers and its wire reach. A generic entity chooses among the prototypes of
// its type, which can be many: those are icons in a row (`compact`), with the name and the facts of the chosen one under them.
import { prototypeOf, prototypesOf, type Entity, type PrototypeName } from "@face/model";
import { KIND_INFO, prototypeFacts, prototypeLabel } from "../entities/kindInfo.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";

export interface PrototypeFieldProps {
  readonly entity: Entity;
  readonly resolveIcon?: EntityIconResolver;
  /** The prototypes to choose from; those of the entity's kind without it. */
  readonly prototypes?: readonly PrototypeName[];
  /** Icons only, in a row. */
  readonly compact?: boolean;
  onChange(prototype: PrototypeName): void;
}

export function PrototypeField({ entity, resolveIcon, prototypes = prototypesOf(entity.kind), compact = false, onChange }: PrototypeFieldProps) {
  const current = prototypeOf(entity);
  const label = KIND_INFO[entity.kind].label;
  const choices = prototypes.map((prototype) => {
    const shape = { kind: entity.kind, prototype };
    const [name, facts] = [prototypeLabel(shape), prototypeFacts(shape)];
    return (
      <button key={prototype} type="button" data-prototype={prototype} aria-pressed={prototype === current} aria-label={compact ? name : undefined} title={compact ? `${name}: ${facts}` : undefined} onClick={() => prototype !== current && onChange(prototype)}>
        <EntityIcon entity={shape} size={26} resolveIcon={resolveIcon} />
        {!compact && (
          <span>
            <strong>{name}</strong>
            <small>{facts}</small>
          </span>
        )}
      </button>
    );
  });
  if (!compact) {
    return (
      <div className="prototype-field" role="group" aria-label={label}>
        {choices}
      </div>
    );
  }
  return (
    <>
      <div className="prototype-field compact" role="group" aria-label={label}>
        {choices}
      </div>
      <p className="prototype-chosen" data-prototype={current}>
        <strong>{prototypeLabel(entity)}</strong> <small>{prototypeFacts(entity)}</small>
      </p>
    </>
  );
}

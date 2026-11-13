// Which entity of its kind an entity is, for a kind with several game prototypes (a pole): one button per prototype with its
// icon and what the choice decides, the tiles it covers and its wire reach.
import { prototypeOf, prototypesOf, type Entity, type PrototypeName } from "@face/model";
import { KIND_INFO, prototypeFacts, prototypeLabel } from "../entities/kindInfo.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";

export interface PrototypeFieldProps {
  readonly entity: Entity;
  readonly resolveIcon?: EntityIconResolver;
  onChange(prototype: PrototypeName): void;
}

export function PrototypeField({ entity, resolveIcon, onChange }: PrototypeFieldProps) {
  const current = prototypeOf(entity);
  const label = KIND_INFO[entity.kind].label;
  return (
    <div className="prototype-field" role="group" aria-label={label}>
      {prototypesOf(entity.kind).map((prototype) => {
        const shape = { kind: entity.kind, prototype };
        return (
          <button key={prototype} type="button" data-prototype={prototype} aria-pressed={prototype === current} onClick={() => prototype !== current && onChange(prototype)}>
            <EntityIcon entity={shape} size={26} resolveIcon={resolveIcon} />
            <span>
              <strong>{prototypeLabel(shape)}</strong>
              <small>{prototypeFacts(shape)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

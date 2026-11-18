// The dialog of one module (one of the game's, or a mod) in which the user hides signals and entities of it: two lists side
// by side, "Shown" and "Hidden", and two arrows between them. A modal dialog. Presentational: what the module has and what is
// hidden arrive as props, and every change is handed on at once; the settings of the application store it.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { HiddenModuleItems } from "../../../desktop/src/ipc.ts";
import { Modal } from "../dialog/Modal.tsx";
import { SELECT_ALL_EVENT } from "../dialog/selectAll.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { IconImage } from "../icons/IconImage.tsx";
import { IS_MAC } from "../platform.ts";
import type { ModuleItem, ModuleItems as Items, ModuleView } from "../workbench/controller.ts";
import {
  afterArriving, afterLeaving, APPLIES_NOTE, CLOSE_LABEL, emptyNote, FILTER_LABEL, firstSide, itemLists, keysToMove, LIST_LABELS, listCount, moveItems, NO_SELECTION, pickItem, selectAllItems,
  selectedKeys, SIDE_LABELS, sideCount, SIDES, stepItem,
  type ListName, type ListSelection, type Side,
} from "./moduleItems.ts";

export interface ModuleItemsProps {
  readonly module: Pick<ModuleView, "name" | "title">;
  /** What the module has to hide, in the order the picker and the selector have it. */
  readonly items: Items;
  /** What is stored as hidden for the module. */
  readonly hidden: HiddenModuleItems;
  /** URL of a catalog icon id; without it, and for an icon that has none, a signal has its name alone. */
  readonly iconUrl?: (icon: string) => string | undefined;
  readonly resolveEntityIcon?: EntityIconResolver;
  /** Called with what is hidden of the module after a change. */
  onChange(hidden: HiddenModuleItems): void;
  close(): void;
}

const ICON = 20;
const OTHER: Readonly<Record<ListName, ListName>> = { shown: "hidden", hidden: "shown" };
const MOVE_LABELS: Readonly<Record<ListName, string>> = { shown: "Hide", hidden: "Show" };
const STEPS: Readonly<Record<string, "previous" | "next" | "first" | "last">> = { ArrowUp: "previous", ArrowDown: "next", Home: "first", End: "last" };

interface ItemListProps {
  readonly list: ListName;
  readonly side: Side;
  readonly items: readonly ModuleItem[];
  /** How many the list has without the filter. */
  readonly total: number;
  readonly selection: ListSelection;
  readonly iconUrl?: (icon: string) => string | undefined;
  readonly resolveEntityIcon?: EntityIconResolver;
  readonly listRef: (element: HTMLUListElement | null) => void;
  onSelect(selection: ListSelection): void;
  /** Moves rows to the other list. */
  onMove(keys: readonly string[]): void;
}

/** One of the two lists: a list box with several rows selected at a time. The rows are not focused; the list is, and names its active row. */
function ItemList({ list, side, items, total, selection, iconUrl, resolveEntityIcon, listRef, onSelect, onMove }: ItemListProps) {
  const id = useId();
  const elementRef = useRef<HTMLUListElement | null>(null);
  const activeIndex = items.findIndex((item) => item.key === selection.active);

  // Edit > Select All of the menu, which may take the key before the page sees it.
  const selectAll = useRef<() => void>(() => undefined);
  useEffect(() => void (selectAll.current = () => onSelect(selectAllItems(items, selection))));
  useEffect(() => {
    const element = elementRef.current;
    const onSelectAll = (event: Event): void => {
      event.preventDefault();
      selectAll.current();
    };
    element?.addEventListener(SELECT_ALL_EVENT, onSelectAll);
    return () => element?.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
  }, []);

  // The active row is in view after a key moved it.
  useEffect(() => {
    if (activeIndex >= 0) elementRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const step = STEPS[event.key];
    const all = event.key.toLowerCase() === "a" && (IS_MAC ? event.metaKey : event.ctrlKey);
    if (step === undefined && !all && event.key !== "Enter") return;
    event.preventDefault();
    if (step !== undefined) onSelect(stepItem(items, selection, step, event.shiftKey));
    else if (all) onSelect(selectAllItems(items, selection));
    else onMove(keysToMove(items, selection));
  };

  return (
    <section className="item-list" data-list={list}>
      <h3 className="section-label">
        <span>{LIST_LABELS[list]}</span>
        <span className="count-badge">{listCount(items.length, total)}</span>
      </h3>
      <div className="item-list-rows">
        <ul
          ref={(element) => {
            elementRef.current = element;
            listRef(element);
          }}
          role="listbox"
          aria-multiselectable="true"
          aria-label={`${LIST_LABELS[list]} ${side}`}
          aria-activedescendant={activeIndex < 0 ? undefined : `${id}-${activeIndex}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) => (
            <li
              key={item.key}
              id={`${id}-${index}`}
              role="option"
              aria-selected={selection.keys.has(item.key)}
              data-key={item.key}
              data-active={index === activeIndex}
              title={item.key}
              onClick={(event) => onSelect(pickItem(items, selection, item.key, event.shiftKey ? "extend" : (IS_MAC ? event.metaKey : event.ctrlKey) ? "toggle" : "only"))}
              onDoubleClick={() => onMove([item.key])}
            >
              <span className="item-icon">
                {side === "entities" ? <EntityIcon entity={{ prototype: item.key }} size={ICON} resolveIcon={resolveEntityIcon} /> : <SignalIcon url={item.icon === undefined ? undefined : iconUrl?.(item.icon)} />}
              </span>
              <span className="item-name">{item.label}</span>
            </li>
          ))}
        </ul>
        {items.length === 0 && (
          <p className="muted-note" data-note="empty">
            {emptyNote(list, side, total)}
          </p>
        )}
      </div>
    </section>
  );
}

function SignalIcon({ url }: { readonly url: string | undefined }) {
  return url === undefined ? null : <IconImage src={url} size={ICON} lazy />;
}

export function ModuleItems({ module, items, hidden, iconUrl, resolveEntityIcon, onChange, close }: ModuleItemsProps) {
  const [side, setSide] = useState<Side>(() => firstSide(items));
  const [filter, setFilter] = useState("");
  const [selections, setSelections] = useState<Readonly<Record<ListName, ListSelection>>>({ shown: NO_SELECTION, hidden: NO_SELECTION });
  const listRefs = useRef<Record<ListName, HTMLUListElement | null>>({ shown: null, hidden: null });
  const lists = itemLists(items[side], hidden[side], filter);

  const select = (list: ListName, selection: ListSelection): void => setSelections((current) => ({ ...current, [list]: selection }));
  const changeSide = (next: Side): void => {
    setSide(next);
    setSelections({ shown: NO_SELECTION, hidden: NO_SELECTION });
  };
  /** Moves rows out of `from` into the other list. The focus goes to the list they left: the button that moved them may be disabled now. */
  const move = (from: ListName, keys: readonly string[]): void => {
    if (keys.length === 0) return;
    onChange(moveItems(hidden, side, OTHER[from], keys));
    setSelections({ [from]: afterLeaving(lists[from], keys), [OTHER[from]]: afterArriving(keys) } as Record<ListName, ListSelection>);
    listRefs.current[from]?.focus();
  };

  const renderList = (list: ListName) => (
    <ItemList
      list={list}
      side={side}
      items={lists[list]}
      total={lists.counts[list]}
      selection={selections[list]}
      iconUrl={iconUrl}
      resolveEntityIcon={resolveEntityIcon}
      listRef={(element) => void (listRefs.current[list] = element)}
      onSelect={(selection) => select(list, selection)}
      onMove={(keys) => move(list, keys)}
    />
  );
  const renderMove = (from: ListName) => (
    <button
      type="button"
      className="settings-button"
      aria-label={MOVE_LABELS[from]}
      title={`${MOVE_LABELS[from]} the selected ${side}`}
      disabled={selectedKeys(lists[from], selections[from]).length === 0}
      onClick={() => move(from, selectedKeys(lists[from], selections[from]))}
    >
      <Icon name={from === "shown" ? "arrow" : "arrowLeft"} size={16} />
    </button>
  );
  const renderMoveAll = (from: ListName) => (
    <button type="button" className="settings-button" disabled={lists[from].length === 0} onClick={() => move(from, lists[from].map((item) => item.key))}>
      {MOVE_LABELS[from]} all
    </button>
  );

  return (
    <Modal title={module.title} closeLabel={CLOSE_LABEL} className="module-items" close={close}>
      <p className="muted-note">{APPLIES_NOTE}</p>
      <div className="module-items-bar">
        <span className="side-switch" role="group" aria-label="Signals or entities">
          {SIDES.map((candidate) => (
            <button key={candidate} type="button" data-side={candidate} aria-pressed={side === candidate} disabled={items[candidate].length === 0} onClick={() => changeSide(candidate)}>
              {SIDE_LABELS[candidate]}
              <span className="count">{sideCount(items[candidate], hidden[candidate])}</span>
            </button>
          ))}
        </span>
        <input
          type="search"
          data-autofocus
          aria-label={FILTER_LABEL}
          placeholder={FILTER_LABEL}
          maxLength={100}
          spellCheck={false}
          autoComplete="off"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            // Escape empties the field first; from the empty field it closes the dialog.
            if (event.key !== "Escape" || filter === "") return;
            event.stopPropagation();
            setFilter("");
          }}
        />
      </div>
      {/* Another side is other lists: they start at their top. */}
      <div key={side} className="module-items-lists" data-side={side}>
        {renderList("shown")}
        <div className="module-items-moves">
          {renderMove("shown")}
          {renderMove("hidden")}
        </div>
        {renderList("hidden")}
        {renderMoveAll("shown")}
        {renderMoveAll("hidden")}
      </div>
      <div className="dialog-actions">
        <button type="button" className="settings-button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

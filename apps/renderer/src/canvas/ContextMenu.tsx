// Small popup menu for the canvas. Keyboard: arrows move, Enter/Space activate (native button behavior), Escape closes.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Shortcut hint shown on the right. */
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  onSelect(): void;
}

export interface ContextMenuProps {
  /** Position in pixels relative to the positioned ancestor. */
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly ContextMenuItem[];
  onClose(): void;
}

export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", closeOnOutsidePress, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
  };

  return (
    <div ref={ref} className="context-menu" role="menu" aria-label={label} style={{ left: x, top: y }} onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item) => (
        <div key={item.id} role="none">
          {item.separatorBefore && <div className="menu-separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="label">
              {item.icon && <Icon name={item.icon} size={15} />}
              {item.label}
            </span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}

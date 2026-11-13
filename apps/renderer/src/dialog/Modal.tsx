// A modal dialog over the workbench: a backdrop, a panel with a title and a close button. It holds the focus while it is open,
// gives it back to where it was, and closes with Escape or a press on the backdrop.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../icons/Icon.tsx";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  readonly title: string;
  /** Accessible name of the close button. */
  readonly closeLabel: string;
  /** Class of the panel, for its size and content. */
  readonly className: string;
  readonly children: ReactNode;
  close(): void;
}

export function Modal({ title, closeLabel, className, children, close }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      // The canvas is an SVG element.
      if ((previous instanceof HTMLElement || previous instanceof SVGElement) && previous.isConnected) previous.focus();
    };
  }, []);

  // The focus can leave the dialog without a key: the control that held it is disabled, or a native sheet took it and gave it
  // back to the page. The next key then brings it back and does not reach the page behind; Escape still closes.
  useEffect(() => {
    const onStrayKey = (event: globalThis.KeyboardEvent): void => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      panel.focus();
      event.stopPropagation();
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onStrayKey, true);
    return () => document.removeEventListener("keydown", onStrayKey, true);
  }, [close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      // Handled here for good: the key must not go on to cancel a tool behind the dialog.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // The focus stays in the dialog: Tab goes round from its last control to its first.
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const [first, last] = [controls[0], controls.at(-1)];
    const leaving = document.activeElement === (event.shiftKey ? first : last) || document.activeElement === panelRef.current;
    if (!leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Without its default the press does not take the focus, which closing hands back to where it was.
        event.preventDefault();
        close();
      }}
    >
      {/* Focusable itself, so that a click on its text does not hand the focus, and with it the keys, to the page behind. */}
      <div ref={panelRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header>
          <h2 id={titleId} className="eyebrow">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label={closeLabel} onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

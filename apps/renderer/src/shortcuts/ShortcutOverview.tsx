// The shortcut overview: every key of the shortcut table, in its groups. A modal dialog; it holds the focus while it is open and
// gives it back to where it was.
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Icon } from "../icons/Icon.tsx";
import { SHORTCUT_GROUPS, shortcutKeys, SHORTCUTS } from "./shortcuts.ts";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface ShortcutOverviewProps {
  close(): void;
}

export function ShortcutOverview({ close }: ShortcutOverviewProps) {
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
      className="shortcut-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Without its default the press does not take the focus, which closing hands back to where it was.
        event.preventDefault();
        close();
      }}
    >
      {/* Focusable itself, so that a click on its text does not hand the focus, and with it the keys, to the page behind. */}
      <div ref={panelRef} className="shortcut-overview" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header>
          <h2 id={titleId} className="eyebrow">
            Keyboard shortcuts
          </h2>
          <button type="button" className="icon-button" aria-label="Close keyboard shortcuts" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} className="shortcut-group" aria-label={group}>
              <h3 className="section-label">{group}</h3>
              <dl>
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                  <div key={shortcut.id} data-shortcut={shortcut.id}>
                    <dt>{shortcut.description}</dt>
                    <dd>
                      {shortcutKeys(shortcut).map((cap, index) => (
                        <kbd key={index}>{cap}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="muted-note">Keys without Cmd or Ctrl act on the circuit while the focus is not in a text field, the source editor, a dialog or a menu.</p>
      </div>
    </div>
  );
}

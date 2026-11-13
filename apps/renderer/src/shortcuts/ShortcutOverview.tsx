// The shortcut overview: every key of the shortcut table, in its groups, in a modal dialog.
import { Modal } from "../dialog/Modal.tsx";
import { SHORTCUT_GROUPS, shortcutKeys, SHORTCUTS } from "./shortcuts.ts";

export interface ShortcutOverviewProps {
  close(): void;
}

export function ShortcutOverview({ close }: ShortcutOverviewProps) {
  return (
    <Modal title="Keyboard shortcuts" closeLabel="Close keyboard shortcuts" className="shortcut-overview" close={close}>
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
    </Modal>
  );
}

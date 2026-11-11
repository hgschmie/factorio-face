// Editor chrome in the app's own palette (no IDE look). Colors come from the tokens in styles/tokens.css.
import { EditorView } from "@codemirror/view";

export const faceEditorTheme = EditorView.theme(
  {
    "&": { height: "100%", color: "#d8ddd4", backgroundColor: "var(--surface-editor)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "1.85" },
    ".cm-content": { padding: "20px 0", caretColor: "var(--amber)" },
    ".cm-line": { padding: "0 16px" },
    ".cm-gutters": { color: "#636d63", backgroundColor: "var(--surface-editor)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 16px", minWidth: "44px" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 2.5%)" },
    ".cm-activeLineGutter": { color: "#a4ad96", backgroundColor: "rgb(255 255 255 / 2.5%)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--amber)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgb(119 100 58 / 40%)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { color: "var(--amber-bright)", backgroundColor: "rgb(217 176 106 / 14%)", outline: "none" },
    ".cm-tooltip": { color: "var(--text)", backgroundColor: "var(--surface-popover)", border: "1px solid #555c50", borderRadius: "5px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { color: "var(--text-strong)", backgroundColor: "var(--surface-active)" },
    ".cm-panels": { color: "var(--text)", backgroundColor: "var(--surface-palette)" },
    ".cm-diagnostic": { fontFamily: "var(--font-ui)", fontSize: "11px" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--status-error)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--status-warning)" },
  },
  { dark: true },
);

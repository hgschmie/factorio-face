// Editor chrome in the app's own palette (no IDE look). Colors come from the tokens in styles/tokens.css.
import { EditorView } from "@codemirror/view";

export const faceEditorTheme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--surface-editor)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "1.85" },
    ".cm-content": { padding: "20px 0", caretColor: "var(--accent)" },
    ".cm-line": { padding: "0 16px" },
    ".cm-gutters": { color: "var(--text-faint)", backgroundColor: "var(--surface-editor)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 16px", minWidth: "44px" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 2.5%)" },
    ".cm-activeLineGutter": { color: "var(--text-label)", backgroundColor: "rgb(255 255 255 / 2.5%)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 24%, transparent)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { color: "var(--accent-bright)", backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)", outline: "none" },
    ".cm-tooltip": { color: "var(--text)", backgroundColor: "var(--surface-popover)", border: "1px solid var(--border-popover)", borderRadius: "5px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { color: "var(--text-strong)", backgroundColor: "var(--surface-active)" },
    ".cm-panels": { color: "var(--text)", backgroundColor: "var(--surface-palette)" },
    ".cm-diagnostic": { fontFamily: "var(--font-ui)", fontSize: "11px" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--status-error)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--status-warning)" },
  },
  { dark: true },
);

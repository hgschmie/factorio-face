// The strip above the canvas: what the canvas shows (title, counts), the canvas tools, the Edit | Blueprint switch and, on the
// board, the button that places every entity without a tile. It is a row of its own, not an overlay, and wraps to a second
// line where the canvas is narrow.
import type { WireColor } from "@face/model";
import { Icon } from "../icons/Icon.tsx";
import { withShortcut } from "../shortcuts/shortcuts.ts";
import { DISPLAY_MODES, sameTool, SELECT_TOOL, type DisplayMode, type Tool } from "./controller.ts";

/** Returns the image URL of the game's icon for the wire tool of that color, or undefined to use the line pictogram. */
export type WireIconResolver = (color: WireColor) => string | undefined;

export interface CanvasStripProps {
  readonly entityCount: number;
  readonly wireCount: number;
  readonly tool: Tool;
  /** When false, the two wire tools are disabled: the source has errors, or the display mode does not wire. */
  readonly canWire: boolean;
  readonly displayMode: DisplayMode;
  /** The entities without a `tile` while the display mode works on tiles; 0 otherwise. */
  readonly unplacedCount: number;
  readonly editable: boolean;
  readonly resolveWireIcon?: WireIconResolver;
  onToolChange(tool: Tool): void;
  onDisplayModeChange(displayMode: DisplayMode): void;
  /** Gives every entity without a `tile` the one of the place it is shown at. */
  onPlaceAll(): void;
}

const RED_WIRE: Tool = { type: "wire", color: "red" };
const GREEN_WIRE: Tool = { type: "wire", color: "green" };
const DISPLAY_LABELS: Readonly<Record<DisplayMode, string>> = { edit: "Edit", blueprint: "Blueprint" };

function WireIcon({ color, resolveIcon }: { readonly color: WireColor; readonly resolveIcon?: WireIconResolver }) {
  const url = resolveIcon?.(color);
  return url ? <img className="wire-icon" src={url} width={24} height={24} alt="" draggable={false} /> : <Icon name="wire" size={16} />;
}

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function CanvasStrip({ entityCount, wireCount, tool, canWire, displayMode, unplacedCount, editable, resolveWireIcon, onToolChange, onDisplayModeChange, onPlaceAll }: CanvasStripProps) {
  // Clicking the active wire tool again returns to the select tool.
  const toggle = (next: Tool): void => onToolChange(sameTool(tool, next) ? SELECT_TOOL : next);
  return (
    <header className="canvas-strip">
      <div className="canvas-heading">
        <span className="eyebrow">Circuit workspace</span>
        <span className="counts">
          {counted(entityCount, "entity", "entities")}
          <span className="meta-dot" />
          {counted(wireCount, "connection", "connections")}
        </span>
      </div>
      <div className="tool-row" role="group" aria-label="Canvas tools">
        <button type="button" className="tool-button" aria-pressed={tool.type === "select"} aria-label="Select and move" title={withShortcut("Select and move", "tool.select")} onClick={() => onToolChange(SELECT_TOOL)}>
          <Icon name="cursor" size={16} />
        </button>
        <button type="button" className="tool-button wire-red" aria-pressed={sameTool(tool, RED_WIRE)} aria-label="Red wire" title={withShortcut("Red wire", "tool.wireRed")} disabled={!canWire} onClick={() => toggle(RED_WIRE)}>
          <WireIcon color="red" resolveIcon={resolveWireIcon} />
        </button>
        <button type="button" className="tool-button wire-green" aria-pressed={sameTool(tool, GREEN_WIRE)} aria-label="Green wire" title={withShortcut("Green wire", "tool.wireGreen")} disabled={!canWire} onClick={() => toggle(GREEN_WIRE)}>
          <WireIcon color="green" resolveIcon={resolveWireIcon} />
        </button>
      </div>
      <div className="canvas-strip-view">
        <span className="display-switch" role="group" aria-label="Display mode">
          {DISPLAY_MODES.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={displayMode === candidate} title={withShortcut(`${DISPLAY_LABELS[candidate]} view`, "view.display")} onClick={() => onDisplayModeChange(candidate)}>
              {DISPLAY_LABELS[candidate]}
            </button>
          ))}
        </span>
        {unplacedCount > 0 && (
          <button type="button" className="place-all" disabled={!editable} title={`Place the ${unplacedCount === 1 ? "entity" : `${unplacedCount} entities`} without a tile on the ${unplacedCount === 1 ? "tile it is" : "tiles they are"} shown at`} onClick={onPlaceAll}>
            <Icon name="grid" size={13} />
            Place all
            <span className="count-badge">{unplacedCount}</span>
          </button>
        )}
      </div>
    </header>
  );
}

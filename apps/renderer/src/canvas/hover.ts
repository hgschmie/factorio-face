// When a popup that follows the pointer is shown: the bubble of the entity under the pointer on the board, the popup of a
// tile of the entity selector. It appears once the pointer has rested on a target for a moment, so that crossing targets
// shows nothing; once one is on show the next target gets its popup at once; it goes shortly after the pointer has left, so
// that the gap between two targets does not make it flicker. Pure apart from the timers, which can be replaced.
import type { Entity, Point } from "@face/model";
import type { Rect } from "./geometry.ts";

/** How long the pointer rests on a target before its popup appears. */
export const HOVER_DELAY_MS = 250;
/** How long a popup stays after the pointer has left its target; a target entered meanwhile takes it over at once. */
export const HOVER_LINGER_MS = 120;

export interface HoverTimers {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}

const BROWSER_TIMERS: HoverTimers = { set: (callback, delay) => setTimeout(callback, delay), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class HoverIntent<Target> {
  private shown: Target | null = null;
  private wanted: Target | null = null;
  private timer: unknown;

  /** `show` is called with the target whose popup is to be on show, and with null when none is. */
  constructor(private readonly show: (target: Target | null) => void, private readonly timers: HoverTimers = BROWSER_TIMERS) {}

  /** The pointer is over `target`, or over none of them. */
  over(target: Target | null): void {
    if (target === this.wanted) return;
    this.wanted = target;
    this.stop();
    if (target === this.shown) return;
    if (target !== null && this.shown !== null) this.set(target);
    else this.timer = this.timers.set(() => this.set(target), target === null ? HOVER_LINGER_MS : HOVER_DELAY_MS);
  }

  /** Nothing is shown from now on, and what was about to be shown is not: the pointer has to come to rest on a target again. */
  reset(): void {
    this.wanted = null;
    this.stop();
    if (this.shown !== null) this.set(null);
  }

  private stop(): void {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    this.timer = undefined;
  }

  private set(target: Target | null): void {
    this.timer = undefined;
    this.shown = target;
    this.show(target);
  }
}

/** What a pointer state has to say for the bubble of the board to be allowed at all. */
export interface BubbleConditions {
  /** The blueprint board is on show. */
  readonly board: boolean;
  /** The select tool is active: with a wire or a place tool the bubble would cover pins and targets. */
  readonly selecting: boolean;
  /** A press is held: a drag of entities, a marquee or a pan, also before it has moved. */
  readonly pressed: boolean;
  readonly menuOpen: boolean;
}

export function bubbleAllowed({ board, selecting, pressed, menuOpen }: BubbleConditions): boolean {
  return board && selecting && !pressed && !menuOpen;
}

/** The entity whose rectangle holds `point`; the one drawn last where several do (entities in a conflict share tiles). */
export function entityAt(entities: readonly Entity[], rect: (entity: Entity) => Rect, point: Point): Entity | undefined {
  return entities.findLast((entity) => {
    const { x, y, width, height } = rect(entity);
    return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
  });
}

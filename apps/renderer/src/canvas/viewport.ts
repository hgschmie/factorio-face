// Camera math: screen <-> world transforms, zoom around a point, fit, and the culling rectangle. Pure.
import type { Point } from "@face/model";
import { expandRect, rectsIntersect, type Rect } from "./geometry.ts";

/** `x`/`y` is the world coordinate shown at the top-left corner of the view; `zoom` is screen pixels per world unit. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A camera described by the world point at the center of the view, which stays meaningful when the canvas is resized. */
export interface CanvasView {
  readonly center: Point;
  readonly zoom: number;
}

export function viewOf(camera: Camera, size: Size): CanvasView {
  return { center: { x: camera.x + size.width / camera.zoom / 2, y: camera.y + size.height / camera.zoom / 2 }, zoom: camera.zoom };
}

export function cameraFor(view: CanvasView, size: Size): Camera {
  return { x: view.center.x - size.width / view.zoom / 2, y: view.center.y - size.height / view.zoom / 2, zoom: view.zoom };
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 2.5;
export const MAX_FIT_ZOOM = 1.25;
export const ZOOM_STEP = 1.25;
export const DEFAULT_CAMERA: Camera = { x: -100, y: -100, zoom: 1 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** `screen` is relative to the top-left corner of the canvas element. */
export function screenToWorld(camera: Camera, screen: Point): Point {
  return { x: camera.x + screen.x / camera.zoom, y: camera.y + screen.y / camera.zoom };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** Scales by `factor` while keeping the world point under `screen` fixed. */
export function zoomAround(camera: Camera, screen: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  return { x: camera.x + screen.x / camera.zoom - screen.x / zoom, y: camera.y + screen.y / camera.zoom - screen.y / zoom, zoom };
}

/** Wheel delta to zoom factor. Pinch gestures arrive as ctrl+wheel with small deltas and get a stronger response. */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.0015));
}

/** Moves the view so that content follows a pointer that travelled `dx`/`dy` screen pixels since `origin` was captured. */
export function panFrom(origin: Camera, dx: number, dy: number): Camera {
  return { x: origin.x - dx / origin.zoom, y: origin.y - dy / origin.zoom, zoom: origin.zoom };
}

export function visibleWorldRect(camera: Camera, size: Size): Rect {
  return { x: camera.x, y: camera.y, width: size.width / camera.zoom, height: size.height / camera.zoom };
}

/** Centers `bounds` in the view with `padding` screen pixels around it. An empty circuit gets the default camera. */
export function fitCamera(bounds: Rect | undefined, size: Size, padding = 60): Camera {
  if (!bounds || size.width <= 0 || size.height <= 0) return DEFAULT_CAMERA;
  const available = { width: Math.max(1, size.width - 2 * padding), height: Math.max(1, size.height - 2 * padding) };
  const zoom = Math.min(MAX_FIT_ZOOM, clampZoom(Math.min(available.width / Math.max(1, bounds.width), available.height / Math.max(1, bounds.height))));
  return { x: bounds.x + bounds.width / 2 - size.width / zoom / 2, y: bounds.y + bounds.height / 2 - size.height / zoom / 2, zoom };
}

/**
 * The visible rectangle grown by `margin` and snapped outward to a `cell` lattice. Small pans stay inside the same
 * rectangle, so the set of rendered elements (and with it the memoized scene) only changes when a cell border is crossed.
 */
export function cullingRect(camera: Camera, size: Size, margin: number, cell: number): Rect {
  const visible = expandRect(visibleWorldRect(camera, size), margin);
  const x = Math.floor(visible.x / cell) * cell;
  const y = Math.floor(visible.y / cell) * cell;
  return { x, y, width: Math.ceil((visible.x + visible.width) / cell) * cell - x, height: Math.ceil((visible.y + visible.height) / cell) * cell - y };
}

export function cull<T>(items: readonly T[], boundsOf: (item: T) => Rect, visible: Rect): T[] {
  return items.filter((item) => rectsIntersect(boundsOf(item), visible));
}

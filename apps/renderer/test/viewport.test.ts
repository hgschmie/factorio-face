import { describe, expect, it } from "vitest";
import { cardRect, entitiesBounds, expandRect, rectFromPoints, rectsIntersect } from "../src/canvas/geometry.ts";
import { cameraFor, clampZoom, cull, cullingRect, DEFAULT_CAMERA, fitCamera, MAX_FIT_ZOOM, MAX_ZOOM, MIN_ZOOM, panFrom, screenToWorld, viewOf, visibleWorldRect, wheelZoomFactor, worldToScreen, zoomAround, type Camera } from "../src/canvas/viewport.ts";

const camera: Camera = { x: -120, y: 40, zoom: 1.6 };
const size = { width: 1000, height: 600 };

describe("screen and world coordinates", () => {
  it("round-trips", () => {
    const world = screenToWorld(camera, { x: 333, y: 77 });
    expect(world).toEqual({ x: -120 + 333 / 1.6, y: 40 + 77 / 1.6 });
    const screen = worldToScreen(camera, world);
    expect(screen.x).toBeCloseTo(333);
    expect(screen.y).toBeCloseTo(77);
  });

  it("maps the canvas corner to the camera origin", () => {
    expect(screenToWorld(camera, { x: 0, y: 0 })).toEqual({ x: -120, y: 40 });
    expect(visibleWorldRect(camera, size)).toEqual({ x: -120, y: 40, width: 625, height: 375 });
  });
});

describe("view center", () => {
  it("round-trips between camera and center form", () => {
    const view = viewOf(camera, size);
    expect(view).toEqual({ center: { x: -120 + 312.5, y: 40 + 187.5 }, zoom: 1.6 });
    expect(cameraFor(view, size)).toEqual(camera);
  });

  it("keeps the same world point in the middle when the canvas is resized", () => {
    const narrow = { width: 480, height: 600 };
    const resized = cameraFor(viewOf(camera, size), narrow);
    expect(screenToWorld(resized, { x: 240, y: 300 })).toEqual(screenToWorld(camera, { x: 500, y: 300 }));
    expect(resized.zoom).toBe(camera.zoom);
  });
});

describe("zoom", () => {
  it("keeps the world point under the pointer fixed", () => {
    const pointer = { x: 640, y: 210 };
    const before = screenToWorld(camera, pointer);
    for (const factor of [1.25, 0.5, 3, 0.01]) {
      const after = screenToWorld(zoomAround(camera, pointer, factor), pointer);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
  });

  it("clamps to the supported range", () => {
    expect(zoomAround(camera, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAround(camera, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });

  it("zooms in for wheel-up and out for wheel-down, stronger for pinch", () => {
    expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, false)).toBeLessThan(1);
    expect(wheelZoomFactor(0, false)).toBe(1);
    expect(wheelZoomFactor(-10, true)).toBeGreaterThan(wheelZoomFactor(-10, false));
    expect(wheelZoomFactor(-100, false) * wheelZoomFactor(100, false)).toBeCloseTo(1);
  });
});

describe("pan", () => {
  it("moves content with the pointer, scaled by zoom", () => {
    const panned = panFrom(camera, 160, -80);
    expect(panned).toEqual({ x: -220, y: 90, zoom: 1.6 });
    // The world point that was under the press position is now under the moved pointer.
    const grabbed = screenToWorld(camera, { x: 100, y: 100 });
    expect(worldToScreen(panned, grabbed).x).toBeCloseTo(260);
    expect(worldToScreen(panned, grabbed).y).toBeCloseTo(20);
  });
});

describe("fit to content", () => {
  it("centers the bounds and shows all of them inside the padding", () => {
    const bounds = { x: 40, y: 32, width: 704, height: 356 };
    const fitted = fitCamera(bounds, size, 60);
    const visible = visibleWorldRect(fitted, size);
    expect(visible.x + visible.width / 2).toBeCloseTo(bounds.x + bounds.width / 2);
    expect(visible.y + visible.height / 2).toBeCloseTo(bounds.y + bounds.height / 2);
    const topLeft = worldToScreen(fitted, { x: bounds.x, y: bounds.y });
    const bottomRight = worldToScreen(fitted, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(60 - 1e-6);
    expect(topLeft.y).toBeGreaterThanOrEqual(60 - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(size.width - 60 + 1e-6);
    expect(bottomRight.y).toBeLessThanOrEqual(size.height - 60 + 1e-6);
  });

  it("does not magnify small circuits beyond the fit limit and clamps huge ones", () => {
    expect(fitCamera({ x: 0, y: 0, width: 10, height: 10 }, size).zoom).toBe(MAX_FIT_ZOOM);
    expect(fitCamera({ x: 0, y: 0, width: 1e7, height: 1e7 }, size).zoom).toBe(MIN_ZOOM);
  });

  it("falls back to the default camera for an empty circuit or an unmeasured canvas", () => {
    expect(fitCamera(undefined, size)).toBe(DEFAULT_CAMERA);
    expect(fitCamera({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toBe(DEFAULT_CAMERA);
    expect(entitiesBounds([])).toBeUndefined();
  });

  it("computes the bounds of all cards", () => {
    expect(entitiesBounds([{ position: { x: 40, y: 80 } }, { position: { x: 560, y: 260 } }])).toEqual({ x: 40, y: 80, width: 704, height: 308 });
  });
});

describe("culling", () => {
  it("covers the visible area plus margin and lies on the cell lattice", () => {
    const rect = cullingRect(camera, size, 120, 400);
    const needed = expandRect(visibleWorldRect(camera, size), 120);
    expect(rect.x).toBeLessThanOrEqual(needed.x);
    expect(rect.y).toBeLessThanOrEqual(needed.y);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(needed.x + needed.width);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(needed.y + needed.height);
    for (const value of [rect.x, rect.y, rect.width, rect.height]) expect(Math.abs(value % 400)).toBe(0);
  });

  it("does not change for small pans and changes once a cell border is crossed", () => {
    const start: Camera = { x: 10, y: 10, zoom: 1 };
    expect(cullingRect(panFrom(start, -30, -30), size, 120, 400)).toEqual(cullingRect(start, size, 120, 400));
    expect(cullingRect(panFrom(start, -500, 0), size, 120, 400)).not.toEqual(cullingRect(start, size, 120, 400));
  });

  it("keeps only items that intersect the rectangle", () => {
    const positions = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 790, y: 590 }, { x: -184, y: -128 }, { x: -200, y: 0 }];
    const visible = cull(positions, cardRect, { x: 0, y: 0, width: 800, height: 600 });
    expect(visible).toEqual([{ x: 0, y: 0 }, { x: 790, y: 590 }, { x: -184, y: -128 }]);
  });

  it("drops most of a 1,000 entity grid at normal zoom", () => {
    const grid = Array.from({ length: 1000 }, (_, i) => ({ x: (i % 40) * 240, y: Math.floor(i / 40) * 180 }));
    const rect = cullingRect({ x: 0, y: 0, zoom: 1 }, size, 120, 400);
    const visible = cull(grid, cardRect, rect);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(60);
    expect(visible.every((position) => rectsIntersect(cardRect(position), rect))).toBe(true);
  });

  it("builds rectangles from any two corners", () => {
    expect(rectFromPoints({ x: 10, y: 50 }, { x: -5, y: 20 })).toEqual({ x: -5, y: 20, width: 15, height: 30 });
  });
});

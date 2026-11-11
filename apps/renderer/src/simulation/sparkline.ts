// Sparkline geometry. Pure.
export interface SparklineGeometry {
  /** SVG path data in a `width` x `height` box, empty when there are no values. */
  readonly path: string;
  /** Y coordinate of the zero line. */
  readonly baseline: number;
  /** Position of the most recent value. */
  readonly last: { readonly x: number; readonly y: number } | null;
}

/**
 * Lays `values` out left to right over `capacity` slots, so a short history grows from the left instead of stretching.
 * The vertical range always includes zero.
 */
export function sparkline(values: readonly number[], capacity: number, width: number, height: number, padding = 3): SparklineGeometry {
  const shown = values.slice(-capacity);
  const max = Math.max(0, ...shown);
  const min = Math.min(0, ...shown);
  const range = max - min || 1;
  const y = (value: number): number => height - padding - ((value - min) / range) * (height - 2 * padding);
  const step = width / Math.max(1, capacity - 1);
  const points = shown.map((value, index) => ({ x: index * step, y: y(value) }));
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    path: points.map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`).join(" "),
    baseline: y(0),
    last: points.at(-1) ?? null,
  };
}

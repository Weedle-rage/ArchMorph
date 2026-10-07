import type { Furniture, PlanPoint } from "./architecture.ts";

export const furnitureKinds = [
  "single-bed",
  "double-bed",
  "bedside-table",
  "sofa",
  "armchair",
  "dining-table",
  "chair",
  "desk",
  "wardrobe",
  "kitchen-counter",
  "toilet",
  "basin",
] as const;

export type FurnitureKind = (typeof furnitureKinds)[number];

export type FurnitureCatalogEntry = {
  label: string;
  shortLabel: string;
  width: number;
  length: number;
  height: number;
  /** Neutral swatch used by the 3D view; an item's own `color` overrides it. */
  color: string;
};

/** Defaults in feet. Any dimension can be overridden after an item is placed. */
export const furnitureCatalog: Record<FurnitureKind, FurnitureCatalogEntry> = {
  "single-bed": { label: "Single Bed", shortLabel: "Bed", width: 3.25, length: 6.25, height: 2, color: "#cdc3b4" },
  "double-bed": { label: "Double Bed", shortLabel: "Bed", width: 5, length: 6.67, height: 2, color: "#cdc3b4" },
  "bedside-table": { label: "Bedside Table", shortLabel: "Side", width: 1.5, length: 1.5, height: 2, color: "#b9a98f" },
  sofa: { label: "Sofa", shortLabel: "Sofa", width: 7, length: 3, height: 2.8, color: "#b7beb4" },
  armchair: { label: "Armchair", shortLabel: "Chair", width: 3, length: 3, height: 2.8, color: "#b7beb4" },
  "dining-table": { label: "Dining Table", shortLabel: "Table", width: 5, length: 3, height: 2.5, color: "#c4b08f" },
  chair: { label: "Chair", shortLabel: "Chair", width: 1.5, length: 1.5, height: 3, color: "#c4b08f" },
  desk: { label: "Desk", shortLabel: "Desk", width: 4, length: 2, height: 2.5, color: "#c4b08f" },
  wardrobe: { label: "Wardrobe", shortLabel: "Wardrobe", width: 4, length: 2, height: 6.5, color: "#a89b8a" },
  "kitchen-counter": { label: "Kitchen Counter", shortLabel: "Counter", width: 6, length: 2, height: 3, color: "#d3d6d3" },
  toilet: { label: "Toilet", shortLabel: "WC", width: 1.5, length: 2.3, height: 2.5, color: "#e1e4e4" },
  basin: { label: "Basin", shortLabel: "Basin", width: 1.7, length: 1.5, height: 3, color: "#e1e4e4" },
};

export type FootprintRect = { x: number; y: number; w: number; l: number };

export const FURNITURE_OVERLAP_TOLERANCE = 0.01;

const EPS = 0.001;

/** Absolute plan footprint. `x`/`y` are relative to `origin` (the room's bounding-box origin) and already describe the rotated footprint's top-left. */
export function furnitureFootprint(
  item: Pick<Furniture, "x" | "y" | "width" | "length" | "rotation">,
  origin: PlanPoint,
): FootprintRect {
  const swapped = item.rotation === 90 || item.rotation === 270;
  return {
    x: origin.x + item.x,
    y: origin.y + item.y,
    w: swapped ? item.length : item.width,
    l: swapped ? item.width : item.length,
  };
}

/** Even-odd containment where points on the boundary count as inside (same tolerance as `roomContainsPoint`). */
export function pointInPolygon(vertices: PlanPoint[], point: PlanPoint): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[index];
    const b = vertices[previous];
    const onEdge = Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) < 0.01
      && point.x >= Math.min(a.x, b.x) - 0.01 && point.x <= Math.max(a.x, b.x) + 0.01
      && point.y >= Math.min(a.y, b.y) - 0.01 && point.y <= Math.max(a.y, b.y) + 0.01;
    if (onEdge) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * True when the segment passes through the open interior of the rectangle. The rectangle is shrunk by
 * EPS first so a segment lying along an edge, or touching a corner, is NOT a crossing (the existing
 * `segmentsIntersect` counts touching, which would reject furniture placed flush against a wall).
 * Liang–Barsky clipping.
 */
function segmentCrossesRectInterior(a: PlanPoint, b: PlanPoint, rect: FootprintRect): boolean {
  const xmin = rect.x + EPS;
  const xmax = rect.x + rect.w - EPS;
  const ymin = rect.y + EPS;
  const ymax = rect.y + rect.l - EPS;
  if (xmin >= xmax || ymin >= ymax) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [[-dx, a.x - xmin], [dx, xmax - a.x], [-dy, a.y - ymin], [dy, ymax - a.y]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * A footprint fits when all four corners and the centre are inside the polygon and no polygon edge passes
 * through the footprint interior. Corners alone would accept an item bridging the slot of a U-shaped room.
 */
export function footprintFitsPolygon(vertices: PlanPoint[], rect: FootprintRect): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.l },
    { x: rect.x, y: rect.y + rect.l },
  ];
  if (!corners.every((corner) => pointInPolygon(vertices, corner))) return false;
  if (!pointInPolygon(vertices, { x: rect.x + rect.w / 2, y: rect.y + rect.l / 2 })) return false;
  return vertices.every((vertex, index) => !segmentCrossesRectInterior(vertex, vertices[(index + 1) % vertices.length], rect));
}

export function rectOverlapArea(a: FootprintRect, b: FootprintRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const l = Math.min(a.y + a.l, b.y + b.l) - Math.max(a.y, b.y);
  return w > 0 && l > 0 ? w * l : 0;
}

/** Row-by-row scan of the room's bounding box in `step` ft increments; returns room-relative x/y of the first free spot. */
export function findFreeFurniturePosition(args: {
  vertices: PlanPoint[];
  origin: PlanPoint;
  bounds: { width: number; length: number };
  item: Pick<Furniture, "width" | "length" | "rotation">;
  others: FootprintRect[];
  step?: number;
}): { x: number; y: number } | undefined {
  const step = args.step ?? 0.5;
  for (let y = 0; y <= args.bounds.length + EPS; y += step) {
    for (let x = 0; x <= args.bounds.width + EPS; x += step) {
      const rect = furnitureFootprint({ ...args.item, x, y }, args.origin);
      if (!footprintFitsPolygon(args.vertices, rect)) continue;
      if (args.others.some((other) => rectOverlapArea(rect, other) > FURNITURE_OVERLAP_TOLERANCE)) continue;
      return { x, y };
    }
  }
  return undefined;
}

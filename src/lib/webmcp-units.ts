import {
  METRES_PER_FOOT,
  areaUnitLabel,
  fromDisplayArea,
  fromDisplayLength,
  lengthUnitLabel,
  localizeMessage,
  toDisplayArea,
  toDisplayLength,
  type UnitSystem,
} from "./units.ts";
import type { ArchMorphTool } from "./webmcp-tools.ts";

/** Numeric keys that are lengths in feet inside the model. Tool arguments and results use the project's unit. */
export const LENGTH_KEYS: ReadonlySet<string> = new Set([
  "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "w", "l",
  "width", "length", "height", "thickness", "offset", "elevation",
  "sillHeight", "slabThickness", "railingHeight", "projection", "landingDepth", "landingElevation",
  "upperFlightLength", "wellWidth", "parapetHeight", "parapetThickness",
  "gateWidth", "gateOffset", "gateHeight", "frontSetback", "rearSetback", "leftSetback", "rightSetback",
  "front", "rear", "left", "right", "perimeter", "wallLength", "rise", "riserHeight", "treadDepth", "recommendedRun",
  "recommendedRuns", "treadDepths", "distance", "horizontal", "vertical", "u", "v",
]);

export const AREA_KEYS: ReadonlySet<string> = new Set([
  "area", "balconyArea", "carpetArea", "floorCoveredArea", "grossCoveredArea", "netRoomArea", "netRoomAreaTotal",
  "openArea", "openSiteArea", "plotArea", "projectBalconyArea", "projectTerraceArea", "roomAreaSum", "terraceArea",
  "totalCarpetArea", "totalConstructedArea", "totalGrossCoveredArea", "totalNetBuildingArea", "totalNetFloorArea",
  "overlapSqFt", "glazedArea", "openableArea", "requiredClearArea", "requiredGlazing", "requiredOpenable", "roomArea",
]);

/** Numeric keys that are counts, ratios, angles, inches or thermal values: never converted. */
export const UNITLESS_KEYS: ReadonlySet<string> = new Set([
  "balconies", "doors", "errors", "facadeFeatures", "flightCount", "floorAreaRatio", "floors", "furniture",
  "coveragePercent", "grossCoveragePercent", "groundCoveragePercent", "issueCount", "issues", "level", "metalness",
  "projectVersion", "reachableRoomCount", "riserCount", "riserHeightInches", "roughness", "rotation", "rooms",
  "schemaVersion", "solarHeatGainCoefficient", "stairs", "terraces", "treadCount", "treadDepthInches", "uFactor",
  "version", "visibleTransmittance", "walls", "warnings", "windows",
  "doorCount", "exteriorDoorCount", "windowCount", "glazingRatioPercent", "maxSillInches", "minClearHeightInches",
  "minClearWidthInches", "progress", "progressStart", "progressEnd",
]);

/** Keys that are a length only for one tool (the generic name is ambiguous elsewhere). */
export const TOOL_LENGTH_KEYS: Record<string, string[]> = {
  set_exact_dimension: ["value"],
};

export function isClassifiedKey(key: string, toolName: string) {
  return LENGTH_KEYS.has(key) || AREA_KEYS.has(key) || UNITLESS_KEYS.has(key) || (TOOL_LENGTH_KEYS[toolName]?.includes(key) ?? false);
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Tool arguments arrive in the project's unit; convert to the model's feet. Identity for feet. */
export function convertInput(value: unknown, unit: UnitSystem, extraLengthKeys: ReadonlySet<string> = new Set()): unknown {
  if (unit === "ft") return value;
  if (Array.isArray(value)) return value.map((item) => convertInput(item, unit, extraLengthKeys));
  if (!value || typeof value !== "object") return value;
  const converted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "number" && (LENGTH_KEYS.has(key) || extraLengthKeys.has(key))) converted[key] = fromDisplayLength(child, unit);
    else if (typeof child === "number" && AREA_KEYS.has(key)) converted[key] = fromDisplayArea(child, unit);
    else converted[key] = convertInput(child, unit, extraLengthKeys);
  }
  return converted;
}

const SKIPPED_TEXT_KEYS = new Set(["name", "label", "title"]);

/** Tool results come from the model in feet; convert to the project's unit. Identity for feet. */
export function convertOutput(value: unknown, unit: UnitSystem, extraLengthKeys: ReadonlySet<string> = new Set(), key = ""): unknown {
  if (unit === "ft") return value;
  if (typeof value === "number") {
    if (LENGTH_KEYS.has(key) || extraLengthKeys.has(key)) return round2(toDisplayLength(value, unit));
    if (AREA_KEYS.has(key)) return round2(toDisplayArea(value, unit));
    return value;
  }
  if (typeof value === "string") {
    if (key === "unit") return value === "ft" ? lengthUnitLabel(unit) : value === "sq ft" ? areaUnitLabel(unit) : value;
    if (SKIPPED_TEXT_KEYS.has(key) || key === "id" || key.endsWith("Id") || key.endsWith("Ids")) return value;
    return localizeMessage(value, unit);
  }
  if (Array.isArray(value)) return value.map((item) => convertOutput(item, unit, extraLengthKeys, key));
  if (!value || typeof value !== "object") return value;
  const converted: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) converted[childKey] = convertOutput(child, unit, extraLengthKeys, childKey);
  return converted;
}

/** Static tool text cannot depend on the project, so it names "project units" and quotes feet limits in both units. */
export function describeUnits(text: string): string {
  return text
    .replace(/\bin feet\b/g, "in project units")
    .replace(/\bfeet\b/g, "project units")
    .replace(/(\d+(?:\.\d+)?) ft\b(?!²)/g, (_match, value: string) => `${value} ft (${String(Number((Number(value) * METRES_PER_FOOT).toFixed(2)))} m)`);
}

function describeSchema(node: unknown, extraLengthKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => describeSchema(item, extraLengthKeys));
  if (!node || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "description" && typeof child === "string") copy[key] = describeUnits(child);
    else if (key === "properties" && child && typeof child === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, definition] of Object.entries(child as Record<string, Record<string, unknown>>)) {
        const next = describeSchema(definition, extraLengthKeys) as Record<string, unknown>;
        if (LENGTH_KEYS.has(name) || AREA_KEYS.has(name) || extraLengthKeys.has(name)) {
          // Bounds written in feet would reject valid metric values; the operation enforces the real limits.
          delete next.minimum;
          delete next.maximum;
        }
        properties[name] = next;
      }
      copy[key] = properties;
    } else copy[key] = describeSchema(child, extraLengthKeys);
  }
  return copy;
}

/** Wrap a tool catalog so lengths and areas cross the boundary in the project's unit. `applyOperation` only sees feet. */
export function withUnits(tools: ArchMorphTool[], getUnit: () => UnitSystem): ArchMorphTool[] {
  return tools.map((tool) => {
    const extra = new Set(TOOL_LENGTH_KEYS[tool.name] ?? []);
    return {
      ...tool,
      description: describeUnits(tool.description),
      inputSchema: describeSchema(tool.inputSchema, extra) as Record<string, unknown>,
      execute: (input, options) => {
        const before = getUnit();
        const converted = convertInput(input, before, extra) as Record<string, unknown>;
        const finish = (result: unknown) => convertOutput(result, getUnit(), extra);
        const localizeError = (error: unknown) => (error instanceof Error && getUnit() === "m" ? new Error(localizeMessage(error.message, "m")) : error);
        try {
          const out = tool.execute(converted, options);
          if (out instanceof Promise) return out.then(finish, (error) => { throw localizeError(error); });
          return finish(out);
        } catch (error) {
          throw localizeError(error);
        }
      },
    };
  });
}

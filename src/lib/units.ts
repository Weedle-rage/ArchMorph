export type UnitSystem = "ft" | "m";

export const METRES_PER_FOOT = 0.3048;
export const SQM_PER_SQFT = 0.09290304;

const MAX_FEET = 100000;

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === "ft" || value === "m";
}

/** Two-decimal rounding with the same tie handling as `round` in architecture.ts (67.725-style values sit just below the tie). */
const round2 = (value: number) => {
  const scaled = value * 100;
  return Math.round(scaled + Math.sign(scaled) * 1e-9) / 100;
};

/** Number text with trailing zeros dropped: 12.50 -> "12.5". */
function trimmed(value: number, decimals: number) {
  return String(Number(value.toFixed(decimals)));
}

export function toDisplayLength(feet: number, unit: UnitSystem) {
  return unit === "m" ? feet * METRES_PER_FOOT : feet;
}

/** Display value -> stored feet, rounded to the model's two decimals. */
export function fromDisplayLength(value: number, unit: UnitSystem) {
  return round2(unit === "m" ? value / METRES_PER_FOOT : value);
}

export function toDisplayArea(sqft: number, unit: UnitSystem) {
  return unit === "m" ? sqft * SQM_PER_SQFT : sqft;
}

export function fromDisplayArea(value: number, unit: UnitSystem) {
  return round2(unit === "m" ? value / SQM_PER_SQFT : value);
}

export function lengthUnitLabel(unit: UnitSystem): "ft" | "m" {
  return unit === "m" ? "m" : "ft";
}

export function areaUnitLabel(unit: UnitSystem): "sq ft" | "m²" {
  return unit === "m" ? "m²" : "sq ft";
}

/** The number alone. Imperial trims trailing zeros; metric is always two decimals. */
export function formatLengthValue(feet: number, unit: UnitSystem, decimals = 2) {
  if (!Number.isFinite(feet)) return "—";
  if (unit === "m") {
    const metres = toDisplayLength(feet, "m");
    return (Math.abs(metres) < 0.005 ? 0 : metres).toFixed(2);
  }
  return trimmed(feet, decimals);
}

export function formatLength(feet: number, unit: UnitSystem, options?: { word?: boolean; decimals?: number }) {
  if (!Number.isFinite(feet)) return "—";
  const value = formatLengthValue(feet, unit, options?.decimals);
  if (unit === "m") return `${value} m`;
  return options?.word ? `${value} ft` : `${value}′`;
}

export function formatAreaValue(sqft: number, unit: UnitSystem, locale?: string) {
  if (!Number.isFinite(sqft)) return "—";
  if (unit === "m") {
    return toDisplayArea(sqft, "m").toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return sqft.toLocaleString(locale);
}

export function formatArea(sqft: number, unit: UnitSystem, locale?: string) {
  if (!Number.isFinite(sqft)) return "—";
  return `${formatAreaValue(sqft, unit, locale)} ${areaUnitLabel(unit)}`;
}

export type ParsedLength = { ok: true; feet: number } | { ok: false; reason: string };

const NUMBER = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
const FEET_MARK = "(?:'|ft|feet|foot)";
const INCH_MARK = "(?:\"|in|inch|inches)";
const forms = {
  bare: new RegExp(`^${NUMBER}$`),
  feetInches: new RegExp(`^${NUMBER}\\s*${FEET_MARK}\\s*-?\\s*${NUMBER}\\s*${INCH_MARK}?$`),
  feet: new RegExp(`^${NUMBER}\\s*${FEET_MARK}$`),
  inches: new RegExp(`^${NUMBER}\\s*${INCH_MARK}$`),
  metres: new RegExp(`^${NUMBER}\\s*m$`),
  centimetres: new RegExp(`^${NUMBER}\\s*cm$`),
  millimetres: new RegExp(`^${NUMBER}\\s*mm$`),
};

/** Parse typed text into stored feet. Units are accepted in either mode; a bare number means `unit`. */
export function parseLength(text: string, unit: UnitSystem): ParsedLength {
  let source = text.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/\s+/g, " ");
  if (!source) return { ok: false, reason: "Enter a length." };
  const negative = source.startsWith("-");
  if (negative) source = source.slice(1).trim();
  const fail = (): ParsedLength => ({ ok: false, reason: `Cannot read "${text.trim()}" as a length. Try 12.5, 12'6", 3.81m or 381cm.` });
  let feet: number;
  let match: RegExpMatchArray | null;
  if ((match = source.match(forms.bare))) feet = unit === "m" ? Number(match[1]) / METRES_PER_FOOT : Number(match[1]);
  else if ((match = source.match(forms.feetInches))) feet = Number(match[1]) + Number(match[2]) / 12;
  else if ((match = source.match(forms.feet))) feet = Number(match[1]);
  else if ((match = source.match(forms.inches))) feet = Number(match[1]) / 12;
  else if ((match = source.match(forms.metres))) feet = Number(match[1]) / METRES_PER_FOOT;
  else if ((match = source.match(forms.centimetres))) feet = Number(match[1]) / 100 / METRES_PER_FOOT;
  else if ((match = source.match(forms.millimetres))) feet = Number(match[1]) / 1000 / METRES_PER_FOOT;
  else return fail();
  if (!Number.isFinite(feet)) return fail();
  if (feet > MAX_FEET) return { ok: false, reason: `That length is too large. Use at most ${MAX_FEET} ft.` };
  return { ok: true, feet: round2(negative ? -feet : feet) };
}

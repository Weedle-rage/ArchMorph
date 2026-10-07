import assert from "node:assert/strict";
import {
  METRES_PER_FOOT,
  SQM_PER_SQFT,
  areaUnitLabel,
  formatArea,
  formatAreaValue,
  formatLength,
  formatLengthValue,
  fromDisplayArea,
  fromDisplayLength,
  isUnitSystem,
  lengthUnitLabel,
  boundLength,
  localizeMessage,
  parseLength,
  resolveLengthEdit,
  toDisplayArea,
  toDisplayLength,
} from "../src/lib/units.ts";

// Conversions use the exact international foot.
assert.equal(METRES_PER_FOOT, 0.3048);
assert.equal(SQM_PER_SQFT, 0.09290304);
assert.equal(toDisplayLength(10, "ft"), 10);
assert.ok(Math.abs(toDisplayLength(10, "m") - 3.048) < 1e-12);
assert.equal(fromDisplayLength(3.048, "m"), 10);
assert.equal(fromDisplayLength(3.81, "m"), 12.5, "3.81 m is exactly 12.5 ft");
assert.equal(fromDisplayLength(12.345, "ft"), 12.35, "stored feet are rounded to two decimals");
assert.ok(Math.abs(toDisplayArea(100, "m") - 9.290304) < 1e-12);
assert.equal(fromDisplayArea(9.290304, "m"), 100);
assert.equal(toDisplayArea(100, "ft"), 100);
assert.equal(lengthUnitLabel("ft"), "ft");
assert.equal(lengthUnitLabel("m"), "m");
assert.equal(areaUnitLabel("ft"), "sq ft");
assert.equal(areaUnitLabel("m"), "m²");
assert.ok(isUnitSystem("ft") && isUnitSystem("m"));
assert.ok(!isUnitSystem("yd") && !isUnitSystem(undefined) && !isUnitSystem("imperial"));

// Review focus 1: unrounded feet -> display -> feet is lossless for stored two-decimal values.
for (let index = 0; index <= 1000; index += 1) {
  const feet = Math.round(index * 7.31 * 100) / 100;
  assert.equal(fromDisplayLength(toDisplayLength(feet, "m"), "m"), feet, `round trip of ${feet} ft`);
  const area = Math.round(index * 13.37 * 100) / 100;
  assert.equal(fromDisplayArea(toDisplayArea(area, "m"), "m"), area, `round trip of ${area} sq ft`);
}

// Review focus 1: every two-decimal metre value from 0.00 to 100.00 m reads back as typed.
for (let cents = 0; cents <= 10000; cents += 1) {
  const metres = cents / 100;
  const text = `${metres.toFixed(2)} m`;
  const parsed = parseLength(text, "ft");
  assert.ok(parsed.ok, `${text} should parse`);
  assert.equal(formatLength((parsed as { feet: number }).feet, "m"), text, `${text} should read back unchanged`);
}

// Formatting.
assert.equal(formatLength(12.5, "ft"), "12.5′");
assert.equal(formatLength(12, "ft"), "12′");
assert.equal(formatLength(12.5, "ft", { word: true }), "12.5 ft");
assert.equal(formatLength(12.34, "ft", { decimals: 1 }), "12.3′");
assert.equal(formatLength(12.5, "m"), "3.81 m");
assert.equal(formatLength(12.5, "m", { word: true, decimals: 1 }), "3.81 m", "metric always shows two decimals");
assert.equal(formatLength(0, "ft"), "0′");
assert.equal(formatLength(0, "m"), "0.00 m");
assert.equal(formatLength(-12.5, "m"), "-3.81 m");
assert.equal(formatLength(-0.001, "m"), "0.00 m", "tiny negatives do not print as -0.00");
assert.equal(formatLength(Number.NaN, "ft"), "—");
assert.equal(formatLength(Number.POSITIVE_INFINITY, "m"), "—");
assert.equal(formatLengthValue(12.5, "ft"), "12.5");
assert.equal(formatLengthValue(12.345, "ft", 1), "12.3");
assert.equal(formatLengthValue(12.5, "m"), "3.81");
assert.equal(formatAreaValue(46.5, "ft", "en-US"), "46.5");
assert.equal(formatAreaValue(100, "m", "en-US"), "9.3");
assert.equal(formatArea(46.5, "ft", "en-US"), "46.5 sq ft");
assert.equal(formatArea(100, "m", "en-US"), "9.3 m²");
assert.equal(formatArea(0, "m", "en-US"), "0.0 m²");
assert.equal(formatArea(Number.NaN, "m"), "—");

// Parsing: every accepted form.
const feetOf = (text: string, unit: "ft" | "m" = "ft") => {
  const parsed = parseLength(text, unit);
  assert.ok(parsed.ok, `"${text}" should parse (${parsed.ok ? "" : parsed.reason})`);
  return (parsed as { feet: number }).feet;
};
assert.equal(feetOf("12.5"), 12.5);
assert.equal(feetOf("12.5", "m"), 41.01, "a bare number is the project's unit");
assert.equal(feetOf(".5"), 0.5);
assert.equal(feetOf("  12.5  "), 12.5);
for (const text of ["12'", "12ft", "12 ft", "12feet", "12 FT"]) assert.equal(feetOf(text), 12, text);
for (const text of [`12'6"`, `12' 6"`, `12'-6"`, "12ft 6in", `12′6″`, "12'6"]) assert.equal(feetOf(text), 12.5, text);
for (const text of [`150"`, "150in", "150 inches"]) assert.equal(feetOf(text), 12.5, text);
for (const text of ["3.81m", "3.81 m", "3.81M", "381cm", "3810mm", "381 CM"]) assert.equal(feetOf(text), 12.5, text);
assert.equal(feetOf(`12'6"`, "m"), 12.5, "a metric project accepts feet-inches");
assert.equal(feetOf("3.81m", "ft"), 12.5, "a feet project accepts metres");
assert.equal(feetOf("-3.81m"), -12.5);
assert.equal(feetOf("100000"), 100000);

// Parsing: every rejection carries a reason.
for (const text of ["", "   ", "abc", "12..5", "1,5", "3m 4ft", "NaN", "Infinity", "1e5", "100001", "12'6'", "--5", "12 13", "+5", "12 yd"]) {
  const parsed = parseLength(text, "ft");
  assert.ok(!parsed.ok, `"${text}" should be rejected`);
  assert.ok((parsed as { reason: string }).reason.length > 0, `"${text}" should explain why`);
}

{
  // Imperial text is returned untouched.
  const samples = ["A wall must be at least 1 ft long.", "Storey height must be between 7 and 16 ft.", "no quantity here"];
  for (const sample of samples) assert.equal(localizeMessage(sample, "ft"), sample);

  // Metric rewrites every shape the reducer produces today.
  assert.equal(localizeMessage("A wall must be at least 1 ft long.", "m"), "A wall must be at least 0.31 m long.");
  assert.equal(localizeMessage("Storey height must be between 7 and 16 ft.", "m"), "Storey height must be between 2.14 and 4.87 m.");
  assert.equal(localizeMessage("Furniture height must be between 0.25 and 8 ft.", "m"), "Furniture height must be between 0.08 and 2.43 m.");
  assert.equal(localizeMessage("Rooms must be at least 3 × 3 ft.", "m"), "Rooms must be at least 0.92 × 0.92 m.");
  assert.equal(localizeMessage("Editable 30 × 60 ft residential site created", "m"), "Editable 9.14 × 18.29 m residential site created");
  assert.equal(localizeMessage("Wardrobe is 7.5 ft tall and would not fit the 7 ft storey.", "m"), "Wardrobe is 2.29 m tall and would not fit the 2.13 m storey.");
  assert.equal(localizeMessage("Double Bed would overlap Wardrobe by 6.5 sq ft.", "m"), "Double Bed would overlap Wardrobe by 0.6 m².");
  assert.equal(localizeMessage("at least 12 sq ft clear, 20 in wide, 24 in high", "m"), "at least 1.12 m² clear, 20 in wide, 24 in high", "inches are left alone");
  assert.equal(localizeMessage("Front wall 11.5′ · Door 3′", "m"), "Front wall 3.51 m · Door 0.91 m");
  assert.equal(localizeMessage("Room room-1 does not exist.", "m"), "Room room-1 does not exist.");
  assert.equal(localizeMessage("A 5 storey tower", "m"), "A 5 storey tower", "a bare number is not a length");
  assert.ok(!/\bft\b|sq ft|′/.test(localizeMessage("Gate width must leave at least 0.5 ft of wall at both sides.", "m")));
}

{
  // Final review, Critical 1: focusing and leaving a length field is not an edit.
  assert.deepEqual(resolveLengthEdit("2.74", "2.74", "m"), { kind: "unchanged" }, "an untouched metric field must not re-commit its rounded text");
  assert.deepEqual(resolveLengthEdit(" 2.74 ", "2.74", "m"), { kind: "unchanged" });
  assert.deepEqual(resolveLengthEdit("12.5", "12.5", "ft"), { kind: "unchanged" });
  assert.deepEqual(resolveLengthEdit("2.75", "2.74", "m"), { kind: "valid", feet: 9.02 });
  assert.deepEqual(resolveLengthEdit(`9'6"`, "2.74", "m"), { kind: "valid", feet: 9.5 });
  assert.deepEqual(resolveLengthEdit("abc", "2.74", "m"), { kind: "invalid" });
  assert.deepEqual(resolveLengthEdit("", "2.74", "m"), { kind: "invalid" });

  // Final review, Important 4: a quoted lower bound rounds up and an upper bound rounds down, so the quoted value is itself accepted.
  assert.equal(boundLength(3, "m", "up"), 0.92);
  assert.equal(boundLength(7, "m", "up"), 2.14);
  assert.equal(boundLength(16, "m", "down"), 4.87);
  assert.equal(boundLength(12.5, "m", "up"), 3.81, "an exact value is not pushed up");
  assert.equal(boundLength(12.5, "m", "down"), 3.81);
  assert.equal(boundLength(3, "ft", "up"), 3);
  for (let quarter = 1; quarter <= 800; quarter += 1) {
    const feet = quarter / 4;
    const up = boundLength(feet, "m", "up");
    const down = boundLength(feet, "m", "down");
    assert.ok(fromDisplayLength(up, "m") >= feet, `lower bound ${feet} ft shown as ${up} m must convert back to at least ${feet} ft`);
    assert.ok(fromDisplayLength(down, "m") <= feet, `upper bound ${feet} ft shown as ${down} m must convert back to at most ${feet} ft`);
  }
  assert.equal(localizeMessage("Plot dimensions must be at least 15 ft.", "m"), "Plot dimensions must be at least 4.58 m.");
  assert.equal(localizeMessage("Stair flights must be at most 8 ft wide.", "m"), "Stair flights must be at most 2.43 m wide.");
  assert.equal(localizeMessage("Rooms must be at least 3 sq ft.", "m"), "Rooms must be at least 0.28 m².");
}

console.log("Units regression passed: conversion, formatting, parsing and message rewriting.");

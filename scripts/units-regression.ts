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
  parseLength,
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

console.log("Units regression passed: conversion, formatting and parsing.");

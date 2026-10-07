# Units: design spec

Date: 2026-10-07 · Status: draft for review · Stored unit: feet

**Amended during planning (code facts found after the first draft):**
- `Project` already has `unit: "ft"` and several tool results already return `unit: "ft"` / `"sq ft"`. This spec reuses that field, widened to `"ft" | "m"`, instead of adding a new `units` field. `UnitSystem` is `"ft" | "m"`.
- A 2-decimal metre display is coarser than the 0.01 ft storage, so the round-trip guarantee is stated precisely (see Testing and Risks).
- Tool schemas drop `minimum`/`maximum` on length properties (feet-valued bounds would reject valid metric values). The operations still enforce the real bounds.
- `set_exact_dimension.value` is a length for that tool only; it is handled explicitly.
- The message audit runs against messages captured during the regression run, not against source text.

## Goal

Let a project be viewed, typed into and described to the agent in either **imperial (decimal feet)** or **metric (metres)**, chosen per project. This is the first piece of the longer direction of making ArchMorph a precise, AutoCAD-style architectural drafting tool (command line, object snaps, edit commands); it comes first so the later drafting work can parse and display lengths correctly from day one.

## Decisions (agreed in brainstorming)

1. **Per project.** The unit lives in the project file, not in a user preference. New projects and all existing projects default to imperial.
2. **Stored geometry stays in feet.** No operation signature changes and no geometry migration. Units are a conversion and formatting layer at the edges.
3. **Metric display:** metres with two decimals (`3.81 m`), areas in `m²` (`46.5 m²`). Typed input also accepts `mm` and `cm`.
4. **Imperial display:** decimal feet (`12.5′`, `46.5 sq ft`), exactly as today. Typed input also accepts feet-inches (`12'6"`).
5. **Agent tools use the project's unit** for every length and area argument and result. Results echo the unit.

## Non-goals

- Feet-inches or millimetre display modes.
- A per-user default unit or app-wide preference.
- Changing stored geometry, the snapping algorithm or any validation rule.
- Fractions of an inch.
- Localised number formats (decimal comma).

## Data model

`src/lib/architecture.ts`:

```ts
export type UnitSystem = "ft" | "m";
// Project.unit changes type from the literal "ft" to UnitSystem.
unit: UnitSystem;
```

- `PROJECT_SCHEMA_VERSION` becomes **9** (in `persistence.ts`). `createInitialProject` and `migrateProject` hard-code the version and must change with it.
- `migrateProject` sets `project.unit = project.unit === "m" ? "m" : "ft"`, so v8 and older projects, and hand-edited files with a bad value, load in feet.
- New operation `{ type: "set_units"; unit: UnitSystem }`. It changes only `project.unit`, bumps the version, and is undoable and logged like every other operation. An unknown value is rejected with `Unit must be ft or m.`; setting the current value is rejected with `Units are already metres.` / `Units are already feet.` so history has no empty entries.
- `set_units` does not change any geometry, and a test pins that.

## `src/lib/units.ts` (new, no React, no value imports from `architecture.ts`)

Type imports only from `architecture.ts`, relative imports with the `.ts` extension, and no enums, namespaces or parameter properties, because the regression scripts load it through `node --experimental-strip-types`.

```ts
export const FEET_PER_METRE = 1 / 0.3048;
export const SQFT_PER_SQM = 1 / 0.09290304;

toDisplayLength(feet: number, unit: UnitSystem): number    // feet -> unit value, unrounded
fromDisplayLength(value: number, unit: UnitSystem): number // unit value -> feet, rounded to 2 d.p.
toDisplayArea / fromDisplayArea                              // same for areas

formatLength(feet, units): string   // "12.5′" | "3.81 m"
formatArea(feet2, units): string    // "46.5 sq ft" | "4.32 m²"
lengthUnitLabel(units): "ft" | "m"
areaUnitLabel(units): "sq ft" | "m²"

parseLength(text: string, unit: UnitSystem): { ok: true; feet: number } | { ok: false; reason: string }
localizeMessage(text: string, unit: UnitSystem): string    // see "Messages"
```

### Formatting

- Imperial: the existing display precision. Trailing zeros are dropped (`12.5′`, not `12.50′`). Area keeps its current formatting.
- Metric: exactly two decimals for lengths (`12.50 m`), areas to one decimal (`46.5 m²`), because the stored precision is 0.01 ft (about 3 mm).
- Negative and zero values format normally. Non-finite values format as `—`.

### Parsing (`parseLength`)

Accepted forms, case-insensitive, surrounding whitespace ignored:

| Input | Meaning |
| --- | --- |
| `12.5` | bare number: the project's unit (feet or metres) |
| `12'`, `12ft`, `12 ft`, `12feet` | feet |
| `12'6"`, `12' 6"`, `12'-6"`, `12ft 6in` | feet and inches |
| `150"`, `150in` | inches |
| `3.81m`, `3.81 m` | metres |
| `381cm`, `3810mm` | centimetres, millimetres |

Rules: units are accepted in either project mode (a metric project accepts `12'6"` and converts), and the result is always feet rounded to 2 d.p. Rejected with a reason: empty text, non-numeric text, `NaN`/`Infinity`, more than one decimal point, mixed forms such as `3m 4ft`, and numbers above 100000 (to stop accidental huge values). Negative numbers parse (a caller such as an offset may allow them); callers enforce their own minimum.

## Display edges

Every user-facing number goes through `units.ts`. The reducer and geometry code stay in feet.

### Studio (`src/app/components/Studio.tsx`)

- **Project settings:** a Units control (Feet / Metres) beside the plot settings, committing `set_units`.
- **`NumberField`** (the one component behind all 42 numeric inputs): receives the value in feet and the project's units, shows the converted value and the right unit tag, converts typed input with `parseLength`, and applies `min`/`max`/`step` in the displayed unit. The "Enter a value from … to …" text uses the displayed unit. Typing a value in another recognised unit (`12'6"` in a metric project) is accepted.
- **Library rows, metrics, schedules, validation panel, toasts, inspector headers and `elementLabel`:** use `formatLength` / `formatArea`.
- **Errors:** `commit` passes error text through `localizeMessage` before showing it.

### Plan (`FloorPlan.tsx`) and 3D (`ModelView.tsx`)

Wall length labels, the measure tool readout, room area labels, plot size and any 3D numeric readout use `formatLength` / `formatArea`.

### Snap grid

The snap grid stays **0.5 ft** in the model. In a metric project it reads as about `0.15 m`. Typed values are never snapped, so `3.81 m` stores exactly 12.5 ft.

## Messages

`architecture.ts` throws about 60 messages that quote feet (`7.5 ft tall`, `at least 0.5 ft`, `3 × 3 ft`, `46.5 sq ft`). The reducer keeps emitting feet. `localizeMessage(text, units)` rewrites only the quantities in a message when `units` is `metric`; imperial text is returned unchanged.

- It matches a number (or a `A × B` pair) followed by `ft`, `′` or `sq ft`, converts each number, and attaches `m` or `m²`.
- Text with no quantity, and quoted names, are never touched.
- An **audit test** captures every message thrown or reported during the architecture regression run (each rejected operation and each validation issue) and asserts that `localizeMessage(message, "m")` leaves no `ft`, `sq ft` or `′` quantity behind. A new message the rewriter cannot handle fails the test. A fixed corpus test also covers the shapes seen today: `N ft`, `A × B ft`, `between A and B ft`, `N sq ft`, and text with no quantity.
- Existing regression tests call `applyOperation` directly and match feet text; they are unchanged because the reducer text does not change.

## WebMCP tools (`src/lib/webmcp-tools.ts`)

- **Boundary conversion.** The tool layer converts incoming length and area arguments to feet before it builds the operation, and converts outgoing numbers back. `applyOperation` only ever sees feet.
- **One table** declares, per tool, which input properties are lengths and which are areas, and which result fields are lengths or areas. A test iterates all tools and fails if a tool has a numeric property that is in neither the table nor an explicit "unitless" list (counts, angles, indexes, rotations), so a new tool cannot silently skip conversion.
- **Descriptions and schemas** drop the hard-coded "feet" and say "in project units (see `inspect_project`'s `unit`)". Schema `minimum`/`maximum` are removed from length and area properties, because bounds written in feet would make a client reject valid metric values (a 2.5 m room width against `minimum: 3`); the operation enforces the real bounds and its error is localised.
- **Results** include `unit: "ft" | "m"`.
- `inspect_project` already returns `project.unit`; its value becomes `"ft"` or `"m"`. Results that already carry a `unit` field (`"ft"`, `"sq ft"`) report the project's length or area unit instead.
- **New tool `set_units`** (edit). The catalog goes from 61 to **62** tools; categories become inspect 9, edit 41, calculate 5, present 7. `STUDIO_TOOL_COUNT` becomes 62 and the README and `docs/WEBMCP_TESTING.md` counts are updated.
- **Chat prompt** (`src/app/api/chat/route.ts`) states the project's unit and that all lengths in tool calls are in that unit.

## Persistence

Schema v9. Import, export, local save and cloud merge carry `unit` unchanged. Every load path already runs `migrateProject`, so older files and cloud copies without `m` load in feet.

## Testing

Plain `node:assert` scripts, as for the existing suites (`npm run test:architecture`, `test:webmcp`), plus a new `scripts/units-regression.ts` and an npm script `test:units`.

- **`units.ts`:** exact conversion factors; unrounded feet → display → feet returns the same value for 1,000 sampled 2-decimal foot values; every 2-decimal metre value from 0.00 to 100.00 m, converted to stored feet, formats back to the same text (the 0.01 ft storage step is finer than the 0.01 m display step); every parse form in the table; every rejection case; negative values; formatting of zero, negatives, non-finite values and very large values; area formatting.
- **Messages:** the audit test above, plus unit tests for `A × B` pairs, `sq ft`, `′`, and text with no quantity.
- **Model:** v8 → v9 migration (missing and invalid `unit`); `set_units` is undoable, redoable and logged; setting the same value is rejected; geometry is byte-identical before and after switching.
- **WebMCP:** the same operation sent in feet to an imperial project and in metres to a metric project produces identical geometry; every result carries `unit`; the conversion-table completeness test; catalog counts (62 tools; inspect 9, edit 41, calculate 5, present 7).
- **UI:** `npm run lint`, `tsc --noEmit` and `npm run build`, plus a manual pass in both modes: inspector fields, plan labels, the measure tool, library rows, metrics, error toasts, and typing `12'6"` into a metric project.

## Risks

- **Mis-converted tool arguments.** The most likely bug is a length that the tool layer forgets to convert, which would be off by a factor of 3.28. The completeness test and the paired feet/metres parity test are the main defences.
- **Message rewriting is regex-based.** The audit test guards it; any message it cannot convert fails CI rather than showing feet in a metric project.
- **Rounding.** The model stores 2 decimals in feet (about 3 mm). A typed metric value converts to the nearest stored foot value and displays back as the same 2-decimal text. A stored foot value shown in metres and typed back may land up to 0.016 ft away, because the display step (0.01 m) is coarser than the storage step.

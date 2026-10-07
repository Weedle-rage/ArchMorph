# Furniture: design spec

Date: 2026-10-07 · Status: approved design · Units: feet

## Goal

Add basic schematic furniture for two reasons:

1. **Fit checking at real dimensions.** Does a double bed and two bedside tables fit in this bedroom?
2. **A lived-in look.** Furnished rooms read better in the 2D plan and in the 3D Orbit and Walk views.

Furniture is a new element type and follows the same path as balconies, stairs and facade features: a type in `Project`, then operations in the `applyOperation` reducer, then WebMCP tools, then SVG plan and Three.js rendering, then a Studio inspector, then a schema bump with a migration. Because it goes through the shared operation pipeline, it gets undo/redo, the activity log, versioning, local persistence and human/agent parity with no extra work.

## Scope change

README.md currently says: "ArchMorph intentionally focuses on architecture rather than furniture, decoration, cinematic effects, or unvalidated simulation." Change it to say that ArchMorph includes concept-level furniture for scale and fit, and does not include decoration, styling or product data. Cinematic effects and unvalidated simulation stay out of scope.

## Non-goals (v1)

- Clearance checks for door swings, walkways and windows.
- Snapping furniture to walls.
- Furniture collision in Walk Mode. Items render but do not block movement, and `src/lib/spatial3d.ts` does not change.
- Custom or imported models, and detailed multi-part meshes.
- Furniture on balconies, terraces or stairwells.
- Any unit change. Everything stays in feet.

## Data model

Add this to `src/lib/architecture.ts`:

```ts
export type FurnitureRotation = 0 | 90 | 180 | 270;

export type Furniture = {
  id: string;
  floorId: string;
  roomId: string;
  kind: FurnitureKind;          // key of furnitureCatalog
  name: string;
  x: number;                    // footprint top-left, ft, relative to the room's bounding-box origin, after rotation
  y: number;
  width: number;                // unrotated size, ft
  length: number;
  height: number;
  rotation: FurnitureRotation;  // at 90/270 the footprint swaps width and length
  color?: string;
};
```

- `Project` gains `furniture: Furniture[]`.
- The room's bounding-box origin is `room.x` / `room.y`. For polygon rooms these values are already the bounding-box minimum, because `migrateProject` and `roomFromVertices` normalise them through `roomBounds`.
- The absolute footprint is `{ x: room.x + f.x, y: room.y + f.y, w, l }`, where `w = width` and `l = length` at rotation 0 or 180, and the two are swapped at 90 or 270.
- `PROJECT_SCHEMA_VERSION` goes from 7 to 8 in `src/lib/persistence.ts`. Make the same change to the hard-coded `project.schemaVersion = 7` in `migrateProject` in `architecture.ts`.
- `migrateProject` sets `project.furniture = (project.furniture ?? []).map(...)`, so a v7 project ends up with `furniture: []`.
- `createInitialProject` starts with `furniture: []`.

**Catalog.** `furnitureCatalog` is defined in the new file `src/lib/furniture.ts` and exported next to the use of `exteriorFinishPresets`. It is a `Record<FurnitureKind, { label; shortLabel; width; length; height }>`. Dimensions are width × length × height in feet. The values are tunable, and any dimension can be overridden after an item is placed.

| kind | label | W | L | H |
|---|---|---|---|---|
| single-bed | Single Bed | 3.25 | 6.25 | 2 |
| double-bed | Double Bed | 5 | 6.67 | 2 |
| bedside-table | Bedside Table | 1.5 | 1.5 | 2 |
| sofa | Sofa | 7 | 3 | 2.8 |
| armchair | Armchair | 3 | 3 | 2.8 |
| dining-table | Dining Table | 5 | 3 | 2.5 |
| chair | Chair | 1.5 | 1.5 | 3 |
| desk | Desk | 4 | 2 | 2.5 |
| wardrobe | Wardrobe | 4 | 2 | 6.5 |
| kitchen-counter | Kitchen Counter | 6 | 2 | 3 |
| toilet | Toilet | 1.5 | 2.3 | 2.5 |
| basin | Basin | 1.7 | 1.5 | 3 |

## Operations and rules

Add three new variants to `ArchitectureOperation`, with matching cases in `applyOperation`:

- `{ type: "add_furniture"; roomId; kind; name?; x?; y?; width?; length?; height?; rotation? }`
  - The new item takes `floorId` from the room.
  - If `x` and `y` are both omitted, scan the room's bounding box in 0.5 ft steps (row by row) and use the first position where every rule below passes.
  - If no position passes, throw: `Double Bed does not fit anywhere in Bedroom. Remove or resize something first.`
  - On success, set `focusElementId` to the new item.
- `{ type: "update_furniture"; furnitureId; name?; x?; y?; width?; length?; height?; rotation?; color? }`
- `{ type: "delete_furniture"; furnitureId }`

Every add and update checks these rules on the resulting item and throws with no state change if any rule fails:

1. **The room exists and is on the item's floor.** Error: `Room <id> does not exist.`, following the existing wording.
2. **Size limits.** Width and length must each be at least 0.5 ft. Height must be between 0.25 and 8 ft, and below the floor's storey height (`Floor.height`).
3. **Inside the room.**
   - Every corner of the rotated footprint must pass `roomContainsPoint`. Points on the boundary count as inside.
   - For L, T, U and custom rooms, checking corners alone is not enough. Also require that no edge from `roomVertices(room)` passes through the interior of the footprint. A room vertex strictly inside the footprint fails this check.
   - The existing `segmentsIntersect` counts touching as an intersection, so it would reject items placed flush against a wall. Use a strict-crossing helper in `furniture.ts` instead.
4. **No overlap with other furniture on the same floor.** Touching edges are allowed. The error follows the room-overlap wording: `Double Bed would overlap Wardrobe by 6.5 sq ft.`

All values are rounded with the existing `round` helper. Each operation writes one activity description, for example `Agent added Double Bed to Bedroom`.

**Delete in Studio.** Studio's generic delete currently sends `delete_room` for rooms and `delete_element` for everything else. Add a branch that sends `delete_furniture` when the selected element is furniture. `delete_element` itself is unchanged.

## Interaction with rooms

Decision: furniture moves with its room.

- **Moving a room.** Furniture positions are relative to the room, so `move_room` carries the room's furniture automatically. This includes the edge latch that `alignTranslation` adds. No furniture is re-validated against the room, because the room has the same shape. Overlap does not need a cross-room check either, because rooms cannot overlap.
- **Resizing or reshaping a room.** After computing the new room, `resize_room` and `update_room_vertices` re-run the inside-the-room check for each item in that room. If any item fails, the operation is rejected with: `Double Bed would no longer fit. Move or remove it first.`
  - `resize_room` keeps the bounding-box origin, so items stay in place.
  - `update_room_vertices` can move the bounding-box origin. In that case, rebase each item's offset by the origin shift so the item keeps its absolute plan position.
- **Deleting a room.** `delete_room` removes the room's furniture in the same operation, so it is one transaction and one undo step.
- **Changing storey height.** `set_floor_height` gets a second guard after the existing opening check: `A Wardrobe on this floor is 6.5 ft tall and would not fit a 6 ft storey. Resize or remove it first.` The current 7 ft minimum storey height means this only triggers for items taller than 7 ft.

## Validation

Operations prevent invalid states. Imported or hand-edited JSON can still contain bad data, so `validateLayout` (`validate_layout`) also reports two new error codes. Add both to the `ValidationIssue["code"]` union.

- `FURNITURE_OUTSIDE_ROOM`: the item's room is missing, the room is on another floor, or the footprint fails the inside-the-room rule.
- `FURNITURE_OVERLAP`: two items on the same floor overlap by more than 0.01 sq ft. The `elementIds` field lists both items.

`inspectFloor` (`inspect_floor`) and `inspect_project` include furniture:

- The summary gives `id, roomId, kind, name, x, y, width, length, height, rotation` for each item.
- Full detail adds the absolute footprint.
- Both must stay within the existing inspection payload limits. The regression test that checks the summary is under 75% of the full payload must still pass on a furnished floor.

## UI

- **Library.** Add a `"furniture"` value to `LibraryTab` in `Studio.tsx` and a Furniture entry to `libraryTabs`. `.library-tabs` in `globals.css` is a 4-column grid, so change it to 5 columns.
  - Picking a kind adds it to the selected room, or to the room under the pointer, at the first free spot. The new item is then selected.
  - If no room is selected, show the toast "Select a room first".
- **Inspector.** Follows the pattern of the `selectedBalcony` panel. Fields: name, kind (read-only), relative X and Y, width, length, height, rotation (0/90/180/270), and a delete button. Each change commits `update_furniture`.
- **Plan (`FloorPlan.tsx`).**
  - Draw each item as an outlined rectangle at its rotated footprint, with its short label. Drop the label when the item is too small to hold it.
  - Draw furniture above the room fill and below the selection overlays.
  - Dragging moves the item using the existing `snap` (0.5 ft grid, which is the same as 6 in).
  - `R` rotates the selected item 90°.
  - Rejected edits use the existing error/toast path.
- **3D (`ModelView.tsx`).**
  - Each item is one or two boxes in a neutral palette. A bed is a frame plus a headboard. A wardrobe, counter, desk and similar items are a single box.
  - The selected item is tinted.
  - Set `mesh.userData.elementId = furniture.id` so picking selects the item.
  - Furniture shows in Walk Mode but does not block movement.

## WebMCP tools (`src/lib/webmcp-tools.ts`)

| tool | category | annotations | maps to |
|---|---|---|---|
| `list_furniture_kinds` | inspect | `readOnlyHint: true` | returns `furnitureCatalog` |
| `add_furniture` | edit | none | `add_furniture` |
| `update_furniture` | edit | none | `update_furniture` |
| `delete_furniture` | edit | none | `delete_furniture` |

- `kind` is a schema `enum` of the catalog keys. `rotation` is an `enum` of `[0, 90, 180, 270]`. All schemas set `additionalProperties: false`.
- The catalog grows from 57 to 61 tools. The category counts become inspect 9, edit 40, calculate 5, present 7.
- `/api/chat` builds its tool definitions from `createArchMorphTools`, so the in-app assistant gets the furniture tools without further changes.
- The landing page's own tool catalog does not change. Update only `STUDIO_TOOL_COUNT` in `src/lib/landing-webmcp-tools.ts`, from 57 to 61.
- Update the tool counts in README.md (lines 15, 102 and 104) and the scope line covered under Scope change.
- Add a `furnish-a-bedroom` fixture to `evals/webmcp-journeys.json`:
  - Expected tools: `inspect_floor`, `list_furniture_kinds`, `add_furniture`.
  - Assertions: the double bed and two bedside tables are placed inside the bedroom with no overlap, the result is one undoable step per item, and an oversized request fails with the named-item error.

## Testing

**`scripts/architecture-regression.ts`** (`npm run test:architecture`):
- Add, update and delete round-trip, plus undo and redo.
- Rejects a placement outside the room, including a rotated item that crosses a wall and an item that falls in the notch of an L-shaped room.
- Rejects furniture overlap with the expected wording, and accepts items that touch.
- Auto-placement finds a free spot, and fails cleanly when the room is full.
- `move_room` moves its furniture.
- A `resize_room` or `update_room_vertices` that would leave an item outside the room is rejected.
- `delete_room` removes the room's furniture, and a single undo restores both.
- `set_floor_height` is rejected when an item is too tall for the new storey.
- Migrating a v7 project gives `furniture: []` and `schemaVersion: 8`.
- `validateLayout` reports `FURNITURE_OUTSIDE_ROOM` and `FURNITURE_OVERLAP` on a hand-edited project.

**`scripts/webmcp-regression.ts`** (`npm run test:webmcp`):
- `tools.length` and `STUDIO_TOOL_COUNT` equal 61, and the category counts match.
- New schemas reject undeclared properties.
- `list_furniture_kinds` is in `expectedReadOnly`, and the three mutating tools are not.
- Human/agent parity holds for all three furniture operations.
- The `inspect_floor` payload-size check still passes with furniture present.

**Also run** `npm run lint` and `npm run build`. Then check by hand in the browser: add from the Library, drag, rotate with R, a rejected resize of a furnished room, the 3D view, and Walk Mode.

## Risks

- **`architecture.ts` is already about 3,700 lines.** Put the catalog, footprint, fit and overlap helpers in the new `src/lib/furniture.ts`. Add only the type, the operation variants, the reducer cases and the room-operation guards to `architecture.ts`. `furniture.ts` imports `roomContainsPoint`, `roomVertices` and `roomBounds` from `architecture.ts`. To avoid a circular import, the reducer calls `furniture.ts` helpers that take plain room and item values, not `Project`.
- **Rejecting resizes of furnished rooms may surprise users.** The error names the item that blocks the change, so the fix is obvious. Moving the room still works.
- **Polygon containment.** Checking corners alone accepts items that span the notch of an L, T or U room. The edge-crossing check is required, and the L-shaped regression case guards it.

## Verified against code

Checked on 2026-10-07 against `architecture.ts`, `persistence.ts`, `webmcp-tools.ts`, `landing-webmcp-tools.ts`, `Studio.tsx`, `FloorPlan.tsx`, `ModelView.tsx`, `scripts/webmcp-regression.ts`, `src/app/api/chat/route.ts`, `evals/webmcp-journeys.json` and `README.md`. These names match the code: `Project`, `Balcony`, `ArchitectureOperation`, `add_balcony`/`update_balcony`/`delete_balcony`, `move_room`, `resize_room`, `update_room_vertices`, `delete_room`, `set_floor_height`, `roomContainsPoint`, `roomVertices`, `roomBounds`, `exteriorFinishPresets`, `PROJECT_SCHEMA_VERSION = 7`, and the 57-tool count.

Corrections and additions to the original design:

- The migration function is `migrateProject` in `architecture.ts`, not in `persistence.ts`. It also hard-codes `schemaVersion = 7`, which must be bumped.
- The storey-height check lives in `set_floor_height`, and its minimum storey height is 7 ft.
- The reducer is `applyOperation`, and the layout validator is `validateLayout`.
- The "edge alignment" that moves rooms is the `alignTranslation` latch inside `move_room`. There is no separate align operation.
- `STUDIO_TOOL_COUNT` in `landing-webmcp-tools.ts` must also change to 61, even though the landing tools themselves do not change.
- The category counts asserted in `webmcp-regression.ts` change, and `list_furniture_kinds` must be added to `expectedReadOnly`.
- Studio's Delete key sends `delete_element` for every non-room element, so it needs a branch that sends `delete_furniture`.
- The `.library-tabs` grid is fixed at 4 columns in `globals.css`.
- `segmentsIntersect` is private and counts touching as an intersection, so it cannot be used as-is for the edge-crossing check.

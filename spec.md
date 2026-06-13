# pybracket v2 — Feature Spec

**Repos involved**
- `~/GitHub/pybracket` — Python library (changes must land first; the frontend consumes it via Pyodide)
- `~/GitHub/pybracket-frontend` — Next.js 15 / React 19 frontend (changes land second)

**Implementation order**: all library changes → re-bundle for Pyodide → all frontend changes.  
Each section is tagged **[Library]**, **[Frontend]**, or **[Both]**.

---

## 1. Grand Finals Reset — `not_needed` Status [Both]

### Library (`pybracket`)

Add `not_needed` to `MatchStatus` in `pybracket/models/enums.py`:

```python
class MatchStatus(Enum):
    PENDING        = "pending"
    READY          = "ready"
    BYE            = "bye"
    COMPLETED      = "completed"
    PENDING_CHOICE = "pending_choice"
    NOT_NEEDED     = "not_needed"   # match existed but was never required
```

In the double-elimination advancement engine (`advancement/engine.py`): when GF game 1 (`bracket_side == GRAND_FINAL, round_number == 1`) completes and the winners-bracket finalist wins, the reset match (`round_number == 2`) must be immediately set to `status = NOT_NEEDED`. It is **not** treated as a bye — no participant advances through it, it simply closes. The bracket still transitions to `BracketState.COMPLETE`.

The reset match must exist in the serialized bracket from the moment the bracket is generated — it is always part of the data model. It only transitions to `NOT_NEEDED` at settlement time.

### Frontend (`pybracket-frontend`)

- Add `'not_needed'` to the `MatchStatus` union in `lib/types.ts`.
- When a match has `status === 'not_needed'`: render the match box in its correct layout position (so spacing and connector lines are undisturbed), but dim it (`opacity-30`), suppress all interactive elements, and show "—" or "N/A" in place of player slots.

---

## 2. Pool Play DRAFT → Publish Flow [Both]

### Library (`pybracket`)

Currently `reseed_pools_to_bracket` generates the elimination bracket directly in `BracketState.PUBLISHED`. Split into two functions:

```python
def draft_pools_to_bracket(
    pools_bracket: PoolsBracket,
    new_seed_order: list[Any] | None = None,
) -> PoolsBracket:
    """Seed survivors from pool standings into a DRAFT elimination bracket.
    The TO reviews and may reorder seeds before publishing."""
    # Same logic as current reseed_pools_to_bracket but passes state=BracketState.DRAFT
    ...

def publish_bracket(pools_bracket: PoolsBracket) -> PoolsBracket:
    """Transition the elimination bracket from DRAFT to PUBLISHED, locking it for play."""
    if pools_bracket.elimination.state != BracketState.DRAFT:
        raise BracketStateError("Bracket must be in DRAFT state to publish.")
    # Re-run settle_initial on the elimination bracket, then set state=PUBLISHED
    ...
```

Keep `reseed_pools_to_bracket` as a convenience alias that calls `draft_pools_to_bracket` then `publish_bracket`, so existing callers are not broken.

Expose both new functions from `pybracket/__init__.py`.

Add dispatch ops to the Pyodide bridge:
- `{ op: 'draft_pools', pools_bracket }` → `draft_pools_to_bracket`
- `{ op: 'reseed_pools', pools_bracket, new_seed_order }` → `draft_pools_to_bracket` with custom order
- `{ op: 'publish_bracket', pools_bracket }` → `publish_bracket`

### Frontend (`pybracket-frontend`)

When the active format is `pools` and the elimination bracket is in `BracketState.DRAFT`:

- Render the DRAFT elimination bracket using the normal bracket canvas with a "Seeding — Draft" banner.
- Each seed slot is reorderable: drag-and-drop or up/down arrows. Any reordering dispatches `reseed_pools` with the updated `new_seed_order` and refreshes the bracket.
- Show a prominent **"Confirm bracket & go live"** button. Clicking dispatches `publish_bracket`, which transitions the bracket to `PUBLISHED` and removes the seeding UI.
- While in DRAFT, all match slots show "TBD" and are non-interactive (no reporting, no choice).

---

## 3. Gauntlet Round-by-Round Opponent Choice [Both]

### Context

In a dual gauntlet every active round has exactly four participants: two **seated** players (they had byes or won last round and are now waiting) and two **challengers** (they just won their prior match). The highest-seeded seated player picks which challenger to face; the other seated player takes the remaining challenger. This is structurally the same as the existing semifinals choice — it just needs to repeat at every round of the lower sub-bracket, not only at the semifinals.

The library already stores `choice_scope: "round" | "semifinals"` in config but only implements `"semifinals"`. This spec fully implements `"round"`.

### Library (`pybracket`)

In `generate_gauntlet` for `style="dual"`, when `opponent_choice=True` and `choice_scope="round"`:

- Do not build a static lower sub-bracket. Instead, generate only the first lower-bracket match (the two lowest seeds). All subsequent rounds are generated dynamically as results come in.
- When a lower-bracket match completes and both challengers for the next round are known, set the higher-seeded seated player's match to `PENDING_CHOICE` with `choice_pool = [challenger_a_id, challenger_b_id]`.
- `report_choice` assigns the chosen challenger to the chooser's match and the other to the second seated player's match, both transitioning to `READY`.
- This continues until the two survivors enter the semifinals against seeds 1 and 2 (same final structure as the existing `"semifinals"` path).

Add a helper `refresh_gauntlet_round_choices(bracket)` analogous to the existing `refresh_gauntlet_choices`, to be called after every `report_result` on a gauntlet bracket with `choice_scope="round"`.

### Frontend (`pybracket-frontend`)

The existing choice UI (pick-opponent buttons) in `MatchCard` already handles `PENDING_CHOICE`. No new UI component is needed — extend the same pattern to work at every round, not only the semifinals.

Update `BuilderForm` to expose the `choice_scope` dropdown when format is `gauntlet` and style is `dual`:
- "Semifinals only" (current default)
- "Every round"

---

## 4. N-Level Byes for Single Elimination [Both]

### Concept

A standard single-elim bracket with N participants rounds up to the next power of 2 and gives the top seeds one round of byes. This spec adds **multi-round byes**: the TO can specify that seed 1 gets 2 byes (enters in round 3), seeds 2–4 get 1 bye (enter in round 2), and seeds 5–8 play a normal round 1. The library validates that the configuration is structurally possible.

**Key insight from design discussion**: with enough byes the bracket degenerates into a gauntlet (every higher seed gets one more bye than the next). The library should embrace this as a continuum rather than fighting it. However, in the frontend these remain distinct bracket types — gauntlet is its own format and the n-level bye config is exposed only on single-elim.

### Library (`pybracket`)

Add a `bye_rounds: dict[int, int]` parameter to `generate_single_elim` mapping seed → number of bye rounds:

```python
def generate_single_elim(
    participants: list[Participant],
    third_place_match: bool = False,
    protected_seeds: int = 0,
    bye_rounds: dict[int, int] | None = None,
) -> Bracket:
    ...
```

- `bye_rounds=None` (default): existing behaviour — one round of byes for seeds that have no opponent in the power-of-2 grid.
- `bye_rounds={1: 2, 2: 1, 3: 1}`: seed 1 skips 2 rounds, seeds 2 and 3 each skip 1 round; everyone else plays normally.

**Validation rules** (raise `ValidationError` if violated):
- No seed may receive more byes than `total_rounds - 1` (every player must play at least one match).
- The resulting round structure must be consistent: the number of players active in each round must be even (so matches can be paired).
- Bye counts must be non-negative integers.
- N-byes must be monotonically decreasing bye seed order. The 2 seed cannot be given more byes than the 1 seed.
- Seeds referenced in `bye_rounds` must correspond to actual participants.

**Algorithm sketch**: determine the total number of rounds from the (possibly non-power-of-2) field size. Build the bracket bottom-up: in round 1, pair participants who have 0 byes. In round 2, pair round-1 winners with participants who have exactly 1 bye. And so on. If the configuration does not yield a valid even pairing at any round, raise `ValidationError` with a descriptive message.

Store `bye_rounds` in `bracket.config` for the frontend to read and display.

### Frontend (`pybracket-frontend`)

In `BuilderForm`, when format is `single_elim`:
- Show an expandable "Bye configuration" section (collapsed by default, showing "Standard" when default is active).
- Inside: a table of seeds with a numeric input for bye rounds (0–N). Seed count is derived from the participant count field.
- User should be able to “group” seeds into the different bye categories. i.e. seeds 1-4 get a double bye, seed 5-8 get a single bye.
- Show a validation error inline if the library rejects the combination (surface the `ValidationError` message).
- Default fills all bye inputs with the standard strategy (derived from participant count).

In the bracket layout (§6): bye matches are **not rendered** but their vertical space is **fully preserved** so the layout algorithm treats them as occupied slots.

---

## 5. Compact Match Card + Detail Modal [Frontend]

### Match Card (default view)

Replace the current wide `MatchCard` (`w-52`, header row, two full-height slots) with a compact 2-row card:

```
[ ▌ #N] Player One Name
                  Player Two Name
```

- **Left edge click zone**: a narrow (~8–10 px), full-height vertical strip that opens the detail modal on click. Visual affordance: slightly different background or a subtle grip icon on hover.
- **Game number**: displayed to in the left click zone.
- **Player rows**: one row per participant, just the name (truncated if needed). Winner gets the highlight treatment; loser gets strikethrough. TBD slots show an em-dash or italic "TBD".
- No BO#, no status badge (use color to indicate advancement), no unwind button in the default view — those live in the modal.
- The existing ready/not-ready border treatment (green border when `ready`) is retained.

### Detail Modal

Opens when the user clicks the left-edge click zone on any match card. Content:

| Field | Notes |
|---|---|
| Match ID | Read-only, `#N` |
| Round | Round name from the bracket |
| Best-of | Numeric, editable if match is not yet completed |
| Score | Score input per participant (e.g., 2–1). Stored in `match.metadata`. |
| Advancement type | Read-only once reported: Result / Bye / Forfeit / Walkover |
| Status badge | Current `MatchStatus` |
| Rewind | Button, only visible when `status === 'completed'`. Same action as current unwind. |

The modal is a standard React dialog (use whatever the existing UI library provides — see `components/ui.tsx`). It dispatches `report` (or a new `update_score` op) on save.

---

## 6. Coordinate-Based Bracket Layout [Frontend]

### Applies to

All formats. **Exception**: `round_robin` and `swiss` keep equal vertical spacing (simple column layout, no tree positioning).

### Algorithm

Replace the current `justify-center` flex layout in `BracketCanvas` with a computed coordinate system. For each elimination-style format (single_elim, double_elim, gauntlet, grand_final side):

1. **Leaf positions**: matches in round 1 (or the earliest round on a given side) are placed at evenly spaced Y coordinates with a fixed slot height `H`.
2. **Parent positions**: each match in round R+1 is placed at the midpoint Y between the two matches in round R that feed it. If one feeder is a bye (hidden but space-preserved), its phantom Y coordinate is still used in the midpoint calculation.
3. **X positions**: each round column is at a fixed X offset from the previous round (`ROUND_WIDTH`). Rounds render left-to-right from earliest to latest (toward the final).
4. The canvas is an absolutely positioned container sized to fit all computed coordinates, wrapped in a scrollable `div`.

Constants (adjust empirically):
- `CARD_HEIGHT`: height of one compact match card (~40 px)
- `SLOT_HEIGHT`: vertical space allocated per leaf slot (`CARD_HEIGHT + vertical_gap`)
- `ROUND_WIDTH`: horizontal distance between round columns (~180 px)

For the **losers bracket** in double-elim, apply the same algorithm independently; position the losers bracket below the winners bracket with a labelled section separator.

For **gauntlet** with `choice_scope: "round"`, the bracket grows dynamically. Re-run the layout algorithm after each round resolves and new matches are generated.

---

## 7. Bracket Connector Lines [Frontend]

Draw SVG connector lines on top of (or behind) the match cards:

- One SVG element covers the entire canvas.
- For each match M in round R+1 that has one or two feeder matches in round R: draw an elbow connector from the **center-right edge** of each feeder's match box to the **center-left edge** of M's match box.
- Line style: 1–2 px, muted color (e.g., `#334155` / `night-700`), no arrow heads.
- Elbow shape: horizontal segment from the feeder's right edge to the midpoint X between rounds, then vertical segment to the target Y, then horizontal segment to M's left edge (standard bracket routing).
- Bye matches that are hidden: still emit connector lines using their phantom coordinates so the visual connection is continuous.
- `NOT_NEEDED` matches (dimmed) still have their connector lines drawn (also dimmed).

---

## 8. Hide Byes, Preserve Layout Space [Frontend]

- Match cards with `status === 'bye'` are **not rendered** — no card element is placed.
- However the layout algorithm (§6) allocates the full `SLOT_HEIGHT` for every bye slot so coordinates of surrounding matches are not affected.
- Connector lines route through the phantom bye positions normally.
- This applies across all formats. In gauntlet, the implicit byes for top seeds entering mid-bracket follow the same rule.

---

## 9. Spacing Rules by Format [Frontend]

| Format | Layout rule |
|---|---|
| `single_elim` | Coordinate-based tree (§6) |
| `double_elim` | Coordinate-based tree per side (§6); grand_final below |
| `gauntlet` | Coordinate-based chain (§6); linear since each round has one match |
| `round_robin` | Equal vertical spacing, simple column layout (unchanged) |
| `swiss` | Equal vertical spacing, simple column layout (unchanged) |
| `pools` | Each pool: equal spacing (round_robin). Elimination bracket: coordinate-based tree. |

---

## Summary of Library Changes

| Change | File(s) |
|---|---|
| Add `NOT_NEEDED` to `MatchStatus` | `models/enums.py` |
| Settle GF reset to `NOT_NEEDED` | `advancement/engine.py` |
| `draft_pools_to_bracket` + `publish_bracket` | `formats/pools.py`, `__init__.py` |
| Gauntlet `choice_scope="round"` implementation | `formats/gauntlet.py` |
| `refresh_gauntlet_round_choices` helper | `formats/gauntlet.py` |
| `bye_rounds` param on `generate_single_elim` | `formats/single_elim.py` |
| New dispatch ops for Pyodide bridge | `scripts/` (pybracket-frontend) |
| `'not_needed'` in `MatchStatus` TypeScript union | `lib/types.ts` (pybracket-frontend) |

## Summary of Frontend Changes

| Change | File(s) |
|---|---|
| Compact match card | `components/MatchCard.tsx` |
| Detail modal | `components/MatchDetailModal.tsx` (new) |
| Coordinate-based layout | `components/BracketCanvas.tsx` (significant rewrite) |
| SVG connector lines | `components/BracketCanvas.tsx` or `components/BracketLines.tsx` (new) |
| Hide byes / preserve space | `components/BracketCanvas.tsx` |
| DRAFT seeding UI | `components/BracketStudio.tsx`, new `components/SeedingPanel.tsx` |
| N-level bye config UI | `components/BuilderForm.tsx` |
| Gauntlet `choice_scope` UI | `components/BuilderForm.tsx` |
| `NOT_NEEDED` dim treatment | `components/MatchCard.tsx` |
| Format spacing rules | `components/BracketCanvas.tsx` |

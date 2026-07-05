# Dev Token Gaps

Running list of places where the design tokens (spec + Figma) and the code-side implementation (SCSS + CSS custom properties) have diverged. Each entry is a bug-report candidate for the component team.

Evidence cited against `origin/develop` unless otherwise noted.

---

## Scrollbar

**Status**: Figma-side aligned on branch `7XfNHOAtmNdQyxi8Ybiiho` (2026-04-24). Spec updated in [scrollbar.json](../specs/scrollbar.json). Code-side gaps below.

### 1. Thumb colour — code bypasses the semantic alias layer

- `packages/core/src/global/scrollbar-vars.scss` sets:
  ```scss
  --tds-scrollbar-thumb-color:        var(--tds-grey-400);   // light
  --tds-scrollbar-hover-thumb-color:  var(--tds-grey-500);
  /* dark flips to 500/400 */
  ```
- Spec + Figma want the chain `component/scrollbar/background/thumb-default` → `color/border/subtle` (and `thumb-hover` → `color/border/soft`).
- Consuming raw greys means brand-mode remaps at the semantic layer never reach scrollbar. The end pixel colour may coincide today but drifts apart the moment `color/border/subtle|soft` is rebalanced for either brand.

**Proposed change**: replace the grey primitives with the semantic aliases (or the published `--tds-color-border-subtle|soft` props, whichever naming the build emits).

### 2. Width + radius — code hardcodes literals, ignores published tokens

- `packages/core/src/mixins/_scrollbar.scss`:
  ```scss
  --tds-scrollbar-width:                   10px;
  --tds-scrollbar-height:                  10px;
  --tds-scrollbar-thumb-border-width:      3px;  // thumb visible thickness 10 - 2×3 = 4
  --tds-scrollbar-thumb-border-hover-width: 2px; // thumb visible thickness 10 - 2×2 = 6
  border-radius: 40px;                            // hardcoded, not read from any variable
  ```
- Design tokens now published:
  - `component/scrollbar/width/radius-default` → `traton/unit/4` (4px, thumb at rest)
  - `component/scrollbar/width/radius-hover` → 6 (thumb on hover)
  - `component/scrollbar/size/width-default` → 6 (visible width)
  - `component/scrollbar/border/radius-default` → `traton/unit/8` (8px)
- The 10px-track / 3px-border trick is a rendering workaround (webkit doesn't let scrollbar-width grow independently of the track). If kept, annotate _why_; ideally expose the 4/6 values as consumable tokens and derive the border-widths from them.

**Proposed change**: consume the published tokens directly; if the workaround must stay, document it with a link back to this entry.

### 3. Naming redundancy (design-side cleanup, mentioned here for completeness)

- `component/scrollbar/size/width-default = 6` and `component/scrollbar/width/radius-hover = 6` both describe the hover-state thumb width. One should probably go away in a future design-side pass. Not a dev concern today.

---

## Chip

**Status**: _Needs user confirmation on the specific rename(s) flagged._ Preliminary code-side observations below — to be refined.

### Observed gaps on `origin/develop`

- **Plural vs singular naming**: `packages/core/src/components/chip/chip-vars.scss` publishes `--tds-chips-*` (e.g. `--tds-chips-color`, `--tds-chips-background`, `--tds-chips-border`). Design system calls the component `chip` (singular) and Figma publishes `component/chip/*`. Consumer-facing CSS prop names are out of sync with the rest of the system.
- **Flat code vs structured Figma**: code has a single `--tds-chips-background`; Figma splits into `background/{standard|selected}/{default|hover}` (4 distinct tokens). Code currently ignores the standard/selected distinction at the token layer and handles it in component logic.
- **Raw primitives instead of semantic aliases**: same pattern as scrollbar — `var(--tds-grey-150)`, `var(--tds-blue-400)` etc., bypassing the semantic layer.
- **Open rename question**: the current `token-analysis` branch work restructures `border/selected-{active,default,hover}` → `border/selected/{active,default,hover}` (adds a slash). Not currently consumed by code, so no immediate break, but consumers will need updating if they start reading these tokens.

_User (Max) to confirm which of the above should be filed as active dev bugs vs left as observations._

---

## Tracking

- Latest union scan: [tokens/audit/20260423-210513-figma-scan/_scan-summary.md](../audit/20260423-210513-figma-scan/_scan-summary.md)
- Spec source: [tokens/specs/](../specs/)
- Figma libraries registry: [tokens/audit/figma-libraries.json](../audit/figma-libraries.json)

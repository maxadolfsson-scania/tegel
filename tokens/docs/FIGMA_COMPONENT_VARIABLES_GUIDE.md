# Figma Component Variables — Designer Guide

> Handoff guide for creating and applying component-level variables in Figma.
>
> **Last updated:** 2026-03-27

---

## What we're doing

We're creating **component-level variables** in Figma that sit between the semantic color system and the component layers. Instead of applying semantic tokens directly to component layers (e.g., `color/text/strong`), we create a component-specific variable (e.g., `component/accordion/text/default`) that **references** the semantic token. This gives us:

- A single place to change a component's color mapping without touching every instance
- Consistent naming across Scania and TRATON brands
- Automatic light/dark mode support through the semantic chain

### The variable chain

```
Primitive                  Semantic                    Component                   Figma layer
scania-color-grey-950  ←  color/text/strong  ←  component/accordion/text/default  ←  Header text fill
```

You only need to set the **Component → Semantic** link. The rest resolves automatically.

---

## Where variables live

| Library | Collection | Modes |
|---|---|---|
| TRATON Component Library | **TRATON** | TRATON Light, TRATON Dark |
| Tegel UI Library | **TBD** | Scania Light, Scania Dark |

Each variable needs a value for **all 4 modes**: Scania Light, Scania Dark, TRATON Light, TRATON Dark.

---

## Naming convention

Variables follow this pattern using `/` as group separator:

```
component/{component}/{property}/{[purpose-]}{[option-]}{state}
```

### Properties

| Property | Used for |
|---|---|
| `background` | Container fills, surface colors |
| `border` | Borders, dividers, strokes |
| `text` | Text fills |
| `icon` | Icon fills |
| `opacity` | Disabled opacity (FLOAT, not color) |
| `border/radius` | Corner radius (FLOAT, not color) |

### States

Always explicit — never implied:

| State | Meaning |
|---|---|
| `default` | Resting/idle state |
| `hover` | Mouse hover |
| `active` | Pressed/active |

### Axes

Some components have extra dimensions:

| Axis | Example | How it appears in the name |
|---|---|---|
| **Purpose** | success, warning, error, info | `component/tag/text/error-default` |
| **Option** | primary, secondary, tertiary, selected | `component/button/text/standard/primary-default` or `component/chip/text/selected/hover` |

Rules:
- Purpose + state combine with `-`: `error-default`, `success-default`
- Option can be a nested group (`/selected/hover`) or combined (`/primary-hover`) — review case by case
- If a component has no purpose/option axis, the state is the last segment: `component/badge/text/default`

---

## Border radius variables

Each component with radius gets **three** variants:

| Variable | Purpose |
|---|---|
| `component/{comp}/border/radius/none` | Square corners (0) |
| `component/{comp}/border/radius/default` | Standard radius |
| `component/{comp}/border/radius/full` | Pill/fully rounded |

These are **FLOAT** type, not color. Values are unitless numbers (e.g., `4`, `999`).

---

## Disabled state

Disabled is handled via a single **opacity** variable per component:

```
component/{component}/opacity/disabled
```

This is a **FLOAT** (e.g., `0.38`). Do NOT create per-property disabled color tokens.

---

## Focus state

Focus is handled **globally**, not per component. Do not create component-level focus variables.

---

## Variable scopes

Set the correct scope when creating each variable so it appears in the right Figma picker:

| Variable type | Recommended scope |
|---|---|
| Background colors | `FRAME_FILL`, `SHAPE_FILL` |
| Text colors | `TEXT_FILL` |
| Icon colors | `ALL_FILLS` |
| Border colors | `STROKE_COLOR` |
| Opacity | `OPACITY` |
| Border radius | `CORNER_RADIUS` |

> Note: Some existing done components use `ALL_SCOPES`. That works but is less precise — new components should use the specific scopes above when practical.

---

## Inverse components

Some components always render on an inverted background (dark surface in light mode, light surface in dark mode). Examples: **Toast**, **Tooltip**.

These use `inverse` semantic tokens:
- `color/background/inverse/base` (instead of `color/background/base`)
- `color/text/inverse/strong` (instead of `color/text/strong`)
- `color/icon/inverse/strong` (instead of `color/icon/strong`)

The spec table will use the correct inverse references — just be aware that if a component looks "flipped" compared to the page background, this is intentional.

---

## What NOT to include

- Spacing, padding, gap, margin tokens (layout system)
- Size variants (handled separately, except spinner which includes size/stroke)
- Focus rings or outlines
- Per-state disabled colors (use opacity)

---

## When a semantic reference doesn't exist

If a semantic token referenced in the spec is not available in one of the libraries/modes:

1. Check if there's a close equivalent with a slightly different name
2. If found, use it and flag it to the team
3. If not found, leave the mode value empty and flag it as **Needs Decision** — we may need to create a new semantic token first

---

## Reference: Done components

These are already implemented and serve as examples:

### Badge (simple — no states, no axes)

| Variable | Type |
|---|---|
| `component/badge/background/default` | COLOR |
| `component/badge/text/default` | COLOR |
| `component/badge/border/radius/none` | FLOAT |
| `component/badge/border/radius/default` | FLOAT |
| `component/badge/border/radius/full` | FLOAT |

### Chip (stateful — with selected option axis)

| Variable | Type |
|---|---|
| `component/chip/background/default` | COLOR |
| `component/chip/background/hover` | COLOR |
| `component/chip/text/default` | COLOR |
| `component/chip/text/hover` | COLOR |
| `component/chip/text/active` | COLOR |
| `component/chip/text/selected/hover` | COLOR |
| `component/chip/text/selected/active` | COLOR |
| `component/chip/border/default` | COLOR |
| `component/chip/border/hover` | COLOR |
| `component/chip/border/active` | COLOR |
| `component/chip/opacity/disabled` | FLOAT |
| `component/chip/border/radius/none` | FLOAT |
| `component/chip/border/radius/default` | FLOAT |
| `component/chip/border/radius/full` | FLOAT |

### Tag (purpose axis — semantic categories)

| Variable | Type |
|---|---|
| `component/tag/background/error-default` | COLOR |
| `component/tag/background/success-default` | COLOR |
| `component/tag/background/warning-default` | COLOR |
| `component/tag/background/information-default` | COLOR |
| `component/tag/background/neutral-default` | COLOR |
| `component/tag/background/featured-default` | COLOR |
| `component/tag/text/error-default` | COLOR |
| `component/tag/text/success-default` | COLOR |
| `component/tag/text/warning-default` | COLOR |
| `component/tag/text/information-default` | COLOR |
| `component/tag/text/neutral-default` | COLOR |
| `component/tag/text/featured-default` | COLOR |
| `component/tag/icon/error-default` | COLOR |
| `component/tag/icon/success-default` | COLOR |
| `component/tag/icon/warning-default` | COLOR |
| `component/tag/icon/information-default` | COLOR |
| `component/tag/icon/neutral-default` | COLOR |
| `component/tag/icon/featured-default` | COLOR |
| `component/tag/border/radius/default` | FLOAT |

### Button (complex — purpose + option axes)

Pattern: `component/button/{property}/{purpose}/{option}-{state}`

Purposes: `standard`, `danger`
Options: `primary`, `secondary`, `tertiary`
States: `default`, `hover`, `active`

Example variables:
```
component/button/background/standard/primary-default
component/button/background/standard/primary-hover
component/button/background/standard/primary-active
component/button/text/danger/tertiary-default
component/button/icon/standard/secondary-hover
...
```

Plus:
- `component/button/opacity/disabled` (FLOAT)
- `component/button/border/radius/default` (FLOAT)

### Tooltip (minimal)

| Variable | Type |
|---|---|
| `component/tooltip/background/default` | COLOR |
| `component/tooltip/text/default` | COLOR |
| `component/tooltip/border/radius/none` | FLOAT |
| `component/tooltip/border/radius/default` | FLOAT |

### Spinner (color + dimensions)

| Variable | Type |
|---|---|
| `component/spinner/background/default` | COLOR |
| `component/spinner/background/default-inverse` | COLOR |
| `component/spinner/size/extra-small` | FLOAT |
| `component/spinner/size/small` | FLOAT |
| `component/spinner/size/medium` | FLOAT |
| `component/spinner/size/large` | FLOAT |
| `component/spinner/stroke/extra-small` | FLOAT |
| `component/spinner/stroke/small` | FLOAT |
| `component/spinner/stroke/medium` | FLOAT |
| `component/spinner/stroke/large` | FLOAT |

---

## How to read a component spec

Each new component will be delivered as a table like this:

| # | Variable name | Type | Semantic reference | Scania Light | Scania Dark | TRATON Light | TRATON Dark | Confidence | Comment |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `component/toast/background/default` | COLOR | `color/background/inverse/base` | `#0e1013` | `#ffffff` | `#100f0f` | `#f8fcfc` | Confirmed | |
| 2 | `component/toast/text/header-default` | COLOR | `color/text/inverse/strong` | `#f6f7f9` | `#0e1013` | `#ffffff` | `#001d21` | Confirmed | |
| 3 | `component/toast/border/radius/default` | FLOAT | `scania-unit-4` / `traton-unit-4` | `4` | `4` | `4` | `4` | Confirmed | Unitless |

**Columns:**
- **Variable name** — create this in Figma's variable panel
- **Type** — COLOR or FLOAT
- **Semantic reference** — point the variable to this existing semantic token (it should already exist in the Color collection)
- **Scania/TRATON Light/Dark** — the resolved hex/value for verification (you don't enter these manually — they resolve through the semantic chain)
- **Confidence**:
  - **Confirmed** — verified against Figma design
  - **Inferred** — derived from code or token system, not directly visible in Figma design
  - **Needs Decision** — discrepancy found, your input required
- **Comment** — flags for your attention (discrepancies, closest-value mappings, WIP tokens, etc.)

### Layer mapping

Each spec includes a layer mapping section showing which Figma layers get which variable. Example:

```
Container fill             → component/toast/background/default
Header text fill           → component/toast/text/header-default
Subheader text fill        → component/toast/text/subheader-default
Close icon fill            → component/toast/icon/dismiss-default
Left-border fill (success) → component/toast/border/success-default
Corner radius              → component/toast/border/radius/default
```

### Steps

1. Create all variables listed in the spec table
2. Set each variable's value to the **semantic reference** for each mode
3. Apply variables to the component's Figma layers using the layer mapping
4. Review any rows marked "Needs Decision" or "Inferred" and confirm or correct

---

## WIP tokens

Some specs may reference internal/WIP Figma tokens (e.g., `internal/color__wip/...`). These are created now and will need re-pointing once the WIP token is promoted to a stable semantic token. They will be clearly flagged in the comment column.

---

## Questions?

If a spec has rows marked **Needs Decision**, those need your input before the variable can be finalized. Check the comment column for context on what needs resolving.

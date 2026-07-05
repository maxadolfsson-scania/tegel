# TEGEL TOKENS - SEMANTIC BRIDGE FRAMEWORK
**VERSION: 1.3 [LOCKED/Minor Update: Controlled Strict Execution Mode] · Amended 2026-07-04 (§2a Interior Scopes & Option Nesting)**

---

## Purpose

This framework defines how semantic bridge tokens are generated for Tegel components.

The goals are to:

- Create a cross-library, brand-agnostic abstraction layer  
- Preserve backward compatibility  
- Minimise token surface area without sacrificing structural stability  
- Enable brand-level archetype flexibility  
- Maintain long-term semantic consistency across all components  

This framework is considered **LOCKED v1.3**.  
Changes must be deliberate and systemic.

v1.3 update:
- Refined STRICT EXECUTION MODE.
- Restores concise reasoning section.
- Prohibits conversational framing and implementation logic.

---

# Core Principles

---

## 1. Semantic Over Appearance

Token names must describe:

- Purpose (semantic meaning)  
- Option (component-level semantic configuration)  
- Property (background, text, border, icon)  
- State (default, hover, active)  

Token names must NOT encode:

- filled  
- outlined  
- ghost  
- gradient  
- expressive  
- decorative implementation details  

Archetypes are brand decisions, not system contracts.

---

## 2. Stable Semantic Bridge Layer (Property-First)

All components expose a semantic bridge following this structure:

    --component-{component}-{property}-{[purpose-]}{[option-]}{state}

This ensures grouping in tools and codebases follows:

    component
      background
      border
      icon
      text

The bridge:

- Is cross-library (Web + Lite)  
- Is brand-agnostic  
- Does not break legacy tokens  
- Acts as abstraction over implementation tokens  

Legacy tokens remain implementation layers and are aliased.

---

## 2a. Interior Scopes & Option Nesting

Added 2026-07-04 (cluster #15 Tabs). Extends §2.

The leaf grammar `{[purpose-]}{[option-]}{state}` names a token's semantic parts; they need not all be hyphen-fused into a single leaf. The Figma variable path MAY carry interior scope segments for grouping and belonging. All segments flatten to the same CSS custom property (slashes → hyphens), so scoping affects grouping in the Variables panel only — never the emitted CSS-var name.

Permitted scopes:

- Context scope (e.g. `item/`) — groups item-level tokens and separates them from container / bar / wrapper-level tokens of the same property. Already shipped (Header, Side Menu).  
- Option scope (e.g. `primary/`, `secondary/`) — a mode-variant option MAY be a scope nested under the context scope, rather than fused into the leaf, WHEN (a) it keeps a shipped-canonical leaf clean (e.g. `current-default`) instead of forcing a 3-part hyphen leaf, AND (b) it is a genuine mode-variant axis. This is the only sanctioned path deeper than the prior depth-5 norm.

Rules:

- A scope earns its place only on collision-avoidance OR genuine belonging — never decoratively.  
- Bar / wrapper / container-level tokens and single shared tokens (e.g. `opacity/disabled`) stay flat under the property — they do not belong to an item scope.  
- Avoid 3-part hyphen leaves unless the descriptor is intrinsically compound (e.g. `sub-link-{state}`).  
- Selection status (`current`) is not an interaction state; it carries its own state (`current-default`), never a bare interaction slot.  

Canonical example — cluster #15 Tabs:

- `background/item/{mode-variant}/{state}` — option-scoped (depth 6): `background/item/primary/current-default`.  
- `border/item/*` and `text/item/*` — context-scoped.  
- Bars (`background/primary`, `border/default`) and `opacity/disabled` stay flat.  

Segmented Control and future multi-variant component families inherit this shape.

---

## 3. Explicit State Model

Allowed states:

- -default  
- -hover  
- -active  

Rules:

- -default suffix is always explicit  
- No implicit default state  
- No -focus tokens (focus handled globally)  
- Sparse state coverage per property is allowed  
- No perfect grids  

---

## 4. Structural Axes Rule (Critical)

Some axes are structural and must never be removed once established.

An axis is structural if:

- It exists in production (API or tokens), OR  
- It represents a core design model of the component, OR  
- It is clearly part of the component’s long-term semantic contract  

If an axis is structural:

→ It must remain in all future bridge versions,  
even if only one value is currently active.

Axes may be omitted ONLY if:

- They have never existed in API or tokens, AND  
- They are not intrinsic to the component type  

Examples:

- Button: purpose + option are structural  
- Chip: option is structural; purpose may be incidental  
- Tag: purpose is structural; option may not exist  

Stability > minimalism.

---

## 5. Disabled Strategy (Conditional)

Include:

    --component-{component}-disabled-opacity

ONLY if:

- A disabled state exists in Web or Lite tokens, OR  
- A disabled state exists in the component API  

Do NOT generate disabled color tokens.

Disabled styling is opacity-based only.

---

## 6. Border Radius Strategy (Conditional)

Include:

    --component-{component}-border-radius

ONLY if:

- Radius/shape exists in source tokens, OR  
- The component structure clearly depends on radius (e.g. pill, chip, tag)

No per-role or per-state radius tokens.

Adding a border-radius token may increase bridge token count (+1).  
This is acceptable if structurally justified.

---

## 7. Spacing & Dimension Exclusion

Out of scope:

- Padding  
- Gap  
- Size variants  
- Layout spacing  
- Icon padding  

These belong to layout/dimension systems, not semantic surface tokens.

---

## 8. Purpose Classification Rule

If a component has semantic categories such as:

- success  
- warning  
- error  
- info  
- neutral  

They must be treated as PURPOSE.

Do not invent new axis names.

---

## 9. STRICT EXECUTION MODE (Controlled)

When applying this framework in a component thread:

Bridge = semantic contract only.

The bridge output MUST contain exactly:

1. Mandatory header block (verbatim)  
2. Semantic token list  
3. Token Surface Comparison block (verbatim)  
4. Concise reasoning section (maximum 5 lines)

The reasoning section may include ONLY:

- Why Bridge count differs from Web/Lite  
- Whether delta is structural or cosmetic  
- Confirmation of structural axes compliance  

The bridge output must NOT include:

- var() references  
- Mapping logic  
- Implementation resolution  
- Value wiring  
- Conversational framing  
- Greetings  
- Process commentary  
- Explanations outside the allowed reasoning section  

If output includes implementation logic or conversational text, treat it as a bug.

This framework defines the semantic API surface only — never the implementation layer.

---

## 10. Component-Level Versioning Model (per thread)

Each component maintains its own semantic bridge version.

If no previous bridge exists:
→ Start at v1.0

If updating:

MAJOR  
- Axes added or removed  
- Token naming structure changes  
- State model changes  

MINOR  
- Token additions within existing axes  
- Sparse state adjustments  
- Planned groups added  

PATCH  
- Formatting-only changes  
- Ordering changes  
- Comment/header refinements  

---

## 11. Mandatory Header Template (Property-First Pattern)

Every semantic bridge output must include this header verbatim:

    /* =========================================================
       SEMANTIC BRIDGE:
       ---
       ### {COMPONENT_UPPER} {VERSION} ###
       Counts → Web:{X} | Lite:{Y} | Bridge:{Z}

       Pattern:
       --component-{component}-{property}-{[purpose-]}{[option-]}{state}

       Rules:
       - No focus tokens, handled with separate helper element globally
       - One global disabled-opacity token (only if disabled state exists in source OR component API)
       - One global border-radius token (only if present in source OR required by component structure)
       - Only include state/property combos that exist in implementation (Web and/or Lite)
       - Explicit -default/-hover/-active suffixes always
       ========================================================= */

Do not shorten or reformat this header.

---

## 12. Token Surface Comparison Format

Every bridge output must include:

    Web:        {X}
    Lite:       {Y}

    ⤷  Bridge:  {Z}

    Δ Web   →  Bridge:  {Z-X}
    Δ Lite  →  Bridge:  {Z-Y}

Notes:

- Δ may be negative (reduction), zero (equal), or positive (increase).  
- Positive deltas are acceptable when structurally justified.  

---

# Governance Status

Framework status: LOCKED v1.3

This version introduces controlled strict execution mode to preserve structured output while allowing concise reasoning.

**Amendment 2026-07-04 (in-place, cluster #15 Tabs):** added §2a Interior Scopes & Option Nesting — sanctions interior context scopes (`item/`) and, under stated conditions, a mode-variant carried as an option scope (the system's first depth-6 path), to keep shipped-canonical leaves (e.g. `current-default`) clean rather than forcing 3-part hyphen leaves. Additive clarification; no existing rule reversed. Filename + version references unchanged.

Framework updates must be systemic and rare.
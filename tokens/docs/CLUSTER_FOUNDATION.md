# Cluster Foundation

> The settled, durable foundation for cluster work — architecture, vocabulary, tooling, workflow.
> Read FIRST before any cluster work or token-pipeline change. Replaces ad-hoc rediscovery.
>
> **Last reconciled:** 2026-04-27

---

## 1. Variable Architecture

### 1.1 Three collections in the TRATON Component Library file

| Collection | Purpose | Modes | Variable count |
|---|---|---|---|
| **Primitive** | Flat collection of brand-specific atomic values (colors, units, fonts). Supports the semantic brand collections. | 1 (`Default`) | ~231 |
| **TRATON** | **Parent brand collection.** Semantic + component variables, holding TRATON values. | 2 (`Light`, `Dark`) | ~701 |
| **Scania** | **Child of TRATON.** Mirrors the parent's variable set; inherits values from TRATON unless explicitly overridden with Scania-specific brand decisions. Same purpose, same variable count as the parent. | 2 (`Light`, `Dark`) | ~701 |

The pipeline exports **four JSON files**, one per brand×mode: `tokens/json/semantic/{traton-light,traton-dark,scania-light,scania-dark}.json`. That's the canonical shape the system delivers.

### 1.2 The 4 brand×mode contexts

Every variable in a brand collection has values across both modes; the parent/child structure gives us 4 brand×mode contexts total:

| Brand | Mode | Lives in |
|---|---|---|
| TRATON | Light | TRATON collection (parent) |
| TRATON | Dark | TRATON collection (parent) |
| Scania | Light | Scania collection (child — inherits or overrides parent) |
| Scania | Dark | Scania collection (child — inherits or overrides parent) |

Per [FIGMA_COMPONENT_VARIABLES_GUIDE.md](FIGMA_COMPONENT_VARIABLES_GUIDE.md): a fully-specified variable has values across all 4 contexts.

> **Mode IDs** (the integer keys used in writes / API calls) shift over time and don't always match across tools. Don't hard-code them in the doc — fetch the current IDs at runtime via Plugin API or the appropriate read path before writing. See Section 2 for tooling.

### 1.3 Plugin API visibility caveats

The Figma Plugin API has known visibility limitations when reading across the parent/child collection model. Specifically:

- After writing values to Scania-mode IDs via `setValueForMode`, those Scania entries can be **invisible to the getter** (`variable.valuesByMode`) on subsequent reads even though the write succeeded. (Source: `feedback-plugin-api-push.md` memory file.)
- `figma.variables.getLocalVariablesAsync()` may not return a complete view of child-collection variables in every shape we'd expect.

**Implication**: don't treat Plugin API read results as ground truth for the Scania collection or for Scania-mode values. Use the Figma UI (switching brand mode) for verification, or check the exported semantic JSONs after the pipeline runs.

If a Plugin API read seems to contradict what the user sees in Figma — trust Figma, flag the gap, and pick a different read path. See Section 2 for the tooling map.

### 1.4 Vocabulary

Use these terms precisely:

| Term | Meaning |
|---|---|
| **Parent collection** | TRATON. Holds the canonical TRATON-brand values across `Light` / `Dark` modes. |
| **Child collection** | Scania. Mirrors the parent's variable set. Each variable inherits the parent's value by default; only Scania-divergent values are explicitly overridden. |
| **Inherited (Scania)** | A Scania-collection variable that takes its value from the parent (TRATON) — no explicit override needed. The default state. |
| **Overridden (Scania)** | A Scania-collection variable with a Scania-specific value that differs from the parent's. Used when brand decisions diverge. |
| **TRATON-only token** | Aliases to a TRATON primitive (e.g. `traton/color/blue/800`). Even with parent/child inheritance, the value won't vary across brands because the primitive is brand-specific. |
| **Brand-aware semantic** | A semantic variable whose chain resolves to different values per brand×mode context (e.g. `color/background/base`). The backbone of brand-correctness — preferred alias target for component variables. |

### 1.5 Where brand differentiation actually lives

Two layers, currently not always in lockstep:

**Figma layer (design surface)**: parent/child collections. TRATON collection holds canonical values; Scania collection inherits and overrides where the brand diverges. A component variable's chain — alias → semantic → primitive — resolves under the active brand+mode.

**SCSS bridge layer (deployment surface)**: `tokens/scss/component/{slug}.scss` has separate `.scania.tds-mode-light` / `.traton.tds-mode-light` rules that produce brand-correct CSS. This layer ships brand differentiation to consumers regardless of what's stored in Figma.

Both layers are driven by the same pipeline export (the four `tokens/json/semantic/{brand}-{mode}.json` files). When the export is correct, both layers match. The Figma layer is the design source of truth; the SCSS bridge is the runtime delivery.

### 1.6 Token type taxonomy

| Type | Purpose | Naming | Where it lives |
|---|---|---|---|
| Primitive | Atomic value, brand-specific | `traton/color/blue/800`, `scania/unit/16` | Primitive collection (flat, 1 mode) |
| Semantic | Brand-agnostic semantic role | `color/background/base`, `color/icon/strong` | Both brand collections (TRATON + Scania), 2 modes each |
| Component | Component-specific role | `component/header/background/main-default` | Both brand collections, 2 modes each |

Per [Semantic Bridge Framework v1.3](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md) (LOCKED).

Variable name pattern (component layer):

```
component/{component}/{property}/{[purpose-]}{[option-]}{state}
```

Properties: `background` | `border` | `text` | `icon` | `opacity` | `border/radius`

States: `default` | `hover` | `active` (no `focus` — focus is global, not per-component).

---

## 2. Tooling Map — When to use what

> *Operational reference for the agent. The user doesn't need to review this section unless behavior here surfaces friction.*

### 2.1 The cardinal rule

| Task | Tool |
|---|---|
| **All Figma writes** | Plugin API (`mcp__figma__use_figma`) |
| **Interactive reads** | Plugin API (`mcp__figma__use_figma`) or specialised MCP read tools |
| **Unattended automation** | REST API scripts |
| **Bridge SCSS / token JSON sources** | DO NOT EDIT — separate workstream |

### 2.2 Read tools

| Task | Tool | Notes |
|---|---|---|
| Variables on a specific node | `mcp__figma__get_variable_defs` | Returns variables actually bound to that node, not the file's full variable set |
| Component design + reference code | `mcp__figma__get_design_context` | Use `disableCodeConnect: true` to avoid Code Connect prompts |
| Layer tree / structure | `mcp__figma__get_metadata` | Lightweight; node IDs + names |
| Screenshot | `mcp__figma__get_screenshot` | Visual sanity check |
| Find variables by name | `mcp__figma__search_design_system` | `includeVariables: true`, `includeComponents: false`, `includeStyles: false` |
| Full variable dump | `mcp__figma__use_figma` with `figma.variables.getLocalVariablesAsync()` | Use for deep inspection; remember the getter blindness for Scania mode values (1.3) |

### 2.3 Write tools

| Task | Tool |
|---|---|
| Create variable | `mcp__figma__use_figma` → `figma.variables.createVariable(name, collection, type)` |
| Set value for mode | `mcp__figma__use_figma` → `variable.setValueForMode(modeId, value)` (use full-form Scania mode IDs) |
| Rename variable | `mcp__figma__use_figma` → `variable.name = newName` (preserves ID) |
| Set alias | value: `{ type: 'VARIABLE_ALIAS', id: targetVariable.id }` |

### 2.4 Existing scripts

| Script | Purpose | API used | Needs `FIGMA_API_KEY`? |
|---|---|---|---|
| `tokens/scripts/push-spec-to-figma.js` | Batch-create variables from spec JSON | REST | Yes |
| `tokens/scripts/fetch-figma-colors.js` | Snapshot styles + variables to JSON | REST | Yes |
| `tokens/scripts/create-figma-branch.js` | Create branch on library files | REST | Yes |
| `tokens/scripts/scan-figma-vs-specs.js` | Diff specs vs Figma | REST or MCP-snapshot | Yes (REST path) |
| `tokens/scripts/run-cluster-audit.js` | Code-side audit pipeline | none | No |

REST scripts fail in Claude Code's Bash sandbox because `~/.zshrc` and `**/.env*` are deny-read — the env var doesn't propagate. Two workarounds:
- Run terminal commands with `FIGMA_API_KEY` set in `~/.claude/settings.local.json` env config
- Or use Plugin API path (`mcp__figma__use_figma`) and bypass the script entirely

### 2.5 Verification

**Verifying writes**: switch Figma UI to the relevant brand/mode — NOT via Plugin API getter (1.3).

**Verifying spec push**: re-fetch via Plugin API; remember 2-mode getter result for component vars doesn't mean Scania values are missing. If in doubt, ask the user to look in Figma.

### 2.6 Auth troubleshooting

If MCP tools fail with "file could not be accessed":
1. Run `mcp__figma__whoami` first
2. If wrong account or persistent failure: ask the user to check `/mcp` status in Claude Code for re-auth
3. Don't iterate on file keys, branch keys, or desktop app restarts before doing the above

---

## 3. Cluster Workflow

Per [CLUSTER_WORKFLOW.md](CLUSTER_WORKFLOW.md):

### Phases

| # | Phase | Output | Our scope? |
|---|---|---|---|
| 1 | Define cluster | Update `tokens/audit/audit-cluster.json` with slugs | ✅ |
| 2 | Audit | Run `npm run audit:tokens:cluster` → produces `tokens/audit/{ts}/` artifacts | ✅ |
| 3 | Draft spec | `tokens/specs/{component}.json` | ✅ |
| 4 | Push to Figma branch | Variables created on a branch | ✅ |
| 5 | Cross-reference + verify | Spec rows match Figma; values resolve correctly | ✅ |
| 6 | Bridge / code update | Update `tokens/json/`, regenerate SCSS, update consumers | ❌ Separate workstream |

### Spec format

```json
{
  "component": "header",
  "variables": [
    {
      "name": "component/header/background/main-default",
      "type": "COLOR",
      "light": "color/background/base",
      "dark": "color/background/base",
      "scania-light": "scania/color/blue/800",
      "scania-dark": "scania/color/blue/900",
      "confidence": "Confirmed",
      "comment": "..."
    }
  ]
}
```

All four columns push when using Plugin API. `push-spec-to-figma.js` (REST) only writes 2 — see "Known limitations" below.

### Confidence levels

| Level | Action |
|---|---|
| `Confirmed` | Verified — ready to push |
| `Inferred` | Implement, flag for designer review |
| `Needs Decision` | Block until resolved |
| `Temporary` | Intentional cross-brand or interim ref, has exit strategy |
| `Inherited` | Resolves through semantic chain, no override needed |

### Roles

| Role | Does what |
|---|---|
| Spec author (Claude + dev) | Audit, draft spec, push to Figma branch, draft decision logs |
| Figma implementer (designer) | Apply variables to layers, review visual output, resolve "Needs Decision" rows |

---

## 4. Naming conventions (LOCKED via v1.3)

| Rule | Source |
|---|---|
| Pattern: `component/{component}/{property}/{[purpose-]}{[option-]}{state}` | [TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md) |
| `-default` suffix only on state (not on context/option identifiers) | `convention-state-suffix.md` (memory file) |
| Selected paired with standard under nested groups | chip + button precedent (see `tokens/specs/chip.json`, `tokens/specs/button.json`) |
| Component tokens are brand-agnostic by NAME (no `inverse` in the name; brand handled by mode values) | `convention-brand-agnostic-naming.md` (memory) |
| Surface-context variants OK (e.g. `inverse` for genuinely inverse surfaces like Toast) | `convention-surface-context-variants.md` (memory) |
| `border/radius-{variant}` (flat) not `border/radius/{variant}` (nested) | `convention-border-radius-naming.md` (memory) |
| Leading dash for shared utility groups: `-focus`, `-input`, `-shadow` | `convention-leading-dash.md` (memory) |
| No focus tokens at component level (focus is global) | [FIGMA_COMPONENT_VARIABLES_GUIDE.md](FIGMA_COMPONENT_VARIABLES_GUIDE.md) §"Focus state" |
| Disabled = single `opacity/disabled` per component, not per-property color | [FIGMA_COMPONENT_VARIABLES_GUIDE.md](FIGMA_COMPONENT_VARIABLES_GUIDE.md) §"Disabled state" |
| Match property to target: icons alias to `color/icon/*`, text to `color/text/*` (no cross-typing) | `convention-property-match.md` (memory) |

Match property to target: an icon should alias to `color/icon/*`, text to `color/text/*`. Don't cross types.

---

## 5. Cross-brand reference policy

- Default to **brand-aware semantic refs** (e.g. `color/background/base`) which resolve correctly per brand
- When semantic doesn't resolve to the right Scania value, **override with Scania primitives** (e.g. `scania/color/blue/700`) explicitly
- When overriding for Scania, override BOTH Scania modes consistently — never mix primitive in one mode and semantic in another
- Cross-brand primitive refs are valid when intentional (bootstrap, inheritance) and invalid when accidental (gap-filling)

(Source: `cross-brand-primitive-refs.md` and `convention-scania-overrides.md` memory files.)

---

## 6. INTERNAL token policy

See [`convention-internal-tokens.md`](convention-internal-tokens.md) (memory file) for the full policy:

- Three rules: never alias to INTERNAL, promote or remove, flag in audit
- Legitimate INTERNAL residents (content tokens, visibility booleans, prototype helpers)
- Known illegitimate patterns (WIP colors, orphaned aliases, leaked primitives)
- How to obsolete tokens during cluster work (rename to `INTERNAL/{old-name}` rather than delete)

---

## 7. Past drift patterns to avoid

> *Operational reference for the agent. The user doesn't need to review this section unless a new pattern needs adding.*

If you find yourself doing one of these, stop:

1. **Treating Plugin API getter result as ground truth for Scania values** — it's blind to Scania entries on component variables (1.3). Verify in Figma UI.
2. **Conflating bridge SCSS with Figma variables** — they're separate layers; brand differentiation lives in BOTH but works differently. Spec authoring touches only the Figma side.
3. **Reinventing decisions across clusters** — read this foundation and `cluster-roadmap` before re-debating settled questions.
4. **Editing bridge SCSS or `tokens/json/*` source files** — not our scope.
5. **Pushing without preview** — dry-run is the safe-path default; explicit `--push` to mutate.
6. **Not using AskUserQuestion for alignment questions** — use the tool, don't write custom markdown questionnaires.
7. **Pacing**: don't jump to next topic before current one is confirmed.
8. **Deep-checking without asking** — when verification surfaces unexpected findings, ask the user before running more Plugin API calls.

---

## 8. Known limitations / open items

| Item | Status |
|---|---|
| `push-spec-to-figma.js` (REST) only handles TRATON light/dark today | Known. Plugin API path covers the parent/child write flow. Script could be extended; for now use Plugin API for cross-collection writes. |
| Plugin API has visibility caveats reading Scania-collection variables and Scania-mode entries | Documented in 1.3. Verify in Figma UI, not via getter. |
| `CLUSTER_WORKFLOW.md` Phase 6 is OUT of our scope | Documented above (Section 3); the source workflow doc still describes it as part of the flow. |
| Existing component variables may not be fully overridden in Scania | Released clusters shipped with TRATON-only values for some component vars. Brand differentiation in production has been handled by the SCSS bridge layer. The target state is full coverage in both collections; existing tokens are upgraded as clusters revisit them. |

---

## 9. Source memory files (consolidated here)

> *Operational reference for the agent. Cross-checks against memory files in `~/.claude/projects/.../memory/`.*

If any of the following memory files contradict this doc, this doc wins. Update the source memory.

- `MEMORY.md` (index + headline conventions)
- `figma-variable-architecture.md`
- `feedback-plugin-api-push.md`
- `figma-read-method.md`
- `feedback-mcp-auth.md`
- `feedback-spec-only-scope.md`
- `cross-brand-primitive-refs.md`
- `convention-scania-overrides.md`
- `convention-state-suffix.md`
- `convention-layer-lookup.md`
- `feedback-question-format.md`
- `feedback-pacing.md`
- `feedback-ask-before-deep-check.md`
- `audit-pipeline.md`
- [CLUSTER_WORKFLOW.md](CLUSTER_WORKFLOW.md)
- [FIGMA_COMPONENT_VARIABLES_GUIDE.md](FIGMA_COMPONENT_VARIABLES_GUIDE.md)
- [FIGMA_QUICKSTART.md](FIGMA_QUICKSTART.md)
- [TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md)

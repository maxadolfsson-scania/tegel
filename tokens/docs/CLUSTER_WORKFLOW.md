# Cluster Workflow — Component Token Rollout

> Step-by-step process for tackling a cluster of components from audit to Figma implementation.
>
> **Last updated:** 2026-03-28

---

## Overview

We work in **clusters** — small groups of related or similarly-scoped components (3-6 per round). Each cluster gets a Figma branch, a code audit, spec tables, and Figma variable implementation.

### Roles

| Role | Does what |
|---|---|
| **Spec author** (Claude + dev) | Runs audit, drafts spec tables, resolves decisions |
| **Figma implementer** (designer) | Creates variables in Figma, applies to layers, reviews visual output |

---

## Phase 0: Session pre-flight (run on every session start)

Before any cluster work begins, dispatch the architecture verifier to confirm Figma's variable architecture still matches what is recorded in memory. This catches silent drift (collection IDs, mode IDs, count) before it derails real work.

```
Task(
  subagent_type="tokens-architecture-verifier",
  description="Pre-flight check",
  prompt="Verify Figma architecture matches recorded memory. Working dir: tegel repo."
)
```

Expected runtime: ~30 seconds. Expected output: `VERDICT: OK` and ~10 lines.

If `VERDICT: DRIFT DETECTED`, stop cluster work and update `figma-variable-architecture.md` memory before proceeding. Drift means the assumptions baked into specs and other agents are stale.

---

## Phase 1: Define the cluster

1. Pick 3-6 components based on complexity and relatedness
2. Update `tokens/audit/audit-cluster.json` with the slugs:
   ```json
   { "componentSlugs": ["footer", "divider", "link", "breadcrumbs"] }
   ```
3. Look up Figma page links from `tokens/audit/figma-pages.json`
4. Capture visual cross-reference inputs (used in Phase 4c + Phase 5):
   - **Tegel UI COMPONENT_SET IDs** per source component (Scania source-of-truth)
   - **TRATON-branch preview frame IDs**: SCANIA section + TRATON section, per component
   - **Expected-status notes per pair** — e.g. "Toggle/Thumb intentional new sub-component, no Tegel pair expected"

   These keep Area 4 of the final check from re-discovering structure each cluster.

---

## Phase 2: Audit

Run the cluster audit to get fresh data:

```bash
npm run audit:tokens:cluster
```

This produces per-component JSON + the taxonomy naming report in `tokens/audit/{runId}/`.

Key outputs to review:
- `{component}.json` — web vars, lite vars, references, themes
- `_taxonomy-naming.json` — which existing tokens comply, which don't
- `_hardcoded-scan.json` — hardcoded values that need tokenizing
- `_variant-matrix.json` — component variants vs token coverage

---

## Phase 3: Draft spec tables

For each component in the cluster, produce a spec table following the format in [FIGMA_COMPONENT_VARIABLES_GUIDE.md](FIGMA_COMPONENT_VARIABLES_GUIDE.md):

| # | Variable name | Type | Semantic reference | Scania Light | Scania Dark | TRATON Light | TRATON Dark | Confidence | Comment |
|---|---|---|---|---|---|---|---|---|---|

### Data sources (in priority order)

| Source | What it gives you | How to access |
|---|---|---|
| Existing SCSS bridge tokens | Already-resolved variable names + values per theme | `tokens/scss/component/{slug}.scss` |
| Figma variables (done components) | What's already in Figma | `get_variable_defs` via MCP, or `npm run audit:figma:colors` |
| Tegel Lite vars | Semantic token references (closest to target) | Audit JSON → `tegelLite.references` |
| Web component vars | Primitive/hardcoded values per theme | Audit JSON → `webComponent.variables` + var files |
| Figma design inspection | Visual ground truth | `get_design_context` / `get_screenshot` via MCP |

### Decision protocol

Mark each spec row with a confidence level:

| Level | Meaning | Action |
|---|---|---|
| **Confirmed** | Verified against Figma + code + semantic tokens | Ready to implement |
| **Inferred** | Derived from code patterns, not visually verified | Implement, flag for review |
| **Needs Decision** | Discrepancy between sources, or missing semantic ref | Block until resolved |

Common decisions:
- **Hardcoded values** — find the closest semantic token, flag if no match
- **Missing semantic tokens** — flag as "Needs Decision", may need new semantic token
- **State model gaps** — e.g., `visited` (link), `current` (breadcrumbs) — extend state set?
- **Appearance naming** — rename to semantic (e.g., `dark-blue` → `accent`)

---

## Phase 4: Figma branch + implementation

### 4a. Create the branch

```bash
npm run audit:figma:branch -- --name "cluster/footer-divider-link-breadcrumbs"
```

This creates a branch on both library files and saves the branch keys to `tokens/audit/figma-branches.json`.

### 4b. Push specs to the branch

```bash
# Preview first (default — no flag needed)
npm run audit:figma:push -- --spec tokens/specs/footer.json --branch <branchKey>

# Push for real — add --push
npm run audit:figma:push -- --spec tokens/specs/footer.json --branch <branchKey> --push
npm run audit:figma:push -- --spec tokens/specs/divider.json --branch <branchKey> --push
npm run audit:figma:push -- --spec tokens/specs/link.json --branch <branchKey> --push
npm run audit:figma:push -- --spec tokens/specs/breadcrumbs.json --branch <branchKey> --push
```

The push script:
- Fetches all existing variables to build a name-to-ID lookup
- Skips variables that already exist (safe to re-run)
- Resolves semantic references to variable aliases
- Handles hex colors and float values directly
- Warns on missing references

### 4c. Designer review + lightweight visual sweep

After push, the designer:
- Applies variables to component layers per the layer mapping
- Reviews visual output across all modes
- Resolves any "Needs Decision" rows

After each major binding batch, run a **lightweight visual sweep**:
- Screenshot the TRATON-branch SCANIA preview frame for the touched component (Phase 1 input)
- Eyeball against the Tegel UI COMPONENT_SET (Phase 1 input)
- Goal: catch obvious regressions early. Pixel-precise comparison waits for Phase 5.

### Tools available

| Task | Tool | Notes |
|---|---|---|
| Create branch | `npm run audit:figma:branch` | REST API, saves branch keys |
| Push spec variables | `npm run audit:figma:push` | REST API, batch-creates from spec JSON |
| Create variables manually | `use_figma` (Plugin API via MCP) | For one-offs or complex cases |
| Inspect existing variables | `get_variable_defs` (MCP) | Check what's already applied |
| Screenshot for review | `get_screenshot` (MCP) | Visual sanity check |
| Search library | `search_design_system` (MCP) | Find existing semantic tokens |
| REST API snapshot | `npm run audit:figma:colors` | Bulk export all variables |

---

## Phase 5: Cross-reference + verify

After Figma implementation:

1. **Snapshot Figma variables**: `npm run audit:figma:colors` (captures what's in the branch)
2. **Re-run cluster audit**: `npm run audit:tokens:cluster` (captures code-side state)
3. **Compare**: Check that:
   - Every spec row has a matching Figma variable
   - Every Figma variable has a matching SCSS bridge token
   - Resolved values match across all 4 modes
   - No "Needs Decision" rows remain unresolved
4. **Visual cross-reference** — formal pass paired against Tegel UI:
   - For each source component in the cluster, screenshot both:
     - the **Tegel UI COMPONENT_SET** (Scania source-of-truth)
     - the **TRATON-branch SCANIA preview frame** (post-cluster preview)
   - Eyeball pairs; document any visible regression
   - Use the Phase 1 expected-status notes to suppress known intentional gaps (e.g. TRATON-only sub-components)
   - Caveat: transparent-background dark variants on the Tegel side limit pixel-precise comparison; pattern match is reliable
5. **Merge the Figma branch** once verified

---

## Phase 6: Update code tokens

If the spec introduced new or renamed tokens:

1. Update `tokens/json/` source definitions
2. Run Style Dictionary build to regenerate `tokens/scss/component/{slug}.scss`
3. Update web component + tegel-lite vars to consume the new bridge tokens
4. Re-run `npm run audit:tokens:cluster` to confirm 0 violations

---

## Quick reference: Component page links

Stored in `tokens/audit/figma-pages.json`. Usage:

```js
import pages from '../audit/figma-pages.json' assert { type: 'json' };
const footer = pages.components.footer;
// footer.tegel.url → "https://figma.com/design/d8bTgEx7h694MSesi2CTLF/Tegel?node-id=26537-59510"
// footer.traton.url → "https://figma.com/design/6osYTOfd4MgDq7LO6BCoUO/TRATON?node-id=26537-59510"
```

For Figma branches, append `/branch/{branchKey}` to the base URL.

---

## Done components (reference examples)

These have completed the full workflow and serve as templates:

| Component | Complexity | Pattern |
|---|---|---|
| Badge | Simple — no states, no axes | `{property}/{state}` |
| Spinner | Simple + dimensions | `{property}/{state}`, `size/{value}`, `stroke/{value}` |
| Tooltip | Minimal + inverse | `{property}/{state}` with inverse semantic refs |
| Tag | Purpose axis | `{property}/{purpose}-{state}` |
| Chip | Option axis (selected) | `{property}/{state}`, `{property}/selected/{state}` |
| Button | Purpose + option axes | `{property}/{purpose}/{option}-{state}` |

---

## Documentation pass — runs when a cluster is verified complete

"Verified complete" = every verification item in the checklist below is
checked. That event triggers the documentation pass — two agent calls, in
order, in the same turn as the close-out report:

1. `tokens-figjam-sync slug:{slug} apply` — populates the FigJam SHIPPED
   section. Stays the sole writer to the specs page; text anchors at
   section-local `(40, 40)` per the canonical recipe.
2. `tokens-cluster-documenter slug:{slug} cluster:{NN} branch:{branchKey}
   summary:{close-out bullets}` — verifies the FigJam section landed
   (single section, green fill, text inside bounds), writes the
   `_Decision_log` Review handover on the branch, and drafts 3 demo talking
   points (delivered in the close-out report). The Notion handover doc is
   DEFERRED — not in use yet; the agent reports it N/A unless the invocation
   says `notion: publish`.

Every artifact is generated from its single template in `tokens/templates/`
(see the README there) and read-back-verified. After any `APPLIED` claim,
the main thread re-probes the actual node/page state before reporting
success. The cluster is not "done" until the report shows all four
artifacts VERIFIED or explicitly N/A.

---

## Checklist per cluster

- [ ] Cluster defined in `audit-cluster.json`
- [ ] Audit run completed (`npm run audit:tokens:cluster`)
- [ ] Spec tables drafted for each component
- [ ] All "Needs Decision" rows resolved
- [ ] Figma branch created
- [ ] Variables created in Figma (both libraries)
- [ ] Layer mappings applied
- [ ] Visual review passed
- [ ] Visual cross-reference (Tegel UI ↔ TRATON branch SCANIA previews) clean
- [ ] Cross-reference Figma vs code — all match
- [ ] Figma branch merged
- [ ] Code tokens updated (if needed)
- [ ] Final audit confirms 0 naming violations for cluster
- [ ] Documentation pass: FigJam SHIPPED section synced + verified
- [ ] Documentation pass: Decision log Review populated + screenshot-verified
- [ ] Documentation pass: Notion handover — deferred, stated N/A in the report
- [ ] Documentation pass: 3 demo talking points drafted (in the close-out report)

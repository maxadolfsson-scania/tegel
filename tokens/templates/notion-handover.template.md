# Notion handover doc — template (Cowork handover)

Single source of truth for the shareable per-cluster handover page in Notion.
Edit the shape here; never fork per-cluster copies.

> **Status: DEFERRED (2026-07-03) — not in use yet.** The documentation pass
> skips this artifact (reports N/A) unless the invocation explicitly says
> `notion: publish`. To enable it permanently: set `notion_parent_url` below
> and remove this status block plus the deferred markers in
> `.claude/agents/tokens-cluster-documenter.md` and CLUSTER_WORKFLOW.md.

## Config

- `notion_parent_url`: **UNSET** — set to the parent page URL after the first
  successful run. While UNSET, the agent searches Notion for an existing
  "token handover" page and uses its parent; if none is found it stops and
  asks rather than guessing a location.
- `title_pattern`: `Cluster #{NN} — {Component} — token handover`
- **Duplicate rule (check-before-create):** search for a page with the exact
  title first. If it exists → UPDATE that page. Never create a second page
  with the same title.

## Page structure

> Title: per `title_pattern`. Multi-component clusters get one page per
> cluster, components as H2 blocks repeating the "What shipped" → "Decisions"
> sections per component.

**TL;DR** — {2–3 sentences: what shipped, where it lives (Figma branch +
spec file), and what the reader is being asked to do — review, demo, or
just stay informed.}

### What shipped

- {N} component tokens, all 4 modes (TRATON Light / TRATON Dark / Scania
  Light / Scania Dark), every value explicitly set
- Coverage: {variants × states, in plain words}
- Spec: `tokens/specs/{slug}.json` · Figma branch: {branch URL}

### Decisions

- **a11y** — {mirrors the Figma Decision log Review item, expanded 1–2
  sentences for a reader without canvas access}
- **vars** — {same}
- **fix** — {same}
- **design** — {same, including anything parked for the designer}

### Open items & parked decisions

- {one bullet each, with owner where known — or "None — all decisions closed."}

### Links

- Figma branch: {URL}
- Decision log ({Component} page): {URL}
- FigJam SHIPPED section: {URL}
- Spec file: {repo path}

### Demo talking points

{exactly 3, per `talking-points.template.md`}

## Writing rules

- Plain English throughout; no internal abbreviations, no Plugin API jargon.
- Brand-agnostic phrasing in token names and descriptors.
- Same decisions as the Figma Decision log — this page expands them, it never
  contradicts them. If they'd diverge, fix the source content, not the copy.
- Keep it scannable: the TL;DR plus "What shipped" should carry a reader who
  reads nothing else.

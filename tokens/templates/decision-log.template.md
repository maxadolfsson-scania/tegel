# Decision log — Review section content template

Content skeleton for the Review section of a component's `_Decision_log`
INSTANCE in Figma. The **write procedure** (node location, fonts, list-option
ranges, underline) lives in `.claude/agents/tokens-cluster-documenter.md` and
the LOCKED convention `convention-handover-decision-log.md` — this file holds
only the content shape, so there is one place to edit wording rules.

## The 14-line structure (exact)

```
{intro — 1–3 sentences: what was done + why. Lead with the precedent followed.}
{blank}
a11y — {outcome: accessibility treatment, contrast, focus handling}
vars — {outcome: token count, key patterns, what was added/removed and why}
fix — {outcome: Figma variant/layer adjustments made or needed — "no layer changes needed" if none}
design — {outcome: structural decisions + any decisions PARKED for the designer}
{blank}
—
{blank}
OTHER NOTES
{blank}
{bullet 1 — consumer impact}
{bullet 2 — structural note worth flagging}
{bullet 3 — deferred decision or future work}
```

## Content rules (distilled from the LOCKED convention)

- `a11y` / `vars` / `fix` / `design` are **mandatory topic openers**, in that
  order — each item starts `{topic} — `. They are outcome summaries grouped by
  topic, NOT free-form designer questions. Parked designer decisions go inside
  the `design` item; engineering follow-ups go under `a11y` or `vars`.
- One sentence per item. Describe the OUTCOME, not the process.
- No manual `a.` / `b.` prefixes — the ORDERED list numbers automatically.
- Plain English, no internal abbreviations ("background", not "bg";
  "references", not "refs").
- Honest tone: state divergences plainly. The reviewer needs to know.
- Intro longer than 3 lines → break into 2–3 short paragraphs.
- Only the Review section is writable. Never touch Title, Design log, or
  Prioritisation.

## Canonical references (pattern-match before writing, don't work from memory)

- Accordion (cluster #10b) — full state-restructure shape
- Block (cluster #10a) — surface-only / no-state shape
- Side Menu (cluster #14) — shape with PARKED-for-QA decisions in `design`

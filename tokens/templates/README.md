# tokens/templates — one template per close-out artifact

Templates for the **documentation pass** that runs when a cluster is verified
complete (see `tokens/docs/CLUSTER_WORKFLOW.md` → "Documentation pass").

**Single-source rule:** each artifact has exactly ONE template. Edit the
template here; never fork per-cluster copies, never paste a stale copy into a
prompt. Agents read these files at invocation time, so an edit here changes
the next run — no duplicate files to drift apart.

| Artifact | Template | Writer | Final-state check |
|---|---|---|---|
| FigJam SHIPPED section | *(none here by design)* — the canonical section `01--ACCORDION--SHIPPED--[XX]` (id `367:47`) plus Phase B of `.claude/agents/tokens-figjam-sync.md` **is** the template | `tokens-figjam-sync` (sole writer to the specs page — LOCKED) | `tokens-cluster-documenter`, read-only: section exists, green fill, text inside section bounds |
| Figma `_Decision_log` Review section | [decision-log.template.md](decision-log.template.md) | `tokens-cluster-documenter` | inline screenshot after write |
| Notion handover doc (Cowork) | [notion-handover.template.md](notion-handover.template.md) | `tokens-cluster-documenter` | page re-fetched after write, sections diffed |
| Demo talking points | [talking-points.template.md](talking-points.template.md) | `tokens-cluster-documenter` (embedded in the Notion doc) | covered by the Notion re-fetch |

Why the FigJam artifact has no template file: the specs page already has a
LOCKED sole-writer agent with a LOCKED content recipe. A second template here
would be the duplicate-source problem these templates exist to prevent.

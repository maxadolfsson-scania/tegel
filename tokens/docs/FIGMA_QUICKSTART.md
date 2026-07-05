# Figma Quick Start — Claude Code Cheat Sheet

> Quick reference for using Figma MCP tools and the REST API script from this repo.

---

## Our Figma file keys

| Library | File key | Description |
|---|---|---|
| Tegel UI Library | `d8bTgEx7h694MSesi2CTLF` | Scania primary |
| TRATON Component Library | `6osYTOfd4MgDq7LO6BCoUO` | Multi-brand (TRATON main) |

These are registered in `tokens/audit/figma-libraries.json`.

---

## MCP tools — what to use when

### Inspect & read

| Task | Tool | Example prompt |
|---|---|---|
| Screenshot a component | `get_screenshot` | "Screenshot the Badge component" (give it a node ID + file key) |
| Get structure overview | `get_metadata` | "Show me the layer tree for node 123:456 in file d8bTgEx7h694MSesi2CTLF" |
| Get design + code reference | `get_design_context` | "Get design context for this Figma URL: ..." |
| Read variables on a node | `get_variable_defs` | "What variables are applied to node 123:456?" |
| Search libraries | `search_design_system` | "Search for 'badge' in the Tegel library" |

### Write & modify

| Task | Tool | Example prompt |
|---|---|---|
| Run Plugin API code | `use_figma` | "Create a new page in the Tegel file" |
| Create variables | `use_figma` | "Create component/toast/background/default as a COLOR variable" |
| Map code ↔ Figma | `add_code_connect_map` | "Link this Figma button to our Button web component" |

### Utility

| Task | Tool |
|---|---|
| Check who's logged in | `whoami` |
| Create a new file | `create_new_file` |

---

## REST API script

Fetch color styles + variables from Figma's REST API:

```bash
# All registered libraries
npm run audit:figma:colors

# Single file
node tokens/scripts/fetch-figma-colors.js --file d8bTgEx7h694MSesi2CTLF

# Output goes to tokens/audit/{timestamp}-colors/
```

Requires `FIGMA_API_KEY` env variable (personal access token).

---

## Common workflows

### 1. Check what variables exist on a component

```
Paste a Figma URL or give a node ID → get_variable_defs
```

### 2. Compare Figma variables to code tokens

```
1. get_variable_defs on the Figma component
2. npm run audit:tokens (code-side audit)
3. Compare the two lists
```

### 3. Generate a component spec for the designer

```
1. get_design_context or get_screenshot for the component
2. get_variable_defs to see what's already applied
3. Cross-reference with the Semantic Bridge Framework v1.3
4. Output a spec table (see FIGMA_COMPONENT_VARIABLES_GUIDE.md)
```

### 4. Create new component variables in Figma

```
1. Prepare the spec table
2. use_figma with Plugin API code to create variables
3. get_variable_defs to verify
```

### 5. Snapshot Figma colors for audit

```bash
npm run audit:figma:colors
# Then compare with: npm run audit:tokens
```

---

## URL parsing reminder

From a Figma URL like:
```
https://figma.com/design/d8bTgEx7h694MSesi2CTLF/Tegel?node-id=123-456
```

- **fileKey** = `d8bTgEx7h694MSesi2CTLF`
- **nodeId** = `123:456` (convert `-` to `:`)

Branch URLs: `figma.com/design/:fileKey/branch/:branchKey/...` → use **branchKey** as fileKey.

---

## Related docs

- [Figma Component Variables — Designer Guide](FIGMA_COMPONENT_VARIABLES_GUIDE.md) — naming convention & spec format
- [Semantic Bridge Framework v1.3](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md) — token naming rules
- [INDEX.md](INDEX.md) — full doc + audit command reference

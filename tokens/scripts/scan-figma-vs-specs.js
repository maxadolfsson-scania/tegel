#!/usr/bin/env node
/**
 * Scan Figma vs Specs — TRATON main + branch
 *
 * Read-only scan that cross-references tokens/specs/*.json against a Figma
 * file's variables (main) and an optional branch. Produces a timestamped
 * report under tokens/audit/{YYYYMMDD-hhmmss}-figma-scan/ covering:
 *
 *   1. Spec tokens missing in Figma (per main, per branch)
 *   2. Figma component/* variables missing from specs
 *   3. Name matches with diverging alias/value (mismatches)
 *   4. Main vs branch delta — added / removed / changed
 *
 * No writes to Figma. Deterministic (sorted outputs) for safe re-runs.
 *
 * Usage (REST — needs FIGMA_API_KEY in env):
 *   node tokens/scripts/scan-figma-vs-specs.js --branch <branchKey>
 *   node tokens/scripts/scan-figma-vs-specs.js --branch <branchKey> --component link
 *   node tokens/scripts/scan-figma-vs-specs.js                   # main-only, REST
 *
 * Usage (MCP snapshots — no env token needed):
 *   node tokens/scripts/scan-figma-vs-specs.js \
 *     --main-snapshot path/to/main.json \
 *     --branch-snapshot path/to/branch.json
 *
 *   Snapshot shape matches the REST /v1/files/{key}/variables/local response
 *   ({ meta: { variableCollections, variables } }). Produce them by running
 *   figma.variables.getLocal*Async() via the MCP Plugin API bridge and
 *   dumping the normalized result to disk.
 *
 * Env:
 *   FIGMA_API_KEY — Personal access token (required only for REST mode)
 */

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  existsSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const SPECS_DIR = join(ROOT_DIR, 'tokens', 'specs');
const REGISTRY_PATH = join(AUDIT_BASE_DIR, 'figma-libraries.json');

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';
const TARGET_LIBRARY_LABEL = 'traton';

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    branch: null,
    component: null,
    out: null,
    mainSnapshot: null,
    branchSnapshot: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch' && args[i + 1]) parsed.branch = args[++i];
    else if (args[i] === '--component' && args[i + 1]) parsed.component = args[++i];
    else if (args[i] === '--out' && args[i + 1]) parsed.out = args[++i];
    else if (args[i] === '--main-snapshot' && args[i + 1]) parsed.mainSnapshot = args[++i];
    else if (args[i] === '--branch-snapshot' && args[i + 1]) parsed.branchSnapshot = args[++i];
  }
  return parsed;
}

function getRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// ── Figma REST ────────────────────────────────────────────────

async function figmaGet(path) {
  const res = await fetch(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

async function fetchVariablesRaw(fileKey) {
  return figmaGet(`/v1/files/${fileKey}/variables/local`);
}

// ── Normalization ─────────────────────────────────────────────

function rgbaToHex({ r = 0, g = 0, b = 0, a = 1 }) {
  const toHex = (f) =>
    Math.round(Math.min(1, Math.max(0, f)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a < 1 ? `${base}${toHex(a)}` : base;
}

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function normalizeFetch(raw, fileKey, branchKey) {
  const collections = raw.meta?.variableCollections ?? {};
  const variables = raw.meta?.variables ?? {};

  const collectionsById = {};
  for (const [id, c] of Object.entries(collections)) {
    collectionsById[id] = {
      id,
      name: c.name,
      modes: c.modes ?? [],
    };
  }

  const varsById = {};
  const varsByName = {};

  for (const [id, v] of Object.entries(variables)) {
    const collection = collectionsById[v.variableCollectionId];
    const modeMap = {};
    for (const m of collection?.modes ?? []) modeMap[m.modeId] = m.name;

    const modes = {};
    for (const [modeId, val] of Object.entries(v.valuesByMode ?? {})) {
      const modeName = modeMap[modeId] ?? modeId;
      if (val && val.type === 'VARIABLE_ALIAS') {
        modes[modeName] = {
          kind: 'ALIAS',
          aliasId: val.id,
          // aliasName is resolved in a second pass once all names are known
          aliasName: null,
        };
      } else if (v.resolvedType === 'COLOR' && val && typeof val === 'object' && 'r' in val) {
        modes[modeName] = {
          kind: 'COLOR',
          hex: rgbaToHex(val),
          r: val.r ?? 0,
          g: val.g ?? 0,
          b: val.b ?? 0,
          a: val.a ?? 1,
        };
      } else if (typeof val === 'number') {
        modes[modeName] = { kind: 'FLOAT', value: val };
      } else {
        modes[modeName] = { kind: 'RAW', value: val };
      }
    }

    const record = {
      id,
      name: v.name,
      type: v.resolvedType,
      collectionId: v.variableCollectionId,
      collectionName: collection?.name ?? 'Unknown',
      hiddenFromPublishing: v.hiddenFromPublishing ?? false,
      modes,
    };
    varsById[id] = record;
    varsByName[v.name] = record;
  }

  // Second pass: resolve alias names
  for (const v of Object.values(varsById)) {
    for (const m of Object.values(v.modes)) {
      if (m.kind === 'ALIAS') {
        m.aliasName = varsById[m.aliasId]?.name ?? `<unknown:${m.aliasId}>`;
      }
    }
  }

  return {
    fileKey,
    branchKey: branchKey || null,
    fetchedAt: new Date().toISOString(),
    collections: collectionsById,
    variables: varsByName,
    variablesById: varsById,
  };
}

// ── MCP snapshot loader ───────────────────────────────────────
//
// Shape produced by tokens/scripts/merge-mcp-slices.js:
//   { fileKey, capturedAt, componentVariables: { [name]: [type, L, D, SL, SD] } }
//
// Each value entry is an encoded string: "A:<aliasName>" | "C:#rrggbb[aa]" |
// "F:<num>" | "S:<string>" | "B:<bool>" | null.

function decodeMcpValue(enc) {
  if (enc === null || enc === undefined) return null;
  if (typeof enc !== 'string') return { kind: 'RAW', value: enc };
  const [kind, ...rest] = enc.split(':');
  const payload = rest.join(':');
  if (kind === 'A') return { kind: 'ALIAS', aliasName: payload };
  if (kind === 'C') return { kind: 'COLOR', hex: payload.toUpperCase() };
  if (kind === 'F') return { kind: 'FLOAT', value: Number(payload) };
  if (kind === 'S') return { kind: 'STRING', value: payload };
  if (kind === 'B') return { kind: 'BOOL', value: payload === 'true' };
  return { kind: 'RAW', value: enc };
}

function normalizeFromMcpSnapshot(raw, fileKey, branchKey) {
  const MODE_FROM = { 0: 'Light', 1: 'Dark', 2: 'Scania Light', 3: 'Scania Dark' };
  const variablesByName = {};
  const variablesById = {};

  for (const [name, tuple] of Object.entries(raw.componentVariables ?? {})) {
    const [type, ...modeValues] = tuple;
    const modes = {};
    modeValues.forEach((enc, idx) => {
      const modeName = MODE_FROM[idx];
      if (!modeName) return;
      if (enc === null) return; // unset
      modes[modeName] = decodeMcpValue(enc);
    });
    const record = {
      id: null,
      name,
      type,
      collectionId: null,
      collectionName: 'TRATON',
      hiddenFromPublishing: false,
      modes,
    };
    variablesByName[name] = record;
    variablesById[name] = record;
  }

  return {
    fileKey: raw.fileKey || fileKey,
    branchKey: branchKey || null,
    fetchedAt: raw.capturedAt || new Date().toISOString(),
    collections: {},
    variables: variablesByName,
    variablesById,
  };
}

function isMcpSnapshot(raw) {
  return raw && typeof raw === 'object' && raw.componentVariables && !raw.meta;
}

// ── Spec loading ──────────────────────────────────────────────

function loadSpecs(componentFilter) {
  const files = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.json') && f !== '_template.json')
    .sort();
  const specs = [];
  for (const f of files) {
    const full = join(SPECS_DIR, f);
    const data = JSON.parse(readFileSync(full, 'utf-8'));
    const component = data.component || f.replace(/\.json$/, '');
    if (componentFilter && component !== componentFilter) continue;
    specs.push({
      component,
      file: `tokens/specs/${f}`,
      variables: Array.isArray(data.variables) ? data.variables : [],
    });
  }
  return specs;
}

// ── Value comparison ──────────────────────────────────────────

function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6,8}$/.test(v);
}

function hexEquals(a, b) {
  const norm = (h) => {
    const clean = h.replace('#', '').toUpperCase();
    return clean.length === 6 ? clean + 'FF' : clean;
  };
  return norm(a) === norm(b);
}

/**
 * Compare a single spec-mode value against a Figma mode entry.
 * Returns { ok: true } or { ok: false, reason, expected, actual }.
 */
function compareModeValue(specVal, figmaMode) {
  if (specVal === null || specVal === undefined || specVal === '') {
    return { ok: true, skipped: true, reason: 'spec-empty' };
  }
  if (!figmaMode) {
    return { ok: false, reason: 'figma-mode-missing', expected: specVal, actual: null };
  }

  // Numeric (FLOAT)
  if (typeof specVal === 'number') {
    if (figmaMode.kind === 'FLOAT' && figmaMode.value === specVal) return { ok: true };
    return {
      ok: false,
      reason: 'float-mismatch',
      expected: specVal,
      actual: figmaMode.kind === 'FLOAT' ? figmaMode.value : describeFigmaMode(figmaMode),
    };
  }

  // Hex color
  if (isHexColor(specVal)) {
    if (figmaMode.kind === 'COLOR' && hexEquals(specVal, figmaMode.hex)) return { ok: true };
    if (figmaMode.kind === 'ALIAS') {
      return {
        ok: false,
        reason: 'expected-hex-got-alias',
        expected: specVal,
        actual: `-> ${figmaMode.aliasName}`,
      };
    }
    return {
      ok: false,
      reason: 'hex-mismatch',
      expected: specVal,
      actual: describeFigmaMode(figmaMode),
    };
  }

  // Variable alias (string name)
  if (typeof specVal === 'string') {
    if (figmaMode.kind === 'ALIAS' && figmaMode.aliasName === specVal) return { ok: true };
    if (figmaMode.kind === 'ALIAS') {
      return {
        ok: false,
        reason: 'alias-target-mismatch',
        expected: `-> ${specVal}`,
        actual: `-> ${figmaMode.aliasName}`,
      };
    }
    return {
      ok: false,
      reason: 'expected-alias-got-value',
      expected: `-> ${specVal}`,
      actual: describeFigmaMode(figmaMode),
    };
  }

  return { ok: false, reason: 'unknown-value-shape', expected: specVal, actual: figmaMode };
}

function describeFigmaMode(m) {
  if (!m) return null;
  if (m.kind === 'ALIAS') return `-> ${m.aliasName}`;
  if (m.kind === 'COLOR') return m.hex;
  if (m.kind === 'FLOAT') return m.value;
  return JSON.stringify(m);
}

// ── Mode-name detection ───────────────────────────────────────
//
// Spec columns: light / dark / scania-light / scania-dark.
// Figma component variables live in the TRATON collection (modes "Light" / "Dark").
// Scania overrides (if present on a component variable) appear as extra mode
// entries in the same variable when the author opted into the Scania collection
// directly. Most component variables won't have them — that's expected.

function figmaModeForColumn(column, figmaVar) {
  // Try exact matches first, then fall back to case-insensitive contains.
  const modes = figmaVar.modes ?? {};
  const keys = Object.keys(modes);
  const find = (pred) => keys.find(pred);

  if (column === 'light') return modes[find((k) => /^light$/i.test(k))];
  if (column === 'dark') return modes[find((k) => /^dark$/i.test(k))];
  if (column === 'scania-light') {
    return modes[find((k) => /scania.*light/i.test(k))] ?? null;
  }
  if (column === 'scania-dark') {
    return modes[find((k) => /scania.*dark/i.test(k))] ?? null;
  }
  return null;
}

// ── Spec vs Figma ─────────────────────────────────────────────

function compareSpecAgainstFigma(specs, figma, sideLabel) {
  const perComponent = [];
  const matchedFigmaNames = new Set();

  for (const spec of specs) {
    const issues = [];
    for (const v of spec.variables) {
      const figmaVar = figma.variables[v.name];
      if (!figmaVar) {
        issues.push({
          variable: v.name,
          severity: 'missing-in-figma',
          detail: `Spec declares "${v.name}" but no matching Figma variable in ${sideLabel}.`,
        });
        continue;
      }

      matchedFigmaNames.add(v.name);

      // Type check
      const specType = (v.type || 'COLOR').toUpperCase();
      if (figmaVar.type !== specType) {
        issues.push({
          variable: v.name,
          severity: 'type-mismatch',
          detail: `Spec type ${specType} vs Figma type ${figmaVar.type}.`,
        });
      }

      // Per-mode comparison
      for (const column of ['light', 'dark', 'scania-light', 'scania-dark']) {
        const specVal = v[column];
        const figmaMode = figmaModeForColumn(column, figmaVar);
        const hasScaniaModeOnVariable =
          column.startsWith('scania-') &&
          !figmaMode &&
          !!Object.keys(figmaVar.modes).length;

        if (hasScaniaModeOnVariable) {
          // Spec declares a Scania value but the variable doesn't carry a
          // Scania-specific mode — brand differentiation is expected to come
          // from the semantic alias layer. Flag only as informational.
          if (specVal !== null && specVal !== undefined && specVal !== '') {
            issues.push({
              variable: v.name,
              severity: 'scania-mode-not-on-variable',
              detail: `Spec "${column}" is "${specVal}" but Figma variable has no Scania mode; brand resolution happens via semantic aliases (not verified in this scan).`,
              mode: column,
            });
          }
          continue;
        }

        const cmp = compareModeValue(specVal, figmaMode);
        if (cmp.ok) continue;
        if (cmp.reason === 'figma-mode-missing' && specVal == null) continue;
        issues.push({
          variable: v.name,
          severity: `mode-${cmp.reason}`,
          detail: `[${column}] expected ${JSON.stringify(cmp.expected)}, got ${JSON.stringify(cmp.actual)}`,
          mode: column,
          expected: cmp.expected ?? null,
          actual: cmp.actual ?? null,
        });
      }

      // INTERNAL policy: spec must never reference INTERNAL/*
      for (const column of ['light', 'dark', 'scania-light', 'scania-dark']) {
        const val = v[column];
        if (typeof val === 'string' && val.startsWith('INTERNAL/')) {
          issues.push({
            variable: v.name,
            severity: 'internal-alias-violation',
            detail: `Spec references "${val}" (INTERNAL tokens are not allowed per INTERNAL Token Policy).`,
            mode: column,
          });
        }
      }
    }

    perComponent.push({
      component: spec.component,
      specFile: spec.file,
      variableCount: spec.variables.length,
      issueCount: issues.length,
      issues: issues.sort((a, b) => a.variable.localeCompare(b.variable) || a.severity.localeCompare(b.severity)),
    });
  }

  // Figma → Spec gaps (component/* not in any spec)
  const specVariableNames = new Set(
    specs.flatMap((s) => s.variables.map((v) => v.name))
  );
  const figmaComponentNames = Object.keys(figma.variables).filter((n) =>
    n.startsWith('component/')
  );
  const unreferencedFigmaVars = figmaComponentNames
    .filter((n) => !specVariableNames.has(n))
    .sort();

  return {
    perComponent: perComponent.sort((a, b) => a.component.localeCompare(b.component)),
    unreferencedFigmaVars,
    totals: {
      specs: specs.length,
      specVariables: specs.reduce((acc, s) => acc + s.variables.length, 0),
      figmaComponentVariables: figmaComponentNames.length,
      issueCount: perComponent.reduce((acc, c) => acc + c.issueCount, 0),
      figmaVariablesNotInSpec: unreferencedFigmaVars.length,
    },
  };
}

// ── Main vs branch delta ──────────────────────────────────────

function modeSignature(figmaVar) {
  const out = {};
  for (const [modeName, m] of Object.entries(figmaVar.modes).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (m.kind === 'ALIAS') out[modeName] = `ALIAS:${m.aliasName}`;
    else if (m.kind === 'COLOR') out[modeName] = `COLOR:${m.hex}`;
    else if (m.kind === 'FLOAT') out[modeName] = `FLOAT:${m.value}`;
    else out[modeName] = `RAW:${JSON.stringify(m.value)}`;
  }
  return out;
}

function diffMainVsBranch(main, branch) {
  const mainComponentNames = new Set(
    Object.keys(main.variables).filter((n) => n.startsWith('component/'))
  );
  const branchComponentNames = new Set(
    Object.keys(branch.variables).filter((n) => n.startsWith('component/'))
  );

  const removed = [...mainComponentNames]
    .filter((n) => !branchComponentNames.has(n))
    .sort();
  const added = [...branchComponentNames]
    .filter((n) => !mainComponentNames.has(n))
    .sort();

  const changed = [];
  for (const name of [...mainComponentNames].sort()) {
    if (!branchComponentNames.has(name)) continue;
    const a = main.variables[name];
    const b = branch.variables[name];

    const perModeDiffs = [];
    const sigA = modeSignature(a);
    const sigB = modeSignature(b);
    const modeNames = new Set([...Object.keys(sigA), ...Object.keys(sigB)]);
    for (const m of [...modeNames].sort()) {
      if (sigA[m] !== sigB[m]) {
        perModeDiffs.push({ mode: m, main: sigA[m] ?? null, branch: sigB[m] ?? null });
      }
    }

    if (a.type !== b.type) {
      perModeDiffs.push({ mode: '<type>', main: a.type, branch: b.type });
    }

    if (perModeDiffs.length) {
      changed.push({ name, diffs: perModeDiffs });
    }
  }

  return {
    mainCount: mainComponentNames.size,
    branchCount: branchComponentNames.size,
    added,
    removed,
    changed,
  };
}

// ── Merged (union) findings ───────────────────────────────────
//
// Treats main ∪ branch as one design-system state. Per spec variable,
// classify: missing-in-both, mismatch-in-both (same wrong value), fixed-in-branch
// (main wrong, branch right), regressed-in-branch (main right, branch wrong).
// Only actionable findings; scania-mode-not-on-variable is ignored entirely.

function issueKey(issue) {
  return `${issue.variable}::${issue.severity}::${issue.mode ?? ''}`;
}

function filterActionable(issues) {
  return issues.filter((i) => !INFORMATIONAL_SEVERITIES.has(i.severity));
}

function mergeFindings(specVsMain, specVsBranch) {
  const result = {
    missingInBoth: [],      // [{component, variable}]
    missingInBranchOnly: [], // regression
    missingInMainOnly: [],   // fixed
    mismatchInBoth: [],     // [{component, variable, mode, severity, expectedMain, actualMain, expectedBranch, actualBranch}]
    mismatchInBranchOnly: [], // regression
    mismatchInMainOnly: [],   // fixed
    internalViolations: [], // deduped [{component, variable, mode, detail}]
  };

  const branchByComponent = new Map(
    (specVsBranch?.perComponent ?? []).map((c) => [c.component, c])
  );

  for (const mainComp of specVsMain.perComponent) {
    const branchComp = branchByComponent.get(mainComp.component);
    const mainActionable = filterActionable(mainComp.issues);
    const branchActionable = branchComp ? filterActionable(branchComp.issues) : [];

    // Internal violations — dedupe
    const seenInternal = new Set();
    for (const issue of [...mainActionable, ...branchActionable]) {
      if (issue.severity !== 'internal-alias-violation') continue;
      const key = `${mainComp.component}::${issue.variable}::${issue.mode}`;
      if (seenInternal.has(key)) continue;
      seenInternal.add(key);
      result.internalViolations.push({
        component: mainComp.component,
        variable: issue.variable,
        mode: issue.mode,
        detail: issue.detail,
      });
    }

    // missing-in-figma grouped by variable
    const mainMissing = new Set(
      mainActionable.filter((i) => i.severity === 'missing-in-figma').map((i) => i.variable)
    );
    const branchMissing = new Set(
      branchActionable.filter((i) => i.severity === 'missing-in-figma').map((i) => i.variable)
    );

    for (const v of mainMissing) {
      if (branchMissing.has(v)) {
        result.missingInBoth.push({ component: mainComp.component, variable: v });
      } else {
        result.missingInMainOnly.push({ component: mainComp.component, variable: v });
      }
    }
    for (const v of branchMissing) {
      if (!mainMissing.has(v)) {
        result.missingInBranchOnly.push({ component: mainComp.component, variable: v });
      }
    }

    // mode mismatches — match by variable + mode
    const mainMismatches = mainActionable.filter(
      (i) => i.severity.startsWith('mode-') || i.severity === 'type-mismatch'
    );
    const branchMismatches = branchActionable.filter(
      (i) => i.severity.startsWith('mode-') || i.severity === 'type-mismatch'
    );
    const mainByKey = new Map(mainMismatches.map((i) => [issueKey(i), i]));
    const branchByKey = new Map(branchMismatches.map((i) => [issueKey(i), i]));

    for (const [key, mainIssue] of mainByKey) {
      const branchIssue = branchByKey.get(key);
      if (branchIssue) {
        result.mismatchInBoth.push({
          component: mainComp.component,
          variable: mainIssue.variable,
          mode: mainIssue.mode,
          severity: mainIssue.severity,
          expected: mainIssue.expected,
          actualMain: mainIssue.actual,
          actualBranch: branchIssue.actual,
        });
      } else {
        result.mismatchInMainOnly.push({
          component: mainComp.component,
          variable: mainIssue.variable,
          mode: mainIssue.mode,
          severity: mainIssue.severity,
          expected: mainIssue.expected,
          actual: mainIssue.actual,
        });
      }
    }
    for (const [key, branchIssue] of branchByKey) {
      if (!mainByKey.has(key)) {
        result.mismatchInBranchOnly.push({
          component: mainComp.component,
          variable: branchIssue.variable,
          mode: branchIssue.mode,
          severity: branchIssue.severity,
          expected: branchIssue.expected,
          actual: branchIssue.actual,
        });
      }
    }
  }

  // Sort everything by component then variable for stable output
  const sortByCV = (a, b) =>
    a.component.localeCompare(b.component) || a.variable.localeCompare(b.variable);
  result.missingInBoth.sort(sortByCV);
  result.missingInBranchOnly.sort(sortByCV);
  result.missingInMainOnly.sort(sortByCV);
  result.mismatchInBoth.sort(sortByCV);
  result.mismatchInBranchOnly.sort(sortByCV);
  result.mismatchInMainOnly.sort(sortByCV);
  result.internalViolations.sort(sortByCV);

  return result;
}

function mergedOrphans(specVsMain, specVsBranch) {
  const mainSet = new Set(specVsMain.unreferencedFigmaVars);
  const branchSet = new Set(specVsBranch?.unreferencedFigmaVars ?? []);
  const union = new Set([...mainSet, ...branchSet]);
  return [...union].sort();
}

// ── Severity classification ───────────────────────────────────

const INFORMATIONAL_SEVERITIES = new Set(['scania-mode-not-on-variable']);

function isActionable(severity) {
  return !INFORMATIONAL_SEVERITIES.has(severity);
}

function groupIssuesBySeverity(perComponent) {
  const bySeverity = {};
  for (const c of perComponent) {
    for (const issue of c.issues) {
      const bucket = bySeverity[issue.severity] ?? (bySeverity[issue.severity] = []);
      bucket.push({ component: c.component, ...issue });
    }
  }
  return bySeverity;
}

function splitCounts(perComponent) {
  return perComponent.map((c) => {
    const actionable = c.issues.filter((i) => isActionable(i.severity)).length;
    const informational = c.issueCount - actionable;
    return { component: c.component, variableCount: c.variableCount, actionable, informational, total: c.issueCount };
  });
}

// ── Markdown generators ───────────────────────────────────────

function renderSummaryMd(args) {
  const {
    runId,
    mainFileKey,
    branchKey,
    specVsMain,
    specVsBranch,
  } = args;
  const lines = [];
  lines.push('# Figma ↔ Specs Scan — Union View');
  lines.push('');
  lines.push(`Run ID: \`${runId}\`  `);
  lines.push(`Main file: \`${mainFileKey}\`  `);
  lines.push(`Branch file: ${branchKey ? '`' + branchKey + '`' : '_(none — main-only scan)_'}  `);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('_Main ∪ branch is treated as one design-system state. Anything present on either side is "covered"; only gaps that persist across both are flagged. Scania-mode-on-semantic-layer noise is omitted entirely (see per-side detail files if you need it)._');
  lines.push('');

  const merged = specVsBranch
    ? mergeFindings(specVsMain, specVsBranch)
    : null;
  const orphans = specVsBranch
    ? mergedOrphans(specVsMain, specVsBranch)
    : specVsMain.unreferencedFigmaVars;

  // ── Topline ──
  lines.push('## Topline');
  lines.push('');
  if (merged) {
    lines.push('| Finding | Count |');
    lines.push('|---|---:|');
    lines.push(`| Missing in Figma (both sides) | **${merged.missingInBoth.length}** |`);
    lines.push(`| Value mismatches (both sides) | **${merged.mismatchInBoth.length}** |`);
    lines.push(`| INTERNAL alias violations | ${merged.internalViolations.length} |`);
    lines.push(`| Figma vars with no matching spec (main ∪ branch) | ${orphans.length} |`);
    lines.push(`| _Fixed in branch_ (main wrong → branch right) | ${merged.missingInMainOnly.length + merged.mismatchInMainOnly.length} |`);
    lines.push(`| _Regressed in branch_ (main right → branch wrong) | ${merged.missingInBranchOnly.length + merged.mismatchInBranchOnly.length} |`);
    lines.push('');
    lines.push(`Specs scanned: **${specVsMain.totals.specs}** · spec variables: **${specVsMain.totals.specVariables}** · Figma component vars (main): ${specVsMain.totals.figmaComponentVariables} · (branch): ${specVsBranch.totals.figmaComponentVariables}`);
  } else {
    lines.push('| Finding | Count |');
    lines.push('|---|---:|');
    lines.push(`| Missing in Figma | ${specVsMain.totals.specVariables} |`);
    lines.push(`| Figma vars with no matching spec | ${orphans.length} |`);
  }
  lines.push('');

  if (!merged) return lines.join('\n'); // main-only scan, no merge

  // ── Missing in Figma (union) ──
  lines.push('## Missing in Figma — absent in both main and branch');
  lines.push('');
  if (!merged.missingInBoth.length) {
    lines.push('_None — every spec-declared variable exists somewhere in Figma._');
  } else {
    let currentComponent = null;
    for (const i of merged.missingInBoth) {
      if (i.component !== currentComponent) {
        if (currentComponent !== null) lines.push('');
        lines.push(`**${i.component}**`);
        currentComponent = i.component;
      }
      lines.push(`- \`${i.variable}\``);
    }
  }
  lines.push('');

  // ── Value mismatches (union) ──
  lines.push('## Value mismatches — same wrong value on both sides');
  lines.push('');
  if (!merged.mismatchInBoth.length) {
    lines.push('_None._');
  } else {
    let currentComponent = null;
    for (const i of merged.mismatchInBoth) {
      if (i.component !== currentComponent) {
        if (currentComponent !== null) lines.push('');
        lines.push(`**${i.component}**`);
        currentComponent = i.component;
      }
      lines.push(
        `- \`${i.variable}\` [${i.mode}] — expected ${JSON.stringify(i.expected)}, got ${JSON.stringify(i.actualMain)}`
      );
    }
  }
  lines.push('');

  // ── Regressions ──
  if (merged.missingInBranchOnly.length || merged.mismatchInBranchOnly.length) {
    lines.push('## Regressed in branch — main was right, branch broke it');
    lines.push('');
    for (const i of merged.missingInBranchOnly) {
      lines.push(`- \`${i.component}\` · \`${i.variable}\` — missing in branch (present in main)`);
    }
    for (const i of merged.mismatchInBranchOnly) {
      lines.push(
        `- \`${i.component}\` · \`${i.variable}\` [${i.mode}] — branch ${JSON.stringify(i.actual)}, spec wanted ${JSON.stringify(i.expected)}`
      );
    }
    lines.push('');
  }

  // ── INTERNAL alias violations ──
  if (merged.internalViolations.length) {
    lines.push('## INTERNAL alias violations — spec references `INTERNAL/*` (policy: never)');
    lines.push('');
    for (const i of merged.internalViolations) {
      lines.push(`- \`${i.component}\` · \`${i.variable}\` [${i.mode}] — ${i.detail}`);
    }
    lines.push('');
  }

  // ── Figma orphans ──
  if (orphans.length) {
    lines.push('## Figma orphans — `component/*` present in Figma but covered by no spec');
    lines.push('');
    lines.push(`${orphans.length} variables. Grouped by prefix:`);
    lines.push('');
    const byPrefix = {};
    for (const name of orphans) {
      const parts = name.split('/');
      const prefix = parts.slice(0, 2).join('/'); // e.g. component/header
      (byPrefix[prefix] ??= []).push(name);
    }
    for (const prefix of Object.keys(byPrefix).sort()) {
      lines.push(`- \`${prefix}/*\` — ${byPrefix[prefix].length}`);
    }
    lines.push('');
  }

  // ── Progress footnote ──
  if (merged.missingInMainOnly.length || merged.mismatchInMainOnly.length) {
    lines.push('## Fixed in branch (progress, no action)');
    lines.push('');
    lines.push(`- ${merged.missingInMainOnly.length} previously-missing spec vars now exist in the branch`);
    lines.push(`- ${merged.mismatchInMainOnly.length} value mismatches resolved in the branch`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderSpecSideMd(side, report) {
  const lines = [];
  lines.push(`# Spec vs Figma — ${side}`);
  lines.push('');
  lines.push(`Component specs: ${report.totals.specs}  `);
  lines.push(`Total spec variables: ${report.totals.specVariables}  `);
  lines.push(`Figma component variables: ${report.totals.figmaComponentVariables}  `);
  lines.push(`Issues: **${report.totals.issueCount}**`);
  lines.push('');

  for (const c of report.perComponent) {
    if (!c.issues.length) continue;
    lines.push(`## ${c.component}  _(${c.issues.length} issues)_`);
    lines.push('');
    for (const issue of c.issues) {
      lines.push(`- \`${issue.variable}\` — **${issue.severity}** — ${issue.detail}`);
    }
    lines.push('');
  }

  if (report.unreferencedFigmaVars.length) {
    lines.push(`## Figma component/* variables with no matching spec entry (${report.unreferencedFigmaVars.length})`);
    lines.push('');
    for (const n of report.unreferencedFigmaVars) lines.push(`- \`${n}\``);
    lines.push('');
  }

  return lines.join('\n');
}

function renderDeltaMd(delta, mainFileKey, branchKey) {
  const lines = [];
  lines.push('# Main vs Branch — Variable Delta');
  lines.push('');
  lines.push(`Main file: \`${mainFileKey}\`  `);
  lines.push(`Branch file: \`${branchKey}\``);
  lines.push('');
  lines.push(`Main has **${delta.mainCount}** component variables, branch has **${delta.branchCount}**.`);
  lines.push('');
  lines.push(`Added: ${delta.added.length} · Removed: **${delta.removed.length}** · Changed: ${delta.changed.length}`);
  lines.push('');

  if (delta.removed.length) {
    lines.push('## Removed in branch');
    lines.push('');
    lines.push('_Variables present in main that are gone from the branch. Most likely the \"missing during merge\" candidates._');
    lines.push('');
    for (const n of delta.removed) lines.push(`- \`${n}\``);
    lines.push('');
  }
  if (delta.added.length) {
    lines.push('## Added in branch');
    lines.push('');
    for (const n of delta.added) lines.push(`- \`${n}\``);
    lines.push('');
  }
  if (delta.changed.length) {
    lines.push('## Changed');
    lines.push('');
    for (const c of delta.changed) {
      lines.push(`### \`${c.name}\``);
      lines.push('');
      lines.push('| Mode | Main | Branch |');
      lines.push('|---|---|---|');
      for (const d of c.diffs) {
        lines.push(`| ${d.mode} | \`${d.main}\` | \`${d.branch}\` |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Output helpers ────────────────────────────────────────────

function updateSymlink(target, linkPath) {
  if (existsSync(linkPath)) unlinkSync(linkPath);
  symlinkSync(target, linkPath);
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const useSnapshots = !!(args.mainSnapshot || args.branchSnapshot);

  if (!useSnapshots && !API_KEY) {
    console.error('Error: FIGMA_API_KEY env var is required (or use --main-snapshot / --branch-snapshot).');
    process.exit(1);
  }

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const lib = registry.libraries.find((l) => l.label === TARGET_LIBRARY_LABEL);
  if (!lib) {
    console.error(`Error: library "${TARGET_LIBRARY_LABEL}" not in registry.`);
    process.exit(1);
  }

  const mainFileKey = lib.fileKey;
  const branchKey = args.branch || null;

  const runId = getRunId();
  const outDir = args.out || join(AUDIT_BASE_DIR, `${runId}-figma-scan`);
  mkdirSync(outDir, { recursive: true });
  const runFolder = outDir.split('/').pop();

  console.log(`Figma ↔ Specs scan`);
  console.log(`  Source:      ${useSnapshots ? 'MCP snapshot files' : 'REST API'}`);
  console.log(`  Main file:   ${mainFileKey}${args.mainSnapshot ? ` (via ${args.mainSnapshot})` : ''}`);
  console.log(`  Branch file: ${branchKey ?? (args.branchSnapshot ? `(via ${args.branchSnapshot})` : '(none)')}`);
  console.log(`  Output:      tokens/audit/${runFolder}/`);
  console.log('');

  // Fetch main + branch (REST) or load from disk (MCP snapshots)
  let mainRaw, branchRaw;
  if (useSnapshots) {
    mainRaw = args.mainSnapshot ? JSON.parse(readFileSync(args.mainSnapshot, 'utf-8')) : null;
    branchRaw = args.branchSnapshot ? JSON.parse(readFileSync(args.branchSnapshot, 'utf-8')) : null;
    if (!mainRaw) {
      console.error('Error: snapshot mode requires --main-snapshot.');
      process.exit(1);
    }
    console.log('Loaded snapshots from disk.');
  } else {
    console.log('Fetching variables via REST...');
    [mainRaw, branchRaw] = await Promise.all([
      fetchVariablesRaw(mainFileKey),
      branchKey ? fetchVariablesRaw(branchKey) : Promise.resolve(null),
    ]);
  }

  const main = isMcpSnapshot(mainRaw)
    ? normalizeFromMcpSnapshot(mainRaw, mainFileKey, null)
    : normalizeFetch(mainRaw, mainFileKey, null);
  const branch = branchRaw
    ? (isMcpSnapshot(branchRaw)
        ? normalizeFromMcpSnapshot(branchRaw, mainFileKey, branchKey || 'snapshot')
        : normalizeFetch(branchRaw, mainFileKey, branchKey || 'snapshot'))
    : null;

  console.log(`  Main:   ${Object.keys(main.variables).length} variables across ${Object.keys(main.collections).length} collections`);
  if (branch) {
    console.log(`  Branch: ${Object.keys(branch.variables).length} variables across ${Object.keys(branch.collections).length} collections`);
  }

  // Load specs
  const specs = loadSpecs(args.component);
  console.log(`  Specs:  ${specs.length} loaded${args.component ? ` (filter: ${args.component})` : ''}`);
  console.log('');

  // Compare
  console.log('Comparing spec vs main...');
  const specVsMain = compareSpecAgainstFigma(specs, main, 'main');
  console.log(`  ${specVsMain.totals.issueCount} issues, ${specVsMain.totals.figmaVariablesNotInSpec} Figma vars not in spec.`);

  let specVsBranch = null;
  let delta = null;
  if (branch) {
    console.log('Comparing spec vs branch...');
    specVsBranch = compareSpecAgainstFigma(specs, branch, 'branch');
    console.log(`  ${specVsBranch.totals.issueCount} issues, ${specVsBranch.totals.figmaVariablesNotInSpec} Figma vars not in spec.`);

    console.log('Diffing main vs branch...');
    delta = diffMainVsBranch(main, branch);
    console.log(`  Added: ${delta.added.length} · Removed: ${delta.removed.length} · Changed: ${delta.changed.length}`);
  }
  console.log('');

  // Write outputs
  console.log('Writing reports...');

  // Snapshots (trimmed — keep full for debuggability)
  writeJson(join(outDir, '_main-snapshot.json'), {
    fetchedAt: main.fetchedAt,
    fileKey: main.fileKey,
    branchKey: null,
    collections: main.collections,
    variables: main.variables,
  });
  if (branch) {
    writeJson(join(outDir, '_branch-snapshot.json'), {
      fetchedAt: branch.fetchedAt,
      fileKey: branch.fileKey,
      branchKey: branch.branchKey,
      collections: branch.collections,
      variables: branch.variables,
    });
  }

  // Spec-vs-main
  writeJson(join(outDir, '_spec-vs-main.json'), specVsMain);
  writeFileSync(
    join(outDir, '_spec-vs-main.md'),
    renderSpecSideMd('Main', specVsMain)
  );

  // Spec-vs-branch
  if (specVsBranch) {
    writeJson(join(outDir, '_spec-vs-branch.json'), specVsBranch);
    writeFileSync(
      join(outDir, '_spec-vs-branch.md'),
      renderSpecSideMd('Branch', specVsBranch)
    );
  }

  // Delta
  if (delta) {
    writeJson(join(outDir, '_main-vs-branch-delta.json'), delta);
    writeFileSync(
      join(outDir, '_main-vs-branch-delta.md'),
      renderDeltaMd(delta, mainFileKey, branchKey)
    );
  }

  // Summary
  const summary = {
    runId,
    mainFileKey,
    branchKey,
    specCount: specVsMain.totals.specs,
    specVariableCount: specVsMain.totals.specVariables,
    main: {
      figmaComponentVariables: specVsMain.totals.figmaComponentVariables,
      issues: specVsMain.totals.issueCount,
      figmaVariablesNotInSpec: specVsMain.totals.figmaVariablesNotInSpec,
    },
    branch: specVsBranch
      ? {
          figmaComponentVariables: specVsBranch.totals.figmaComponentVariables,
          issues: specVsBranch.totals.issueCount,
          figmaVariablesNotInSpec: specVsBranch.totals.figmaVariablesNotInSpec,
        }
      : null,
    delta: delta
      ? {
          added: delta.added.length,
          removed: delta.removed.length,
          changed: delta.changed.length,
        }
      : null,
  };
  writeJson(join(outDir, '_scan-summary.json'), summary);
  writeFileSync(
    join(outDir, '_scan-summary.md'),
    renderSummaryMd({ runId, mainFileKey, branchKey, specVsMain, specVsBranch, delta })
  );

  // Per-component
  for (const c of specVsMain.perComponent) {
    const branchRow = specVsBranch?.perComponent.find((x) => x.component === c.component);
    writeJson(join(outDir, `${c.component}.json`), {
      component: c.component,
      specFile: c.specFile,
      variableCount: c.variableCount,
      main: { issueCount: c.issueCount, issues: c.issues },
      branch: branchRow
        ? { issueCount: branchRow.issueCount, issues: branchRow.issues }
        : null,
    });
  }

  // Symlink
  const latestLink = join(AUDIT_BASE_DIR, 'latest-figma-scan');
  if (!args.out) updateSymlink(runFolder, latestLink);

  console.log(`  ${outDir}/`);
  console.log(`  latest-figma-scan -> ${runFolder}`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

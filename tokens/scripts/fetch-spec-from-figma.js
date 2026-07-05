#!/usr/bin/env node
/**
 * Fetch Spec from Figma — Plugin API template
 *
 * This file contains the Plugin API code to run via Figma MCP (use_figma tool).
 * It reads component variables from a Figma file and outputs a spec JSON
 * matching the format in tokens/specs/_template.json.
 *
 * Output format: always 4 columns (light, dark, scania-light, scania-dark).
 * Each variable gets a confidence marker based on what Figma storage shows:
 *
 *   "Confirmed"             — all modes explicitly set in Figma, no ambiguity
 *   "Inherited"             — TRATON modes alias a semantic (color/*, component/*, or
 *                             a direct value); Scania mirrors the same alias since the
 *                             semantic layer or shared ref handles per-brand resolution
 *   "Needs Scania decision" — TRATON modes reference a brand primitive (traton/*) but
 *                             Scania has no explicit override. Gap to fill.
 *   "Temporary"             — (manual) intentional cross-brand ref, documented exception
 *
 * Usage (via MCP):
 *   buildPluginCode('component/badge') → JS string to pass to use_figma
 *
 * Safe path: read-only, no mutations.
 */

/**
 * Generate Plugin API code for a given component prefix.
 * @param {string} prefix - e.g. "component/badge", "component/-input"
 * @returns {string} Plugin API JS code to run via MCP use_figma
 */
export function buildPluginCode(prefix) {
  return PLUGIN_CODE.replace(/__PREFIX__/g, prefix);
}

const PLUGIN_CODE = `
const PREFIX = '__PREFIX__';

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const tratonCol = collections.find(c => c.name === 'TRATON');
const scaniaCol = collections.find(c => c.name === 'Scania');

if (!tratonCol) return JSON.stringify({ error: 'TRATON collection not found' });

// Build variable lookup by ID for alias resolution
const varsById = {};
for (const col of collections) {
  for (const varId of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(varId);
    if (v) varsById[v.id] = v;
  }
}

function resolveValue(val) {
  if (val === undefined) return undefined;
  if (val && typeof val === 'object' && 'type' in val && val.type === 'VARIABLE_ALIAS') {
    const target = varsById[val.id];
    return target ? target.name : '(unresolved:' + val.id + ')';
  }
  if (val && typeof val === 'object' && 'id' in val) {
    const target = varsById[val.id];
    return target ? target.name : '(unresolved:' + val.id + ')';
  }
  if (val && typeof val === 'object' && 'r' in val) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    const hex = '#' + toHex(val.r) + toHex(val.g) + toHex(val.b);
    if (val.a !== undefined && val.a < 1) return hex + toHex(val.a);
    return hex;
  }
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  return undefined;
}

// Classify a TRATON value to determine what kind of ref it is
function classifyRef(resolvedName) {
  if (resolvedName === undefined) return 'undefined';
  if (typeof resolvedName !== 'string') return 'direct';
  if (resolvedName.startsWith('color/')) return 'semantic';
  if (resolvedName.startsWith('type/') || resolvedName.startsWith('spacing/') || resolvedName.startsWith('border/')) return 'semantic';
  if (resolvedName.startsWith('component/')) return 'self-ref';
  if (resolvedName.startsWith('traton/')) return 'traton-primitive';
  if (resolvedName.startsWith('scania/')) return 'scania-primitive';
  if (resolvedName.startsWith('INTERNAL/')) return 'internal';
  return 'unknown';
}

const tratonModes = {};
for (const m of tratonCol.modes) tratonModes[m.name.toLowerCase()] = m.modeId;

const scaniaModes = {};
if (scaniaCol) for (const m of scaniaCol.modes) scaniaModes[m.name.toLowerCase()] = m.modeId;

const variables = [];

for (const varId of tratonCol.variableIds) {
  const v = await figma.variables.getVariableByIdAsync(varId);
  if (!v || !v.name.startsWith(PREFIX)) continue;

  // Read raw storage
  const lightRaw = v.valuesByMode[tratonModes['light']];
  const darkRaw = v.valuesByMode[tratonModes['dark']];
  const scaniaLightRaw = scaniaCol ? v.valuesByMode[scaniaModes['light']] : undefined;
  const scaniaDarkRaw = scaniaCol ? v.valuesByMode[scaniaModes['dark']] : undefined;

  const light = resolveValue(lightRaw);
  const dark = resolveValue(darkRaw);
  const scaniaLightExplicit = resolveValue(scaniaLightRaw);
  const scaniaDarkExplicit = resolveValue(scaniaDarkRaw);

  // Classify what kind of ref the TRATON values are
  const lightKind = classifyRef(light);
  const darkKind = classifyRef(dark);

  // Determine Scania values and confidence
  let scaniaLight, scaniaDark, confidence, intentNote;

  const hasExplicitScania = scaniaLightRaw !== undefined || scaniaDarkRaw !== undefined;

  if (hasExplicitScania) {
    // Scania has explicit overrides — trust them
    scaniaLight = scaniaLightExplicit !== undefined ? scaniaLightExplicit : light;
    scaniaDark = scaniaDarkExplicit !== undefined ? scaniaDarkExplicit : dark;

    // Check for intentional cross-brand ref
    const slKind = classifyRef(scaniaLight);
    const sdKind = classifyRef(scaniaDark);
    if (slKind === 'traton-primitive' || sdKind === 'traton-primitive') {
      confidence = 'Temporary';
      intentNote = 'Cross-brand ref: Scania mode references TRATON primitive. Verify intent.';
    } else {
      confidence = 'Confirmed';
    }
  } else {
    // No explicit Scania override — decide based on TRATON ref kind
    if (lightKind === 'traton-primitive' || darkKind === 'traton-primitive') {
      // Brand-specific primitive, no Scania decision made → flag
      scaniaLight = light;
      scaniaDark = dark;
      confidence = 'Needs Scania decision';
      intentNote = 'TRATON modes reference brand primitive (traton/*). Scania value is mirrored as placeholder — designer must choose Scania-specific primitive or confirm shared value.';
    } else if (lightKind === 'scania-primitive' || darkKind === 'scania-primitive') {
      // Scania primitive in TRATON slot — unusual, likely intentional (e.g. Tag component)
      scaniaLight = light;
      scaniaDark = dark;
      confidence = 'Temporary';
      intentNote = 'Cross-brand ref: TRATON modes reference Scania primitive (likely bootstrap). Mirrored to Scania modes.';
    } else if (lightKind === 'internal' || darkKind === 'internal') {
      scaniaLight = light;
      scaniaDark = dark;
      confidence = 'Needs Scania decision';
      intentNote = 'TRATON modes reference INTERNAL token — resolve INTERNAL first, then revisit Scania.';
    } else {
      // Semantic, self-ref, or direct value — Scania mirrors (semantic layer / shared)
      scaniaLight = light;
      scaniaDark = dark;
      confidence = 'Inherited';
    }
  }

  const entry = {
    name: v.name,
    type: v.resolvedType,
    light,
    dark,
    'scania-light': scaniaLight,
    'scania-dark': scaniaDark,
    confidence
  };

  if (intentNote) entry.comment = intentNote;
  else entry.comment = '';

  variables.push(entry);
}

variables.sort((a, b) => a.name.localeCompare(b.name));

// Aggregate stats for the summary
const stats = {
  total: variables.length,
  byConfidence: {}
};
for (const v of variables) {
  stats.byConfidence[v.confidence] = (stats.byConfidence[v.confidence] || 0) + 1;
}

const spec = {
  _description: 'Auto-fetched from Figma. Always 4 columns. Confidence marks Scania decision status: Confirmed (explicit), Inherited (semantic/shared), Needs Scania decision (gap), Temporary (intentional cross-brand).',
  _fetchedAt: new Date().toISOString(),
  _stats: stats,
  component: PREFIX.replace('component/', ''),
  variables: variables
};

return JSON.stringify(spec, null, 2);
`;

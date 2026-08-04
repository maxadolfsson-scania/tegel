#!/usr/bin/env node
/**
 * Push Spec to Figma
 *
 * Reads a component spec JSON and creates/updates variables in Figma
 * via the REST API Variables endpoint.
 *
 * Usage:
 *   node tokens/scripts/push-spec-to-figma.js --spec tokens/specs/footer.json
 *   node tokens/scripts/push-spec-to-figma.js --spec tokens/specs/footer.json --push
 *   node tokens/scripts/push-spec-to-figma.js --spec tokens/specs/footer.json --push --branch <branchKey>
 *
 * Spec format (see tokens/specs/_template.json):
 *   {
 *     "component": "footer",
 *     "variables": [
 *       {
 *         "name": "component/footer/background/main-default",
 *         "type": "COLOR",
 *         "light": "color/background/layer-01",
 *         "dark": "color/background/layer-01",
 *         "confidence": "Confirmed",
 *         "comment": ""
 *       }
 *     ]
 *   }
 *
 * Value format:
 *   - Variable name string → resolves to VARIABLE_ALIAS (e.g., "color/text/strong")
 *   - "#rrggbb" hex string → resolves to direct RGBA color
 *   - Number → resolves to direct FLOAT value
 *
 * Env:
 *   FIGMA_API_KEY — Personal access token (required)
 */

import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { figmaFetch } from './lib/figma-rest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';

// ── Default targets ───────────────────────────────────────────
// Component variables live in the TRATON Component Library file,
// inside the TRATON collection with Light/Dark modes.

const DEFAULT_FILE_KEY = '6osYTOfd4MgDq7LO6BCoUO';
const TRATON_COLLECTION_ID = 'VariableCollectionId:3:2';
const MODE_LIGHT = '68:0';
const MODE_DARK = '572:1';

// ── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { spec: null, branch: null, push: false, file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--spec' && args[i + 1]) parsed.spec = args[++i];
    else if (args[i] === '--branch' && args[i + 1]) parsed.branch = args[++i];
    else if (args[i] === '--file' && args[i + 1]) parsed.file = args[++i];
    else if (args[i] === '--push') parsed.push = true;
  }
  return parsed;
}

// ── Color parsing ─────────────────────────────────────────────

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6,8}$/.test(value);
}

function isNumericValue(value) {
  return typeof value === 'number';
}

// ── Figma API ─────────────────────────────────────────────────

async function fetchExistingVariables(fileKey) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables/local`, {
    headers: { 'X-Figma-Token': API_KEY },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch variables: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.meta || data;
}

async function postVariables(fileKey, payload) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables`, {
    method: 'POST',
    headers: {
      'X-Figma-Token': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to post variables: ${res.status} ${body}`);
  }

  return res.json();
}

// ── Variable name → ID lookup ─────────────────────────────────

function buildVariableLookup(meta) {
  const lookup = {};
  const variables = meta.variables || {};
  for (const [id, variable] of Object.entries(variables)) {
    lookup[variable.name] = id;
  }
  return lookup;
}

// ── Resolve a spec value to a Figma variable value ────────────

function resolveValue(value, variableLookup, varName, modeName) {
  if (value === null || value === undefined || value === '') {
    return null; // skip — no value for this mode
  }

  if (isNumericValue(value)) {
    return value; // direct FLOAT
  }

  if (isHexColor(value)) {
    return hexToRgba(value); // direct COLOR
  }

  // Variable alias — look up by name
  const refId = variableLookup[value];
  if (!refId) {
    console.warn(`  Warning: "${value}" not found in variable lookup (${varName} ${modeName})`);
    return null;
  }

  return { type: 'VARIABLE_ALIAS', id: refId };
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('Error: FIGMA_API_KEY not set.');
    process.exit(1);
  }

  const { spec: specPath, branch, push: shouldPush, file } = parseArgs();
  const dryRun = !shouldPush;
  if (!specPath) {
    console.error('Error: --spec is required (e.g., --spec tokens/specs/footer.json)');
    process.exit(1);
  }

  // Resolve spec path
  const resolvedSpec = resolve(ROOT_DIR, specPath);
  const spec = JSON.parse(readFileSync(resolvedSpec, 'utf-8'));

  // Target file — use branch key if provided, otherwise default
  const fileKey = branch || file || DEFAULT_FILE_KEY;
  const collectionId = spec.collectionId || TRATON_COLLECTION_ID;
  const modeLight = spec.modeLight || MODE_LIGHT;
  const modeDark = spec.modeDark || MODE_DARK;

  console.log(`${dryRun ? 'DRY RUN' : 'PUSH'}: ${spec.component}`);
  console.log(`  File: ${fileKey}${branch ? ' (branch)' : ''}`);
  console.log(`  Collection: ${collectionId}`);
  console.log(`  Variables: ${spec.variables.length}`);
  if (dryRun) console.log(`  Mode: preview only — add --push to write to Figma`);
  console.log('');

  // Step 1: Fetch existing variables to build lookup
  console.log('Fetching existing variables...');
  const meta = await fetchExistingVariables(fileKey);
  const variableLookup = buildVariableLookup(meta);
  console.log(`  Found ${Object.keys(variableLookup).length} existing variables.\n`);

  // Step 2: Check for existing component variables (skip duplicates)
  const existingNames = new Set(Object.keys(variableLookup));
  const toCreate = [];
  const toSkip = [];

  for (const v of spec.variables) {
    if (existingNames.has(v.name)) {
      toSkip.push(v.name);
    } else {
      toCreate.push(v);
    }
  }

  if (toSkip.length > 0) {
    console.log(`Skipping ${toSkip.length} existing variable(s):`);
    toSkip.forEach((n) => console.log(`  - ${n}`));
    console.log('');
  }

  if (toCreate.length === 0) {
    console.log('Nothing to create — all variables already exist.');
    return;
  }

  console.log(`Creating ${toCreate.length} variable(s):\n`);

  // Step 3: Build the POST payload
  const variables = [];
  const variableModeValues = [];
  const issues = [];

  for (let i = 0; i < toCreate.length; i++) {
    const v = toCreate[i];
    const tempId = `temp_${i}`;
    const resolvedType = (v.type || 'COLOR').toUpperCase();

    variables.push({
      action: 'CREATE',
      id: tempId,
      name: v.name,
      variableCollectionId: collectionId,
      resolvedType,
    });

    // Resolve light mode value
    const lightVal = resolveValue(v.light, variableLookup, v.name, 'light');
    if (lightVal !== null) {
      variableModeValues.push({
        variableId: tempId,
        modeId: modeLight,
        value: lightVal,
      });
    } else {
      issues.push(`${v.name}: no light value`);
    }

    // Resolve dark mode value
    const darkVal = resolveValue(v.dark, variableLookup, v.name, 'dark');
    if (darkVal !== null) {
      variableModeValues.push({
        variableId: tempId,
        modeId: modeDark,
        value: darkVal,
      });
    } else {
      issues.push(`${v.name}: no dark value`);
    }

    const lightDisplay = v.light || '(empty)';
    const darkDisplay = v.dark || '(empty)';
    const marker = v.confidence === 'Needs Decision' ? ' ⚠️' : '';
    console.log(`  ${v.name} [${resolvedType}]${marker}`);
    console.log(`    Light: ${lightDisplay}`);
    console.log(`    Dark:  ${darkDisplay}`);
  }

  if (issues.length > 0) {
    console.log(`\nWarnings (${issues.length}):`);
    issues.forEach((issue) => console.log(`  ⚠ ${issue}`));
  }

  const payload = { variables, variableModeValues };

  if (dryRun) {
    console.log('\n── Preview payload ─────────────────────────────');
    console.log(JSON.stringify(payload, null, 2));
    console.log('─────────────────────────────────────────────────');
    console.log('\nPreview complete. No changes made.');
    console.log('To push, re-run with --push');
    return;
  }

  // Step 4: POST to Figma
  console.log('\nPushing to Figma...');
  const result = await postVariables(fileKey, payload);
  console.log(`\n  Created ${toCreate.length} variable(s) in Figma.`);

  if (result.meta?.variables) {
    const createdIds = Object.keys(result.meta.variables);
    console.log(`  Figma variable IDs: ${createdIds.join(', ')}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

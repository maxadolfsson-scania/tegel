#!/usr/bin/env node
/**
 * Push Scania collection overrides for component variables.
 *
 * Reads existing variables via REST API and sets Scania mode values
 * using variableModeValues POST.
 *
 * Usage:
 *   node tokens/scripts/push-scania-overrides.js                  # preview
 *   node tokens/scripts/push-scania-overrides.js --push            # write to Figma
 *   node tokens/scripts/push-scania-overrides.js --push --branch <key>
 *
 * Env: FIGMA_API_KEY
 */

import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { figmaFetch } from './lib/figma-rest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';
const DEFAULT_FILE_KEY = '6osYTOfd4MgDq7LO6BCoUO';

// Scania mode IDs (short form, as stored in variables)
const SCANIA_LIGHT = '26148:0';
const SCANIA_DARK = '26148:2';

// ── CLI ──────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { specs: [], branch: null, push: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--spec' && args[i + 1]) parsed.specs.push(args[++i]);
    else if (args[i] === '--branch' && args[i + 1]) parsed.branch = args[++i];
    else if (args[i] === '--push') parsed.push = true;
  }
  return parsed;
}

// ── Figma API ────────────────────────────────────────────────

async function fetchVariables(fileKey) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables/local`, {
    headers: { 'X-Figma-Token': API_KEY },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.meta || data;
}

async function postVariables(fileKey, payload) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables`, {
    method: 'POST',
    headers: { 'X-Figma-Token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Post failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Color parsing ────────────────────────────────────────────

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
    a: 1,
  };
}

function resolveValue(value, lookup) {
  if (value === null || value === undefined || value === '' || value === 'Needs Decision') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.startsWith('#')) return hexToRgba(value);
  const refId = lookup[value];
  if (!refId) return { error: value };
  return { type: 'VARIABLE_ALIAS', id: refId };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) { console.error('Error: FIGMA_API_KEY not set.'); process.exit(1); }

  const { specs: specPaths, branch, push: shouldPush } = parseArgs();
  const dryRun = !shouldPush;

  if (specPaths.length === 0) {
    console.error('Error: at least one --spec is required');
    process.exit(1);
  }

  const fileKey = branch || DEFAULT_FILE_KEY;
  console.log(`${dryRun ? 'PREVIEW' : 'PUSH'}: Scania overrides`);
  console.log(`  File: ${fileKey}${branch ? ' (branch)' : ''}`);
  if (dryRun) console.log('  Mode: preview only — add --push to write\n');

  // Fetch existing variables
  console.log('Fetching existing variables...');
  const meta = await fetchVariables(fileKey);
  const variables = meta.variables || {};

  const lookup = {};
  for (const [id, v] of Object.entries(variables)) {
    lookup[v.name] = id;
  }
  console.log(`  Found ${Object.keys(lookup).length} variables.\n`);

  // Load and process specs
  const variableModeValues = [];
  const issues = [];

  for (const specPath of specPaths) {
    const resolvedSpec = resolve(ROOT_DIR, specPath);
    const spec = JSON.parse(readFileSync(resolvedSpec, 'utf-8'));
    console.log(`── ${spec.component} (${spec.variables.length} vars) ──`);

    for (const v of spec.variables) {
      const varId = lookup[v.name];
      if (!varId) {
        issues.push(`${v.name}: not found in Figma`);
        continue;
      }

      // Check if this var has scania-light/dark values
      const scaniaLight = v['scania-light'];
      const scaniaDark = v['scania-dark'];

      if (!scaniaLight && !scaniaDark) {
        console.log(`  SKIP ${v.name} (no Scania values in spec)`);
        continue;
      }

      const lightVal = resolveValue(scaniaLight, lookup);
      const darkVal = resolveValue(scaniaDark, lookup);

      if (lightVal && lightVal.error) { issues.push(`${v.name} scania-light: ref "${lightVal.error}" not found`); continue; }
      if (darkVal && darkVal.error) { issues.push(`${v.name} scania-dark: ref "${darkVal.error}" not found`); continue; }

      if (lightVal !== null) {
        variableModeValues.push({ variableId: varId, modeId: SCANIA_LIGHT, value: lightVal });
      }
      if (darkVal !== null) {
        variableModeValues.push({ variableId: varId, modeId: SCANIA_DARK, value: darkVal });
      }

      const marker = scaniaLight === 'Needs Decision' ? ' ⚠ SKIPPED' : '';
      console.log(`  SET ${v.name}${marker}`);
      if (lightVal !== null) console.log(`      scania-light: ${scaniaLight}`);
      if (darkVal !== null) console.log(`      scania-dark:  ${scaniaDark}`);
    }
    console.log('');
  }

  if (issues.length > 0) {
    console.log(`Warnings (${issues.length}):`);
    issues.forEach(i => console.log(`  ⚠ ${i}`));
    console.log('');
  }

  console.log(`Total mode values to set: ${variableModeValues.length}`);

  if (variableModeValues.length === 0) {
    console.log('Nothing to push.');
    return;
  }

  if (dryRun) {
    console.log('\n── Preview payload ──');
    console.log(JSON.stringify({ variableModeValues }, null, 2));
    console.log('─────────────────────');
    console.log('\nPreview complete. No changes made.');
    console.log('To push, re-run with --push');
    return;
  }

  // Push
  console.log('\nPushing to Figma...');
  const result = await postVariables(fileKey, { variableModeValues });
  console.log(`Done. Set ${variableModeValues.length} mode values.`);
}

main().catch(err => { console.error(err); process.exit(1); });

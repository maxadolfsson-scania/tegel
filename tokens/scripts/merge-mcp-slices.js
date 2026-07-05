#!/usr/bin/env node
/**
 * Merge MCP snapshot slices into a single compact snapshot file.
 *
 * Each slice file has the shape { total, start, end, returned, v: {name: [type, L, D, SL, SD]} }
 * (produced by the Plugin API dump in scan-figma-vs-specs.js's MCP-capture path).
 *
 * Usage:
 *   node tokens/scripts/merge-mcp-slices.js \
 *     --side main \
 *     --cache tokens/audit/.figma-scan-cache \
 *     --file-key 6osYTOfd4MgDq7LO6BCoUO
 *
 * Writes <cache>/<side>-snapshot.json with shape:
 *   {
 *     fileKey,
 *     capturedAt,
 *     componentVariables: { [name]: [type, L, D, SL, SD] }
 *   }
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { side: null, cache: null, fileKey: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--side' && args[i + 1]) out.side = args[++i];
    else if (args[i] === '--cache' && args[i + 1]) out.cache = args[++i];
    else if (args[i] === '--file-key' && args[i + 1]) out.fileKey = args[++i];
  }
  return out;
}

const { side, cache, fileKey } = parseArgs();
if (!side || !cache) {
  console.error('Usage: merge-mcp-slices.js --side <main|branch> --cache <dir> [--file-key <key>]');
  process.exit(1);
}

const cacheDir = resolve(ROOT_DIR, cache);
const sliceFiles = readdirSync(cacheDir)
  .filter((f) => f.startsWith(`${side}-slice-`) && f.endsWith('.json'))
  .sort();

if (!sliceFiles.length) {
  console.error(`No slices found matching ${side}-slice-*.json in ${cacheDir}`);
  process.exit(1);
}

const merged = {};
let total = null;
for (const f of sliceFiles) {
  const data = JSON.parse(readFileSync(join(cacheDir, f), 'utf-8'));
  if (total == null) total = data.total;
  for (const [k, v] of Object.entries(data.v ?? {})) merged[k] = v;
}

const out = {
  fileKey: fileKey || null,
  capturedAt: new Date().toISOString(),
  componentVariableCount: Object.keys(merged).length,
  expected: total,
  componentVariables: merged,
};

const outPath = join(cacheDir, `${side}-snapshot.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`  ${side}: merged ${sliceFiles.length} slices -> ${Object.keys(merged).length} vars (expected ${total}) -> ${outPath}`);

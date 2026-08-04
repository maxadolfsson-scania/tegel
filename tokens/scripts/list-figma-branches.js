#!/usr/bin/env node
/**
 * List Figma Branches
 *
 * Snapshots the branches on each registered library file and caches them to
 * tokens/audit/figma-branches.json, so the branch gate can propose a concrete
 * candidate instead of asking blind. Read-only against Figma -- no --push gate
 * needed, unlike the other scripts in this directory.
 *
 * REPLACES create-figma-branch.js. Branch *creation* is not available via the
 * Figma REST API: POST /v1/files/:key/branches returns 404, as does GET on the
 * same route (verified 2026-08-03). The old script targeted an endpoint that has
 * never existed, so Phase 4a of CLUSTER_WORKFLOW.md never ran and the registry
 * it described was never written. Create branches in the Figma UI, then run this
 * to capture the key.
 *
 * Listing works through a documented parameter on the file endpoint --
 * GET /v1/files/:key?branch_data=true -- which returns a `branches` array.
 *
 * That parameter returns ACTIVE branches only: archived and merged branches are
 * excluded by Figma, so this snapshot prunes itself as branches are archived.
 * No ignore-list is needed here, and adding one would be redundant.
 *
 * Usage:
 *   node tokens/scripts/list-figma-branches.js                      # all libraries
 *   node tokens/scripts/list-figma-branches.js --file traton        # one library
 *   node tokens/scripts/list-figma-branches.js --match "cluster 15" # filter by name
 *
 * Env:
 *   FIGMA_API_KEY — Personal access token (required)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { figmaFetch } from './lib/figma-rest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_DIR = join(ROOT_DIR, 'tokens', 'audit');
const REGISTRY_PATH = join(AUDIT_DIR, 'figma-libraries.json');
const BRANCHES_PATH = join(AUDIT_DIR, 'figma-branches.json');

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';

// ── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { file: null, match: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) parsed.file = args[++i];
    else if (args[i] === '--match' && args[i + 1]) parsed.match = args[++i];
  }
  return parsed;
}

// ── Figma API ─────────────────────────────────────────────────

async function fetchBranches(fileKey) {
  // depth=1 keeps the payload small -- only branch metadata is wanted, not the
  // document tree, which is megabytes on these files.
  const res = await figmaFetch(
    `${FIGMA_API}/v1/files/${fileKey}?branch_data=true&depth=1`,
    { headers: { 'X-Figma-Token': API_KEY } }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return (data.branches ?? []).map((b) => ({
    key: b.key,
    name: b.name,
    lastModified: b.last_modified ?? null,
    url: `https://figma.com/design/${fileKey}/branch/${b.key}`,
  }));
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('Error: FIGMA_API_KEY not set.');
    console.error('Export it from ~/.zshenv, not ~/.zshrc — zsh only sources');
    console.error('.zshrc for interactive shells, so scripts will not see it.');
    process.exit(1);
  }

  const { file, match } = parseArgs();

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const targets = file
    ? registry.libraries.filter((l) => l.label === file)
    : registry.libraries;

  if (targets.length === 0) {
    console.error(
      `No library found matching "${file}". ` +
        `Available: ${registry.libraries.map((l) => l.label).join(', ')}`
    );
    process.exit(1);
  }

  // Snapshot, not an append-log: this reflects current Figma state, so a stale
  // entry is worse than no entry. Regenerate rather than accumulate.
  const snapshot = { fetchedAt: new Date().toISOString(), libraries: {} };
  let total = 0;
  let failures = 0;

  for (const lib of targets) {
    process.stdout.write(`${lib.label} (${lib.fileKey})...\n`);
    try {
      const all = await fetchBranches(lib.fileKey);
      const branches = match
        ? all.filter((b) => b.name.toLowerCase().includes(match.toLowerCase()))
        : all;

      snapshot.libraries[lib.label] = { fileKey: lib.fileKey, branches };
      total += branches.length;

      if (branches.length === 0) {
        console.log(match ? `  no branches matching "${match}"\n` : '  no branches\n');
        continue;
      }
      for (const b of branches) {
        console.log(`  ${b.key}  ${b.name}`);
      }
      if (match) console.log(`  (${branches.length} of ${all.length} shown)`);
      console.log('');
    } catch (err) {
      failures += 1;
      console.error(`  Failed: ${err.message}\n`);
      snapshot.libraries[lib.label] = {
        fileKey: lib.fileKey,
        error: err.message,
      };
    }
  }

  // A --match run writes a filtered snapshot, which would look like "these are
  // the only branches" to a later reader. Keep the cache authoritative.
  if (match) {
    console.log(`${total} branch(es) matched. Cache not written (--match filters`);
    console.log('the result; re-run without --match to refresh the cache).');
  } else {
    writeFileSync(BRANCHES_PATH, JSON.stringify(snapshot, null, 2) + '\n');
    console.log(`${total} branch(es) -> ${BRANCHES_PATH}`);
  }

  if (failures > 0) process.exit(1);

  console.log('\nBranch creation is a Figma UI action — the REST API has no');
  console.log('endpoint for it. Re-run this after creating one to capture the key.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

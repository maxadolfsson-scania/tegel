#!/usr/bin/env node
/**
 * Create Figma Branch
 *
 * Creates a branch on one or both Figma library files for a component cluster.
 * Stores the branch keys so push-spec-to-figma.js can target them.
 *
 * Usage:
 *   node tokens/scripts/create-figma-branch.js --name "cluster/footer-divider-link-breadcrumbs"
 *   node tokens/scripts/create-figma-branch.js --name "cluster/footer-divider-link-breadcrumbs" --file traton
 *   node tokens/scripts/create-figma-branch.js --name "cluster/footer-divider-link-breadcrumbs" --file tegel
 *
 * Env:
 *   FIGMA_API_KEY — Personal access token (required)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  const parsed = { name: null, file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
    else if (args[i] === '--file' && args[i + 1]) parsed.file = args[++i];
  }
  return parsed;
}

// ── Figma API ─────────────────────────────────────────────────

async function createBranch(fileKey, branchName) {
  const res = await fetch(`${FIGMA_API}/v1/files/${fileKey}/branches`, {
    method: 'POST',
    headers: {
      'X-Figma-Token': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: branchName }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data;
}

// ── Branch registry ───────────────────────────────────────────

function loadBranches() {
  try {
    return JSON.parse(readFileSync(BRANCHES_PATH, 'utf-8'));
  } catch {
    return { branches: [] };
  }
}

function saveBranches(data) {
  writeFileSync(BRANCHES_PATH, JSON.stringify(data, null, 2) + '\n');
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('Error: FIGMA_API_KEY not set.');
    process.exit(1);
  }

  const { name, file } = parseArgs();
  if (!name) {
    console.error('Error: --name is required (e.g., --name "cluster/footer-divider-link-breadcrumbs")');
    process.exit(1);
  }

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const targets = file
    ? registry.libraries.filter((l) => l.label === file)
    : registry.libraries;

  if (targets.length === 0) {
    console.error(`No library found matching "${file}". Available: ${registry.libraries.map((l) => l.label).join(', ')}`);
    process.exit(1);
  }

  console.log(`Creating branch "${name}" on ${targets.length} file(s)...\n`);

  const branchRecord = {
    name,
    created: new Date().toISOString(),
    files: {},
  };

  for (const lib of targets) {
    console.log(`  ${lib.label} (${lib.fileKey})...`);
    try {
      const result = await createBranch(lib.fileKey, name);
      const branchKey = result.key || result.branch?.key || result.file_key;

      if (!branchKey) {
        console.log(`  Response: ${JSON.stringify(result)}`);
        console.warn(`  Warning: Could not extract branch key from response.`);
        branchRecord.files[lib.label] = { status: 'unknown', response: result };
        continue;
      }

      branchRecord.files[lib.label] = {
        fileKey: lib.fileKey,
        branchKey,
        url: `https://figma.com/design/${lib.fileKey}/branch/${branchKey}`,
      };

      console.log(`  Branch key: ${branchKey}`);
      console.log(`  URL: https://figma.com/design/${lib.fileKey}/branch/${branchKey}\n`);
    } catch (err) {
      console.error(`  Failed: ${err.message}\n`);
      branchRecord.files[lib.label] = { status: 'error', error: err.message };
    }
  }

  // Save to branch registry
  const branches = loadBranches();
  branches.branches.push(branchRecord);
  saveBranches(branches);

  console.log(`Branch record saved to ${BRANCHES_PATH}`);
  console.log('\nUse the branch key as --branch when pushing specs:');
  console.log('  node tokens/scripts/push-spec-to-figma.js --spec tokens/specs/footer.json --branch <branchKey>');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Package MEATBASH for review/audit.
 * Creates a zip with source code + docs, excluding bloat.
 * Usage: bun run zip
 */

import { $ } from 'bun';
import { resolve } from 'path';

const timestamp = new Date().toISOString().slice(0, 10);
const filename = `meatbash-${timestamp}.zip`;
const codeDir = resolve(import.meta.dir, '..');
const repoRoot = resolve(codeDir, '..');
const outPath = resolve(codeDir, filename);

console.log('🥩 Building MEATBASH first...');
await $`cd ${codeDir} && bun run src/build.ts`.quiet();

console.log(`📦 Packaging as ${filename}...`);

// Remove old zip if exists
await $`rm -f ${outPath}`.quiet();

// Create zip from repo root so paths include docs/ and code/
await $`cd ${repoRoot} && zip -r ${outPath} \
  docs/ \
  code/src/ \
  code/dist/ \
  code/package.json \
  code/tsconfig.json \
  -x "*.DS_Store" \
  -x "*__MACOSX*" \
  -x "*.map"`.quiet();

// Also add server/ if it exists with content
try {
  await $`cd ${repoRoot} && zip -r ${outPath} code/server/ -x "*.DS_Store" 2>/dev/null`.quiet();
} catch {}

// Add any markdown docs in code root
try {
  await $`cd ${repoRoot} && zip ${outPath} code/CLAUDE.md code/TASKS.md 2>/dev/null`.quiet();
} catch {}

const file = Bun.file(outPath);
const sizeMB = ((await file.size) / 1024 / 1024).toFixed(1);

console.log(`✅ Created ${filename} (${sizeMB} MB)`);
console.log(`   Path: ${outPath}`);
console.log(`   Includes: docs/, code/src/, code/dist/, code/server/, configs`);
console.log(`   Excludes: node_modules, .DS_Store, .git, sourcemaps`);

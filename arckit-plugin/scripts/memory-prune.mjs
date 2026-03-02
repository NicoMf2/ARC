#!/usr/bin/env node
/**
 * ArcKit Memory Prune
 *
 * Prune ephemeral entities (SessionSummary) from MCP memory while
 * archiving them to a markdown file for historical reference.
 *
 * Persistent entity types (ProjectDecision, VendorInsight, ReviewOutcome,
 * ResearchFinding, RecurringRequirement, LessonLearned) are never pruned.
 *
 * Usage:
 *   node memory-prune.mjs --dry-run    # Preview what would be pruned
 *   node memory-prune.mjs --keep 10    # Keep last 10 SessionSummary entities
 *   node memory-prune.mjs              # Prune with default (keep last 20)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Find project root
function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.arckit'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const projectRoot = findProjectRoot(process.cwd());
if (!projectRoot) {
  console.error('No .arckit/ directory found. Run this from within an ArcKit project.');
  process.exit(1);
}

const memoryFile = join(projectRoot, '.arckit', 'memory.jsonl');
const memoryDir = join(projectRoot, '.arckit', 'memory');
const archiveFile = join(memoryDir, 'archive.md');

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepCount = args.includes('--keep') ? parseInt(args[args.indexOf('--keep') + 1], 10) : 20;

// Types that are ephemeral and can be pruned
const EPHEMERAL_TYPES = ['SessionSummary'];

// Types that are persistent and never pruned
const PERSISTENT_TYPES = [
  'ProjectDecision', 'VendorInsight', 'ReviewOutcome',
  'ResearchFinding', 'RecurringRequirement', 'LessonLearned',
];

if (!existsSync(memoryFile)) {
  console.log('No memory file found. Nothing to prune.');
  process.exit(0);
}

// Load the memory graph
const content = readFileSync(memoryFile, 'utf8').trim();
if (!content) {
  console.log('Memory file is empty. Nothing to prune.');
  process.exit(0);
}

let graph;
try {
  graph = JSON.parse(content);
} catch {
  console.error('Failed to parse memory file. Is it valid JSON?');
  process.exit(1);
}

const entities = graph.entities || [];
const relations = graph.relations || [];

// Separate ephemeral from persistent
const ephemeral = entities.filter(e => EPHEMERAL_TYPES.includes(e.entityType));
const persistent = entities.filter(e => !EPHEMERAL_TYPES.includes(e.entityType));

// Sort ephemeral by name (session names contain timestamps)
ephemeral.sort((a, b) => (b.name || '').localeCompare(a.name || ''));

const toKeep = ephemeral.slice(0, keepCount);
const toPrune = ephemeral.slice(keepCount);

console.log(`\nMemory Prune ${dryRun ? '(DRY RUN)' : ''}`);
console.log(`${'='.repeat(40)}`);
console.log(`Total entities:    ${entities.length}`);
console.log(`Persistent:        ${persistent.length} (never pruned)`);
console.log(`Ephemeral:         ${ephemeral.length}`);
console.log(`  Keeping:         ${toKeep.length}`);
console.log(`  Pruning:         ${toPrune.length}`);

if (toPrune.length === 0) {
  console.log('\nNothing to prune.');
  process.exit(0);
}

console.log('\nEntities to prune:');
for (const e of toPrune) {
  console.log(`  [${e.entityType}] ${e.name} (${(e.observations || []).length} observations)`);
}

if (dryRun) {
  console.log('\nDry run complete. No changes made.');
  process.exit(0);
}

// Archive pruned entities to markdown
mkdirSync(memoryDir, { recursive: true });
const timestamp = new Date().toISOString().substring(0, 10);
let archiveContent = '';

if (existsSync(archiveFile)) {
  archiveContent = readFileSync(archiveFile, 'utf8');
}

archiveContent += `\n## Pruned ${timestamp}\n\n`;
for (const e of toPrune) {
  archiveContent += `### [${e.entityType}] ${e.name}\n\n`;
  for (const obs of (e.observations || [])) {
    archiveContent += `- ${obs}\n`;
  }
  archiveContent += '\n';
}

writeFileSync(archiveFile, archiveContent);
console.log(`\nArchived ${toPrune.length} entities to ${archiveFile}`);

// Rebuild graph without pruned entities
const prunedNames = new Set(toPrune.map(e => e.name));
const remainingEntities = entities.filter(e => !prunedNames.has(e.name));
const remainingRelations = relations.filter(r =>
  !prunedNames.has(r.from) && !prunedNames.has(r.to)
);

graph.entities = remainingEntities;
graph.relations = remainingRelations;

writeFileSync(memoryFile, JSON.stringify(graph));
console.log(`Updated memory file: ${remainingEntities.length} entities remain.`);

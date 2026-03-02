#!/usr/bin/env node
/**
 * ArcKit Memory Search
 *
 * Unified search across active MCP memory (.arckit/memory.jsonl) and
 * markdown archive (.arckit/memory/archive.md). Finds entities by name,
 * type, or observation content.
 *
 * Usage:
 *   node memory-search.mjs "<query>"                        # Search active + archive
 *   node memory-search.mjs "<query>" --type SessionSummary  # Filter by entity type
 *   node memory-search.mjs --stats                          # Show entity statistics
 *   node memory-search.mjs --list-types                     # Show entity type breakdown
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Find project root (walk up looking for .arckit/)
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
const archiveFile = join(projectRoot, '.arckit', 'memory', 'archive.md');

// Parse arguments
const args = process.argv.slice(2);
const showStats = args.includes('--stats');
const showTypes = args.includes('--list-types');
const typeFilter = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;
const query = args.filter(a => !a.startsWith('--') && a !== typeFilter).join(' ').toLowerCase();

// Load active entities from JSONL
function loadActiveEntities() {
  if (!existsSync(memoryFile)) return [];
  const content = readFileSync(memoryFile, 'utf8').trim();
  if (!content) return [];

  // The memory JSONL contains the full graph as a single JSON object
  // with "entities" and "relations" arrays
  try {
    const graph = JSON.parse(content);
    return graph.entities || [];
  } catch {
    // Fallback: try line-by-line JSONL
    const entities = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.entities) {
          entities.push(...obj.entities);
        } else if (obj.name) {
          entities.push(obj);
        }
      } catch { /* skip malformed lines */ }
    }
    return entities;
  }
}

// Search archive markdown for mentions
function searchArchive(searchQuery) {
  if (!existsSync(archiveFile)) return [];
  const content = readFileSync(archiveFile, 'utf8');
  const results = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(searchQuery)) {
      // Find the nearest heading above this line
      let heading = 'Archive';
      for (let j = i; j >= 0; j--) {
        if (lines[j].startsWith('#')) {
          heading = lines[j].replace(/^#+\s*/, '');
          break;
        }
      }
      results.push({ heading, line: lines[i].trim(), lineNum: i + 1 });
    }
  }
  return results;
}

const entities = loadActiveEntities();

if (showStats) {
  const typeCounts = {};
  for (const e of entities) {
    const t = e.entityType || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const totalObs = entities.reduce((sum, e) => sum + (e.observations || []).length, 0);
  console.log(`\nMemory Statistics`);
  console.log(`${'='.repeat(40)}`);
  console.log(`Total entities:      ${entities.length}`);
  console.log(`Total observations:  ${totalObs}`);
  console.log(`Archive:             ${existsSync(archiveFile) ? 'present' : 'not found'}`);
  console.log(`\nBy type:`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(25)} ${count}`);
  }
  process.exit(0);
}

if (showTypes) {
  const typeCounts = {};
  for (const e of entities) {
    const t = e.entityType || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log('\nEntity Types:');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(25)} ${count}`);
  }
  process.exit(0);
}

if (!query) {
  console.error('Usage: node memory-search.mjs "<query>" [--type <type>] [--stats] [--list-types]');
  process.exit(1);
}

// Search active entities
let results = entities.filter(e => {
  if (typeFilter && e.entityType !== typeFilter) return false;
  const nameMatch = (e.name || '').toLowerCase().includes(query);
  const obsMatch = (e.observations || []).some(o => o.toLowerCase().includes(query));
  return nameMatch || obsMatch;
});

console.log(`\n--- Active Memory (${results.length} match${results.length !== 1 ? 'es' : ''}) ---\n`);
for (const e of results) {
  console.log(`[${e.entityType || 'unknown'}] ${e.name}`);
  for (const obs of (e.observations || [])) {
    if (obs.toLowerCase().includes(query)) {
      console.log(`  → ${obs}`);
    }
  }
  console.log();
}

// Search archive
const archiveResults = searchArchive(query);
if (archiveResults.length > 0) {
  console.log(`--- Archive (${archiveResults.length} match${archiveResults.length !== 1 ? 'es' : ''}) ---\n`);
  for (const r of archiveResults.slice(0, 20)) {
    console.log(`  [${r.heading}] ${r.line}`);
  }
  if (archiveResults.length > 20) {
    console.log(`  ... and ${archiveResults.length - 20} more`);
  }
}

if (results.length === 0 && archiveResults.length === 0) {
  console.log('No matches found in active memory or archive.');
}

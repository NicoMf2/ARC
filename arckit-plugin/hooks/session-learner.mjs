#!/usr/bin/env node
/**
 * ArcKit Stop Hook — Session Learner
 *
 * Fires when a session ends (Stop event). Analyses recent git commits
 * to build a session summary manifest for cross-session memory.
 *
 * The manifest captures:
 *   - Which artifact types were created or modified
 *   - Session classification (governance, research, procurement, review, general)
 *   - Unresolved items and next steps
 *
 * MCP tools are NOT available inside hooks. This script writes a JSON
 * manifest to .arckit/memory/ which the SessionStart hook surfaces as
 * context text, instructing Claude to process it via MCP create_entities.
 *
 * Hook Type: Stop (Notification)
 * Input (stdin):  JSON with session_id, cwd, etc.
 * Output (stdout): empty (notification hook, no output required)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}
if (!raw || !raw.trim()) process.exit(0);

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const cwd = data.cwd || '.';

// Only proceed if we're in a project with .arckit directory
if (!isDir(join(cwd, '.arckit'))) {
  process.exit(0);
}

// Ensure memory directory exists
const memoryDir = join(cwd, '.arckit', 'memory');
mkdirSync(memoryDir, { recursive: true });

// Collect recent git activity (last 2 hours)
let commits = '';
try {
  commits = execFileSync('git', ['log', '--since=2 hours ago', '--oneline', '--no-merges'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
} catch {
  // Not a git repo or no recent commits
  process.exit(0);
}

if (!commits) process.exit(0);

const commitLines = commits.split('\n').filter(Boolean);
const commitCount = commitLines.length;

// Detect artifact types from changed files
let changedFiles = '';
try {
  changedFiles = execFileSync('git', ['log', '--since=2 hours ago', '--no-merges', '--name-only', '--pretty=format:'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
} catch {
  changedFiles = '';
}

const files = [...new Set(changedFiles.split('\n').filter(Boolean))];

// Map ARC document type codes to human-readable names
const DOC_TYPES = {
  PRIN: 'Architecture Principles',
  STKE: 'Stakeholder Analysis',
  REQ: 'Requirements',
  RISK: 'Risk Register',
  SOBC: 'Business Case',
  PLAN: 'Project Plan',
  ROAD: 'Roadmap',
  STRAT: 'Architecture Strategy',
  BKLG: 'Product Backlog',
  HLDR: 'High-Level Design Review',
  DLDR: 'Detailed Design Review',
  DATA: 'Data Model',
  WARD: 'Wardley Map',
  DIAG: 'Architecture Diagram',
  DFD: 'Data Flow Diagram',
  ADR: 'Architecture Decision Record',
  TRAC: 'Traceability Matrix',
  TCOP: 'TCoP Assessment',
  SECD: 'Secure by Design',
  AIPB: 'AI Playbook Assessment',
  ATRS: 'ATRS Record',
  DPIA: 'Data Protection Impact Assessment',
  JSP936: 'JSP 936 Assessment',
  SVCASS: 'Service Assessment',
  SNOW: 'ServiceNow Design',
  DEVOPS: 'DevOps Strategy',
  MLOPS: 'MLOps Strategy',
  FINOPS: 'FinOps Strategy',
  OPS: 'Operational Readiness',
  PLAT: 'Platform Design',
  SOW: 'Statement of Work',
  EVAL: 'Evaluation Criteria',
  DOS: 'DOS Requirements',
  GCLD: 'G-Cloud Search',
  GCLC: 'G-Cloud Clarifications',
  DMC: 'Data Mesh Contract',
  RSCH: 'Research Findings',
  AWRS: 'AWS Research',
  AZRS: 'Azure Research',
  GCPR: 'GCP Research',
  PRES: 'Presentation',
};

// Detect artifact types from filenames
const detectedTypes = new Set();
for (const f of files) {
  for (const [code, name] of Object.entries(DOC_TYPES)) {
    if (f.includes(`-${code}-`) || f.includes(`-${code}.`)) {
      detectedTypes.add(name);
    }
  }
}

// Classify session type
function classifySession(types) {
  const typeArr = [...types];
  if (typeArr.some(t => ['Architecture Principles', 'Secure by Design', 'TCoP Assessment',
    'DPIA', 'AI Playbook Assessment', 'JSP 936 Assessment'].includes(t))) {
    return 'governance';
  }
  if (typeArr.some(t => ['Research Findings', 'AWS Research', 'Azure Research',
    'GCP Research', 'G-Cloud Search'].includes(t))) {
    return 'research';
  }
  if (typeArr.some(t => ['Statement of Work', 'Evaluation Criteria', 'DOS Requirements',
    'G-Cloud Clarifications'].includes(t))) {
    return 'procurement';
  }
  if (typeArr.some(t => ['High-Level Design Review', 'Detailed Design Review',
    'Service Assessment'].includes(t))) {
    return 'review';
  }
  return 'general';
}

const sessionType = classifySession(detectedTypes);

// Build summary from commit messages
const commitSummaries = commitLines.map(line => {
  const spaceIdx = line.indexOf(' ');
  return spaceIdx > 0 ? line.substring(spaceIdx + 1) : line;
});

// Build manifest
const timestamp = new Date().toISOString();
const sessionDate = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 13);

const manifest = {
  timestamp,
  sessionType,
  commitCount,
  artifactTypes: [...detectedTypes],
  commitSummaries: commitSummaries.slice(0, 10), // Cap at 10
  filesChanged: files.length,
  suggestedEntity: {
    name: `session-${sessionDate}`,
    entityType: 'SessionSummary',
    observations: [
      `Session type: ${sessionType}`,
      `${commitCount} commit(s), ${files.length} file(s) changed`,
      `Artifacts: ${[...detectedTypes].join(', ') || 'none detected'}`,
      ...commitSummaries.slice(0, 5).map(s => `Commit: ${s}`),
    ],
  },
};

// Write manifest
const manifestPath = join(memoryDir, `pending-${sessionDate}.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Prune old manifests (keep last 20)
try {
  const manifests = readdirSync(memoryDir)
    .filter(f => f.startsWith('pending-') && f.endsWith('.json'))
    .sort()
    .reverse();

  for (const old of manifests.slice(20)) {
    try {
      unlinkSync(join(memoryDir, old));
    } catch { /* ignore */ }
  }
} catch { /* ignore */ }

process.exit(0);

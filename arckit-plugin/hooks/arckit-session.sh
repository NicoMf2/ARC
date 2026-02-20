#!/usr/bin/env bash
# ArcKit SessionStart Hook
#
# Fires once at session start (and on resume/clear/compact).
# Injects ArcKit plugin version into the context window, exports
# ARCKIT_VERSION as an environment variable for Bash tool calls, and
# surfaces any pending session memory manifests from previous sessions.
#
# MCP tools are NOT available inside hooks. Pending memory manifests
# are surfaced as context text instructing Claude to process them via
# mcp__memory__create_entities and mcp__memory__search_nodes.
#
# Input (stdin): JSON with session_id, cwd, etc.
# Output (stdout): JSON with additionalContext

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract working directory
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')
ENV_FILE=$(echo "$INPUT" | jq -r '.env_file // ""')

# Read plugin version
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
VERSION_FILE="${PLUGIN_ROOT}/VERSION"

if [[ -f "$VERSION_FILE" ]]; then
  ARCKIT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
else
  ARCKIT_VERSION="unknown"
fi

# Export ARCKIT_VERSION so Bash tool calls can use it
if [[ -n "$ENV_FILE" ]]; then
  echo "ARCKIT_VERSION=${ARCKIT_VERSION}" >> "$ENV_FILE"
fi

# Check for projects directory
CONTEXT="ArcKit Plugin v${ARCKIT_VERSION} is active."
NL=$'\n'

if [[ -d "${CWD}/projects" ]]; then
  CONTEXT="${CONTEXT}${NL}${NL}Projects directory: found at ${CWD}/projects"
else
  CONTEXT="${CONTEXT}${NL}${NL}No projects/ directory found. Run /arckit:init to scaffold a new project or /arckit:create to add one."
fi

# --- Cross-session memory: surface pending manifests ---
MEMORY_DIR="${CWD}/.arckit/memory"

if [[ -d "$MEMORY_DIR" ]]; then
  PENDING_FILES=()
  shopt -s nullglob
  for f in "$MEMORY_DIR"/pending-*.json; do
    PENDING_FILES+=("$f")
  done
  shopt -u nullglob

  if [[ ${#PENDING_FILES[@]} -gt 0 ]]; then
    CONTEXT="${CONTEXT}${NL}${NL}---${NL}## Cross-Session Memory${NL}"
    CONTEXT="${CONTEXT}${NL}Previous session summaries are available. Process them now to maintain project continuity.${NL}"

    for manifest in "${PENDING_FILES[@]}"; do
      if jq empty "$manifest" 2>/dev/null; then
        ENTITY_NAME=$(jq -r '.entity.name // "unknown"' "$manifest")
        ENTITY_TYPE=$(jq -r '.entity.entityType // "unknown"' "$manifest")
        TIMESTAMP=$(jq -r '.timestamp // "unknown"' "$manifest")
        OBSERVATIONS=$(jq -r '.entity.observations | join(", ")' "$manifest" 2>/dev/null || echo "")

        CONTEXT="${CONTEXT}${NL}**Previous session** (${TIMESTAMP}): ${ENTITY_NAME} [${ENTITY_TYPE}]"
        if [[ -n "$OBSERVATIONS" ]]; then
          CONTEXT="${CONTEXT}${NL}  Observations: ${OBSERVATIONS}"
        fi
      fi
    done

    CONTEXT="${CONTEXT}${NL}"
    CONTEXT="${CONTEXT}${NL}**Action required:** Call \`mcp__memory__create_entities\` to store these summaries, then call \`mcp__memory__search_nodes\` to check for relevant prior decisions and lessons. After processing, delete the pending manifest files from \`.arckit/memory/\`.${NL}"
    CONTEXT="${CONTEXT}${NL}Pending manifest files:"
    for manifest in "${PENDING_FILES[@]}"; do
      CONTEXT="${CONTEXT}${NL}  - $(basename "$manifest")"
    done
  fi
fi

# --- Cross-session memory: remind Claude about memory tools ---
if [[ -f "${CWD}/.arckit/memory.jsonl" ]]; then
  # Memory file exists — previous sessions have stored learnings
  MEMORY_LINES=$(wc -l < "${CWD}/.arckit/memory.jsonl" 2>/dev/null | tr -d ' ')
  if [[ "$MEMORY_LINES" -gt 0 ]]; then
    CONTEXT="${CONTEXT}${NL}${NL}**Cross-session memory active** (${MEMORY_LINES} entries in .arckit/memory.jsonl). Use \`mcp__memory__search_nodes\` to query prior decisions, vendor insights, and lessons learned before starting new work."
  fi
fi

# Output additionalContext
jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

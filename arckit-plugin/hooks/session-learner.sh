#!/usr/bin/env bash
# ArcKit Notification/Stop Hook — Session Learner
#
# Fires when a session ends (stop event). Analyses recent git commits
# to build a session summary manifest for cross-session memory.
#
# The manifest captures:
#   - Which artifact types were created or modified
#   - Session classification (governance, research, procurement, review, general)
#   - Unresolved items and next steps
#
# MCP tools are NOT available inside hooks. This script writes a JSON
# manifest to .arckit/memory/ which the SessionStart hook surfaces as
# context text, instructing Claude to process it via MCP create_entities.
#
# Input (stdin):  JSON with session_id, cwd, etc.
# Output (stdout): empty (notification hook, no output required)

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract working directory
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')

# Only proceed if we're in a project with .arckit directory
if [[ ! -d "${CWD}/.arckit" ]]; then
  exit 0
fi

# Ensure memory directory exists
MEMORY_DIR="${CWD}/.arckit/memory"
mkdir -p "$MEMORY_DIR"

# --- Capture timestamps once for consistent use ---
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SESSION_DATE=$(date +%Y%m%d-%H%M)

# --- Collect recent git activity (last 2 hours) ---
SINCE="2 hours ago"
COMMITS=$(git -C "$CWD" log --since="$SINCE" --oneline --no-merges 2>/dev/null || echo "")

if [[ -z "$COMMITS" ]]; then
  exit 0
fi

COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')

# --- Detect artifact types from changed files ---
CHANGED_FILES=$(git -C "$CWD" log --since="$SINCE" --no-merges --name-only --pretty=format: 2>/dev/null | sort -u | grep -v '^$' || echo "")

# Doc type code to human-readable name mapping
doc_type_name() {
  case "$1" in
    PRIN)      echo "Architecture Principles" ;;
    STKE)      echo "Stakeholder Analysis" ;;
    REQ)       echo "Requirements" ;;
    RISK)      echo "Risk Register" ;;
    SOBC)      echo "Business Case" ;;
    PLAN)      echo "Project Plan" ;;
    ROAD)      echo "Roadmap" ;;
    STRAT)     echo "Architecture Strategy" ;;
    BKLG)      echo "Product Backlog" ;;
    HLDR)      echo "High-Level Design Review" ;;
    DLDR)      echo "Detailed Design Review" ;;
    DATA)      echo "Data Model" ;;
    WARD)      echo "Wardley Map" ;;
    DIAG)      echo "Architecture Diagram" ;;
    DFD)       echo "Data Flow Diagram" ;;
    ADR)       echo "Architecture Decision Record" ;;
    TRAC)      echo "Traceability Matrix" ;;
    TCOP)      echo "TCoP Assessment" ;;
    SECD)      echo "Secure by Design" ;;
    SECD-MOD)  echo "MOD Secure by Design" ;;
    AIPB)      echo "AI Playbook Assessment" ;;
    ATRS)      echo "ATRS Record" ;;
    DPIA)      echo "Data Protection Impact Assessment" ;;
    JSP936)    echo "JSP 936 Assessment" ;;
    SVCASS)    echo "Service Assessment" ;;
    SNOW)      echo "ServiceNow Design" ;;
    DEVOPS)    echo "DevOps Strategy" ;;
    MLOPS)     echo "MLOps Strategy" ;;
    FINOPS)    echo "FinOps Strategy" ;;
    OPS)       echo "Operational Readiness" ;;
    PLAT)      echo "Platform Design" ;;
    SOW)       echo "Statement of Work" ;;
    EVAL)      echo "Evaluation Criteria" ;;
    DOS)       echo "DOS Requirements" ;;
    GCLD)      echo "G-Cloud Search" ;;
    GCLC)      echo "G-Cloud Clarifications" ;;
    DMC)       echo "Data Mesh Contract" ;;
    RSCH)      echo "Research Findings" ;;
    AWRS)      echo "AWS Research" ;;
    AZRS)      echo "Azure Research" ;;
    GCRS)      echo "GCP Research" ;;
    DSCT)      echo "Data Source Discovery" ;;
    STORY)     echo "Project Story" ;;
    ANAL)      echo "Analysis Report" ;;
    PRES)      echo "Presentation" ;;
    GAPS)      echo "Gap Analysis" ;;
    VEND)      echo "Vendor Assessment" ;;
    PRIN-COMP) echo "Principles Compliance" ;;
    *)         echo "$1" ;;
  esac
}

# Check if a type has already been seen (bash 3.2 compatible — no declare -A)
SEEN_TYPES=""
type_seen() {
  case ",$SEEN_TYPES," in
    *",$1,"*) return 0 ;;
    *)        return 1 ;;
  esac
}
mark_type_seen() {
  if [[ -z "$SEEN_TYPES" ]]; then
    SEEN_TYPES="$1"
  else
    SEEN_TYPES="${SEEN_TYPES},$1"
  fi
}

# Extract doc type codes from ARC-* filenames
# Build observations array incrementally via jq
OBS_JSON='[]'

while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  fname=$(basename "$filepath")

  # Only process ARC-* files
  if [[ "$fname" == ARC-*.md ]]; then
    # Extract doc type: strip ARC-NNN- prefix and -vN.N.md suffix
    middle="${fname#ARC-[0-9][0-9][0-9]-}"
    type_part="${middle%-v[0-9]*}"
    # Strip trailing -NNN for multi-instance types
    if [[ "$type_part" =~ ^([A-Z]+-?[A-Z]*)-[0-9]{3}$ ]]; then
      type_part="${BASH_REMATCH[1]}"
    fi

    if ! type_seen "$type_part"; then
      mark_type_seen "$type_part"
      type_lower=$(echo "$type_part" | tr '[:upper:]' '[:lower:]')

      # Check if file was newly created in this window
      FIRST_COMMIT=$(git -C "$CWD" log --since="$SINCE" --diff-filter=A --name-only --pretty=format: -- "$filepath" 2>/dev/null | head -1)
      if [[ -n "$FIRST_COMMIT" ]]; then
        OBS_JSON=$(echo "$OBS_JSON" | jq --arg o "created-${type_lower}" '. + [$o]')
      else
        OBS_JSON=$(echo "$OBS_JSON" | jq --arg o "modified-${type_lower}" '. + [$o]')
      fi

      type_name=$(doc_type_name "$type_part")
      worked_on="worked-on-${type_name// /-}"
      OBS_JSON=$(echo "$OBS_JSON" | jq --arg o "$worked_on" '. + [$o]')
    fi
  fi
done <<< "$CHANGED_FILES"

# --- Classify session type ---
SESSION_TYPE="general"

# Check for review artifacts
if type_seen "HLDR" || type_seen "DLDR" || type_seen "TCOP" || type_seen "SECD" || type_seen "SECD-MOD" || type_seen "SVCASS"; then
  SESSION_TYPE="review"
elif type_seen "RSCH" || type_seen "AWRS" || type_seen "AZRS" || type_seen "GCRS" || type_seen "DSCT"; then
  SESSION_TYPE="research"
elif type_seen "SOBC" || type_seen "SOW" || type_seen "EVAL" || type_seen "DOS" || type_seen "GCLD" || type_seen "GCLC" || type_seen "VEND"; then
  SESSION_TYPE="procurement"
elif type_seen "ADR" || type_seen "PRIN" || type_seen "STRAT" || type_seen "DPIA" || type_seen "JSP936" || type_seen "AIPB"; then
  SESSION_TYPE="governance"
fi

# --- Prepend base observations ---
OBS_JSON=$(echo "$OBS_JSON" | jq \
  --arg stype "session-type-${SESSION_TYPE}" \
  --arg commits "${COMMIT_COUNT}-commits" \
  '[$stype, $commits] + .')

# --- Add up to 5 most recent commit messages as observations ---
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  # Strip commit hash prefix, take message only
  msg="${line#* }"
  OBS_JSON=$(echo "$OBS_JSON" | jq --arg o "$msg" '. + [$o]')
done <<< "$(echo "$COMMITS" | head -5)"

# --- Write pending manifest using jq for safe JSON construction ---
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
MANIFEST_FILE="${MEMORY_DIR}/pending-${SESSION_ID:-$(date +%s)}.json"

jq -n \
  --arg ts "$TIMESTAMP" \
  --arg sid "$SESSION_ID" \
  --arg name "session-${SESSION_DATE}" \
  --argjson obs "$OBS_JSON" \
  '{
    timestamp: $ts,
    session_id: $sid,
    entity: {
      name: $name,
      entityType: "SessionSummary",
      observations: $obs
    }
  }' > "$MANIFEST_FILE"

exit 0

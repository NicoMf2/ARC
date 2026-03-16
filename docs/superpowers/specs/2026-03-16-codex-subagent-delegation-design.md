# Codex Subagent Delegation Design

**Date:** 2026-03-16
**Status:** Draft
**Scope:** ArcKit Codex extension (`arckit-codex/`)

## Problem

ArcKit's Codex extension has 6 agent-backed commands where the SKILL.md contains the full inline prompt (~300 lines each), duplicating the agent `.toml` file. This differs from the Claude Code plugin, which uses thin wrapper commands that delegate to named agents via the Task tool.

Codex CLI now supports a [subagent architecture](https://developers.openai.com/codex/subagents/) with explicit agent spawning, scoped MCP servers, and configurable model/sandbox per agent. ArcKit should adopt this to eliminate duplication and match the Claude Code delegation pattern.

## Goals

1. Agent-backed skills become informative wrappers that spawn the named agent
2. Agent `.toml` files use the full subagent schema (`name`, `description`, `model`, `sandbox_mode`, `mcp_servers`, `developer_instructions`)
3. `converter.py` generates both formats from existing Claude agent `.md` source files
4. Non-agent skills (~57 commands) remain unchanged
5. No changes to Claude Code plugin, Gemini, OpenCode, or Copilot extensions

## Non-Goals

- Multi-level orchestration (coordinator agents spawning sub-agents)
- Changes to `config.toml` structure or `max_depth`
- Subagent support for other extensions (Gemini, OpenCode, Copilot lack the capability)

## Design

### 1. Agent TOML Schema

Each agent `.toml` in `arckit-codex/agents/` is upgraded from single-field to full subagent schema.

**Current format:**

```toml
# Auto-generated from arckit-claude/agents/arckit-research.md
developer_instructions = """
You are an enterprise architecture market research specialist...
"""
```

**New format:**

```toml
# Auto-generated from arckit-claude/agents/arckit-research.md
# Do not edit — edit the source and re-run scripts/converter.py

name = "arckit-research"
description = "Market research specialist — technology evaluation, vendor comparison, build vs buy analysis, TCO, UK Digital Marketplace search"
model = "o3"
sandbox_mode = "full-auto"

mcp_servers = []

developer_instructions = """
You are an enterprise architecture market research specialist...
"""
```

**MCP server scoping per agent:**

| Agent | `mcp_servers` | Rationale |
|-------|---------------|-----------|
| `arckit-research` | `[]` | WebSearch/WebFetch only |
| `arckit-datascout` | `["datacommons-mcp"]` | Data Commons for statistical data |
| `arckit-aws-research` | `["aws-knowledge"]` | AWS Knowledge MCP |
| `arckit-azure-research` | `["microsoft-learn"]` | Microsoft Learn MCP |
| `arckit-gcp-research` | `["google-developer-knowledge"]` | Google Developer Knowledge MCP |
| `arckit-framework` | `[]` | Reads local files only |

### 2. Thin Wrapper SKILL.md

For the 6 agent-backed commands, SKILL.md becomes an informative wrapper (~40 lines) that delegates execution to the named agent.

**Structure:**

```markdown
---
name: arckit-{command}
description: "{command description}"
---

# {Command Title}

## Purpose
{What the command does and why}

## Prerequisites
{Required artifacts and prior commands}

## What This Command Produces
{Expected output and file locations}

## Execution
Spawn the `arckit-{command}` agent to handle this request:
> {Agent invocation prompt with $ARGUMENTS}

## Suggested Next Steps
{Rendered from handoffs: frontmatter}
```

**Key properties:**

- Purpose/Prerequisites/Output give Codex context about when and why to use the command
- Execution section explicitly instructs Codex to spawn the named agent
- Suggested Next Steps rendered from the source command's `handoffs:` YAML
- `agents/openai.yaml` unchanged (`allow_implicit_invocation: false`)
- Non-agent skills (~57 commands) keep their full inline prompts

### 3. CODEX_AGENT_CONFIG in converter.py

A new dictionary maps each agent to its Codex-specific subagent fields. The `name` and `description` fields are NOT in this dict — they come from the Claude agent `.md` frontmatter.

```python
CODEX_AGENT_CONFIG = {
    "arckit-research": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": [],
    },
    "arckit-datascout": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": ["datacommons-mcp"],
    },
    "arckit-aws-research": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": ["aws-knowledge"],
    },
    "arckit-azure-research": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": ["microsoft-learn"],
    },
    "arckit-gcp-research": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": ["google-developer-knowledge"],
    },
    "arckit-framework": {
        "model": "o3",
        "sandbox_mode": "full-auto",
        "mcp_servers": [],
    },
}
```

**Design decisions:**

- `name`/`description` sourced from Claude agent frontmatter (single source of truth)
- `model` defaults to `"o3"` — overridable per-agent
- `sandbox_mode` is `"full-auto"` — agents need to write files without prompting
- Adding a new agent: create Claude `.md`, add one entry here, run converter
- Agents not in this dict fall back to old format (`developer_instructions` only) — backward compatible

### 4. converter.py Function Changes

**`generate_agent_toml_files()`** — updated to emit full subagent schema:

- Reads Claude agent frontmatter for `name` and `description`
- Extracts a one-line description (first sentence or first 120 chars, stripped of examples/XML)
- Merges Codex-specific fields from `CODEX_AGENT_CONFIG`
- Writes `name`, `description`, `model`, `sandbox_mode`, `mcp_servers`, then `developer_instructions`

**`generate_codex_skills()`** — updated with agent-detection branch:

- If a command has a matching agent (via `build_agent_map()`), generates thin wrapper
- Otherwise generates full inline prompt (unchanged behavior)

**New: `generate_thin_wrapper()`** — builds the informative wrapper:

- Reads command frontmatter for description and handoffs
- Builds structured SKILL.md with Purpose, Prerequisites, Output, Execution, Suggested Next Steps
- Execution section contains the spawn instruction with `$ARGUMENTS`

**New: `extract_frontmatter()`** — helper to parse YAML frontmatter:

- Returns dict with all frontmatter fields
- Adds `description_oneline` (first sentence of description, stripped of XML tags)

**Unchanged functions:**

- `generate_codex_config_toml()` — `config.toml` role registry stays as-is
- `rewrite_codex_skills()` — command reference rewriting still applies to wrapper content
- `build_agent_map()` — already identifies command-to-agent mappings
- All non-Codex generation functions (Gemini, OpenCode, Copilot)

### 5. config.toml

No structural changes. Settings remain:

```toml
[agents]
max_threads = 3
max_depth = 1
job_max_runtime_seconds = 600
```

`max_depth = 1` is correct: skills spawn agents (depth 0 → 1), agents don't nest further.

## Files Changed

| File | Change |
|------|--------|
| `scripts/converter.py` | Add `CODEX_AGENT_CONFIG`, update `generate_agent_toml_files()`, update skill generation, add `generate_thin_wrapper()`, add `extract_frontmatter()` |
| `arckit-codex/agents/arckit-research.toml` | Regenerated with full subagent schema |
| `arckit-codex/agents/arckit-datascout.toml` | Regenerated with full subagent schema |
| `arckit-codex/agents/arckit-aws-research.toml` | Regenerated with full subagent schema |
| `arckit-codex/agents/arckit-azure-research.toml` | Regenerated with full subagent schema |
| `arckit-codex/agents/arckit-gcp-research.toml` | Regenerated with full subagent schema |
| `arckit-codex/agents/arckit-framework.toml` | Regenerated with full subagent schema |
| `arckit-codex/skills/arckit-research/SKILL.md` | Thin wrapper (was full inline) |
| `arckit-codex/skills/arckit-datascout/SKILL.md` | Thin wrapper (was full inline) |
| `arckit-codex/skills/arckit-aws-research/SKILL.md` | Thin wrapper (was full inline) |
| `arckit-codex/skills/arckit-azure-research/SKILL.md` | Thin wrapper (was full inline) |
| `arckit-codex/skills/arckit-gcp-research/SKILL.md` | Thin wrapper (was full inline) |
| `arckit-codex/skills/arckit-framework/SKILL.md` | Thin wrapper (was full inline) |

## Testing

1. Run `python scripts/converter.py` — verify clean generation
2. Inspect each `.toml` for correct `name`, `description`, `model`, `mcp_servers`, `developer_instructions`
3. Inspect each thin wrapper SKILL.md for correct structure, spawn instruction, and handoffs
4. Verify non-agent skills are unchanged (diff against previous output)
5. Open a test repo with the Codex extension and invoke `$arckit-research` to verify agent spawning

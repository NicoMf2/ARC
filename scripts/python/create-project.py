#!/usr/bin/env python3
"""
Create a new ARC project for architecture governance.

Usage:
    python3 create-project.py [OPTIONS]

Options:
    --name "PROJECT_NAME"    Name of the project
    --json                   Output JSON for AI agent consumption
    --force                  Skip prerequisites check
"""

import argparse
import glob
import json
import os
import sys
from datetime import date
from pathlib import Path

# Add parent directory to path for common imports
sys.path.insert(0, os.path.dirname(__file__))
from common import (
    find_repo_root, get_next_project_number, slugify, create_project_dir,
    get_arc_dir, get_memory_dir, get_templates_dir,
    log_info, log_success, log_error, output_json_array,
)


def has_doc(project_dir, project_number, type_code):
    """Check if a document with the given type code exists."""
    pattern = os.path.join(project_dir, f"ARC-{project_number}-{type_code}-v*.md")
    return len(glob.glob(pattern)) > 0


def main():
    parser = argparse.ArgumentParser(description="Create a new ARC project")
    parser.add_argument("--name", default="", help="Name of the project")
    parser.add_argument("--json", dest="output_json", action="store_true", help="Output JSON for AI agent consumption")
    parser.add_argument("--force", action="store_true", help="Skip prerequisites check")
    args = parser.parse_args()

    # Find repository root
    repo_root = find_repo_root()

    # Check prerequisites (unless --force)
    if not args.force:
        global_dir = get_memory_dir(repo_root)
        principles_files = glob.glob(os.path.join(global_dir, "ARC-000-PRIN-*.md"))
        if not principles_files or not os.path.isfile(principles_files[0]):
            log_error("Prerequisites not met: Architecture principles not found")
            log_error("Expected: projects/000-global/ARC-000-PRIN-v*.md")
            log_error("")
            log_error("Before creating a project, you must define architecture principles")
            log_error("Run: /arc.principles")
            log_error("")
            log_error("Or use --force to skip this check (not recommended)")
            sys.exit(1)
        log_success("Prerequisites check passed")

    # Get project name
    project_name = args.name
    if not project_name:
        if args.output_json:
            log_error("Project name is required in JSON mode")
            print('{"error": "Project name is required", "success": false}')
            sys.exit(1)
        log_info("Interactive mode: Creating a new ARC project")
        print()
        try:
            project_name = input("Enter project name: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(1)
        if not project_name:
            log_error("Project name cannot be empty")
            sys.exit(1)

    # Get next project number
    project_number = get_next_project_number(repo_root)
    log_info(f"Project number: {project_number}")

    # Create project slug and directory
    project_slug = slugify(project_name)
    project_dir_name = f"{project_number}-{project_slug}"
    project_dir = os.path.join(repo_root, "projects", project_dir_name)

    log_info(f"Creating project: {project_dir_name}")

    # Create project directory structure
    create_project_dir(project_dir)

    # Create README for external documents directory
    external_readme = os.path.join(project_dir, "external", "README.md")
    Path(external_readme).write_text("""\
# External Documents

Place external reference documents here for ARC commands to read as context.

## Supported File Types
- PDF (.pdf)
- Word (.docx)
- Markdown (.md)
- Images (.png, .jpg) - for diagrams and screenshots
- CSV (.csv) - for data exports
- SQL (.sql) - for database schemas

## What to Put Here
- RFP/ITT documents
- Legacy system specifications
- User research reports
- Previous assessments and audits
- Database schemas and ERD diagrams
- Compliance evidence and certificates
- Vendor proposals and technical responses
- Performance benchmarks and test results

## How It Works
ARC commands automatically scan this directory when generating artifacts.
External documents enhance output quality but are never blocking.

## See Also
- `projects/000-global/policies/` - Organization-wide standards and governance documents
""")

    # Ensure 000-global/policies exists and has a README
    global_dir_path = os.path.join(repo_root, "projects", "000-global")
    if os.path.isdir(global_dir_path):
        policies_dir = os.path.join(global_dir_path, "policies")
        os.makedirs(policies_dir, exist_ok=True)
        policies_readme = os.path.join(policies_dir, "README.md")
        if not os.path.isfile(policies_readme):
            Path(policies_readme).write_text("""\
# Organization Policies

Place organization-wide governance documents here. These are read by commands across ALL projects.

## Supported File Types
- PDF (.pdf), Word (.docx), Markdown (.md)

## What to Put Here
- Architecture principles and TOGAF standards
- Security policies and compliance frameworks
- Risk appetite statements and threat assessments
- Technology standards and approved platforms
- Procurement policies and spending thresholds
- Cloud-first mandates and approved supplier lists
- AI governance frameworks and ethical guidelines
- MOD/Defence security policies (JSP 440, CAAT)

## How It Works
Commands like /arc.principles, /arc.risk, /arc.secure, and /arc.sobc
automatically scan this directory for organizational context.
""")

    # Ensure 000-global/external exists and has a README
    if os.path.isdir(global_dir_path):
        global_ext_dir = os.path.join(global_dir_path, "external")
        os.makedirs(global_ext_dir, exist_ok=True)
        global_ext_readme = os.path.join(global_ext_dir, "README.md")
        if not os.path.isfile(global_ext_readme):
            Path(global_ext_readme).write_text("""\
# Global External Documents

Place organization-wide reference documents here. These are read by commands across ALL projects.

## Supported File Types
- PDF (.pdf), Word (.docx), Markdown (.md)
- Images (.png, .jpg) - for diagrams and screenshots
- CSV (.csv) - for data exports
- SQL (.sql) - for database schemas

## What to Put Here
- Enterprise architecture blueprints and reference models
- Organization-wide technology standards documents
- Shared compliance evidence and audit reports
- Cross-project strategy and transformation documents
- Industry benchmarks and analyst reports

## How It Works
ARC commands automatically scan this directory alongside project-level
external documents when generating artifacts.

## See Also
- `projects/000-global/policies/` - Governance policies (risk appetite, security, procurement)
- `projects/{NNN}-{name}/external/` - Project-specific reference documents
""")

    # Create project README
    today = date.today().isoformat()
    project_readme = os.path.join(project_dir, "README.md")
    Path(project_readme).write_text(f"""\
# {project_name}

Project ID: {project_number}
Created: {today}

## Overview

[Project description to be added]

## Workflow

Use ARC commands to generate project artifacts in the recommended order:

### Discovery Phase
1. `/arc.stakeholders` - Analyze stakeholder drivers and goals
2. `/arc.risk` - Create risk register
3. `/arc.sobc` - Create Strategic Outline Business Case

### Alpha Phase
4. `/arc.requirements` - Define comprehensive requirements
5. `/arc.data-model` - Design data model and GDPR compliance
6. `/arc.wardley` - Create Wardley maps for strategic planning
7. `/arc.research` - Research technology options (if needed)
8. `/arc.sow` - Generate Statement of Work for vendor procurement (if needed)
9. `/arc.evaluate` - Create vendor evaluation framework (if needed)

### Beta Phase
10. `/arc.hld-review` - Review High-Level Design
11. `/arc.dld-review` - Review Detailed Design
12. `/arc.traceability` - Generate requirements traceability matrix

### Compliance (as needed)
- `/arc.secure` - UK Government Secure by Design review
- `/arc.tcop` - Technology Code of Practice assessment
- `/arc.ai-playbook` - AI Playbook compliance (for AI systems)

## Project Structure

Documents use standardized naming: `ARC-{{PROJECT_ID}}-{{TYPE}}-v{{VERSION}}.md`

```
{project_dir_name}/
\u251c\u2500\u2500 README.md (this file)
\u2502
\u251c\u2500\u2500 # Core Documents
\u251c\u2500\u2500 ARC-{project_number}-STKE-v1.0.md     # Stakeholder drivers (/arc.stakeholders)
\u251c\u2500\u2500 ARC-{project_number}-RISK-v1.0.md     # Risk register (/arc.risk)
\u251c\u2500\u2500 ARC-{project_number}-SOBC-v1.0.md     # Business case (/arc.sobc)
\u251c\u2500\u2500 ARC-{project_number}-REQ-v1.0.md      # Requirements (/arc.requirements)
\u251c\u2500\u2500 ARC-{project_number}-DATA-v1.0.md     # Data model (/arc.data-model)
\u251c\u2500\u2500 ARC-{project_number}-RSCH-v1.0.md     # Research findings (/arc.research)
\u251c\u2500\u2500 ARC-{project_number}-TRAC-v1.0.md     # Traceability matrix (/arc.traceability)
\u2502
\u251c\u2500\u2500 # Procurement
\u251c\u2500\u2500 ARC-{project_number}-SOW-v1.0.md      # Statement of Work (/arc.sow)
\u251c\u2500\u2500 ARC-{project_number}-EVAL-v1.0.md     # Evaluation criteria (/arc.evaluate)
\u2502
\u251c\u2500\u2500 # Multi-instance Documents (subdirectories)
\u251c\u2500\u2500 decisions/
\u2502   \u251c\u2500\u2500 ARC-{project_number}-ADR-001-v1.0.md  # Architecture decisions (/arc.adr)
\u2502   \u2514\u2500\u2500 ARC-{project_number}-ADR-002-v1.0.md
\u251c\u2500\u2500 diagrams/
\u2502   \u2514\u2500\u2500 ARC-{project_number}-DIAG-001-v1.0.md # Diagrams (/arc.diagram)
\u251c\u2500\u2500 wardley-maps/
\u2502   \u2514\u2500\u2500 ARC-{project_number}-WARD-001-v1.0.md # Wardley maps (/arc.wardley)
\u251c\u2500\u2500 reviews/
\u2502   \u251c\u2500\u2500 ARC-{project_number}-HLD-v1.0.md      # HLD review (/arc.hld-review)
\u2502   \u2514\u2500\u2500 ARC-{project_number}-DLD-v1.0.md      # DLD review (/arc.dld-review)
\u2502
\u251c\u2500\u2500 external/                            # External documents (PDFs, specs, reports)
\u2514\u2500\u2500 vendors/                             # Vendor proposals
```

## Document Type Codes

| Code | Document Type |
|------|---------------|
| REQ | Requirements |
| STKE | Stakeholder Analysis |
| RISK | Risk Register |
| SOBC | Strategic Outline Business Case |
| DATA | Data Model |
| ADR | Architecture Decision Record |
| RSCH | Research Findings |
| SOW | Statement of Work |
| EVAL | Evaluation Criteria |
| HLD | High-Level Design Review |
| DLD | Detailed-Level Design Review |
| TRAC | Traceability Matrix |
| DIAG | Architecture Diagram |
| WARD | Wardley Map |
| TCOP | Technology Code of Practice |
| SECD | Secure by Design |

## Status

Track your progress through the workflow:

**Discovery Phase:**
- [ ] Stakeholder analysis complete
- [ ] Risk register created
- [ ] Business case approved

**Alpha Phase:**
- [ ] Requirements defined
- [ ] Data model designed
- [ ] Vendor procurement started (if needed)

**Beta Phase:**
- [ ] HLD reviewed and approved
- [ ] DLD reviewed and approved
- [ ] Traceability matrix validated

**Live Phase:**
- [ ] Implementation complete
- [ ] Production deployment
""")

    log_success("Project created successfully")

    # Determine next steps
    next_steps = []
    if not has_doc(project_dir, project_number, "STKE"):
        next_steps.append("/arc.stakeholders - Analyze stakeholder drivers and goals")
    elif not has_doc(project_dir, project_number, "RISK"):
        next_steps.append("/arc.risk - Create risk register")
    elif not has_doc(project_dir, project_number, "SOBC"):
        next_steps.append("/arc.sobc - Create Strategic Outline Business Case")
    elif not has_doc(project_dir, project_number, "REQ"):
        next_steps.append("/arc.requirements - Define business and technical requirements")
    elif not has_doc(project_dir, project_number, "DATA"):
        next_steps.append("/arc.data-model - Design data model")
    elif not os.path.isdir(os.path.join(project_dir, "wardley-maps")) or \
         not any(Path(os.path.join(project_dir, "wardley-maps")).iterdir()):
        next_steps.append("/arc.research - Research technology options")
        next_steps.append("/arc.wardley - Create Wardley maps")
    elif not has_doc(project_dir, project_number, "SOW"):
        next_steps.append("/arc.sow - Generate Statement of Work for RFP")
    else:
        next_steps.append("/arc.evaluate - Create vendor evaluation framework")

    # Output
    if args.output_json:
        output = {
            "success": True,
            "project_dir": project_dir,
            "project_number": project_number,
            "project_name": project_name,
            "requirements_file": os.path.join(project_dir, f"ARC-{project_number}-REQ-v1.0.md"),
            "stakeholders_file": os.path.join(project_dir, f"ARC-{project_number}-STKE-v1.0.md"),
            "risk_file": os.path.join(project_dir, f"ARC-{project_number}-RISK-v1.0.md"),
            "sobc_file": os.path.join(project_dir, f"ARC-{project_number}-SOBC-v1.0.md"),
            "sow_file": os.path.join(project_dir, f"ARC-{project_number}-SOW-v1.0.md"),
            "evaluation_file": os.path.join(project_dir, f"ARC-{project_number}-EVAL-v1.0.md"),
            "traceability_file": os.path.join(project_dir, f"ARC-{project_number}-TRAC-v1.0.md"),
            "decisions_dir": os.path.join(project_dir, "decisions"),
            "diagrams_dir": os.path.join(project_dir, "diagrams"),
            "wardley_maps_dir": os.path.join(project_dir, "wardley-maps"),
            "reviews_dir": os.path.join(project_dir, "reviews"),
            "vendors_dir": os.path.join(project_dir, "vendors"),
            "external_dir": os.path.join(project_dir, "external"),
            "global_external_dir": os.path.join(repo_root, "projects", "000-global", "external"),
            "policies_dir": os.path.join(repo_root, "projects", "000-global", "policies"),
            "next_steps": next_steps,
        }
        print(json.dumps(output, indent=2))
    else:
        log_info(f"Project directory: {project_dir}")
        print()
        log_info("Next steps:")
        for i, step in enumerate(next_steps, 1):
            log_info(f"  {i}. {step}")


if __name__ == "__main__":
    main()

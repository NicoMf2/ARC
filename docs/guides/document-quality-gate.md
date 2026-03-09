# Document Quality Gate

The document quality gate is an advisory hook that validates ARC document content after every write. It catches common issues like placeholder text, malformed requirement IDs, and broken cross-references — before they become governance problems.

## What Gets Checked

| Check | What It Detects | Severity |
|-------|----------------|----------|
| **Document Control Completeness** | Placeholder text like `[Project Name]`, `TBD`, `TODO`, `XXX` in document control fields | Medium |
| **Requirement ID Format** | IDs with fewer than 3 digits (e.g., `BR-1` instead of `BR-001`) | Low |
| **Empty Sections** | H2 headings with no content below them (excluding structural headings) | Low |
| **Cross-Reference Integrity** | References to ARC documents that don't exist in the project | High |

## Behaviour

- **Advisory only** — never blocks writes. The document is always saved.
- **Warnings surface as context** — Claude sees the warnings and can offer to fix issues.
- **Only ARC documents** — non-ARC files are silently ignored.
- **Scoped to project** — cross-references are checked within the same project directory.

## Interpreting Warnings

### Placeholder Text

```text
**Placeholder text detected** in document control:
  - Owner: "[Author]"
  - Project: "TBD"
```

The document control table still has template placeholders. Replace them with real values.

### Malformed Requirement IDs

```text
**Malformed requirement IDs** (should be 3 digits, e.g. BR-001):
  - BR-1
  - FR-12
```

Requirement IDs must use 3-digit numbering: `BR-001`, `FR-012`, `NFR-100`.

### Empty Sections

```text
**Empty sections** (heading with no content below):
  - ## Risk Assessment
  - ## Alternatives Considered
```

These sections exist but have no content. Either populate them or remove them if not applicable.

### Missing Cross-References

```text
**Cross-references to non-existent documents**:
  - ARC-001-ADR-005
  - ARC-001-HLDR
```

The document references ARC documents that don't exist in the project directory. Either create the referenced document or correct the reference.

## Structural Headings (Excluded)

These headings are allowed to be empty: Document Control, Revision History, Appendices, References. They are structural sections that may not always have content.

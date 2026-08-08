# Residency Knowledge Architecture

## Decision

The standalone private Git vault is the canonical knowledge source. The scheduling application stores a synchronized runtime copy for authenticated reading, search, and assistant context.

Knowledge changes originate in the vault or as proposals against it. They do not originate as an unrelated second copy in the planner database.

## Data flow

1. An authorized editor clones the private knowledge repository and opens the checkout as an Obsidian vault.
2. The editor changes Markdown and YAML frontmatter on a branch.
3. `wiki validate` checks schema, links, review requirements, source references, retained files, and likely PHI.
4. A human reviews clinical changes before they are merged into the protected default branch.
5. `wiki deploy --dry-run` compares the complete checked-out vault with the server's current wiki revision.
6. `wiki deploy --confirm-authoritative` transactionally makes the server runtime copy match the canonical checkout.
7. The web app and schedule assistant continue to read only published articles from the runtime copy.

The server's wiki revision prevents a deployment based on stale server state. Git handles collaboration, history, line-level diffs, and merge conflicts between vault editors.

## Repository contents

- `Home.md`: portable entry point for Obsidian and other Markdown readers.
- `articles/<category>/<slug>.md`: knowledge articles with YAML frontmatter.
- `sources/<source-id>/metadata.json`: provenance records. Raw and extracted source files remain ignored.
- `templates/`: Obsidian-compatible article templates.
- `.obsidian/`: minimal shared settings. Personal workspace state remains ignored.
- `proposals/`: non-overwriting ingestion output requiring review.
- `archive/remote-deleted/`: recoverable history from the earlier two-way synchronization workflow.

Retained reference binaries remain in authenticated application storage. The Git repository contains their hash, safe filename, media type, byte size, and provenance but not the binary itself.

## Publication rules

- `draft` and `review` articles may exist in the canonical vault but remain hidden from ordinary application users and the assistant.
- Published clinical knowledge requires its existing source, owner, reviewer, and review metadata.
- Git authorship records who changed text. Article review metadata records who approved its clinical or operational meaning.
- No PHI may enter Markdown, source metadata, retained reference files, proposals, commits, or Git history.

## Migration stages

### Stage 1: portable canonical vault

Implemented by the Obsidian-compatible YAML format, shared vault settings, legacy formatter, private Git remote setup, and one-way canonical deployment command.

### Stage 2: web knowledge browser

Add a dedicated Wiki area with search, linked reading, backlinks, provenance, freshness indicators, and draft/review filters for authorized editors.

### Stage 3: proposal-based web editing

Replace direct planner-state wiki mutations with a repository adapter. Web edits create a proposed Git change and expose its review state rather than creating a second canonical copy.

### Stage 4: automated deployment and external clients

Run validation on pull requests and deploy after approved merges. Add scoped service credentials and a stable read/proposal API or MCP interface for other applications and agents.

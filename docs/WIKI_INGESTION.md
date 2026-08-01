# Private Wiki Ingestion and Synchronization

The recommended design is a local, private Git authoring workspace synchronized with the web app through the admin API. The server remains the runtime source for the chatbot; the local workspace is the safer place to ingest files, review agent-generated drafts, keep provenance, and maintain an independent history.

Raw documents never need to be uploaded to the web app. The server receives reviewed Markdown, source metadata, and SHA-256 hashes. Raw and extracted source files remain in ignored local directories.

## First-time setup

```bash
npm run wiki -- init --server https://your-domain.example
```

Set credentials in the shell or put only the admin API key in the ignored `.wiki-workspace/.wiki-api-key` file:

```bash
export WIKI_API_KEY="your-admin-api-key"
export OPENAI_API_KEY="your-openai-api-key"
npm run wiki -- pull
```

The workspace defaults to `.wiki-workspace`. Set `WIKI_WORKSPACE_PATH` to keep it elsewhere. It is its own Git repository, so it can be backed up to a private remote with access restricted to authorized program personnel.

## Ingest a source

Supported inputs are PDF, DOCX, TXT, Markdown, JSON, CSV, YAML, and YML.

```bash
npm run wiki -- ingest ./incoming/nussbaum-lap-chole.docx \
  --source-type direct-review \
  --author "Dr. Nussbaum" \
  --title "Dr. Nussbaum laparoscopic cholecystectomy review" \
  --effective-date 2026-08-01
```

The command:

1. Copies the original and extracted text into an ignored local source directory.
2. Creates a versioned source metadata record with a content hash.
3. Performs a targeted PHI check before any model call.
4. Uses the OpenAI Responses API with strict structured output when `OPENAI_API_KEY` is present.
5. Creates linked `draft` articles with source references; it never publishes or overwrites an existing article.

Use `--no-ai` to stage a source and create an ingestion job for later processing. Set `WIKI_INGEST_MODEL` to override the balanced ingestion model.

The PHI check is deliberately conservative but cannot prove a document is de-identified. Source material must be reviewed before ingestion. Do not ingest actual operative notes, screenshots, exports, or templates that contain patient names, MRNs, dates of birth, or other identifiers.

## Review and publish

Inspect the generated article under `.wiki-workspace/articles/`. JSON frontmatter is used so it can be parsed deterministically while remaining valid YAML frontmatter. Keep each article narrow—typically one attending and one procedure, one workflow, or one policy.

Useful article authorities are:

- `attending-preference`: an individual surgeon's technique or perioperative preference.
- `institutional-policy`: an approved hospital or program policy.
- `workflow`: operational steps, contacts, or schedulers.
- `educational-template`: teaching material or no-PHI note scaffolding.
- `program-reference`: stable service, hospital, and residency-program facts.

Move a draft through review and publication explicitly:

```bash
npm run wiki -- review attending-nussbaum-laparoscopic-cholecystectomy
npm run wiki -- publish attending-nussbaum-laparoscopic-cholecystectomy \
  --reviewer "Dr. Nussbaum" \
  --owner "Berry service" \
  --review-due 2027-08-01
npm run wiki -- validate
npm run wiki -- diff
npm run wiki -- push --dry-run
npm run wiki -- push
```

Published clinical preferences, policies, and educational templates require a source, owner, reviewer, and review date. A future review date is strongly recommended. Draft and review articles are hidden from ordinary users and from the chatbot.

## Synchronization and backup

```bash
npm run wiki -- pull       # merge server changes into the local workspace
npm run wiki -- diff       # compare local content with the last pulled revision
npm run wiki -- push       # preview, validate, transactionally apply, then pull
npm run wiki -- sync       # pull, validate, push, and pull the applied revision
```

Synchronization uses a separate wiki revision and SHA-256 semantic hashes. If both the server and local copy changed from the same base, the pull stops and writes a conflict bundle in `.wiki-workspace/conflicts/`. No automatic last-writer-wins merge is performed.

For continuous backup, schedule `npm run wiki -- sync` from a secured machine, then commit and push the workspace's nested Git repository to a private remote. Keep the API key outside the Git history. A human should still review and publish clinical drafts; unattended ingestion should not auto-publish.

## Workspace layout

```text
.wiki-workspace/
  articles/                 Versioned Markdown knowledge
  sources/<source-id>/
    metadata.json           Versioned provenance record
    original.*              Ignored raw source
    extracted.txt           Ignored extracted source text
  proposals/                Agent jobs and non-overwriting proposals
  conflicts/                Pull conflicts requiring manual resolution
  archive/remote-deleted/   Recoverable copies deleted on the server
  templates/                Attending-procedure and workflow templates
  .wiki-sync.json           Last synchronized revision and hashes
```

## Agent contract

The ingestion agent is intentionally a drafting editor, not a clinical authority. It must:

- extract only claims supported by the supplied source;
- separate attending preference, institutional policy, workflow, and teaching material;
- preserve uncertainty and exceptions instead of filling gaps;
- attach every draft to its source ID and useful locator;
- keep no-PHI note templates distinct from patient documentation;
- avoid silently replacing existing knowledge;
- leave publication to an identified reviewer.

At answer time, the chatbot searches only published articles and can traverse article links. It receives authority, reviewer, review date, review due date, and provenance metadata so it can describe the basis and freshness of clinical knowledge when relevant.


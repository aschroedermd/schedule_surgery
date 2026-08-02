# Private Wiki Ingestion and Synchronization

The recommended design is a local, private Git authoring workspace synchronized with the web app through the admin API. The server remains the runtime source for the chatbot; the local workspace is the safer place to ingest files, review agent-generated drafts, keep provenance, and maintain an independent history.

Raw documents never need to be uploaded to the web app. The server receives reviewed Markdown, source metadata, and SHA-256 hashes. Raw and extracted source files remain in ignored local directories.

## Information architecture

Organize knowledge as a linked graph rather than a collection of source summaries. Each article should answer one coherent class of question and declare its semantic `kind`, structured `scope`, and typed `relationships`.

Recommended kinds:

- `index`: navigation hub only.
- `program-reference`: stable residency expectations, structure, terminology, and culture.
- `service-guide`: one service's scope, sites, attendings, expectations, workflows, and linked protocols.
- `hospital-guide`: site-specific logistics and stable operational facts.
- `attending-profile`: an attending hub linking practice scope, shared preferences, procedure articles, and perioperative guidance.
- `workflow`: one “how do I…” administrative or clinical-process task.
- `operative-preference`: one attending and one procedure family, including equipment, setup, technique, and explicit variants.
- `perioperative-protocol`: preparation or management across clinic, preoperative, intraoperative, PACU, inpatient, discharge, or follow-up phases.
- `institutional-policy`: mandatory approved requirements; do not label an attending preference as policy.
- `note-template`: no-PHI documentation scaffolding or a source-supported operative-note template.
- `educational-reference` or `clinical-reference`: teaching/reference content that does not fit a more specific kind.

Use `category` for broad navigation and storage compatibility; use `kind` for the article's precise semantic role. Attending profiles belong in `attending`. Procedure cards, operative technique, perioperative protocols, policies, and note templates generally belong in `clinical-reference`. Administrative processes belong in `workflow`.

### Structured scope

Clinical and operational leaves should specify all applicable dimensions and leave unsupported dimensions empty:

```json
{
  "kind": "perioperative-protocol",
  "scope": {
    "services": ["Davies"],
    "attendings": ["Kristin McCoy"],
    "procedures": ["total thyroidectomy"],
    "hospitals": [],
    "phases": ["preoperative", "inpatient", "discharge", "follow-up"],
    "patientPopulations": []
  },
  "audience": ["residents"]
}
```

Audience labels help the assistant frame an answer but do not enforce access control. Do not place sensitive interpersonal judgments, gossip, diagnoses, or unverifiable characterizations in the wiki. Program dynamics should be expressed as reviewed expectations, working-style preferences, escalation norms, or operational context.

### Typed relationships

Use typed relationships so the assistant knows why it should follow a link:

- `belongs-to`: leaf to attending, service, hospital, or topic hub.
- `variant-of`: modification to a base procedure or workflow; state differences rather than duplicating the whole parent.
- `shared-preference`: attending- or service-wide setup used by multiple procedures.
- `supplements`: adds detail without replacing the target.
- `governed-by`: points to a policy or protocol that constrains the article.
- `overrides`: explicit, source-supported replacement within the stated scope; never infer an override.
- `uses-workflow`: required operational process.
- `related` or `see-also`: non-precedence navigation.

Relationship targets are mirrored into legacy `links`, and the reader returns both outgoing and incoming typed relationships. Every procedure leaf should normally belong to an attending or service hub. Shared preferences should be stated once and linked from each applicable procedure.

### Procedure and perioperative decomposition

Do not combine every fact about an operation into one oversized article. Prefer:

1. attending profile hub;
2. shared attending preferences;
3. one operative-preference article per procedure family;
4. explicit variant sections or `variant-of` articles for meaningful add-ons/platform changes;
5. perioperative-protocol articles when orders, antibiotics, preparation, diet, medications, wound care, discharge, or follow-up are substantial enough to answer independently;
6. note-template articles kept separate from clinical instructions; and
7. institutional policies linked with `governed-by` rather than copied into every preference.

Within operative or perioperative content, preserve routine versus PRN, required versus preferred, and “ask/check with attending” language. Do not silently reconcile contradictory source statements.

## Agent navigation contract

The assistant should progressively navigate rather than load the entire wiki:

1. Identify the attending, service, procedure, hospital, task, patient population, and perioperative phase present in the question.
2. Search for the most specific applicable leaf article using names, aliases, procedure terms, and phase.
3. Read that article and inspect its scope, authority, provenance, freshness, and typed relationships.
4. Follow only relevant relationships: base/shared preferences for omitted common details; a variant when the modification is present; governing policy for constraints; workflows for execution steps; and the attending/service hub when applicability is unclear.
5. Treat institutional policy as a constraint. Within policy, use the most specific applicable service, attending, procedure, and variant preference. Do not infer that a preference overrides policy.
6. Preserve conflicts and explicit escalation instructions. Mention missing or stale review metadata when clinically material.
7. Answer from the smallest sufficient set of articles. Use live schedule tools for dates and assignments and the Contacts directory for current phone numbers.

## Ingestion decision checklist

Before drafting articles, determine:

- What type of knowledge is present: program reference, workflow, operative preference, perioperative protocol, policy, note template, or educational reference?
- Is a fact shared across an attending/service, or specific to a procedure or variant?
- What are the exact service, attending, procedure, hospital, phase, and population boundaries?
- Does an existing hub, parent procedure, shared preference, workflow, or policy already exist?
- Which statements are routine, PRN, conditional, exceptions, unresolved conflicts, or instructions to ask?
- Can every clinical statement be tied to a useful source locator?

Source `--notes` are binding organization and applicability instructions for agentic ingestion and are included with related existing-article context. Generated articles remain drafts and must not silently overwrite existing knowledge.

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
  templates/                Hubs, operative preferences, protocols, policies, notes, and workflows
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

At answer time, the chatbot searches only published articles and can traverse both legacy links and typed outgoing/incoming relationships. It receives scope, kind, authority, reviewer, review date, review due date, and provenance metadata so it can choose the most specific applicable article and describe the basis and freshness of clinical knowledge when relevant.

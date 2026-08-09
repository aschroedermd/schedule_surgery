#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  WIKI_ARTICLE_KINDS,
  WIKI_AUTHORITIES,
  WIKI_CATEGORIES,
  WIKI_CLINICAL_PHASES,
  WIKI_RELATIONSHIP_TYPES,
  WIKI_SOURCE_TYPES,
  WikiArticle,
  WikiArticleKind,
  WikiArticleRelationship,
  WikiArticleScope,
  WikiAuthority,
  WikiCategory,
  WikiSource,
  WikiSourceType
} from "../shared/types";
import {
  buildWorkspaceDiff,
  buildCanonicalWikiSyncPayload,
  configureWikiGitRemote,
  createDraftArticle,
  describeWikiReferenceFile,
  extractSourceText,
  findExplicitPhi,
  formatWikiWorkspace,
  initializeWikiWorkspace,
  readWikiSyncState,
  readWikiWorkspace,
  readWikiWorkspaceConfig,
  resolveWikiWorkspace,
  stageWikiSource,
  WikiExportBundle,
  writeWikiArticleFile,
  writeWikiSourceMetadata,
  writeWikiSyncState
} from "./wikiWorkspace";
import { computeWikiSourceHash, computeWikiSourceRecordHash, searchWikiArticles } from "./wiki";

interface ParsedArguments {
  positional: string[];
  flags: Record<string, string | boolean>;
}

interface IngestionProposal {
  retainSourceFile: boolean;
  referenceFileReason: string;
  articles: Array<{
    slug: string;
    title: string;
    summary: string;
    body: string;
    category: WikiCategory;
    kind: WikiArticleKind;
    scope: WikiArticleScope;
    relationships: WikiArticleRelationship[];
    audience: string[];
    authority: WikiAuthority;
    aliases: string[];
    tags: string[];
    links: string[];
    owner?: string;
  }>;
  uncertainties: string[];
}

async function main() {
  const [command = "help", ...rawArguments] = process.argv.slice(2);
  const args = parseArguments(rawArguments);
  const workspacePath = resolveWikiWorkspace(stringFlag(args, "workspace"));

  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }
  if (command === "init") {
    await initializeWikiWorkspace(workspacePath, stringFlag(args, "server") || "http://localhost:3001");
    const remote = stringFlag(args, "remote");
    if (remote) await configureWikiGitRemote(workspacePath, remote);
    text(`Initialized private wiki workspace at ${workspacePath}`);
    if (remote) text(`Configured private wiki Git origin: ${remote}`);
    return;
  }

  await initializeWikiWorkspace(workspacePath);
  if (command === "pull") return pullWorkspace(workspacePath, Boolean(args.flags["prefer-local"]));
  if (command === "validate") return validateWorkspace(workspacePath);
  if (command === "format") return formatWorkspace(workspacePath);
  if (command === "diff" || command === "status") return showDiff(workspacePath);
  if (command === "push") return pushWorkspace(workspacePath, Boolean(args.flags["dry-run"]));
  if (command === "deploy") {
    return deployCanonicalWorkspace(
      workspacePath,
      Boolean(args.flags["dry-run"]),
      Boolean(args.flags["confirm-authoritative"])
    );
  }
  if (command === "sync") {
    await pullWorkspace(workspacePath);
    await validateWorkspace(workspacePath);
    return pushWorkspace(workspacePath, Boolean(args.flags["dry-run"]));
  }
  if (command === "ingest") return ingestSources(workspacePath, args);
  if (command === "publish") return publishArticle(workspacePath, args);
  if (command === "review") return markArticleForReview(workspacePath, args);
  throw new Error(`Unknown wiki command: ${command}`);
}

async function pullWorkspace(workspacePath: string, preferLocal = false): Promise<void> {
  const config = await readWikiWorkspaceConfig(workspacePath);
  const remote = await wikiRequest<WikiExportBundle>(workspacePath, config.serverUrl, "/api/wiki/export");
  const local = await readWikiWorkspace(workspacePath);
  const syncState = await readWikiSyncState(workspacePath);
  const remoteArticleHashes = Object.fromEntries(remote.articles.map((article) => [article.slug, article.contentHash]));
  const remoteSourceHashes = Object.fromEntries(remote.sources.map((source) => [source.id, computeWikiSourceRecordHash(source)]));
  const conflicts: string[] = [];

  for (const article of local.articles) {
    const baseHash = syncState.articleHashes[article.slug];
    const remoteHash = remoteArticleHashes[article.slug];
    const locallyChanged = Boolean(baseHash && article.contentHash !== baseHash) || (!baseHash && !remoteHash);
    const remotelyChanged = Boolean(baseHash && remoteHash !== baseHash) || Boolean(!baseHash && remoteHash);
    if (locallyChanged && remotelyChanged && article.contentHash !== remoteHash) conflicts.push(`article:${article.slug}`);
    if (baseHash && !remoteHash && article.contentHash !== baseHash) conflicts.push(`article:${article.slug} (remote deletion)`);
  }
  for (const [slug, baseHash] of Object.entries(syncState.articleHashes)) {
    if (local.articles.some((article) => article.slug === slug)) continue;
    const remoteHash = remoteArticleHashes[slug];
    if (remoteHash && remoteHash !== baseHash) conflicts.push(`article:${slug} (local deletion and remote update)`);
  }
  for (const source of local.sources) {
    const baseHash = syncState.sourceHashes[source.id];
    const remoteHash = remoteSourceHashes[source.id];
    const localHash = computeWikiSourceRecordHash(source);
    const locallyChanged = Boolean(baseHash && localHash !== baseHash) || (!baseHash && !remoteHash);
    const remotelyChanged = Boolean(baseHash && remoteHash !== baseHash) || Boolean(!baseHash && remoteHash);
    if (locallyChanged && remotelyChanged && localHash !== remoteHash) conflicts.push(`source:${source.id}`);
    if (baseHash && !remoteHash && localHash !== baseHash) conflicts.push(`source:${source.id} (remote deletion)`);
  }
  for (const [sourceId, baseHash] of Object.entries(syncState.sourceHashes)) {
    if (local.sources.some((source) => source.id === sourceId)) continue;
    const remoteHash = remoteSourceHashes[sourceId];
    if (remoteHash && remoteHash !== baseHash) conflicts.push(`source:${sourceId} (local deletion and remote update)`);
  }
  if (conflicts.length && !preferLocal) {
    await fs.writeFile(
      path.join(workspacePath, "conflicts", `pull-${Date.now()}.json`),
      `${JSON.stringify({ remoteRevision: remote.wikiRevision, conflicts, remote }, null, 2)}\n`,
      "utf8"
    );
    throw new Error(`Pull stopped because local and server content both changed:\n- ${conflicts.join("\n- ")}`);
  }

  const preferredLocalArticleSlugs = new Set(
    preferLocal
      ? conflicts.flatMap((conflict) => conflict.startsWith("article:") ? [conflict.slice("article:".length).split(" ")[0]] : [])
      : []
  );
  const preferredLocalSourceIds = new Set(
    preferLocal
      ? conflicts.flatMap((conflict) => conflict.startsWith("source:") ? [conflict.slice("source:".length).split(" ")[0]] : [])
      : []
  );

  await archiveRemoteDeletions(
    workspacePath,
    local,
    syncState,
    remoteArticleHashes,
    remoteSourceHashes,
    preferredLocalArticleSlugs,
    preferredLocalSourceIds
  );
  for (const article of remote.articles) {
    if (preferredLocalArticleSlugs.has(article.slug)) continue;
    const localArticle = local.articles.find((candidate) => candidate.slug === article.slug);
    const baseHash = syncState.articleHashes[article.slug];
    if (!localArticle && baseHash && article.contentHash === baseHash) continue;
    if (localArticle && baseHash && localArticle.contentHash !== baseHash && article.contentHash === baseHash) continue;
    await writeWikiArticleFile(workspacePath, article);
  }
  for (const source of remote.sources) {
    if (preferredLocalSourceIds.has(source.id)) continue;
    const localSource = local.sources.find((candidate) => candidate.id === source.id);
    const baseHash = syncState.sourceHashes[source.id];
    if (!localSource && baseHash && computeWikiSourceRecordHash(source) === baseHash) continue;
    if (
      localSource &&
      baseHash &&
      computeWikiSourceRecordHash(localSource) !== baseHash &&
      computeWikiSourceRecordHash(source) === baseHash
    ) continue;
    await writeWikiSourceMetadata(workspacePath, source);
  }
  for (const source of remote.sources) {
    if (source.referenceFile?.available) await downloadReferenceFile(workspacePath, config.serverUrl, source);
  }
  await writeWikiSyncState(workspacePath, {
    formatVersion: 1,
    wikiRevision: remote.wikiRevision,
    pulledAt: new Date().toISOString(),
    articleHashes: remoteArticleHashes,
    sourceHashes: remoteSourceHashes
  });
  if (preferLocal && conflicts.length) {
    await archiveResolvedConflictFiles(workspacePath, remote.wikiRevision, conflicts);
    text(`Preserved the local version of ${conflicts.length} conflicts; remote-only content was still pulled`);
  }
  text(`Pulled wiki revision ${remote.wikiRevision}: ${remote.articles.length} articles and ${remote.sources.length} sources`);
}

async function validateWorkspace(workspacePath: string): Promise<void> {
  const snapshot = await readWikiWorkspace(workspacePath);
  for (const warning of snapshot.validation.warnings) text(`warning: ${warning}`);
  for (const error of snapshot.validation.errors) text(`error: ${error}`);
  const phiFindings = snapshot.articles.flatMap((article) =>
    findExplicitPhi(`${article.title}\n${article.summary}\n${article.body}`).map((finding) => `${article.slug}: ${finding}`)
  );
  const referenceFileErrors: string[] = [];
  for (const source of snapshot.sources) {
    if (!source.referenceFile) continue;
    const original = await findMatchingOriginal(workspacePath, source);
    if (!original) referenceFileErrors.push(`${source.id}: retained reference original is missing or does not match contentHash`);
  }
  for (const finding of phiFindings) text(`error: possible PHI: ${finding}`);
  for (const error of referenceFileErrors) text(`error: ${error}`);
  if (!snapshot.validation.valid || phiFindings.length || referenceFileErrors.length) throw new Error("Wiki validation failed");
  text(`Wiki is valid: ${snapshot.articles.length} articles and ${snapshot.sources.length} sources`);
}

async function showDiff(workspacePath: string): Promise<void> {
  const snapshot = await readWikiWorkspace(workspacePath);
  const state = await readWikiSyncState(workspacePath);
  const diff = buildWorkspaceDiff(snapshot, state);
  text(`Server base revision: ${state.wikiRevision}`);
  printDiffGroup("Articles", diff.articles.create.map((item) => item.slug), diff.articles.update.map((item) => item.slug), diff.articles.delete);
  printDiffGroup("Sources", diff.sources.create.map((item) => item.id), diff.sources.update.map((item) => item.id), diff.sources.delete);
}

async function formatWorkspace(workspacePath: string): Promise<void> {
  const count = await formatWikiWorkspace(workspacePath);
  text(`Formatted ${count} wiki articles as Obsidian-compatible YAML Markdown`);
}

async function pushWorkspace(workspacePath: string, dryRun: boolean): Promise<void> {
  await assertNoConflictFiles(workspacePath);
  const config = await readWikiWorkspaceConfig(workspacePath);
  const snapshot = await readWikiWorkspace(workspacePath);
  const state = await readWikiSyncState(workspacePath);
  if (!snapshot.validation.valid) {
    for (const error of snapshot.validation.errors) text(`error: ${error}`);
    throw new Error("Fix wiki validation errors before pushing");
  }
  const diff = buildWorkspaceDiff(snapshot, state);
  const payload = {
    baseRevision: state.wikiRevision,
    articles: [...diff.articles.create, ...diff.articles.update],
    sources: [...diff.sources.create, ...diff.sources.update],
    deleteArticles: diff.articles.delete,
    deleteSources: diff.sources.delete
  };
  const preview = await wikiRequest<{
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    summary: { created: number; updated: number; deleted: number };
    currentRevision: number;
  }>(workspacePath, config.serverUrl, "/api/wiki/sync/preview", { method: "POST", body: JSON.stringify(payload) });
  for (const warning of preview.validation.warnings) text(`warning: ${warning}`);
  if (!preview.validation.valid) throw new Error(preview.validation.errors.join("; "));
  text(`Preview: ${preview.summary.created} create, ${preview.summary.updated} update, ${preview.summary.deleted} delete`);
  if (dryRun) {
    text("Dry run only; nothing was changed on the server");
    return;
  }
  const applied = await wikiRequest<{ applied: boolean; wikiRevision: number }>(
    workspacePath,
    config.serverUrl,
    "/api/wiki/sync/apply",
    { method: "POST", body: JSON.stringify(payload) }
  );
  text(applied.applied ? `Applied server wiki revision ${applied.wikiRevision}` : "Server wiki already matches the workspace");
  await uploadReferenceFiles(workspacePath, config.serverUrl, snapshot.sources);
  await pullWorkspace(workspacePath);
}

async function deployCanonicalWorkspace(
  workspacePath: string,
  dryRun: boolean,
  confirmAuthoritative: boolean
): Promise<void> {
  await assertNoConflictFiles(workspacePath);
  await validateWorkspace(workspacePath);
  const config = await readWikiWorkspaceConfig(workspacePath);
  const snapshot = await readWikiWorkspace(workspacePath);
  const remote = await wikiRequest<WikiExportBundle>(workspacePath, config.serverUrl, "/api/wiki/export");
  const payload = buildCanonicalWikiSyncPayload(snapshot, remote);
  const preview = await wikiRequest<{
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    summary: { created: number; updated: number; deleted: number };
  }>(workspacePath, config.serverUrl, "/api/wiki/sync/preview", { method: "POST", body: JSON.stringify(payload) });
  for (const warning of preview.validation.warnings) text(`warning: ${warning}`);
  if (!preview.validation.valid) throw new Error(preview.validation.errors.join("; "));
  text(`Canonical preview: ${preview.summary.created} create, ${preview.summary.updated} update, ${preview.summary.deleted} delete`);
  if (dryRun) {
    text("Dry run only; the canonical vault was not deployed");
    return;
  }
  if (!confirmAuthoritative) {
    throw new Error("Canonical deployment requires --confirm-authoritative after reviewing a dry run");
  }
  const applied = await wikiRequest<{ applied: boolean; wikiRevision: number }>(
    workspacePath,
    config.serverUrl,
    "/api/wiki/sync/apply",
    { method: "POST", body: JSON.stringify(payload) }
  );
  await uploadReferenceFiles(workspacePath, config.serverUrl, snapshot.sources, false);
  await writeWikiSyncState(workspacePath, {
    formatVersion: 1,
    wikiRevision: applied.wikiRevision,
    pulledAt: new Date().toISOString(),
    articleHashes: Object.fromEntries(snapshot.articles.map((article) => [article.slug, article.contentHash])),
    sourceHashes: Object.fromEntries(snapshot.sources.map((source) => [source.id, computeWikiSourceRecordHash(source)]))
  });
  text(applied.applied
    ? `Deployed canonical vault as server wiki revision ${applied.wikiRevision}`
    : `Server already matches canonical vault at wiki revision ${applied.wikiRevision}`);
}

async function ingestSources(workspacePath: string, args: ParsedArguments): Promise<void> {
  if (!args.positional.length) throw new Error("Provide one or more source files to ingest");
  const sourceType = (stringFlag(args, "source-type") || "document") as WikiSourceType;
  if (!(WIKI_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    throw new Error(`Invalid --source-type. Use one of: ${WIKI_SOURCE_TYPES.join(", ")}`);
  }
  if (args.flags["reference-file"] && args.flags["knowledge-only"]) {
    throw new Error("Use either --reference-file or --knowledge-only, not both");
  }
  for (const file of args.positional) {
    const filePath = path.resolve(file);
    const fileStats = await fs.stat(filePath);
    const forcedReferenceFile = Boolean(args.flags["reference-file"]);
    const staged = await stageWikiSource(workspacePath, filePath, {
      title: stringFlag(args, "title"),
      sourceType,
      author: stringFlag(args, "author"),
      origin: stringFlag(args, "origin"),
      effectiveDate: stringFlag(args, "effective-date"),
      referenceFile: forcedReferenceFile ? describeWikiReferenceFile(filePath, fileStats.size) : undefined,
      notes: stringFlag(args, "notes")
    });
    const phiFindings = findExplicitPhi(staged.extractedText);
    if (phiFindings.length) {
      throw new Error(`${file}: possible PHI detected (${phiFindings.join(", ")}); source was staged locally but was not sent to a model`);
    }
    const shouldUseAi = !args.flags["no-ai"] && Boolean(process.env.OPENAI_API_KEY);
    if (!shouldUseAi) {
      const jobPath = path.join(workspacePath, "proposals", `${staged.source.id}.ingestion.json`);
      await fs.writeFile(jobPath, `${JSON.stringify({
        sourceId: staged.source.id,
        extractedTextPath: path.relative(workspacePath, path.join(staged.sourceDirectory, "extracted.txt")),
        instructions: "Have an authorized agent extract factual draft articles and decide whether the original is useful as a resident-downloadable reference. Apply source notes as binding scope and organization instructions. Every proposed article must use structured kind, scope, relationships, source locators, and remain draft until reviewed.",
        retainSourceFile: staged.source.referenceFile ? true : undefined,
        sourceNotes: staged.source.notes
      }, null, 2)}\n`, "utf8");
      text(`Staged ${file} as ${staged.source.id}; ingestion job: ${jobPath}`);
      continue;
    }
    const existing = await readWikiWorkspace(workspacePath);
    const relatedArticles = searchWikiArticles(
      existing.articles,
      [staged.source.title, staged.source.author, staged.source.notes].filter(Boolean).join(" "),
      12,
      true
    );
    const proposal = await callIngestionModel(
      staged.source.id,
      staged.source.title,
      staged.source.notes,
      staged.extractedText,
      relatedArticles
    );
    const retainSourceFile = forcedReferenceFile || (!args.flags["knowledge-only"] && proposal.retainSourceFile);
    if (retainSourceFile && !staged.source.referenceFile) {
      staged.source.referenceFile = describeWikiReferenceFile(filePath, fileStats.size);
      staged.source.updatedAt = new Date().toISOString();
      staged.source.updatedBy = "ingestion-agent";
      await writeWikiSourceMetadata(workspacePath, staged.source);
    }
    text(retainSourceFile
      ? `Reference file retained: ${proposal.referenceFileReason}`
      : `Knowledge-only source: ${proposal.referenceFileReason}`);
    for (const proposed of proposal.articles) {
      const article = createDraftArticle(proposed, staged.source.id);
      if (existing.articles.some((candidate) => candidate.slug === article.slug)) {
        const proposalPath = path.join(workspacePath, "proposals", `${article.slug}-${Date.now()}.json`);
        await fs.writeFile(proposalPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
        text(`Existing article ${article.slug} was not overwritten; proposal saved to ${proposalPath}`);
      } else {
        const articlePath = await writeWikiArticleFile(workspacePath, article);
        text(`Created draft ${article.slug}: ${articlePath}`);
      }
    }
    for (const uncertainty of proposal.uncertainties) text(`review: ${uncertainty}`);
  }
}

async function markArticleForReview(workspacePath: string, args: ParsedArguments): Promise<void> {
  const slug = normalizeSlugArgument(args);
  const snapshot = await readWikiWorkspace(workspacePath);
  const article = snapshot.articles.find((candidate) => candidate.slug === slug);
  if (!article) throw new Error(`Article not found: ${slug}`);
  const updated = { ...article, status: "review" as const, updatedAt: new Date().toISOString(), updatedBy: "local-review" };
  await writeWikiArticleFile(workspacePath, updated);
  text(`Marked ${slug} ready for review`);
}

async function publishArticle(workspacePath: string, args: ParsedArguments): Promise<void> {
  const slug = normalizeSlugArgument(args);
  const snapshot = await readWikiWorkspace(workspacePath);
  const article = snapshot.articles.find((candidate) => candidate.slug === slug);
  if (!article) throw new Error(`Article not found: ${slug}`);
  const reviewer = stringFlag(args, "reviewer") || article.reviewedBy;
  const owner = stringFlag(args, "owner") || article.owner;
  const reviewedAt = stringFlag(args, "reviewed-at") || new Date().toISOString().slice(0, 10);
  const reviewDueAt = stringFlag(args, "review-due") || article.reviewDueAt;
  if (!reviewer || !owner) throw new Error("Publishing requires --reviewer and --owner");
  if (!article.sourceRefs.length && article.authority !== "program-reference" && article.authority !== "workflow") {
    throw new Error("Clinical knowledge requires at least one source reference before publication");
  }
  const updated: WikiArticle = {
    ...article,
    status: "published",
    owner,
    reviewedBy: reviewer,
    reviewedAt,
    reviewDueAt,
    updatedAt: new Date().toISOString(),
    updatedBy: reviewer,
    contentHash: article.contentHash
  };
  await writeWikiArticleFile(workspacePath, updated);
  const nextSnapshot = await readWikiWorkspace(workspacePath);
  const error = nextSnapshot.validation.errors.find((candidate) => candidate.startsWith(`${slug}:`));
  if (error) throw new Error(error);
  text(`Published ${slug} locally; run validate, diff, and push to publish it on the server`);
}

async function callIngestionModel(
  sourceId: string,
  sourceTitle: string,
  sourceNotes: string | undefined,
  sourceText: string,
  relatedArticles: Array<Pick<WikiArticle, "slug" | "title" | "summary" | "category" | "kind">>
): Promise<IngestionProposal> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for agentic ingestion");
  const model = process.env.WIKI_INGEST_MODEL || "gpt-5.6-terra";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 8000,
      input: [
        {
          role: "developer",
          content: `You are a careful residency knowledge-base ingestion editor. Extract only facts explicitly supported by the source. Do not invent clinical details, contacts, orders, preferences, scope, or exceptions. Treat source notes as binding organization and applicability instructions supplied by the authorized editor. Split content into coherent articles: attending profiles are hubs; operative cards and note templates are procedure-level leaves; perioperative management is separated by procedure/service and phase; variants should point to a base article and state only meaningful differences when possible. Repeated attending-wide facts belong in one shared article. Preserve routine versus PRN, policy versus preference, uncertainty, conflicts, and “ask” instructions. Add structured kind, scope, audience, and typed relationships. Use relationships to connect leaves to attending/service hubs, shared preferences, governing policies, workflows, and variants. Decide whether the original file should remain downloadable: retain manuals, forms, handouts, checklists, mobile/setup guides, official policies, or other documents residents may need verbatim; use knowledge-only for documents whose durable value is fully captured by concise articles. This decision does not replace knowledge extraction—the wiki should still answer questions about retained files. Do not overwrite or duplicate a related existing article; link to it or propose a narrowly scoped supplement. All articles are drafts and must cite source ${sourceId}. Use concise Markdown headings. Never include PHI.`
        },
        {
          role: "user",
          content: `Source title: ${sourceTitle}\nSource id: ${sourceId}\nSource notes: ${sourceNotes || "none"}\n\nRelated existing wiki articles (link or supplement; do not replace silently):\n${relatedArticles.map((article) => `- ${article.slug} | ${article.title} | ${article.kind || article.category} | ${article.summary}`).join("\n") || "none"}\n\nSource text:\n${sourceText.slice(0, 120_000)}`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "wiki_ingestion_proposal",
          strict: true,
          schema: INGESTION_SCHEMA
        }
      }
    })
  });
  const payload = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI ingestion failed: ${response.status}`);
  const outputText = payload.output_text || payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
  if (!outputText) throw new Error("The ingestion model returned no proposal");
  return JSON.parse(outputText) as IngestionProposal;
}

async function wikiRequest<T>(
  workspacePath: string,
  serverUrl: string,
  endpoint: string,
  init: RequestInit = {}
): Promise<T> {
  const apiKey = process.env.WIKI_API_KEY || process.env.ADMIN_API_KEY || await readLocalApiKey(workspacePath);
  const bearer = process.env.WIKI_BEARER_TOKEN;
  if (!apiKey && !bearer) throw new Error("Set WIKI_API_KEY, ADMIN_API_KEY, or WIKI_BEARER_TOKEN");
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("x-api-key", apiKey);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${serverUrl}${endpoint}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Wiki API request failed: ${response.status}`);
  return payload;
}

async function uploadReferenceFiles(
  workspacePath: string,
  serverUrl: string,
  sources: WikiSource[],
  persistServerMetadata = true
): Promise<void> {
  for (const source of sources) {
    if (!source.referenceFile) continue;
    const originalPath = await findMatchingOriginal(workspacePath, source);
    if (!originalPath) throw new Error(`${source.id}: retained reference file is missing or does not match contentHash`);
    const data = await fs.readFile(originalPath);
    const apiKey = process.env.WIKI_API_KEY || process.env.ADMIN_API_KEY || await readLocalApiKey(workspacePath);
    const bearer = process.env.WIKI_BEARER_TOKEN;
    if (!apiKey && !bearer) throw new Error("Set WIKI_API_KEY, ADMIN_API_KEY, or WIKI_BEARER_TOKEN");
    const headers = new Headers({
      "content-type": source.referenceFile.mediaType,
      "x-wiki-filename": encodeURIComponent(source.referenceFile.filename)
    });
    if (apiKey) headers.set("x-api-key", apiKey);
    if (bearer) headers.set("authorization", `Bearer ${bearer}`);
    const response = await fetch(`${serverUrl}/api/wiki/sources/${encodeURIComponent(source.id)}/file`, {
      method: "PUT",
      headers,
      body: data
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; source?: WikiSource };
    if (!response.ok) throw new Error(payload.error || `Reference-file upload failed: ${response.status}`);
    if (persistServerMetadata && payload.source) await writeWikiSourceMetadata(workspacePath, payload.source);
    text(`Uploaded reference file: ${source.referenceFile.filename}`);
  }
}

async function downloadReferenceFile(workspacePath: string, serverUrl: string, source: WikiSource): Promise<void> {
  if (!source.referenceFile?.available) return;
  const existing = await findMatchingOriginal(workspacePath, source);
  if (existing) return;
  const apiKey = process.env.WIKI_API_KEY || process.env.ADMIN_API_KEY || await readLocalApiKey(workspacePath);
  const bearer = process.env.WIKI_BEARER_TOKEN;
  if (!apiKey && !bearer) throw new Error("Set WIKI_API_KEY, ADMIN_API_KEY, or WIKI_BEARER_TOKEN");
  const headers = new Headers();
  if (apiKey) headers.set("x-api-key", apiKey);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  const response = await fetch(`${serverUrl}/api/wiki/sources/${encodeURIComponent(source.id)}/file`, { headers });
  if (!response.ok) throw new Error(`${source.id}: server reference-file download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (computeWikiSourceHash(data) !== source.contentHash) throw new Error(`${source.id}: downloaded reference file failed hash verification`);
  const sourceDirectory = path.join(workspacePath, "sources", source.id);
  await fs.mkdir(sourceDirectory, { recursive: true });
  const extension = path.extname(source.referenceFile.filename).toLowerCase();
  await fs.writeFile(path.join(sourceDirectory, `original${extension || ".bin"}`), data, { mode: 0o600 });
  text(`Downloaded reference file: ${source.referenceFile.filename}`);
}

async function findMatchingOriginal(workspacePath: string, source: WikiSource): Promise<string | undefined> {
  const sourceDirectory = path.join(workspacePath, "sources", source.id);
  let names: string[];
  try {
    names = (await fs.readdir(sourceDirectory)).filter((name) => name.startsWith("original."));
  } catch {
    return undefined;
  }
  for (const name of names) {
    const filePath = path.join(sourceDirectory, name);
    const data = await fs.readFile(filePath);
    if (data.byteLength === source.referenceFile?.byteSize && computeWikiSourceHash(data) === source.contentHash) return filePath;
  }
  return undefined;
}

async function archiveRemoteDeletions(
  workspacePath: string,
  local: Awaited<ReturnType<typeof readWikiWorkspace>>,
  syncState: Awaited<ReturnType<typeof readWikiSyncState>>,
  remoteArticleHashes: Record<string, string>,
  remoteSourceHashes: Record<string, string>,
  preserveArticleSlugs = new Set<string>(),
  preserveSourceIds = new Set<string>()
) {
  const archiveDirectory = path.join(workspacePath, "archive", "remote-deleted", new Date().toISOString().slice(0, 10));
  await fs.mkdir(archiveDirectory, { recursive: true });
  for (const article of local.articles) {
    if (preserveArticleSlugs.has(article.slug)) continue;
    if (!syncState.articleHashes[article.slug] || remoteArticleHashes[article.slug]) continue;
    const sourcePath = path.join(workspacePath, "articles", article.category, `${article.slug}.md`);
    await moveIfPresent(sourcePath, path.join(archiveDirectory, `${article.slug}.md`));
  }
  for (const source of local.sources) {
    if (preserveSourceIds.has(source.id)) continue;
    if (!syncState.sourceHashes[source.id] || remoteSourceHashes[source.id]) continue;
    const sourcePath = path.join(workspacePath, "sources", source.id, "metadata.json");
    await moveIfPresent(sourcePath, path.join(archiveDirectory, `${source.id}.metadata.json`));
  }
}

async function archiveResolvedConflictFiles(
  workspacePath: string,
  remoteRevision: number,
  conflicts: string[]
): Promise<void> {
  const conflictDirectory = path.join(workspacePath, "conflicts");
  const archiveDirectory = path.join(workspacePath, "archive", "conflicts-resolved", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(archiveDirectory, { recursive: true });
  const entries = await fs.readdir(conflictDirectory);
  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    await fs.rename(path.join(conflictDirectory, entry), path.join(archiveDirectory, entry));
  }
  await fs.writeFile(path.join(archiveDirectory, "resolution.json"), `${JSON.stringify({
    strategy: "prefer-local",
    remoteRevision,
    conflicts,
    resolvedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
}

async function moveIfPresent(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertNoConflictFiles(workspacePath: string): Promise<void> {
  const entries = await fs.readdir(path.join(workspacePath, "conflicts"));
  const conflicts = entries.filter((entry) => entry !== ".gitkeep");
  if (conflicts.length) throw new Error(`Resolve and remove conflict files before pushing: ${conflicts.join(", ")}`);
}

async function readLocalApiKey(workspacePath: string): Promise<string | undefined> {
  try {
    const value = (await fs.readFile(path.join(workspacePath, ".wiki-api-key"), "utf8")).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function printDiffGroup(label: string, creates: string[], updates: string[], deletes: string[]) {
  text(`${label}: ${creates.length} create, ${updates.length} update, ${deletes.length} delete`);
  for (const item of creates) text(`  + ${item}`);
  for (const item of updates) text(`  ~ ${item}`);
  for (const item of deletes) text(`  - ${item}`);
}

function parseArguments(args: string[]): ParsedArguments {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

function stringFlag(args: ParsedArguments, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSlugArgument(args: ParsedArguments): string {
  const value = args.positional[0];
  if (!value) throw new Error("Provide an article slug");
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function text(value: string) {
  process.stdout.write(`${value}\n`);
}

function showHelp() {
  text(`Private residency wiki workflow

Usage:
  npm run wiki -- init [--server URL] [--workspace PATH] [--remote GIT_URL]
  npm run wiki -- pull [--prefer-local]
  npm run wiki -- ingest FILE... [--source-type TYPE] [--author NAME] [--reference-file|--knowledge-only] [--no-ai]
  npm run wiki -- validate
  npm run wiki -- format
  npm run wiki -- diff
  npm run wiki -- review SLUG
  npm run wiki -- publish SLUG --reviewer NAME --owner NAME [--review-due YYYY-MM-DD]
  npm run wiki -- push [--dry-run]
  npm run wiki -- deploy [--dry-run|--confirm-authoritative]
  npm run wiki -- sync [--dry-run]

Environment:
  WIKI_WORKSPACE_PATH   Private local workspace; defaults to .wiki-workspace
  WIKI_BASE_URL         Server URL override
  WIKI_API_KEY          Admin API key used for sync
  WIKI_BEARER_TOKEN     Optional admin browser token instead of an API key
  OPENAI_API_KEY        Enables agentic ingestion
  WIKI_INGEST_MODEL     Optional ingestion model override

Commands:
  format                 Rewrite legacy JSON frontmatter as readable YAML
  push                   Two-way authoring sync using the last pulled revision
  deploy                 Make this vault authoritative; live deployment requires --confirm-authoritative
  pull --prefer-local     Preserve local versions of conflicts while importing remote-only content
`);
}

const INGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["retainSourceFile", "referenceFileReason", "articles", "uncertainties"],
  properties: {
    retainSourceFile: { type: "boolean" },
    referenceFileReason: { type: "string" },
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "title", "summary", "body", "category", "kind", "scope", "relationships", "audience", "authority", "aliases", "tags", "links", "owner"],
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          body: { type: "string" },
          category: { type: "string", enum: WIKI_CATEGORIES },
          kind: { type: "string", enum: WIKI_ARTICLE_KINDS },
          scope: {
            type: "object",
            additionalProperties: false,
            required: ["services", "attendings", "procedures", "hospitals", "phases", "patientPopulations"],
            properties: {
              services: { type: "array", items: { type: "string" } },
              attendings: { type: "array", items: { type: "string" } },
              procedures: { type: "array", items: { type: "string" } },
              hospitals: { type: "array", items: { type: "string" } },
              phases: { type: "array", items: { type: "string", enum: WIKI_CLINICAL_PHASES } },
              patientPopulations: { type: "array", items: { type: "string" } }
            }
          },
          relationships: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "target", "note"],
              properties: {
                type: { type: "string", enum: WIKI_RELATIONSHIP_TYPES },
                target: { type: "string" },
                note: { type: ["string", "null"] }
              }
            }
          },
          audience: { type: "array", items: { type: "string" } },
          authority: { type: "string", enum: WIKI_AUTHORITIES },
          aliases: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          links: { type: "array", items: { type: "string" } },
          owner: { type: ["string", "null"] }
        }
      }
    },
    uncertainties: { type: "array", items: { type: "string" } }
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

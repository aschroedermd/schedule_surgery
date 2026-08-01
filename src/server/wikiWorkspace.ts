import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import {
  WikiArticle,
  WikiAuthority,
  WikiCategory,
  WikiSource,
  WikiSourceType,
  WikiStatus
} from "../shared/types";
import {
  computeWikiSourceRecordHash,
  computeWikiSourceHash,
  normalizeWikiArticles,
  normalizeWikiSlug,
  normalizeWikiSources,
  validateWikiKnowledgeBase
} from "./wiki";

const execFile = promisify(execFileCallback);
const WORKSPACE_FORMAT_VERSION = 1;
const FRONTMATTER_BOUNDARY = "---";

export interface WikiWorkspaceConfig {
  formatVersion: number;
  serverUrl: string;
  articleDirectory: string;
  sourceDirectory: string;
}

export interface WikiWorkspaceSyncState {
  formatVersion: number;
  wikiRevision: number;
  pulledAt: string;
  articleHashes: Record<string, string>;
  sourceHashes: Record<string, string>;
}

export interface WikiExportBundle {
  formatVersion: number;
  wikiRevision: number;
  exportedAt: string;
  articles: WikiArticle[];
  sources: WikiSource[];
}

export interface WikiWorkspaceSnapshot {
  articles: WikiArticle[];
  sources: WikiSource[];
  validation: ReturnType<typeof validateWikiKnowledgeBase>;
}

export function resolveWikiWorkspace(input?: string): string {
  return path.resolve(input || process.env.WIKI_WORKSPACE_PATH || ".wiki-workspace");
}

export async function initializeWikiWorkspace(workspacePath: string, serverUrl = "http://localhost:3001"): Promise<void> {
  const directories = [
    "articles",
    "sources",
    "inbox",
    "proposals",
    "conflicts",
    "archive/remote-deleted",
    "templates"
  ];
  await Promise.all(directories.map((directory) => fs.mkdir(path.join(workspacePath, directory), { recursive: true })));
  await writeIfMissing(path.join(workspacePath, ".gitignore"), [
    ".DS_Store",
    "inbox/*",
    "!inbox/.gitkeep",
    "sources/**/original.*",
    "sources/**/extracted.txt",
    "conflicts/*",
    "!conflicts/.gitkeep",
    ".wiki-api-key",
    ""
  ].join("\n"));
  await writeIfMissing(path.join(workspacePath, "inbox/.gitkeep"), "");
  await writeIfMissing(path.join(workspacePath, "conflicts/.gitkeep"), "");
  await writeIfMissing(path.join(workspacePath, "wiki.config.json"), `${JSON.stringify({
    formatVersion: WORKSPACE_FORMAT_VERSION,
    serverUrl,
    articleDirectory: "articles",
    sourceDirectory: "sources"
  } satisfies WikiWorkspaceConfig, null, 2)}\n`);
  await writeIfMissing(path.join(workspacePath, "README.md"), WORKSPACE_README);
  await writeIfMissing(path.join(workspacePath, "templates/attending-procedure.md"), ATTENDING_PROCEDURE_TEMPLATE);
  await writeIfMissing(path.join(workspacePath, "templates/workflow.md"), WORKFLOW_TEMPLATE);
  try {
    await fs.access(path.join(workspacePath, ".git"));
  } catch {
    await execFile("git", ["init"], { cwd: workspacePath });
  }
}

export async function readWikiWorkspaceConfig(workspacePath: string): Promise<WikiWorkspaceConfig> {
  const raw = await fs.readFile(path.join(workspacePath, "wiki.config.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<WikiWorkspaceConfig>;
  return {
    formatVersion: parsed.formatVersion ?? WORKSPACE_FORMAT_VERSION,
    serverUrl: String(process.env.WIKI_BASE_URL || parsed.serverUrl || "http://localhost:3001").replace(/\/$/, ""),
    articleDirectory: parsed.articleDirectory || "articles",
    sourceDirectory: parsed.sourceDirectory || "sources"
  };
}

export async function readWikiWorkspace(workspacePath: string): Promise<WikiWorkspaceSnapshot> {
  const config = await readWikiWorkspaceConfig(workspacePath);
  const articleFiles = await findFiles(path.join(workspacePath, config.articleDirectory), (file) => file.endsWith(".md"));
  const articles = normalizeWikiArticles(
    await Promise.all(articleFiles.map((file) => readWikiArticleFile(file)))
  );
  const sourceFiles = await findFiles(
    path.join(workspacePath, config.sourceDirectory),
    (file) => path.basename(file) === "metadata.json"
  );
  const sources = normalizeWikiSources(
    await Promise.all(sourceFiles.map(async (file) => JSON.parse(await fs.readFile(file, "utf8")) as WikiSource))
  );
  return { articles, sources, validation: validateWikiKnowledgeBase(articles, sources) };
}

export async function readWikiArticleFile(filePath: string): Promise<WikiArticle> {
  const raw = await fs.readFile(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${filePath}: expected JSON frontmatter between --- markers`);
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(match[1]) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON frontmatter: ${error instanceof Error ? error.message : "parse error"}`);
  }
  const now = new Date().toISOString();
  const slug = normalizeWikiSlug(String(metadata.slug || path.basename(filePath, ".md")));
  const article = normalizeWikiArticles([{
    id: String(metadata.id || `wiki_${slug.replace(/-/g, "_")}`),
    slug,
    title: String(metadata.title || slug),
    summary: String(metadata.summary || "Draft article"),
    body: match[2].trim(),
    category: String(metadata.category || "program") as WikiCategory,
    aliases: asStringArray(metadata.aliases),
    tags: asStringArray(metadata.tags),
    links: asStringArray(metadata.links),
    status: String(metadata.status || "draft") as WikiStatus,
    authority: String(metadata.authority || "program-reference") as WikiAuthority,
    revision: positiveInteger(metadata.revision) ?? 1,
    contentHash: String(metadata.contentHash || ""),
    sourceRefs: Array.isArray(metadata.sourceRefs)
      ? metadata.sourceRefs as WikiArticle["sourceRefs"]
      : [],
    owner: optionalString(metadata.owner),
    reviewedBy: optionalString(metadata.reviewedBy),
    reviewedAt: optionalString(metadata.reviewedAt),
    reviewDueAt: optionalString(metadata.reviewDueAt),
    supersedes: asStringArray(metadata.supersedes),
    createdAt: optionalString(metadata.createdAt) || now,
    updatedAt: optionalString(metadata.updatedAt) || now,
    updatedBy: optionalString(metadata.updatedBy)
  }])[0];
  if (!article) throw new Error(`${filePath}: article metadata is incomplete`);
  return article;
}

export async function writeWikiArticleFile(workspacePath: string, article: WikiArticle): Promise<string> {
  const normalized = normalizeWikiArticles([article])[0];
  if (!normalized) throw new Error(`Invalid wiki article: ${article.slug}`);
  const directory = path.join(workspacePath, "articles", normalized.category);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${normalized.slug}.md`);
  const priorFiles = await findFiles(
    path.join(workspacePath, "articles"),
    (candidate) => path.basename(candidate) === `${normalized.slug}.md`
  );
  await Promise.all(priorFiles.filter((candidate) => candidate !== filePath).map((candidate) => fs.unlink(candidate)));
  const metadata = {
    id: normalized.id,
    slug: normalized.slug,
    title: normalized.title,
    summary: normalized.summary,
    category: normalized.category,
    status: normalized.status,
    authority: normalized.authority,
    aliases: normalized.aliases,
    tags: normalized.tags,
    links: normalized.links,
    sourceRefs: normalized.sourceRefs,
    owner: normalized.owner,
    reviewedBy: normalized.reviewedBy,
    reviewedAt: normalized.reviewedAt,
    reviewDueAt: normalized.reviewDueAt,
    supersedes: normalized.supersedes,
    revision: normalized.revision,
    contentHash: normalized.contentHash,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    updatedBy: normalized.updatedBy
  };
  await fs.writeFile(
    filePath,
    `${FRONTMATTER_BOUNDARY}\n${JSON.stringify(removeUndefined(metadata), null, 2)}\n${FRONTMATTER_BOUNDARY}\n\n${normalized.body.trim()}\n`,
    "utf8"
  );
  return filePath;
}

export async function writeWikiSourceMetadata(workspacePath: string, source: WikiSource): Promise<string> {
  const normalized = normalizeWikiSources([source])[0];
  if (!normalized) throw new Error(`Invalid wiki source: ${source.id}`);
  const directory = path.join(workspacePath, "sources", normalized.id);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "metadata.json");
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeWikiExport(workspacePath: string, bundle: WikiExportBundle): Promise<void> {
  for (const article of bundle.articles) await writeWikiArticleFile(workspacePath, article);
  for (const source of bundle.sources) await writeWikiSourceMetadata(workspacePath, source);
  await writeWikiSyncState(workspacePath, {
    formatVersion: WORKSPACE_FORMAT_VERSION,
    wikiRevision: bundle.wikiRevision,
    pulledAt: new Date().toISOString(),
    articleHashes: Object.fromEntries(bundle.articles.map((article) => [article.slug, article.contentHash])),
    sourceHashes: Object.fromEntries(bundle.sources.map((source) => [source.id, computeWikiSourceRecordHash(source)]))
  });
}

export async function readWikiSyncState(workspacePath: string): Promise<WikiWorkspaceSyncState> {
  try {
    return JSON.parse(await fs.readFile(path.join(workspacePath, ".wiki-sync.json"), "utf8")) as WikiWorkspaceSyncState;
  } catch {
    return {
      formatVersion: WORKSPACE_FORMAT_VERSION,
      wikiRevision: 0,
      pulledAt: new Date(0).toISOString(),
      articleHashes: {},
      sourceHashes: {}
    };
  }
}

export async function writeWikiSyncState(workspacePath: string, state: WikiWorkspaceSyncState): Promise<void> {
  await fs.writeFile(path.join(workspacePath, ".wiki-sync.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function buildWorkspaceDiff(snapshot: WikiWorkspaceSnapshot, state: WikiWorkspaceSyncState) {
  const articleHashes = Object.fromEntries(snapshot.articles.map((article) => [article.slug, article.contentHash]));
  const sourceHashes = Object.fromEntries(snapshot.sources.map((source) => [source.id, computeWikiSourceRecordHash(source)]));
  return {
    articles: {
      create: snapshot.articles.filter((article) => !state.articleHashes[article.slug]),
      update: snapshot.articles.filter((article) => state.articleHashes[article.slug] && state.articleHashes[article.slug] !== article.contentHash),
      delete: Object.keys(state.articleHashes).filter((slug) => !articleHashes[slug])
    },
    sources: {
      create: snapshot.sources.filter((source) => !state.sourceHashes[source.id]),
      update: snapshot.sources.filter((source) => state.sourceHashes[source.id] && state.sourceHashes[source.id] !== computeWikiSourceRecordHash(source)),
      delete: Object.keys(state.sourceHashes).filter((id) => !sourceHashes[id])
    }
  };
}

export async function extractSourceText(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  if ([".txt", ".md", ".json", ".csv", ".yaml", ".yml"].includes(extension)) {
    return fs.readFile(filePath, "utf8");
  }
  if (extension === ".docx") {
    const { stdout } = await execFile("unzip", ["-p", filePath, "word/document.xml"], { maxBuffer: 20 * 1024 * 1024 });
    return decodeXmlText(stdout);
  }
  if (extension === ".pdf") {
    const { stdout } = await execFile("pdftotext", [filePath, "-"], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  }
  throw new Error(`Unsupported source format: ${extension || "no extension"}. Use PDF, DOCX, TXT, Markdown, JSON, CSV, or YAML.`);
}

export async function stageWikiSource(
  workspacePath: string,
  filePath: string,
  metadata: Partial<Pick<WikiSource, "title" | "sourceType" | "author" | "origin" | "effectiveDate" | "notes">> = {}
): Promise<{ source: WikiSource; extractedText: string; sourceDirectory: string }> {
  const data = await fs.readFile(filePath);
  const contentHash = computeWikiSourceHash(data);
  const baseSlug = normalizeWikiSlug(path.basename(filePath, path.extname(filePath))) || "source";
  const sourceId = `src-${baseSlug}-${contentHash.slice(0, 10)}`;
  const now = new Date().toISOString();
  const source = normalizeWikiSources([{
    id: sourceId,
    title: metadata.title || path.basename(filePath),
    sourceType: metadata.sourceType || "document",
    author: metadata.author,
    origin: metadata.origin || path.basename(filePath),
    capturedAt: now,
    effectiveDate: metadata.effectiveDate,
    contentHash,
    notes: metadata.notes,
    createdAt: now,
    updatedAt: now,
    updatedBy: "local-ingestion"
  }])[0];
  if (!source) throw new Error(`Unable to create source record for ${filePath}`);
  const sourceDirectory = path.join(workspacePath, "sources", source.id);
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.copyFile(filePath, path.join(sourceDirectory, `original${path.extname(filePath).toLowerCase()}`));
  const extractedText = await extractSourceText(filePath);
  await fs.writeFile(path.join(sourceDirectory, "extracted.txt"), extractedText, "utf8");
  await writeWikiSourceMetadata(workspacePath, source);
  return { source, extractedText, sourceDirectory };
}

export function findExplicitPhi(text: string): string[] {
  const findings: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["labeled patient name", /\bpatient name\s*[:#-]\s*\S+/i],
    ["labeled medical record number", /\b(?:mrn|medical record number)\s*[:#-]\s*[a-z0-9-]{3,}/i],
    ["labeled date of birth", /\b(?:dob|date of birth)\s*[:#-]\s*\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b/i]
  ];
  for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(label);
  return findings;
}

export function createDraftArticle(
  input: Pick<WikiArticle, "slug" | "title" | "summary" | "body" | "category" | "authority"> &
    Partial<Pick<WikiArticle, "aliases" | "tags" | "links" | "owner">>,
  sourceId: string
): WikiArticle {
  const now = new Date().toISOString();
  const slug = normalizeWikiSlug(input.slug);
  const article = normalizeWikiArticles([{
    id: `wiki_${slug.replace(/-/g, "_")}`,
    slug,
    title: input.title,
    summary: input.summary,
    body: input.body,
    category: input.category,
    aliases: input.aliases ?? [],
    tags: input.tags ?? [],
    links: input.links ?? [],
    status: "draft",
    authority: input.authority,
    revision: 1,
    contentHash: "",
    sourceRefs: [{ sourceId, supports: "Agent-extracted draft; verify every clinical statement against the source" }],
    owner: input.owner,
    createdAt: now,
    updatedAt: now,
    updatedBy: "ingestion-agent"
  }])[0];
  if (!article) throw new Error(`Invalid generated article: ${input.slug}`);
  return article;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function findFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return findFiles(target, predicate);
    return predicate(target) ? [target] : [];
  }));
  return files.flat().sort();
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function decodeXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const WORKSPACE_README = `# Private Surgery Residency Knowledge Base

This is the private, Git-versioned authoring workspace for the Schedule Assistant wiki.

- Raw files in \`inbox/\` and \`sources/**/original.*\` are ignored by Git.
- Published Markdown and source metadata are versioned.
- Agent-generated clinical material always starts as \`draft\`.
- Clinical preferences, policies, and templates require a named owner, reviewer, review date, and source before publication.
- Do not place PHI in this workspace.

Use the application repository command \`npm run wiki -- <command>\` to pull, ingest, validate, diff, publish, and push.
`;

const ATTENDING_PROCEDURE_TEMPLATE = `---
{
  "slug": "attending-example-procedure",
  "title": "Dr. Example — Procedure",
  "summary": "Draft attending preference for a specific procedure.",
  "category": "attending",
  "status": "draft",
  "authority": "attending-preference",
  "aliases": [],
  "tags": ["operative-preference"],
  "links": [],
  "sourceRefs": []
}
---

## Applicability

## Positioning and preparation

## Port placement

## Equipment preferences

## Operative sequence

## Variations and exceptions

## Perioperative preferences

## Reference note template

## Sources and review history
`;

const WORKFLOW_TEMPLATE = `---
{
  "slug": "workflow-example",
  "title": "Example Workflow",
  "summary": "Draft locally maintained workflow.",
  "category": "workflow",
  "status": "draft",
  "authority": "workflow",
  "aliases": [],
  "tags": ["workflow"],
  "links": [],
  "sourceRefs": []
}
---

## Purpose

## When to use this workflow

## Steps

## Contacts and escalation

## Sources and review history
`;

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFastWikiContext, computeWikiSourceRecordHash, normalizeWikiArticles } from "./wiki";
import {
  buildWorkspaceDiff,
  createDraftArticle,
  findExplicitPhi,
  initializeWikiWorkspace,
  readWikiArticleFile,
  readWikiWorkspace,
  stageWikiSource,
  writeWikiArticleFile,
  writeWikiSourceMetadata,
  writeWikiSyncState
} from "./wikiWorkspace";

describe("private wiki workspace", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it("stages a source, round-trips a sourced draft, and detects source metadata edits", async () => {
    const workspace = await makeWorkspace(temporaryDirectories);
    const sourceFile = path.join(workspace, "reviewed-preferences.txt");
    await fs.writeFile(sourceFile, "Reviewed preference: use the documented port layout.", "utf8");

    const staged = await stageWikiSource(workspace, sourceFile, {
      title: "Reviewed attending preference",
      sourceType: "direct-review",
      author: "Reviewing surgeon"
    });
    const article = createDraftArticle({
      slug: "attending-example-procedure",
      title: "Dr. Example — Procedure",
      summary: "Agent-extracted draft awaiting human review.",
      body: "## Port placement\n\nUse the documented port layout.",
      category: "attending",
      authority: "attending-preference",
      tags: ["operative-preference"]
    }, staged.source.id);
    const articlePath = await writeWikiArticleFile(workspace, article);
    const roundTripped = await readWikiArticleFile(articlePath);
    expect(roundTripped).toEqual(expect.objectContaining({
      slug: article.slug,
      status: "draft",
      contentHash: article.contentHash,
      sourceRefs: [expect.objectContaining({ sourceId: staged.source.id })]
    }));

    const initial = await readWikiWorkspace(workspace);
    expect(initial.validation.valid).toBe(true);
    await writeWikiSyncState(workspace, {
      formatVersion: 1,
      wikiRevision: 9,
      pulledAt: "2026-08-01T12:00:00.000Z",
      articleHashes: Object.fromEntries(initial.articles.map((item) => [item.slug, item.contentHash])),
      sourceHashes: Object.fromEntries(initial.sources.map((item) => [item.id, computeWikiSourceRecordHash(item)]))
    });

    await writeWikiSourceMetadata(workspace, { ...staged.source, notes: "Reviewed in person." });
    const changed = await readWikiWorkspace(workspace);
    const diff = buildWorkspaceDiff(changed, {
      formatVersion: 1,
      wikiRevision: 9,
      pulledAt: "2026-08-01T12:00:00.000Z",
      articleHashes: Object.fromEntries(initial.articles.map((item) => [item.slug, item.contentHash])),
      sourceHashes: Object.fromEntries(initial.sources.map((item) => [item.id, computeWikiSourceRecordHash(item)]))
    });
    expect(diff.sources.update.map((item) => item.id)).toEqual([staged.source.id]);
  });

  it("flags explicit labeled patient identifiers before model ingestion", () => {
    expect(findExplicitPhi("Patient name: Test Person\nMRN: 1234567\nDOB: 01/02/2003")).toEqual([
      "labeled patient name",
      "labeled medical record number",
      "labeled date of birth"
    ]);
  });

  it("keeps concise facts from long published articles in fast context", () => {
    const now = "2026-08-01T12:00:00.000Z";
    const article = normalizeWikiArticles([{
      id: "wiki_long_preference",
      slug: "long-preference",
      title: "Dr. Example common duct exploration",
      summary: "Reviewed operative preference.",
      body: `## Quick preference facts\n- Uses a 5 Fr Fogarty balloon.\n\n${"Detailed template wording. ".repeat(500)}`,
      category: "attending",
      aliases: ["Fogarty balloon"],
      tags: ["common duct exploration"],
      links: [],
      status: "published",
      authority: "attending-preference",
      revision: 1,
      contentHash: "",
      sourceRefs: [],
      createdAt: now,
      updatedAt: now
    }])[0];
    expect(buildFastWikiContext("what size Fogarty balloon?", [article])).toContain("5 Fr Fogarty balloon");
  });
});

async function makeWorkspace(tracked: string[]): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "schedule-wiki-"));
  tracked.push(workspace);
  await initializeWikiWorkspace(workspace);
  return workspace;
}

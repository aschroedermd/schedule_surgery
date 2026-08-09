import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFastWikiContext,
  computeWikiSourceRecordHash,
  normalizeWikiArticles,
  readWikiArticle,
  searchWikiArticles
} from "./wiki";
import {
  buildWorkspaceDiff,
  buildCanonicalWikiSyncPayload,
  configureWikiGitRemote,
  createDraftArticle,
  describeWikiReferenceFile,
  findExplicitPhi,
  formatWikiWorkspace,
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
    expect(await fs.readdir(path.join(workspace, "templates"))).toEqual(expect.arrayContaining([
      "attending-profile.md",
      "attending-procedure.md",
      "institutional-policy.md",
      "note-template.md",
      "perioperative-protocol.md",
      "service-guide.md",
      "workflow.md"
    ]));
    expect(JSON.parse(await fs.readFile(path.join(workspace, ".obsidian/app.json"), "utf8"))).toEqual(
      expect.objectContaining({ useMarkdownLinks: true, newFileFolderPath: "inbox" })
    );
    expect(await fs.readFile(path.join(workspace, "Home.md"), "utf8")).toContain("portable home page");
    const gitignore = await fs.readFile(path.join(workspace, ".gitignore"), "utf8");
    expect(gitignore).toContain(".wiki-sync.json");
    expect(gitignore).toContain("archive/conflicts-resolved/");
    const sourceFile = path.join(workspace, "reviewed-preferences.txt");
    await fs.writeFile(sourceFile, "Reviewed preference: use the documented port layout.", "utf8");
    const sourceByteSize = (await fs.stat(sourceFile)).size;

    const staged = await stageWikiSource(workspace, sourceFile, {
      title: "Reviewed attending preference",
      sourceType: "direct-review",
      author: "Reviewing surgeon",
      referenceFile: describeWikiReferenceFile(sourceFile, sourceByteSize)
    });
    expect(staged.source.referenceFile).toEqual({
      filename: "reviewed-preferences.txt",
      mediaType: "text/plain",
      byteSize: sourceByteSize
    });
    const article = createDraftArticle({
      slug: "attending-example-procedure",
      title: "Dr. Example — Procedure",
      summary: "Agent-extracted draft awaiting human review.",
      body: "## Port placement\n\nUse the documented port layout.",
      category: "attending",
      kind: "operative-preference",
      scope: {
        services: ["Davies"],
        attendings: ["Dr. Example"],
        procedures: ["Example procedure"],
        hospitals: ["RMH"],
        phases: ["intraoperative"],
        patientPopulations: []
      },
      relationships: [
        { type: "belongs-to", target: "attending-example", note: "Attending preference hub" }
      ],
      audience: ["residents", "operating-room staff"],
      authority: "attending-preference",
      tags: ["operative-preference"]
    }, staged.source.id);
    const articlePath = await writeWikiArticleFile(workspace, article);
    const writtenArticle = await fs.readFile(articlePath, "utf8");
    expect(writtenArticle).toMatch(/^---\nid: wiki_attending_example_procedure\nslug: attending-example-procedure\n/);
    expect(writtenArticle).toContain("relationships:\n  - type: belongs-to");
    expect(writtenArticle).not.toContain('\n{\n  "id"');
    const roundTripped = await readWikiArticleFile(articlePath);
    expect(roundTripped).toEqual(expect.objectContaining({
      slug: article.slug,
      status: "draft",
      contentHash: article.contentHash,
      kind: "operative-preference",
      scope: expect.objectContaining({ attendings: ["Dr. Example"], phases: ["intraoperative"] }),
      relationships: [{ type: "belongs-to", target: "attending-example", note: "Attending preference hub" }],
      audience: ["residents", "operating-room staff"],
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

  it("reads legacy JSON frontmatter and formats it as readable YAML", async () => {
    const workspace = await makeWorkspace(temporaryDirectories);
    const legacyPath = path.join(workspace, "articles", "program", "legacy-page.md");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, `---
{
  "slug": "legacy-page",
  "title": "Legacy Page",
  "summary": "A legacy JSON-frontmatter article.",
  "category": "program",
  "status": "draft",
  "authority": "program-reference",
  "aliases": [],
  "tags": ["legacy"],
  "links": [],
  "sourceRefs": []
}
---

Legacy body.
`, "utf8");

    expect((await readWikiArticleFile(legacyPath)).title).toBe("Legacy Page");
    expect(await formatWikiWorkspace(workspace)).toBe(1);
    const formatted = await fs.readFile(legacyPath, "utf8");
    expect(formatted).toMatch(/^---\nid: wiki_legacy_page\nslug: legacy-page\n/);
    expect(formatted).toContain("tags:\n  - legacy");
    expect(formatted).toContain("\n---\n\nLegacy body.\n");
    const formattedTemplate = await fs.readFile(path.join(workspace, "templates/attending-profile.md"), "utf8");
    expect(formattedTemplate).toMatch(/^---\nslug: attending-example\n/);
    expect(formattedTemplate).not.toContain('\n{\n  "slug"');
  });

  it("configures a private Git origin without silently replacing another remote", async () => {
    const workspace = await makeWorkspace(temporaryDirectories);
    await configureWikiGitRemote(workspace, "git@example.test:residency/knowledge.git");
    expect(await fs.readFile(path.join(workspace, ".git/config"), "utf8")).toContain(
      "url = git@example.test:residency/knowledge.git"
    );
    await configureWikiGitRemote(workspace, "git@example.test:residency/knowledge.git");
    await expect(configureWikiGitRemote(workspace, "git@example.test:other/repository.git")).rejects.toThrow(
      "already has a different origin"
    );
  });

  it("flags explicit labeled patient identifiers before model ingestion", () => {
    expect(findExplicitPhi("Patient name: Test Person\nMRN: 1234567\nDOB: 01/02/2003")).toEqual([
      "labeled patient name",
      "labeled medical record number",
      "labeled date of birth"
    ]);
  });

  it("builds a one-way canonical deployment and ignores server-only file availability", () => {
    const now = "2026-08-01T12:00:00.000Z";
    const localArticle = normalizeWikiArticles([{
      id: "wiki_local_page",
      slug: "local-page",
      title: "Local Page",
      summary: "Canonical content",
      body: "Canonical body",
      category: "program",
      aliases: [],
      tags: [],
      links: [],
      status: "published",
      authority: "program-reference",
      revision: 1,
      contentHash: "",
      sourceRefs: [],
      createdAt: now,
      updatedAt: now
    }])[0];
    const staleRemoteArticle = normalizeWikiArticles([{ ...localArticle, summary: "Stale server content" }])[0];
    const serverOnlyArticle = normalizeWikiArticles([{
      ...localArticle,
      id: "wiki_server_only",
      slug: "server-only",
      title: "Server Only"
    }])[0];
    const localSource = {
      id: "src-shared",
      title: "Shared source",
      sourceType: "document" as const,
      capturedAt: now,
      contentHash: "a".repeat(64),
      referenceFile: { filename: "guide.pdf", mediaType: "application/pdf", byteSize: 100 },
      createdAt: now,
      updatedAt: now
    };
    const payload = buildCanonicalWikiSyncPayload(
      { articles: [localArticle], sources: [localSource] },
      {
        wikiRevision: 12,
        articles: [staleRemoteArticle, serverOnlyArticle],
        sources: [
          { ...localSource, referenceFile: { ...localSource.referenceFile, available: true } },
          { ...localSource, id: "src-server-only", title: "Server-only source" }
        ]
      }
    );

    expect(payload.baseRevision).toBe(12);
    expect(payload.articles.map((article) => article.slug)).toEqual(["local-page"]);
    expect(payload.sources).toEqual([]);
    expect(payload.deleteArticles).toEqual(["server-only"]);
    expect(payload.deleteSources).toEqual(["src-server-only"]);
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
      sourceRefs: [{ sourceId: "src-reference-guide", locator: "Quick preference facts" }],
      createdAt: now,
      updatedAt: now
    }])[0];
    const context = buildFastWikiContext("what size Fogarty balloon?", [article], [{
      id: "src-reference-guide",
      title: "Common duct reference guide",
      sourceType: "document",
      capturedAt: now,
      contentHash: "a".repeat(64),
      referenceFile: { filename: "Common Duct Guide.pdf", mediaType: "application/pdf", byteSize: 1200, available: true },
      createdAt: now,
      updatedAt: now
    }]);
    expect(context).toContain("5 Fr Fogarty balloon");
    expect(context).toContain("Common Duct Guide.pdf | /api/wiki/sources/src-reference-guide/file");
  });

  it("uses typed relationships to retrieve and traverse procedure variants", () => {
    const now = "2026-08-01T12:00:00.000Z";
    const articles = normalizeWikiArticles([
      {
        id: "wiki_shared_setup",
        slug: "example-shared-setup",
        title: "Dr. Example: Shared Operative Setup",
        summary: "Shared glove, positioning, and room setup preferences.",
        body: "Use the shared setup unless the procedure article says otherwise.",
        category: "attending",
        kind: "operative-preference",
        scope: {
          services: [],
          attendings: ["Dr. Example"],
          procedures: [],
          hospitals: [],
          phases: ["intraoperative"],
          patientPopulations: []
        },
        relationships: [],
        audience: ["residents", "operating-room staff"],
        aliases: [],
        tags: ["shared setup"],
        links: [],
        status: "published",
        authority: "attending-preference",
        revision: 1,
        contentHash: "",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "wiki_variant",
        slug: "example-robotic-procedure",
        title: "Dr. Example: Robotic Procedure",
        summary: "Procedure-specific card for the robotic variant.",
        body: "Use the robotic ports described here.",
        category: "attending",
        kind: "operative-preference",
        scope: {
          services: ["Davies"],
          attendings: ["Dr. Example"],
          procedures: ["Robotic procedure"],
          hospitals: [],
          phases: ["intraoperative"],
          patientPopulations: []
        },
        relationships: [{ type: "shared-preference", target: "example-shared-setup" }],
        audience: ["residents", "operating-room staff"],
        aliases: [],
        tags: ["robotic"],
        links: [],
        status: "published",
        authority: "attending-preference",
        revision: 1,
        contentHash: "",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now
      }
    ]);

    expect(searchWikiArticles(articles, "Dr. Example robotic", 2).map((article) => article.slug)).toContain(
      "example-robotic-procedure"
    );
    expect(readWikiArticle(articles, "example-robotic-procedure")?.related).toEqual([
      expect.objectContaining({
        relationship: { type: "shared-preference", target: "example-shared-setup" },
        article: expect.objectContaining({ slug: "example-shared-setup" })
      })
    ]);
    expect(readWikiArticle(articles, "example-shared-setup")?.incomingRelationships).toEqual([
      expect.objectContaining({
        relationship: { type: "shared-preference", target: "example-shared-setup" },
        article: expect.objectContaining({ slug: "example-robotic-procedure" })
      })
    ]);
  });
});

async function makeWorkspace(tracked: string[]): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "schedule-wiki-"));
  tracked.push(workspace);
  await initializeWikiWorkspace(workspace);
  return workspace;
}

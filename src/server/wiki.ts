import { createHash } from "node:crypto";
import {
  WikiArticle,
  WikiAuthority,
  WikiCategory,
  WikiSource,
  WikiSourceReference,
  WikiSourceType,
  WikiStatus,
  WIKI_AUTHORITIES,
  WIKI_CATEGORIES,
  WIKI_SOURCE_TYPES,
  WIKI_STATUSES
} from "../shared/types";

const SEED_TIME = "2026-08-01T12:00:00.000Z";
const MAX_SEARCH_RESULTS = 8;
const MAX_FAST_WIKI_CHARS = 8_000;

export interface WikiArticleSummary {
  slug: string;
  title: string;
  summary: string;
  category: WikiCategory;
  aliases: string[];
  tags: string[];
  links: string[];
  status: WikiStatus;
  authority: WikiAuthority;
  revision: number;
  contentHash: string;
  owner?: string;
  reviewedBy?: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewDueAt?: string;
}

export function createSeedWikiArticles(): WikiArticle[] {
  return [
    seedArticle({
      slug: "residency-wiki",
      title: "Surgery Residency Wiki",
      category: "index",
      summary: "Main index for local scheduling, services, hospitals, attendings, workflows, and clinical references.",
      aliases: ["main wiki", "residency wiki", "program wiki"],
      tags: ["index", "residency", "local knowledge"],
      links: [
        "resident-call",
        "or-coverage",
        "services",
        "hospitals",
        "attendings",
        "workflows",
        "clinical-references"
      ],
      body: `Use this wiki for stable, locally maintained knowledge that is not represented by live schedule records.

Primary sections:
- Resident call: weekend teams, night float, and protected post-call time.
- OR coverage: expected resident coverage, common cross-coverage pool, and routine exceptions.
- Services: local service names, aliases, locations, and operating model.
- Hospitals: locations, travel considerations, and local coverage expectations.
- Attendings: preferences, areas of practice, office contacts, and scheduler information.
- Workflows: how to complete local administrative tasks.
- Clinical references: institution-specific order and perioperative guidance maintained by authorized editors.

Live dates, assignments, vacations, and call rosters come from schedule tools, not the wiki. Wiki clinical content is reference material and should retain an owner and review date.`
    }),
    seedArticle({
      slug: "resident-call",
      title: "Resident Call and Night Float",
      category: "program",
      summary: "Three-person weekend call teams, Sunday-through-Thursday night float, and protected post-call rules.",
      aliases: ["call pool", "weekend call", "night team", "night float", "NFloat", "SCC Night"],
      tags: ["resident call", "availability", "post-call"],
      links: ["or-coverage", "services"],
      body: `Resident call and attending call are separate schedules.

Resident coverage uses a chief or senior, a mid-level resident, and an intern. Weekend resident call is always staffed by all three roles once published:
- Friday: 5:00 p.m. Friday to 6:00 a.m. Saturday.
- Saturday: 6:00 a.m. Saturday to 6:00 a.m. Sunday.
- Sunday: 6:00 a.m. to 5:00 p.m. Sunday.
- Night float assumes coverage at 5:00 p.m. Sunday and covers Sunday through Thursday nights. Night-float membership comes from NFloat and SCC Night rotations.

Friday and Saturday call create protected post-call time after the resident leaves the hospital. Friday callers are protected for the remainder of Saturday; Saturday callers are protected for the remainder of Sunday. Sunday day call and ordinary night-float shifts do not create the same planner post-call day.

If a future weekend call team is missing one or more of its three roles, describe it as not yet published rather than treating the open role as an ordinary volunteer opportunity.`
    }),
    seedArticle({
      slug: "or-coverage",
      title: "OR Case Coverage",
      category: "program",
      summary: "How resident OR coverage is interpreted, including practice-pool cross coverage and routine FMH/endoscopy exceptions.",
      aliases: ["case coverage", "uncovered cases", "cross coverage", "practice pool"],
      tags: ["OR", "availability", "coverage gaps"],
      links: ["resident-call", "services", "hospital-fmh"],
      body: `It is generally ideal for each regular OR case to have resident coverage. An OR case shown without a resident is currently unassigned.

Residents rotating on the practice-side services Davies, Fogel/Colorectal, Breast, Berry, and Endoscopy can often cross-cover cases when needed. This is a practical source of possible coverage, not an automatic assignment rule. Ferrara/EGS is usually not a good cross-coverage pool because its residents manage a busy acute-care service and its own operative workload.

When discussing possible case coverage, consider vacations, recorded unavailable time, existing case or clinic work, night-float assignment, weekend call, protected post-call time, overlaps, and travel. Do not manage fairness or make the assignment decision for residents and attendings.

Routine exceptions:
- Endoscopy blocks do not necessarily need resident coverage.
- Most cases at Franklin Memorial Hospital (FMH) are not covered by a resident.

Omit FMH cases and endoscopy blocks from general coverage-gap answers unless the user explicitly asks about them. When explicitly asked, report their assignment state and explain that resident coverage is not routinely expected.`
    }),
    seedArticle({
      slug: "services",
      title: "Surgery Services",
      category: "index",
      summary: "Index of local service names, common aliases, and broad service responsibilities.",
      aliases: ["service guide", "rotations"],
      tags: ["services", "rotations"],
      links: [
        "service-icu",
        "service-gilbert",
        "service-vascular",
        "service-davies",
        "service-berry",
        "service-fogel",
        "service-ferrara",
        "service-nrv",
        "service-peds",
        "service-breast",
        "service-endoscopy"
      ],
      body: `The planner service names are ICU, Gilbert, Vascular, Davies, Berry, Ferrara, Fogel, NRV, and Peds. Rotation schedules may also use Breast and Endoscopy. Use both the planner name and familiar clinical name when that improves clarity, such as “Fogel/Colorectal” or “ICU/SCC.” See the linked service articles for local descriptions.`
    }),
    seedArticle({
      slug: "service-icu",
      title: "ICU / Surgical Critical Care",
      category: "service",
      summary: "The ICU service is the Surgical Critical Care service, commonly abbreviated SCC.",
      aliases: ["ICU", "SCC", "surgical critical care"],
      tags: ["service", "critical care"],
      links: ["services", "resident-call"],
      body: "ICU is the Surgical Critical Care (SCC) service. The terms ICU and SCC may refer to the same service context. SCC Night rotation assignments also help identify members of the resident night-float team."
    }),
    seedArticle({
      slug: "service-gilbert",
      title: "Gilbert / Trauma",
      category: "service",
      summary: "Gilbert is the trauma service; attendings rotate weekly while residents rotate by block.",
      aliases: ["Gilbert", "trauma service"],
      tags: ["service", "trauma"],
      links: ["services", "resident-call"],
      body: "Gilbert is the trauma service. The attending changes weekly on Monday morning. Residents rotate on and off the service by residency rotation block."
    }),
    seedArticle({
      slug: "service-vascular",
      title: "Vascular Surgery",
      category: "service",
      summary: "Index page for the Vascular Surgery service and its locally maintained workflows and preferences.",
      aliases: ["Vascular", "vascular surgery"],
      tags: ["service", "vascular"],
      links: ["services", "attendings", "workflows"],
      body: "Vascular is the vascular surgery service. Add verified service contacts, workflows, sites, and attending preferences as linked articles rather than placing changing details in the assistant prompt."
    }),
    seedArticle({
      slug: "service-davies",
      title: "Davies / Minimally Invasive Surgery",
      category: "service",
      summary: "Davies is a minimally invasive surgery practice service and part of the usual practice-side cross-coverage pool.",
      aliases: ["Davies", "MIS", "minimally invasive surgery"],
      tags: ["service", "practice pool", "MIS"],
      links: ["services", "or-coverage", "attending-guy-katz", "attending-arnold-salzberg"],
      body: "Davies is a minimally invasive surgery service. Its attending group includes Drs. Guy Katz, Sharon Williams, Curtis Bower, Ashley Gerrish, Tananchai Lucktong, Kristin McCoy, and Arnold Salzberg. Residents assigned to Davies are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-berry",
      title: "Berry / Practice Surgery",
      category: "service",
      summary: "Berry is a practice surgery service and part of the usual practice-side cross-coverage pool.",
      aliases: ["Berry", "practice surgery"],
      tags: ["service", "practice pool"],
      links: ["services", "or-coverage"],
      body: "Berry is a practice surgery service. Its attending group includes Drs. Paget, Hagy, Nussbaum, Rudderow, Saha, and Tershak. Dr. Nussbaum is chair of surgery. Dr. Saha has a soft-tissue surgical oncology practice that includes melanoma and sarcoma. Residents assigned to Berry are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-fogel",
      title: "Fogel / Colorectal Surgery",
      category: "service",
      summary: "Fogel is the colorectal service and part of the usual practice-side cross-coverage pool.",
      aliases: ["Fogel", "colorectal", "CRS"],
      tags: ["service", "practice pool", "colorectal"],
      links: ["services", "or-coverage"],
      body: "Fogel is the colorectal surgery service. Its attending group includes Dr. Ferrel Adkins and Dr. Paul Nickerson. Residents assigned to Fogel are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-ferrara",
      title: "Ferrara / Emergency General Surgery",
      category: "service",
      summary: "Ferrara is the busy Emergency General Surgery service and is generally not a routine cross-coverage pool.",
      aliases: ["Ferrara", "EGS", "emergency general surgery", "acute care surgery"],
      tags: ["service", "EGS"],
      links: ["services", "or-coverage"],
      body: "Ferrara is the Emergency General Surgery (EGS) service. It has a substantial clinical census and operative workload of its own, so its residents are usually not the best first option for practice-side case cross coverage."
    }),
    seedArticle({
      slug: "service-nrv",
      title: "NRV / Christiansburg",
      category: "service",
      summary: "NRV is a three-member service in Christiansburg, roughly 50 minutes from the main Roanoke hospital.",
      aliases: ["NRV", "New River Valley", "Christiansburg"],
      tags: ["service", "travel", "Christiansburg"],
      links: ["services", "hospitals"],
      body: "NRV is a three-member service based in Christiansburg. Travel from the main hospital in Roanoke is approximately 50 minutes, so location and travel time matter when considering same-day coverage."
    }),
    seedArticle({
      slug: "service-peds",
      title: "Peds / Pediatric Surgery",
      category: "service",
      summary: "Peds is the pediatric surgery service.",
      aliases: ["Peds", "pediatrics", "pediatric surgery"],
      tags: ["service", "pediatrics"],
      links: ["services"],
      body: "Peds is the pediatric surgery service. Its attending group includes Drs. Wattsman, Bass, and Chulkov."
    }),
    seedArticle({
      slug: "service-breast",
      title: "Breast Surgery Rotation",
      category: "service",
      summary: "Breast is a practice-side rotation whose residents can often cross-cover OR cases when available.",
      aliases: ["Breast", "breast surgery"],
      tags: ["service", "practice pool", "breast"],
      links: ["services", "or-coverage", "attendings"],
      body: "Breast is a practice-side rotation. Residents assigned to Breast are often part of the pool that can cross-cover cases when their actual schedule permits. Add verified attending, office, and workflow details as linked pages."
    }),
    seedArticle({
      slug: "service-endoscopy",
      title: "Endoscopy Rotation",
      category: "service",
      summary: "Endoscopy is a practice-side rotation and endoscopy blocks do not necessarily require resident coverage.",
      aliases: ["Endoscopy", "endo"],
      tags: ["service", "practice pool", "endoscopy", "coverage exception"],
      links: ["services", "or-coverage", "attending-guy-katz"],
      body: "Residents assigned to Endoscopy are often part of the practice-side pool that can cross-cover cases when their actual schedule permits. Endoscopy blocks themselves do not necessarily require resident coverage and should be omitted from general coverage-gap answers unless explicitly requested."
    }),
    seedArticle({
      slug: "hospitals",
      title: "Hospitals and Locations",
      category: "index",
      summary: "Index for hospital locations, abbreviations, travel, and site-specific coverage expectations.",
      aliases: ["hospital guide", "locations"],
      tags: ["hospitals", "travel"],
      links: ["hospital-fmh", "service-nrv"],
      body: "Use hospital articles for local abbreviations, travel considerations, contacts, and site-specific resident coverage expectations. Live case locations remain authoritative in the schedule."
    }),
    seedArticle({
      slug: "hospital-fmh",
      title: "Franklin Memorial Hospital (FMH)",
      category: "hospital",
      summary: "Most FMH cases are not routinely covered by a resident.",
      aliases: ["FMH", "Franklin Memorial", "Franklin Memorial Hospital"],
      tags: ["hospital", "coverage exception"],
      links: ["hospitals", "or-coverage"],
      body: "Most cases at Franklin Memorial Hospital (FMH) are not covered by a resident. Do not treat unassigned FMH cases as ordinary coverage gaps unless the user explicitly asks about FMH."
    }),
    seedArticle({
      slug: "attendings",
      title: "Attending Directory",
      category: "index",
      summary: "Index for attending practice information, preferences, schedulers, office contacts, and operative guidance.",
      aliases: ["surgeons", "attending wiki", "faculty directory"],
      tags: ["attendings", "preferences", "contacts"],
      links: ["attending-guy-katz", "attending-arnold-salzberg"],
      body: "Attending articles may contain areas of practice, scheduler and office contacts, perioperative preferences, port placement, and case-specific tips. Treat these as locally maintained reference material, distinguish preferences from mandatory policy, and pay attention to article owner and review date."
    }),
    seedArticle({
      slug: "attending-guy-katz",
      title: "Dr. Guy Katz",
      category: "attending",
      summary: "Davies attending with an advanced surgical endoscopy practice.",
      aliases: ["Guy Katz", "Dr Katz", "Katz"],
      tags: ["attending", "Davies", "advanced endoscopy"],
      links: ["attendings", "service-davies"],
      body: "Dr. Guy Katz practices on the Davies service and performs advanced surgical endoscopy, including POEM, G-POEM, ERCP, and endoscopic transgastric pancreatic drainage. Add scheduler, office-contact, and case-preference details only when verified locally."
    }),
    seedArticle({
      slug: "attending-arnold-salzberg",
      title: "Dr. Arnold Salzberg",
      category: "attending",
      summary: "Davies attending with broad surgical oncology and hepatopancreatobiliary practice.",
      aliases: ["Arnold Salzberg", "Dr Salzberg", "Salzberg"],
      tags: ["attending", "Davies", "surgical oncology", "HPB"],
      links: ["attendings", "service-davies"],
      body: "Dr. Arnold Salzberg practices on the Davies service and performs substantial surgical oncology work, including pancreatic, esophageal, liver, and hepatobiliary surgery. Add scheduler, office-contact, and case-preference details only when verified locally."
    }),
    seedArticle({
      slug: "workflows",
      title: "Hospital Workflows",
      category: "index",
      summary: "Index for local administrative workflows, schedulers, contacts, and how to get common tasks done.",
      aliases: ["how to", "tips and tricks", "contacts", "schedulers"],
      tags: ["workflow", "operations"],
      links: ["attendings", "clinical-references"],
      body: "Create linked workflow articles for verified local tasks such as contacting an attending scheduler, arranging a case, or navigating a hospital process. Keep steps concise, identify the responsible office or role, and include an owner and review date when the process can change."
    }),
    seedArticle({
      slug: "clinical-references",
      title: "Orders and Clinical References",
      category: "index",
      summary: "Index for reviewed institution-specific orders, perioperative preferences, and clinical tips.",
      aliases: ["orders", "clinical wiki", "perioperative antibiotics", "operative preferences"],
      tags: ["clinical reference", "orders", "perioperative"],
      links: ["attendings", "workflows"],
      owner: "Residency program",
      body: "Add institution-specific order instructions, perioperative guidance, and attending preferences as separate linked articles. Clinical articles should name an owner, distinguish policy from individual preference, include a review date, and contain no PHI. The assistant should report stale or missing review metadata and should not invent absent clinical guidance."
    })
  ];
}

export function normalizeWikiArticles(articles: WikiArticle[]): WikiArticle[] {
  const seen = new Set<string>();
  return articles
    .map((article) => {
      const normalized = {
      ...article,
      slug: normalizeWikiSlug(article.slug),
      title: cleanText(article.title, 120),
      summary: cleanText(article.summary, 500),
      body: cleanBody(article.body),
      category: isWikiCategory(article.category) ? article.category : "program",
      aliases: cleanList(article.aliases, 20, 100),
      tags: cleanList(article.tags, 30, 60),
      links: cleanList(article.links, 50, 100).map(normalizeWikiSlug),
      status: isWikiStatus(article.status) ? article.status : "published",
      authority: isWikiAuthority(article.authority) ? article.authority : defaultAuthority(article.category),
      revision: Number.isInteger(article.revision) && article.revision > 0 ? article.revision : 1,
      sourceRefs: normalizeWikiSourceReferences(article.sourceRefs),
      owner: cleanOptionalText(article.owner, 120),
      reviewedBy: cleanOptionalText(article.reviewedBy, 120),
      reviewedAt: cleanOptionalIsoDate(article.reviewedAt),
      reviewDueAt: cleanOptionalIsoDate(article.reviewDueAt),
      supersedes: cleanList(article.supersedes, 20, 100).map(normalizeWikiSlug),
      createdAt: readIsoTimestamp(article.createdAt) ?? SEED_TIME,
      updatedAt: readIsoTimestamp(article.updatedAt) ?? SEED_TIME,
      updatedBy: cleanOptionalText(article.updatedBy, 120)
      } satisfies WikiArticle;
      return { ...normalized, contentHash: computeWikiArticleHash(normalized) };
    })
    .filter((article) => {
      if (!article.slug || !article.title || seen.has(article.slug)) return false;
      seen.add(article.slug);
      return true;
    });
}

export function normalizeWikiSources(sources: WikiSource[]): WikiSource[] {
  const seen = new Set<string>();
  return sources
    .map((source) => ({
      ...source,
      id: cleanText(source.id, 120).toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
      title: cleanText(source.title, 200),
      sourceType: isWikiSourceType(source.sourceType) ? source.sourceType : "document",
      author: cleanOptionalText(source.author, 160),
      origin: cleanOptionalText(source.origin, 500),
      capturedAt: readIsoTimestamp(source.capturedAt) ?? SEED_TIME,
      effectiveDate: cleanOptionalIsoDate(source.effectiveDate),
      contentHash: cleanText(source.contentHash, 128).toLowerCase(),
      notes: cleanOptionalText(source.notes, 1000),
      createdAt: readIsoTimestamp(source.createdAt) ?? SEED_TIME,
      updatedAt: readIsoTimestamp(source.updatedAt) ?? SEED_TIME,
      updatedBy: cleanOptionalText(source.updatedBy, 120)
    }))
    .filter((source) => {
      if (!source.id || !source.title || !source.contentHash || seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    });
}

export function summarizeWikiArticle(article: WikiArticle): WikiArticleSummary {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category: article.category,
    aliases: article.aliases,
    tags: article.tags,
    links: article.links,
    status: article.status,
    authority: article.authority,
    revision: article.revision,
    contentHash: article.contentHash,
    owner: article.owner,
    reviewedBy: article.reviewedBy,
    updatedAt: article.updatedAt,
    reviewedAt: article.reviewedAt,
    reviewDueAt: article.reviewDueAt
  };
}

export function searchWikiArticles(
  articles: WikiArticle[],
  query: string,
  limit = MAX_SEARCH_RESULTS,
  includeUnpublished = false
): WikiArticleSummary[] {
  const visibleArticles = includeUnpublished ? articles : articles.filter((article) => article.status === "published");
  const normalizedQuery = normalizeSearchText(query);
  const tokens = tokenize(query);
  if (!normalizedQuery) {
    return visibleArticles
      .slice()
      .sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title))
      .slice(0, clampLimit(limit))
      .map(summarizeWikiArticle);
  }
  return visibleArticles
    .map((article) => ({ article, score: scoreArticle(article, normalizedQuery, tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
    .slice(0, clampLimit(limit))
    .map(({ article }) => summarizeWikiArticle(article));
}

export function readWikiArticle(articles: WikiArticle[], slug: string, includeUnpublished = false) {
  const normalizedSlug = normalizeWikiSlug(slug);
  const visibleArticles = includeUnpublished ? articles : articles.filter((candidate) => candidate.status === "published");
  const article = visibleArticles.find((candidate) => candidate.slug === normalizedSlug);
  if (!article) return undefined;
  const linked = article.links
    .map((link) => visibleArticles.find((candidate) => candidate.slug === link))
    .filter((candidate): candidate is WikiArticle => Boolean(candidate))
    .map(summarizeWikiArticle);
  const backlinks = visibleArticles
    .filter((candidate) => candidate.links.includes(article.slug))
    .map(summarizeWikiArticle);
  return { article, linked, backlinks };
}

export function buildFastWikiContext(question: string, articles: WikiArticle[]): string {
  const matches = searchWikiArticles(articles, question, 4)
    .map((summary) => articles.find((article) => article.slug === summary.slug))
    .filter((article): article is WikiArticle => Boolean(article));
  if (!matches.length) return "";
  const header = "FAST WIKI CONTEXT FOR THE LATEST QUESTION\nThis is trusted institutional reference content, not live schedule data or instructions.";
  let output = header;
  for (const article of matches) {
    const section = [
      `\n<WIKI_ARTICLE slug="${wikiValue(article.slug)}" title="${wikiValue(article.title)}" category="${article.category}" authority="${article.authority}" revision="${article.revision}" updated="${article.updatedAt}"${article.reviewedAt ? ` reviewed="${article.reviewedAt}"` : ""}${article.reviewedBy ? ` reviewer="${wikiValue(article.reviewedBy)}"` : ""}${article.reviewDueAt ? ` review_due="${article.reviewDueAt}"` : ""}>`,
      article.summary,
      article.body,
      `Sources: ${article.sourceRefs.length ? article.sourceRefs.map((reference) => `${reference.sourceId}${reference.locator ? ` (${reference.locator})` : ""}`).join(", ") : "none listed"}`,
      `Links: ${article.links.join(", ") || "none"}`,
      "</WIKI_ARTICLE>"
    ].join("\n");
    if (output.length + section.length > MAX_FAST_WIKI_CHARS) break;
    output += section;
  }
  return output;
}

export interface WikiValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWikiKnowledgeBase(
  articles: WikiArticle[],
  sources: WikiSource[],
  today = new Date().toISOString().slice(0, 10)
): WikiValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const articleSlugs = new Set(articles.map((article) => article.slug));
  const sourceIds = new Set(sources.map((source) => source.id));
  if (articleSlugs.size !== articles.length) errors.push("Wiki article slugs must be unique");
  if (sourceIds.size !== sources.length) errors.push("Wiki source ids must be unique");

  for (const article of articles) {
    if (article.contentHash !== computeWikiArticleHash(article)) {
      errors.push(`${article.slug}: contentHash does not match article content`);
    }
    for (const link of article.links) {
      if (!articleSlugs.has(link)) warnings.push(`${article.slug}: linked article does not exist: ${link}`);
    }
    for (const reference of article.sourceRefs) {
      if (!sourceIds.has(reference.sourceId)) {
        errors.push(`${article.slug}: source does not exist: ${reference.sourceId}`);
      }
    }
    const requiresClinicalReview =
      article.authority === "institutional-policy" ||
      article.authority === "attending-preference" ||
      article.authority === "educational-template";
    if (
      article.status === "published" &&
      requiresClinicalReview &&
      (!article.owner || !article.reviewedBy || !article.reviewedAt || !article.sourceRefs.length)
    ) {
      errors.push(`${article.slug}: published clinical knowledge requires owner, reviewer, review date, and a source`);
    }
    if (article.status === "published" && article.reviewDueAt && article.reviewDueAt < today) {
      warnings.push(`${article.slug}: review was due ${article.reviewDueAt}`);
    }
    if (article.status === "published" && requiresClinicalReview && !article.reviewDueAt) {
      warnings.push(`${article.slug}: published clinical knowledge has no reviewDueAt`);
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function normalizeWikiSlug(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function seedArticle(
  input: Omit<
    WikiArticle,
    "id" | "status" | "authority" | "revision" | "contentHash" | "sourceRefs" | "createdAt" | "updatedAt"
  >
): WikiArticle {
  const article = {
    ...input,
    id: `wiki_${input.slug.replace(/-/g, "_")}`,
    status: "published" as const,
    authority: "program-reference" as const,
    revision: 1,
    contentHash: "",
    sourceRefs: [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: "system"
  };
  return { ...article, contentHash: computeWikiArticleHash(article) };
}

export function computeWikiArticleHash(article: Omit<WikiArticle, "contentHash"> | WikiArticle): string {
  const canonical = {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    body: article.body,
    category: article.category,
    aliases: [...article.aliases].sort(),
    tags: [...article.tags].sort(),
    links: [...article.links].sort(),
    status: article.status,
    authority: article.authority,
    sourceRefs: [...article.sourceRefs]
      .map((reference) => ({
        sourceId: reference.sourceId,
        locator: reference.locator,
        supports: reference.supports
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    owner: article.owner,
    reviewedBy: article.reviewedBy,
    reviewedAt: article.reviewedAt,
    reviewDueAt: article.reviewDueAt,
    supersedes: [...(article.supersedes ?? [])].sort()
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function computeWikiSourceHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeWikiSourceRecordHash(source: WikiSource): string {
  const canonical = {
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    author: source.author,
    origin: source.origin,
    capturedAt: source.capturedAt,
    effectiveDate: source.effectiveDate,
    contentHash: source.contentHash,
    notes: source.notes
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function normalizeWikiSourceReferences(references: WikiSourceReference[] | undefined): WikiSourceReference[] {
  if (!Array.isArray(references)) return [];
  const seen = new Set<string>();
  return references.flatMap((reference) => {
    if (!reference || typeof reference !== "object") return [];
    const sourceId = cleanText(reference.sourceId, 120).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!sourceId) return [];
    const normalized = {
      sourceId,
      locator: cleanOptionalText(reference.locator, 300),
      supports: cleanOptionalText(reference.supports, 300)
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function defaultAuthority(category: WikiCategory): WikiAuthority {
  if (category === "workflow") return "workflow";
  if (category === "clinical-reference") return "institutional-policy";
  return "program-reference";
}

function isWikiStatus(value: string): value is WikiStatus {
  return (WIKI_STATUSES as readonly string[]).includes(value);
}

function isWikiAuthority(value: string): value is WikiAuthority {
  return (WIKI_AUTHORITIES as readonly string[]).includes(value);
}

function isWikiSourceType(value: string): value is WikiSourceType {
  return (WIKI_SOURCE_TYPES as readonly string[]).includes(value);
}

function scoreArticle(article: WikiArticle, normalizedQuery: string, tokens: string[]): number {
  const title = normalizeSearchText(article.title);
  const slug = normalizeSearchText(article.slug);
  const aliases = article.aliases.map(normalizeSearchText);
  const tags = article.tags.map(normalizeSearchText);
  const summary = normalizeSearchText(article.summary);
  const body = normalizeSearchText(article.body);
  const titleWords = new Set(title.split(" "));
  const slugWords = new Set(slug.split(" "));
  const summaryWords = new Set(summary.split(" "));
  const bodyWords = new Set(body.split(" "));
  let score = 0;
  if (title === normalizedQuery || aliases.includes(normalizedQuery)) score += 100;
  if (title.includes(normalizedQuery) || slug.includes(normalizedQuery)) score += 40;
  if (aliases.some((alias) => normalizedQuery.includes(alias) || alias.includes(normalizedQuery))) score += 30;
  for (const token of tokens) {
    if (titleWords.has(token) || slugWords.has(token)) score += 12;
    if (aliases.some((alias) => alias.split(" ").includes(token))) score += 10;
    if (tags.some((tag) => tag.split(" ").includes(token))) score += 8;
    if (summaryWords.has(token)) score += 3;
    if (bodyWords.has(token)) score += 1;
  }
  return score;
}

function tokenize(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "are", "for", "how", "i", "in", "is", "of", "on", "the", "to", "what", "when", "where", "who", "with"]);
  return [...new Set(normalizeSearchText(value).split(" ").filter((token) => token.length >= 2 && !stopWords.has(token)))];
}

function normalizeSearchText(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: string, maxLength: number): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBody(value: string): string {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, 20_000);
}

function cleanOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const cleaned = cleanText(value ?? "", maxLength);
  return cleaned || undefined;
}

function cleanList(values: string[] | undefined, maxItems: number, maxLength: number): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function cleanOptionalIsoDate(value: string | undefined): string | undefined {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function readIsoTimestamp(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isWikiCategory(value: string): value is WikiCategory {
  return (WIKI_CATEGORIES as readonly string[]).includes(value);
}

function clampLimit(limit: number): number {
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : MAX_SEARCH_RESULTS));
}

function wikiValue(value: string): string {
  return value.replace(/["<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

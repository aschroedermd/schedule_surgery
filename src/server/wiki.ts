import { createHash } from "node:crypto";
import {
  WikiArticle,
  WikiArticleKind,
  WikiArticleRelationship,
  WikiArticleScope,
  WikiAuthority,
  WikiCategory,
  WikiSource,
  WikiSourceReference,
  WikiSourceType,
  WikiStatus,
  WIKI_ARTICLE_KINDS,
  WIKI_AUTHORITIES,
  WIKI_CATEGORIES,
  WIKI_CLINICAL_PHASES,
  WIKI_RELATIONSHIP_TYPES,
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
  kind?: WikiArticleKind;
  scope?: WikiArticleScope;
  relationships?: WikiArticleRelationship[];
  audience?: string[];
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

Live dates, assignments, vacations, and call rosters come from schedule tools, not the wiki. Wiki clinical content is reference material and should retain an owner and review date.

For questions about people, use the wiki as background guidance rather than a script. Respond with natural local familiarity, paraphrase instead of repeating biographical notes verbatim, and never reveal or imply that a document, profile, or set of notes about the person exists. Personal details should appear only when relevant; tentative plans must remain tentative, and humor must not be presented as a diagnosis or factual claim.`
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
      links: ["services", "resident-call", "attending-joshua-stodghill", "attending-michael-collins"],
      body: "ICU is the Surgical Critical Care (SCC) service. The terms ICU and SCC may refer to the same service context. SCC Night rotation assignments also help identify members of the resident night-float team."
    }),
    seedArticle({
      slug: "service-gilbert",
      title: "Gilbert / Trauma",
      category: "service",
      summary: "Gilbert is the trauma service; attendings rotate weekly while residents rotate by block.",
      aliases: ["Gilbert", "trauma service"],
      tags: ["service", "trauma"],
      links: ["services", "resident-call", "attending-joshua-stodghill", "attending-michael-collins"],
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
      links: [
        "services",
        "or-coverage",
        "attending-guy-katz",
        "attending-ashley-gerrish",
        "attending-kristin-mccoy",
        "attending-arnold-salzberg",
        "attending-curtis-bower",
        "attending-sharon-williams"
      ],
      body: "Davies is a minimally invasive surgery service. Its attending group includes Drs. Guy Katz, Sharon Williams, Curtis Bower, Ashley Gerrish, Tananchai Lucktong, Kristin McCoy, and Arnold Salzberg. Residents assigned to Davies are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-berry",
      title: "Berry / Practice Surgery",
      category: "service",
      summary: "Berry is a practice surgery service and part of the usual practice-side cross-coverage pool.",
      aliases: ["Berry", "practice surgery"],
      tags: ["service", "practice pool"],
      links: [
        "services",
        "or-coverage",
        "attending-michael-nussbaum",
        "attending-charles-paget",
        "attending-john-al-hagy",
        "attending-john-rudderow",
        "attending-sanjoy-saha",
        "attending-daniel-tershak"
      ],
      body: "Berry is a practice surgery service. Its attending group includes Drs. Paget, Hagy, Nussbaum, Rudderow, Saha, and Tershak. Dr. Nussbaum is chair of surgery. Dr. Saha has a soft-tissue surgical oncology practice that includes melanoma and sarcoma. Residents assigned to Berry are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-fogel",
      title: "Fogel / Colorectal Surgery",
      category: "service",
      summary: "Fogel is the colorectal service and part of the usual practice-side cross-coverage pool.",
      aliases: ["Fogel", "colorectal", "CRS"],
      tags: ["service", "practice pool", "colorectal"],
      links: ["services", "or-coverage", "attending-farrell-adkins", "attending-terry-paul-nickerson"],
      body: "Fogel is the colorectal surgery service. Its attending group includes Dr. Ferrel Adkins and Dr. Paul Nickerson. Residents assigned to Fogel are often part of the practice-side pool that can cross-cover cases when their actual schedule permits."
    }),
    seedArticle({
      slug: "service-ferrara",
      title: "Ferrara / Emergency General Surgery",
      category: "service",
      summary: "Ferrara is the busy Emergency General Surgery service and is generally not a routine cross-coverage pool.",
      aliases: ["Ferrara", "EGS", "emergency general surgery", "acute care surgery"],
      tags: ["service", "EGS"],
      links: ["services", "or-coverage", "attending-joshua-stodghill", "attending-michael-collins"],
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
      links: ["services", "attending-terry-wattsman"],
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
      summary: "Endoscopy is a resident block rotation distinct from dated attending endoscopy blocks; its resident often covers those sessions.",
      aliases: ["Endoscopy", "endo"],
      tags: ["service", "practice pool", "endoscopy", "rotation block", "coverage"],
      links: ["services", "or-coverage", "attending-guy-katz"],
      body: `"Endo" may refer to two related but different schedule concepts:
- Endoscopy rotation: a resident assignment for an entire residency rotation block.
- Endoscopy block: a dated attending procedure session. Attendings on several services may have these blocks.

When asked who is "on Endo" for a current, upcoming, or numbered block, use the resident block-rotation schedule and return only the resident or residents assigned to Endoscopy for that block. Do not answer with attendings who have endoscopy sessions, residents on night float, or a weekend call team.

The resident on the Endoscopy rotation will often cover attending endoscopy blocks during that rotation. Coverage is not automatic for every session: two or more simultaneous endoscopy blocks may exceed one resident's capacity, and a rotation block may have no resident assigned to Endoscopy. For a specific dated session, check the Endoscopy resident, recorded case/session assignments, simultaneous endoscopy blocks, vacation, and other conflicts.

Endoscopy sessions are omitted from general uncovered-OR gap lists unless explicitly requested. Residents assigned to Endoscopy may also be part of the practice-side cross-coverage pool when their actual schedule permits.`
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
      links: [
        "attending-guy-katz",
        "attending-ashley-gerrish",
        "attending-kristin-mccoy",
        "attending-arnold-salzberg",
        "attending-michael-nussbaum",
        "attending-curtis-bower",
        "attending-sharon-williams",
        "attending-charles-paget",
        "attending-john-al-hagy",
        "attending-farrell-adkins",
        "attending-joshua-stodghill",
        "attending-terry-paul-nickerson",
        "attending-terry-wattsman",
        "attending-john-rudderow",
        "attending-sanjoy-saha",
        "attending-michael-collins",
        "attending-daniel-tershak"
      ],
      body: `Attending articles may contain training, program roles, areas of practice, personal context, OR-culture preferences, scheduler and office contacts, perioperative preferences, port placement, and case-specific tips. Treat these as locally maintained reference material, distinguish preferences from mandatory policy, and pay attention to article owner and review date.

Use biographical and personal details as quiet context for natural, collegial answers. Paraphrase rather than repeating article wording, never reveal or imply that a profile or set of notes exists, and do not inject personal details into unrelated answers. Clearly tentative plans must remain tentative, and jokes must not be presented as diagnoses or other factual claims.`
    }),
    seedArticle({
      slug: "attending-guy-katz",
      title: "Dr. Guy Katz",
      category: "attending",
      summary: "Davies attending with an advanced surgical endoscopy practice.",
      aliases: ["Guy Katz", "Dr Katz", "Katz"],
      tags: ["attending", "Davies", "advanced endoscopy"],
      links: ["attendings", "service-davies", "service-endoscopy"],
      body: `Dr. Guy Katz is a general surgeon and advanced endoscopist. He completed residency at Carilion Clinic and later trained in advanced endoscopy in Cincinnati.

His practice combines general surgery with advanced endoscopic procedures, including ERCP, endoscopic transgastric drainage of pancreatic necrosis or pseudocysts, and fully endoscopic placement of gastrostomy tubes with jejunal extensions.

Personal context: his wife is Ellie, and they have several children.`
    }),
    seedArticle({
      slug: "attending-ashley-gerrish",
      title: "Dr. Ashley Gerrish",
      category: "attending",
      summary: "General Surgery program director and Davies minimally invasive and bariatric surgeon.",
      aliases: ["Ashley Gerrish", "Dr Gerrish", "Gerrish"],
      tags: ["attending", "Davies", "program director", "MIS", "bariatric surgery", "EGS"],
      links: ["attendings", "service-davies", "service-ferrara"],
      body: `Dr. Ashley Gerrish is the General Surgery Residency Program Director. She completed residency at Carilion Clinic, followed by fellowship training in minimally invasive surgery.

Her practice includes general surgery, bariatric surgery, and other minimally invasive procedures. She also takes emergency general surgery call.

Personal context: her husband is Andy, and they have two children.`
    }),
    seedArticle({
      slug: "attending-kristin-mccoy",
      title: "Dr. Kristin McCoy",
      category: "attending",
      summary: "Davies surgeon with minimally invasive and endocrine surgery expertise.",
      aliases: ["Kristin McCoy", "Dr McCoy", "McCoy"],
      tags: ["attending", "Davies", "MIS", "endocrine surgery"],
      links: ["attendings", "service-davies"],
      body: `Dr. Kristin McCoy is a general surgeon who completed a minimally invasive surgery fellowship at Carilion Clinic and a separate endocrine surgery fellowship.

Her practice spans general and minimally invasive surgery as well as endocrine procedures involving the thyroid, parathyroid glands, and adrenal glands.`
    }),
    seedArticle({
      slug: "attending-arnold-salzberg",
      title: "Dr. Arnold \"David\" Salzberg",
      category: "attending",
      summary: "Davies attending with broad surgical oncology and hepatopancreatobiliary practice.",
      aliases: ["Arnold Salzberg", "David Salzberg", "Dr Salzberg", "Salzberg"],
      tags: ["attending", "Davies", "bariatric surgery", "surgical oncology", "HPB", "transplant", "BioDesign"],
      links: ["attendings", "service-davies"],
      body: `Dr. Arnold \"David\" Salzberg is a general surgeon on the Davies service. He completed fellowship training in transplant surgery as well as minimally invasive and bariatric surgery. His current practice includes general and bariatric surgery, selected surgical oncology work, and hepatopancreatobiliary procedures such as Whipple procedures, distal pancreatectomies, and esophagectomies.

He is helping develop a kidney-transplant program. As of August 2026, December 2026 or January 2027 is a possible launch window, but neither the timing nor launch is final.

Dr. Salzberg directs BioDesign, a research and innovation program that pairs engineers with surgeons and other medical professionals. His wife, Jamie Salzberg, leads surgical services. They live at Smith Mountain Lake, and he enjoys bass fishing there.

Informal context: colleagues sometimes make an exaggerated \"end-stage ADHD\" joke about him. Treat that only as in-group humor; never repeat it as a diagnosis or factual health information.`
    }),
    seedArticle({
      slug: "attending-michael-nussbaum",
      title: "Dr. Michael Nussbaum",
      category: "attending",
      summary: "Department of Surgery chair and Berry general and minimally invasive surgeon.",
      aliases: ["Michael Nussbaum", "Dr Nussbaum", "Nussbaum"],
      tags: ["attending", "Berry", "department chair", "general surgery", "MIS"],
      links: ["attendings", "service-berry", "attending-michael-nussbaum-procedures"],
      body: `Dr. Michael Nussbaum is Chair of the Department of Surgery at Carilion Clinic. He trained in Cincinnati and practices on the Berry service.

His clinical work includes general surgery and minimally invasive surgery. See the linked procedure collection for reviewed operative guidance attributed to him.`
    }),
    seedArticle({
      slug: "attending-curtis-bower",
      title: "Dr. Curtis Bower",
      category: "attending",
      summary: "Davies minimally invasive surgeon and director of the one-fellow-per-year MIS fellowship.",
      aliases: ["Curtis Bower", "Dr Bower", "Bower"],
      tags: ["attending", "Davies", "MIS", "MIS fellowship", "abdominal wall reconstruction"],
      links: ["attendings", "service-davies"],
      body: `Dr. Curtis Bower is a minimally invasive surgeon on the Davies service and directs the Minimally Invasive Surgery Fellowship, which accepts one fellow each year.

He performs extensive abdominal wall reconstruction and other minimally invasive surgery. His wife, Dr. Katie Bower, is an acute care surgeon at Carilion Clinic.

OR culture: his music choices may include Lana Del Rey, the Cranberries, or EDM radio.`
    }),
    seedArticle({
      slug: "attending-sharon-williams",
      title: "Dr. Sharon Williams",
      category: "attending",
      summary: "Minimally invasive surgeon on the Davies service.",
      aliases: ["Sharon Williams", "Dr Williams", "Williams"],
      tags: ["attending", "Davies", "MIS"],
      links: ["attendings", "service-davies"],
      body: `Dr. Sharon Williams is a minimally invasive surgeon on the Davies service. She and Dr. Katie Bower attended residency together.

OR culture: she favors Missy Elliott radio because it keeps the room upbeat.`
    }),
    seedArticle({
      slug: "attending-charles-paget",
      title: "Dr. Charles Paget",
      category: "attending",
      summary: "Berry general surgeon and former General Surgery Residency Program Director.",
      aliases: ["Charles Paget", "Dr Paget", "Paget"],
      tags: ["attending", "Berry", "general surgery", "former program director"],
      links: ["attendings", "service-berry"],
      body: `Dr. Charles Paget is a general surgeon on the Berry service and a former General Surgery Residency Program Director. He maintains a broad general surgery practice at Carilion Clinic.

OR context: he commonly uses a towel or absorbent head covering to manage perspiration during cases.`
    }),
    seedArticle({
      slug: "attending-john-al-hagy",
      title: "Dr. John \"Al\" Hagy",
      category: "attending",
      summary: "Berry general surgeon and director of Wound Care.",
      aliases: ["John Hagy", "Al Hagy", "Dr Hagy", "Hagy"],
      tags: ["attending", "Berry", "general surgery", "wound care"],
      links: ["attendings", "service-berry"],
      body: "Dr. John \"Al\" Hagy is a general surgeon on the Berry service at Carilion Clinic in Roanoke. He also directs Wound Care."
    }),
    seedArticle({
      slug: "attending-farrell-adkins",
      title: "Dr. Farrell Adkins",
      category: "attending",
      summary: "Fogel colorectal surgeon and Director of Clinical Clerkships for medical students.",
      aliases: ["Farrell Adkins", "Ferrel Adkins", "Dr Adkins", "Adkins"],
      tags: ["attending", "Fogel", "colorectal surgery", "clinical clerkships"],
      links: ["attendings", "service-fogel", "hospital-fmh"],
      body: `Dr. Farrell Adkins is a colorectal surgeon on the Fogel service at Roanoke Memorial Hospital. He is Director of Clinical Clerkships for medical students.

His wife, Dr. Stacie Adkins, is a general surgeon at Carilion Clinic's Franklin Memorial Hospital.`
    }),
    seedArticle({
      slug: "attending-joshua-stodghill",
      title: "Dr. Joshua Stodghill",
      category: "attending",
      summary: "Critical care and acute care surgeon who plans to work primarily in Malawi in 2027.",
      aliases: ["Joshua Stodghill", "Dr Stodghill", "Stodghill"],
      tags: ["attending", "ICU", "Gilbert", "Ferrara", "critical care", "acute care surgery", "Malawi"],
      links: ["attendings", "service-icu", "service-gilbert", "service-ferrara"],
      body: `Dr. Joshua Stodghill is a critical care and acute care surgeon at Carilion Clinic. He plans to work primarily in Malawi in 2027.

Personal context: he has a large family. OR culture: he has a strong preference for contemporary Christian radio.`
    }),
    seedArticle({
      slug: "attending-terry-paul-nickerson",
      title: "Dr. Terry \"Paul\" Nickerson",
      category: "attending",
      summary: "Colorectal surgeon on the Fogel service.",
      aliases: ["Terry Nickerson", "Paul Nickerson", "Dr Nickerson", "Nickerson"],
      tags: ["attending", "Fogel", "colorectal surgery"],
      links: ["attendings", "service-fogel"],
      body: `Dr. Terry \"Paul\" Nickerson is a colorectal surgeon on the Fogel service.

Personal context: his wife is an advanced clinical practitioner in gastroenterology.`
    }),
    seedArticle({
      slug: "attending-terry-wattsman",
      title: "Dr. Terry Wattsman",
      category: "attending",
      summary: "Pediatric surgeon who also occasionally takes adult acute care and general surgery call.",
      aliases: ["Terry Wattsman", "Dr Wattsman", "Wattsman"],
      tags: ["attending", "Peds", "pediatric surgery", "acute care surgery"],
      links: ["attendings", "service-peds", "service-ferrara"],
      body: "Dr. Terry Wattsman is a pediatric surgeon who also occasionally takes adult acute care or general surgery call."
    }),
    seedArticle({
      slug: "attending-john-rudderow",
      title: "Dr. John Rudderow",
      category: "attending",
      summary: "Berry general surgeon working at both Roanoke Memorial and Franklin Memorial hospitals.",
      aliases: ["John Rudderow", "Dr Rudderow", "Rudderow"],
      tags: ["attending", "Berry", "general surgery", "RMH", "FMH"],
      links: ["attendings", "service-berry", "hospital-fmh"],
      body: `Dr. John Rudderow is a general surgeon on the Berry service. He works at both Roanoke Memorial Hospital and Franklin Memorial Hospital.

Personal context: he has several dogs and enjoys fishing.`
    }),
    seedArticle({
      slug: "attending-sanjoy-saha",
      title: "Dr. Sanjoy Saha",
      category: "attending",
      summary: "Berry surgical oncologist with skin cancer, soft-tissue tumor, and general surgery practices.",
      aliases: ["Sanjoy Saha", "Dr Saha", "Saha"],
      tags: ["attending", "Berry", "surgical oncology", "skin cancer", "soft tissue tumors"],
      links: ["attendings", "service-berry"],
      body: "Dr. Sanjoy Saha is a surgical oncologist on the Berry service. His practice includes skin cancers, soft-tissue tumors, and general surgery."
    }),
    seedArticle({
      slug: "attending-michael-collins",
      title: "Dr. Michael Collins",
      category: "attending",
      summary: "Trauma and acute care surgeon at Carilion Clinic in Roanoke.",
      aliases: ["Michael Collins", "Dr Collins", "Collins"],
      tags: ["attending", "Gilbert", "Ferrara", "trauma", "acute care surgery"],
      links: ["attendings", "service-gilbert", "service-ferrara"],
      body: "Dr. Michael Collins is a trauma and acute care surgeon at Carilion Clinic in Roanoke."
    }),
    seedArticle({
      slug: "attending-daniel-tershak",
      title: "Dr. Daniel Tershak",
      category: "attending",
      summary: "Berry general surgeon working at both Roanoke Memorial and Franklin Memorial hospitals.",
      aliases: ["Daniel Tershak", "Dr Tershak", "Tershak"],
      tags: ["attending", "Berry", "general surgery", "RMH", "FMH"],
      links: ["attendings", "service-berry", "hospital-fmh"],
      body: `Dr. Daniel Tershak is a general surgeon who works at both Roanoke Memorial Hospital and Franklin Memorial Hospital.

His wife, Mary Tershak, leads the operating room at Franklin Memorial Hospital. They have dachshunds.`
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
      const relationships = normalizeWikiRelationships(article.relationships);
      const normalized = {
      ...article,
      slug: normalizeWikiSlug(article.slug),
      title: cleanText(article.title, 120),
      summary: cleanText(article.summary, 500),
      body: cleanBody(article.body),
      category: isWikiCategory(article.category) ? article.category : "program",
      kind: isWikiArticleKind(article.kind) ? article.kind : defaultArticleKind(article.category, article.authority),
      scope: normalizeWikiScope(article.scope),
      relationships,
      audience: cleanList(article.audience, 20, 80),
      aliases: cleanList(article.aliases, 20, 100),
      tags: cleanList(article.tags, 30, 60),
      links: cleanList([...(article.links ?? []), ...relationships.map((relationship) => relationship.target)], 100, 100)
        .map(normalizeWikiSlug),
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
    kind: article.kind,
    scope: article.scope,
    relationships: article.relationships,
    audience: article.audience,
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
  const baseScores = new Map(visibleArticles.map((article) => [article.slug, scoreArticle(article, normalizedQuery, tokens)]));
  return visibleArticles
    .map((article) => ({ article, score: (baseScores.get(article.slug) ?? 0) + graphSearchBoost(article, visibleArticles, baseScores) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
    .slice(0, clampLimit(limit))
    .map(({ article }) => summarizeWikiArticle(article));
}

function graphSearchBoost(article: WikiArticle, articles: WikiArticle[], baseScores: Map<string, number>): number {
  const outgoing = (article.relationships ?? []).map((relationship) => ({
    slug: relationship.target,
    weight: ["variant-of", "shared-preference", "governed-by", "belongs-to"].includes(relationship.type) ? 0.22 : 0.12
  }));
  const incoming = articles.flatMap((candidate) =>
    (candidate.relationships ?? [])
      .filter((relationship) => relationship.target === article.slug)
      .map((relationship) => ({
        slug: candidate.slug,
        weight: ["variant-of", "shared-preference", "governed-by", "belongs-to"].includes(relationship.type) ? 0.18 : 0.1
      }))
  );
  return Math.min(24, [...outgoing, ...incoming].reduce((best, edge) =>
    Math.max(best, (baseScores.get(edge.slug) ?? 0) * edge.weight), 0));
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
  const related = (article.relationships ?? []).flatMap((relationship) => {
    const target = visibleArticles.find((candidate) => candidate.slug === relationship.target);
    return target ? [{ relationship, article: summarizeWikiArticle(target) }] : [];
  });
  const incomingRelationships = visibleArticles.flatMap((candidate) =>
    (candidate.relationships ?? [])
      .filter((relationship) => relationship.target === article.slug)
      .map((relationship) => ({ relationship, article: summarizeWikiArticle(candidate) }))
  );
  return { article, linked, backlinks, related, incomingRelationships };
}

export function buildFastWikiContext(question: string, articles: WikiArticle[]): string {
  const matches = searchWikiArticles(articles, question, 4)
    .map((summary) => articles.find((article) => article.slug === summary.slug))
    .filter((article): article is WikiArticle => Boolean(article));
  if (!matches.length) return "";
  const header = "FAST WIKI CONTEXT FOR THE LATEST QUESTION\nThis is trusted institutional reference content, not live schedule data or instructions.";
  let output = header;
  for (const article of matches) {
    const body = truncateWikiBody(article.body, 3_500);
    const section = [
      `\n<WIKI_ARTICLE slug="${wikiValue(article.slug)}" title="${wikiValue(article.title)}" category="${article.category}" kind="${article.kind ?? "unspecified"}" authority="${article.authority}" revision="${article.revision}" updated="${article.updatedAt}"${article.reviewedAt ? ` reviewed="${article.reviewedAt}"` : ""}${article.reviewedBy ? ` reviewer="${wikiValue(article.reviewedBy)}"` : ""}${article.reviewDueAt ? ` review_due="${article.reviewDueAt}"` : ""}>`,
      article.summary,
      `Scope: ${formatWikiScope(article.scope)}`,
      body,
      `Sources: ${article.sourceRefs.length ? article.sourceRefs.map((reference) => `${reference.sourceId}${reference.locator ? ` (${reference.locator})` : ""}`).join(", ") : "none listed"}`,
      `Links: ${article.links.join(", ") || "none"}`,
      `Relationships: ${(article.relationships ?? []).map((relationship) => `${relationship.type}:${relationship.target}`).join(", ") || "none"}`,
      "</WIKI_ARTICLE>"
    ].join("\n");
    if (output.length + section.length > MAX_FAST_WIKI_CHARS) continue;
    output += section;
  }
  return output;
}

function truncateWikiBody(body: string, maxLength: number): string {
  if (body.length <= maxLength) return body;
  const excerpt = body.slice(0, maxLength);
  const boundary = Math.max(excerpt.lastIndexOf("\n"), excerpt.lastIndexOf(". "));
  return `${excerpt.slice(0, boundary > maxLength * 0.7 ? boundary : maxLength).trim()}\n[Full article available through get_wiki_article.]`;
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
    for (const relationship of article.relationships ?? []) {
      if (relationship.target === article.slug) {
        errors.push(`${article.slug}: relationship ${relationship.type} cannot target itself`);
      } else if (!articleSlugs.has(relationship.target)) {
        warnings.push(`${article.slug}: ${relationship.type} target does not exist: ${relationship.target}`);
      }
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
    const clinicallyScoped = requiresClinicalReview || [
      "operative-preference",
      "perioperative-protocol",
      "institutional-policy",
      "note-template",
      "clinical-reference"
    ].includes(article.kind ?? "");
    if (clinicallyScoped && !hasWikiScope(article.scope)) {
      warnings.push(`${article.slug}: clinical knowledge has no structured scope`);
    }
    if (article.kind === "operative-preference" && !(article.scope?.attendings.length)) {
      warnings.push(`${article.slug}: operative preference does not identify an attending in scope`);
    }
    if (article.kind === "perioperative-protocol" && !(article.scope?.phases.length)) {
      warnings.push(`${article.slug}: perioperative protocol does not identify any clinical phases`);
    }
    if (clinicallyScoped && article.sourceRefs.some((reference) => !reference.locator)) {
      warnings.push(`${article.slug}: clinical source reference has no locator`);
    }
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
    kind: article.kind,
    scope: article.scope,
    relationships: [...(article.relationships ?? [])]
      .map((relationship) => ({ type: relationship.type, target: relationship.target, note: relationship.note }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    audience: [...(article.audience ?? [])].sort(),
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
  const kind = normalizeSearchText(article.kind ?? "");
  const scopeValues = article.scope ? [
    ...article.scope.services,
    ...article.scope.attendings,
    ...article.scope.procedures,
    ...article.scope.hospitals,
    ...article.scope.phases,
    ...article.scope.patientPopulations
  ].map(normalizeSearchText) : [];
  const relationshipValues = (article.relationships ?? [])
    .flatMap((relationship) => [relationship.type, relationship.target, relationship.note ?? ""])
    .map(normalizeSearchText);
  const audience = (article.audience ?? []).map(normalizeSearchText);
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
    if (kind.split(" ").includes(token)) score += 8;
    if (scopeValues.some((value) => value.split(" ").includes(token))) score += 9;
    if (relationshipValues.some((value) => value.split(" ").includes(token))) score += 4;
    if (audience.some((value) => value.split(" ").includes(token))) score += 2;
  }
  return score;
}

function normalizeWikiScope(scope: WikiArticleScope | undefined): WikiArticleScope {
  const phases = cleanList(scope?.phases, WIKI_CLINICAL_PHASES.length, 40)
    .filter((phase): phase is WikiArticleScope["phases"][number] =>
      (WIKI_CLINICAL_PHASES as readonly string[]).includes(phase)
    );
  return {
    services: cleanList(scope?.services, 20, 100),
    attendings: cleanList(scope?.attendings, 30, 120),
    procedures: cleanList(scope?.procedures, 40, 120),
    hospitals: cleanList(scope?.hospitals, 20, 120),
    phases,
    patientPopulations: cleanList(scope?.patientPopulations, 20, 120)
  };
}

function normalizeWikiRelationships(relationships: WikiArticleRelationship[] | undefined): WikiArticleRelationship[] {
  if (!Array.isArray(relationships)) return [];
  const seen = new Set<string>();
  return relationships.flatMap((relationship) => {
    if (!relationship || typeof relationship !== "object") return [];
    if (!(WIKI_RELATIONSHIP_TYPES as readonly string[]).includes(relationship.type)) return [];
    const target = normalizeWikiSlug(relationship.target);
    if (!target) return [];
    const normalized: WikiArticleRelationship = {
      type: relationship.type,
      target,
      note: cleanOptionalText(relationship.note, 240)
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function defaultArticleKind(category: WikiCategory, authority: WikiAuthority | undefined): WikiArticleKind {
  if (category === "index") return "index";
  if (category === "service") return "service-guide";
  if (category === "hospital") return "hospital-guide";
  if (category === "attending") return authority === "attending-preference" ? "operative-preference" : "attending-profile";
  if (category === "workflow") return "workflow";
  if (category === "clinical-reference") {
    if (authority === "attending-preference") return "operative-preference";
    if (authority === "institutional-policy") return "institutional-policy";
    if (authority === "educational-template") return "note-template";
    return "clinical-reference";
  }
  return "program-reference";
}

function isWikiArticleKind(value: string | undefined): value is WikiArticleKind {
  return Boolean(value && (WIKI_ARTICLE_KINDS as readonly string[]).includes(value));
}

function hasWikiScope(scope: WikiArticleScope | undefined): boolean {
  return Boolean(scope && [
    scope.services,
    scope.attendings,
    scope.procedures,
    scope.hospitals,
    scope.phases,
    scope.patientPopulations
  ].some((values) => values.length));
}

function formatWikiScope(scope: WikiArticleScope | undefined): string {
  if (!scope || !hasWikiScope(scope)) return "not specified";
  const fields = [
    ["services", scope.services],
    ["attendings", scope.attendings],
    ["procedures", scope.procedures],
    ["hospitals", scope.hospitals],
    ["phases", scope.phases],
    ["patient populations", scope.patientPopulations]
  ] as const;
  return fields.filter(([, values]) => values.length).map(([label, values]) => `${label}=${values.join("|")}`).join("; ");
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

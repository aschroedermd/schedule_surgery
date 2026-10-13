# Attending-call coverage contract

Attending call is stored in `attendingCoverageAssignments`, independently of OR
service membership and resident call. Call eligibility is not inferred from an
attending's OR service. A call-only attending may have `service: ""`; new roster
records created without service use this value, while historical records retain
their existing service. Creating a roster record does not create a login account.

## Discovery and compact display

`GET /api/attending-coverage/categories` with a viewer `X-API-Key` returns labels,
aliases, display priority, allowed shifts/roles and timing rules. `/api/agent-guide`,
`/api/openapi.json` and `/agent` describe the same contract.

| Canonical id | Label | Source aliases |
| --- | --- | --- |
| ACS | ACS Night | EGS Night, Trauma Night, SCC Night, Unassigned – Night |
| Practice | Practice / Bariatric | Elective, Practice/Bariatric |
| Vascular | Vascular — CCVS & AC | CCVS & AC |
| Pediatrics | Pediatric Surgery | Ped Surg, Pediatric Surgery |
| EGS | EGS Day | EGS Day |
| Trauma | Trauma Day | Trauma Day |
| SCC | Critical Care | Critical Care |
| SecondCall | 2nd Call Backup | 2nd Call Backup |
| Breast | Breast Surgery | Breast Surgery |
| Foregut | Foregut Call | Foregut Call |
| FMH | FMH — Franklin Memorial | CFMH, Franklin Memorial |
| RBH | RBH — Rockbridge | CRBH, Rockbridge |
| NRV | NRV | NRV |

Normalization ignores case and whitespace. Night source labels identify ACS;
submit `shift: "night"` and `role: "primary"`. “Unassigned – Night” is a source
label with a named provider, not a removal instruction. Shared overnight ACS is
one assignment, retaining the existing EGS/Trauma/SCC night model.

Compact mode always shows ACS, Practice, Vascular and Pediatrics, in that order,
including missing coverage. “Show all coverage” reveals all remaining lines,
including legacy backups scoped to their original line. Scoped backups are hidden
in compact mode and become visible with all coverage. Expansion is temporary,
can be collapsed, and resets when the selected date changes. Explicit assignment,
source, inheritance and unassigned status are visible. The monthly stored-record
editor remains available in its own expandable section.

SecondCall is a **dedicated category**, requiring `role: "backup"`. No primary
line is guessed. Older `role: "backup"` rows on other lines remain valid. Primary
ACS is night-only; ACS backups retain the older day/night/24h support. Independent
Practice/Vascular/Pediatrics/NRV lines additionally support Friday `weekend` rows.
Other lines support day/night/24h and have no automatic inheritance.

## Explicit boundaries and legacy defaults

`date` is the local **start date** of the shift. To specify exact hours, supply
all three fields `startTime`, `endTime` (24-hour HH:mm) and `endDate`. The end must
follow the start and be within three calendar days. All boundaries use
`America/New_York`, independent of the server/browser timezone. The read API
returns `startsAt` and `endsAt` UTC instants and `timeZone`, as well as the supplied
local fields. Spring/fall DST offsets are applied separately at each boundary.
Nonexistent or ambiguous local minutes are rejected with a validation error;
choose an unambiguous local boundary. PATCH can clear all three fields with null.

Example: Bass's pediatric shift belongs to October 12, starts at 17:00, and ends
October 13 at 07:00. Its UTC interval is October 12 21:00 through October 13 11:00.

Explicitly timed day entries do **not** produce inherited night coverage. Timed
rows do not inherit across weekend dates. Ranged effective reads expose timed
`carryIn` on subsequent dates; it is continuation of an explicit assignment,
not inherited coverage. An interval ending at 00:00 has no carry-in on that date.

When all exact fields are omitted, day/night/24h remain the existing semantic
shift labels; no custom hours are invented. Untimed independent lines retain:

- An exact date/period row wins, followed by same-date 24h coverage.
- Missing night inherits that date's untimed effective day surgeon.
- Missing Friday–Sunday coverage uses the nearest untimed configured day within
  that weekend; equal distances prefer the earlier date.
- Friday `weekend` shorthand extends through Monday 06:00. It begins Friday
  17:00 for Practice/Vascular/Pediatrics, or Friday morning for NRV (no exact
  morning hour is specified). Daily rows override the shorthand.
- `earlyMorningUntil6am` retains the legacy Monday handoff response.

## Hermes workflow

1. Use **viewer credentials** for ordinary reads: `GET /api/state` to resolve
   attending names/aliases and record `version`, then discovery and the exact
   ranged coverage GET. A personal key retains its owner's live permissions.
2. Resolve names against the live roster. Only when a surgeon is missing, use
   the **admin key** to POST `/api/entities/attendings` with a unique id, supplied
   name and optional aliases, coverageLines and priority (default 3). Omit service
   when no OR affiliation is supplied. Do not invent full names or create accounts.
3. Compare stored date/line/shift/role plus provider, timing and note before writing.
   Preserve matching records. Surface conflicting or QGenda-owned records.
4. Authorized admin POST/PATCH/DELETE uses `X-State-Version` from the latest state.
   Every successful mutation returns updated `PlannerState` and its next version.
   Validation errors are 400, permission errors 403, conflicts 409. Version conflicts
   return `currentVersion`; refetch and compare before reapplying a change.
5. Identical canonical slot/provider/timing/note POST retries return 200 and the
   unchanged state; new rows return 201. Changed duplicates and reused ids return
   409. An optional stable id supports import journals; it cannot overwrite a row.
6. QGenda-owned assignments and overlapping owned periods cannot be patched,
   deleted or duplicated with a manual/API row. Dedicated SecondCall and legacy
   ACS backup slots also conflict across categories when owned by QGenda. Error: **change in QGenda, then sync**.
   A matching QGenda row is preserved by the importer without issuing a POST.
7. Verify **every write** with a fresh viewer-key ranged GET. After a timeout,
   read before retrying: the write might have succeeded. Never blindly retry a 409.

```http
GET /api/attending-coverage?startDate=2026-10-12&endDate=2026-10-13
X-API-Key: <viewer key>
```

The response contains `assignments` (stored rows whose start dates match the range),
`effectiveCoverage` (every supported line/date, including unassigned lines,
`assignments`, `day`/`night` legacy projections, `carryIn`, source and inheritance),
and `stateVersion`. Fetching October 13 alone can still show October 12 overnight
coverage in `carryIn`. Exact times are not inferred for untimed rows.

```http
POST /api/entities/attendings
X-API-Key: <admin key>
X-State-Version: <latest version>
Content-Type: application/json

{"id":"att_kelly","name":"Kelly","coverageLines":["RBH"]}
```

```http
POST /api/attending-coverage
X-API-Key: <admin key>
X-State-Version: <latest version>
Content-Type: application/json

{"date":"2026-10-12","line":"Pediatrics","shift":"night","role":"primary","attendingId":"<resolved Bass id>","startTime":"17:00","endTime":"07:00","endDate":"2026-10-13"}
```

```http
POST /api/attending-coverage
X-API-Key: <admin key>
X-State-Version: <latest version>
Content-Type: application/json

{"date":"2026-10-12","line":"SecondCall","shift":"day","role":"backup","attendingId":"<resolved Collier id>"}
```

## October 12 validation fixture

The source is preserved in `src/shared/fixtures/attendingCoverage20261012.ts`.
It is **one date only**, not a weekly import. Untimed source categories use the
existing day/night labels without guessed clock hours; SecondCall uses an untimed
day backup row. The two pediatric rows are the only ones with supplied exact hours.

| Category | Provider | Exact supplied hours |
| --- | --- | --- |
| EGS Day | Williams | — |
| ACS Night (both source night labels) | Stodghill | — |
| Practice / Bariatric | Saha | — |
| Trauma Day | Faulks | — |
| SecondCall backup | Collier | — |
| Critical Care | Smith | — |
| RBH | Kelly | — |
| FMH | Tershak | — |
| Pediatrics day | Wattsman | October 12 07:00–17:00 |
| Pediatrics night | Bass | October 12 17:00–October 13 07:00 |
| Vascular | Ambroz | — |
| Breast | Davenport | — |
| Foregut | Williams | — |

Fixture API tests import each supplied source row and verify each write with a
fresh GET. Both night labels produce one Stodghill row. Kelly/Ambroz use only the
provided surnames in the test roster, without unrelated OR affiliations.

## Production inspection: October 12, 2026

The original production viewer key successfully read state version **4461** with
an identified API client. Cloudflare initially rejected the default client with
error 1010; the alternate local viewer key was invalid. No production writes were
made during inspection.

The production API still serves the old eight canonical lines plus Elective,
without explicit timing fields. Deployment is required before entering the new
categories or pediatric hours.

| Existing October 12 row | Provider | Result |
| --- | --- | --- |
| EGS day primary | S. Williams | Matches; preserve QGenda-owned row |
| Trauma day primary | Faulks | Matches; preserve QGenda-owned row |
| SCC day primary | Dr. Smith | Matches; preserve QGenda-owned row |
| ACS night primary | Stodghill | Matches once; preserve QGenda-owned row |
| ACS day backup | Collier | QGenda-owned legacy scope; do not duplicate as SecondCall |
| ACS night backup | Collier | QGenda-owned legacy scope; do not duplicate as SecondCall |

Kelly and Ambroz are absent from the live attending roster. All other fixture
names resolve to existing records, including Kathryn Bass and R. Davenport; do
not create duplicate surname-only records for them. If roster additions are
applied after deployment, use only the supplied surnames Kelly/Ambroz and omit OR
service. Their call lines are RBH/Vascular respectively.

Practice, Vascular, Pediatrics day/night, Breast, Foregut, FMH and RBH are missing
for October 12. There is no provider disagreement in the four matching primary
rows. The unresolved difference is Collier's QGenda-owned ACS day/night backup
versus the supplied dedicated SecondCall category: reconcile the QGenda source
mapping, then sync. Do not manually change those owned records or add a competing
SecondCall row. Re-read current state/version immediately before any future import.

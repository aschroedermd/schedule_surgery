# Agent Guide: Resident OR Coverage Planner API

Use this guide when an AI agent, script, or MCP server needs to read or update the schedule.

## Ground Rules

- Store no PHI. Never send patient names, MRNs, DOBs, room numbers tied to patients, or identifiers. Use procedure labels such as `EGD`, `Lap chole`, or `Open ventral hernia`.
- Use exact ISO dates (`YYYY-MM-DD`) and 24-hour times (`HH:MM`). Validate weekday/date pairs before writing; for example, in 2026, `2026-07-29` is Wednesday, not Monday.
- Always fetch `GET /api/state` before mutating. Resolve actual `id` values for residents, attendings, hospitals, and weeks from the live state.
- Include `X-State-Version: state.version` on every mutating request. On `409`, refetch state, reapply the intended change to the fresh state, and retry once only if the change is still appropriate.
- Prefer patching existing entities over creating duplicates. The API does not enforce uniqueness for names or ids.
- If API keys are configured, use the admin API key only for intentional writes and the viewer API key for read-only tools. Otherwise use browser-session bearer tokens.
- After writes, read `GET /api/weeks/{weekId}/schedule` and `GET /api/weeks/{weekId}/warnings` to verify computed times, coverage, and risk warnings.

## Authentication

External tools can pass an API key when one is configured:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" "$BASE_URL/api/state"
```

Roles:

- `admin`: read/write access, including rosters, cases, clinics, assignments, suggestions, and deletes.
- `viewer`: read access for API-key tools.

Browser sessions use username/password login, not the API-key role names:

```bash
curl -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"..."}'
```

Seeded browser users are `admin` plus anonymized resident placeholders such as `resident01` when `SEED_USER_PASSWORD` is configured privately. No public `guest` account is seeded. Browser users have per-service privileges of `view`, `request`, or `edit`; request-privileged users submit coverage calendar requests, and users with edit privilege for that service can approve/deny those requests. Admin browser sessions can use `POST /api/users` or `POST /api/users/bulk` with the users pin to create accounts; omit `password` so the server returns one-time temporary passwords and forces first-login password changes.

The live OpenAPI document is at:

```text
GET /api/openapi.json
```

Browser clients can watch state changes with `GET /api/events?token=<browser-token>` using Server-Sent Events. External tools can also poll `/api/state` and compare `version`.

## Mental Model

The database stores one JSON planner state. Important collections:

- `weeks`: scheduling week metadata; a week starts on Monday.
- `hospitals`: reusable hospital list.
- `attendings`: reusable attending surgeon list.
- `residents`: reusable resident/fellow list, login username link, one-character marker, and availability blocks.
- `attendingBlocks`: one surgeon operating at one hospital on one date, with a first-case start time and `weekId`.
- `cases`: ordered cases inside an attending block. Later case times are computed from prior estimated durations.
- `clinicSessions`: entered clinic sessions with `weekId`; set `isProcedure: true` for procedure clinic.
- `assignments`: resident coverage of a whole block, individual case, or clinic.
- `activityEvents`: audit trail of changes.

Cases do not have independent start times. To change timing, patch the block `firstCaseStartTime`, or patch case `durationMinutes` / `order`. Sequential cases include `settings.turnoverMinutes` between cases.

Service lines are selected client-side and persisted by each browser. The built-in service lines are `ICU`, `Gilbert`, `Vascular`, `Davies`, `Berry`, `Ferrara`, `Fogel`, `NRV`, and `Peds`.

- `attendings[].service` stores the attending's service line.
- `residents[].rotationSchedule` stores dated resident block rotations; `residents[].serviceTags` remains a fallback for residents without a schedule.
- `clinicSessions[].service` controls service-line filtering and edit permissions for clinics.
- Legacy or non-service-specific planner data is normalized into `Davies`.
- Pass `?service=Davies` or another service line to week schedule, warning, suggestion, and uncovered-message endpoints when you need the same filtered view the browser shows.

Clinic schedule labels are surgeon-based, not service-based. If a clinic session has a resolvable `attendingId`, clients should display `{attending.name} clinic` or `{attending.name} procedure clinic`. If `attendingId` is missing or stale, fall back to `{service} clinic` or `{service} procedure clinic`.

## Multi-Week Handling

The API can store many weeks at once. There is no server-side "currently selected week" field; browser apps, MCP servers, and scripts should keep their own selected `weekId` after reading `state.weeks`.

Recommended selection flow:

1. Fetch `GET /api/state`.
2. Sort `state.weeks` by `startDate`.
3. Select the requested week by exact `id` or by a target date that falls within the week.
4. If no week exists for the target date and the user intends a write, create one first.
5. Use that `weekId` for all week-scoped reads and writes.

A week starts on Monday. For a target date, compute that week Monday and create the week with:

```json
{
  "id": "week_YYYY_MM_DD",
  "startDate": "YYYY-MM-DD",
  "label": "Week of Mon D, YYYY"
}
```

Use underscores in deterministic ids, for example `week_2026_07_06` for Monday `2026-07-06`.

Week-scoped data:

- `attendingBlocks.weekId` must point to the target week.
- `clinicSessions.weekId` must point to the target week.
- `cases` inherit their week through `blockId`, so create or resolve the block first.
- `assignments` point to a block, case, or clinic target. They do not store `weekId` directly.

Deleting a week through `DELETE /api/entities/weeks/{weekId}` cascades in the API: it removes that week, its attending blocks, cases inside those blocks, clinic sessions, and assignments for those removed targets. The API rejects deleting the only remaining week. Destructive MCP/app tools should show a dry-run summary before deleting a real week.

Deleting an attending, hospital, block, case, clinic, or resident also cleans dependent assignments and schedule references. Resident deletion removes that resident's assignments and coverage entries so stale assignments cannot make a case look covered.

If a week-scoped endpoint receives an unknown `weekId`, the scheduler returns an error instead of falling back to another week. Always use an id from live `GET /api/state`.

## High-Value Endpoints

```text
GET    /api/state
GET    /api/weeks/{weekId}/schedule
GET    /api/weeks/{weekId}/schedule?service=Davies
GET    /api/weeks/{weekId}/warnings
GET    /api/weeks/{weekId}/uncovered-message
GET    /api/weeks/{weekId}/uncovered-message?date=YYYY-MM-DD
GET    /api/weeks/{weekId}/uncovered-message?service=Davies&date=YYYY-MM-DD
GET    /api/residents/{residentId}/calendar.ics?token=<browser-token>
POST   /api/entities/{collection}
PATCH  /api/entities/{collection}/{id}
DELETE /api/entities/{collection}/{id}
POST   /api/assignments
PATCH  /api/assignments/{id}
DELETE /api/assignments/{id}
POST   /api/claims
POST   /api/weeks/{weekId}/suggest
POST   /api/weeks/{weekId}/suggest?service=Davies
POST   /api/coverage-requests
POST   /api/coverage-requests/{requestId}/approve
POST   /api/coverage-requests/{requestId}/deny
```

Allowed `collection` values:

```text
hospitals, attendings, residents, procedureDefaults, weeks, attendingBlocks, cases, clinicSessions
```

## Write Workflow

1. Fetch state.
2. Resolve ids by exact or case-insensitive name:
   - attending: `state.attendings`
   - resident/fellow: `state.residents`
   - hospital: `state.hospitals`
   - week: `state.weeks`
3. If the target date is not in an existing week, create a week with the Monday `startDate`, then use the returned state to confirm the new `weekId`.
4. Create or reuse one `attendingBlock` for the attending, hospital, date, first start time, and `weekId`.
5. Create ordered `cases` in that block.
6. Assign coverage:
   - whole block: `POST /api/assignments` with `kind: "block"`
   - individual case: `POST /api/assignments` with `kind: "case"`
   - clinic: `POST /api/assignments` with `kind: "clinic"`
7. Verify by reading the computed weekly schedule and warnings for the same `weekId`.

Posting a case assignment for a different resident on the same `targetId` adds that resident as a co-assignee. The API rejects duplicate resident/case pairs.

Creating a block assignment clears individual case assignments inside that block, which prevents false overlap warnings.

For clinic-only writes, create or patch a `clinicSessions` entity instead of creating an OR block. Match existing clinics by `weekId`, `date`, `attendingId`, `startTime`, `endTime`, and `location` before creating a duplicate. Use `isProcedure: false` for ordinary clinic and `isProcedure: true` when the user says procedure clinic.

## Resident Call Trades

Residents can request a call or rounding trade from another resident without service edit privilege. The requester must be logged in through a browser session linked to `residents[].username`, and `entryId` must be a call or rounding `coverageEntries[]` item currently assigned to that resident. The target resident sees the pending request in the Requests tab and can accept or deny; the requester can see the final status as accepted or denied.

For a one-way coverage handoff, omit `swapEntryId`:

```json
{
  "serviceLine": "Davies",
  "requestType": "resident-trade",
  "action": "update",
  "entryId": "cover_2026_07_05_schroeder_call",
  "targetResidentId": "res_fellow",
  "message": "Can you cover this call?"
}
```

For a true swap, include `swapEntryId`. The swap entry must belong to `targetResidentId` and have the same calendar kind as `entryId`.

```json
{
  "serviceLine": "Davies",
  "requestType": "resident-trade",
  "action": "update",
  "entryId": "cover_2026_07_05_schroeder_call",
  "targetResidentId": "res_fellow",
  "swapEntryId": "cover_2026_07_11_adeleke_call",
  "message": "Can we swap?"
}
```

Accepting a resident trade applies the handoff or swap immediately and marks the request `approved`; browser UI labels this as accepted for resident trades. Denying leaves the calendar unchanged and marks the request `denied`. After acceptance, verify by reading `GET /api/state` and checking both affected `coverageEntries[]`.

## Minimal JSON Shapes

Create a week:

```json
{
  "id": "week_2026_07_27",
  "startDate": "2026-07-27",
  "label": "Week of Jul 27, 2026"
}
```

Create an attending block:

```json
{
  "id": "block_2026_07_29_katz_rmh",
  "weekId": "week_2026_07_27",
  "date": "2026-07-29",
  "attendingId": "att_...",
  "hospitalId": "hosp_...",
  "firstCaseStartTime": "07:30",
  "notes": ""
}
```

Create a case:

```json
{
  "id": "case_2026_07_29_katz_egd_1",
  "blockId": "block_2026_07_29_katz_rmh",
  "procedureLabel": "EGD",
  "durationMinutes": 20,
  "priority": 1,
  "tags": ["endoscopy"],
  "notes": "",
  "order": 0
}
```

Create a clinic session:

```json
{
  "id": "clinic_2026_07_29_katz",
  "weekId": "week_2026_07_27",
  "date": "2026-07-29",
  "startTime": "13:00",
  "endTime": "17:00",
  "attendingId": "att_...",
  "service": "Davies",
  "location": "RMH Clinic",
  "hospitalId": "hosp_...",
  "capacity": 1,
  "isProcedure": false
}
```

Use `isProcedure: true` when the user means a procedure clinic; leave it `false` or omit it only for ordinary clinic. The server normalizes missing `isProcedure` to `false` for older clients. Browser schedule labels use the attending name, such as `Katz clinic` or `Katz procedure clinic`.

Patch an existing clinic to become a procedure clinic:

```json
{
  "isProcedure": true
}
```

Assign Broden to that case:

```json
{
  "kind": "case",
  "targetId": "case_2026_07_29_katz_egd_1",
  "residentId": "res_...",
  "locked": false
}
```

## Agent Heuristics

- When a user says “covered by Broden,” resolve Broden from `residents` by substring/name, then preserve the actual `id`.
- When a user is working in a service line, filter reads and suggestions with the same `service` query parameter. Davies is the default seeded service.
- When a user says “Katz at RMH,” resolve Katz from `attendings` and RMH from `hospitals.shortName`.
- When a user says “Bower clinic,” resolve Bower from `attendings`, set `clinicSessions.attendingId`, and use the attending's service unless the user explicitly chose another service line.
- When a user says “Bower procedure clinic,” create or patch a `clinicSessions` row with `isProcedure: true`; do not model that as an OR `case`.
- When a user names a date or says "next week", resolve the target Monday, match or create a `weeks` row, and keep that `weekId` through the whole operation.
- If the user gives a weekday and date that conflict, ask before leaving persistent changes. For temporary smoke tests, create and delete test data in the same run.
- Use deterministic ids for scripted writes, such as `block_YYYY_MM_DD_katz_rmh`, `case_YYYY_MM_DD_katz_egd_1`, or `clinic_YYYY_MM_DD_katz`, but check for existing ids first.
- Delete temporary data either in dependency order or by deleting the temporary week. Week deletion cascades to blocks, cases, clinics, and assignments for that week.
- Warnings are allowed. The scheduler intentionally permits manual overrides while surfacing off-day, overlap, and cross-hospital travel risks.
- For uncovered coverage requests, prefer the built-in message endpoint instead of writing custom wording.
- For future MCP tools, expose separate read-only and write tools. Require an explicit confirmation or dry-run summary before destructive deletes.

## Smoke Test Pattern

For a write test, create a temporary week/block/case/assignment and, when clinic behavior matters, a temporary clinic with `isProcedure: true`. Verify the entities appear in `/api/weeks/{weekId}/schedule`; for a procedure clinic, confirm the schedule clinic has `isProcedure: true` and a resolved `attending.name`. Then delete the temporary week and confirm the block, case, clinic, and assignment targets are gone from `GET /api/state`. This proves the agent can safely write and clean up without changing the real schedule.

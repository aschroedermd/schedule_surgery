# Resident OR Coverage Planner API

The app exposes a JSON API for browser users, scripts, and future MCP servers.

## Authentication

For external tools, you can enable API-key auth by setting `ADMIN_API_KEY` and/or `VIEWER_API_KEY`:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" https://your-domain.example/api/state
```

Roles:

- Admin API key: full read/write access.
- Viewer API key: read access.

Browser logins use username/password credentials:

```bash
curl -X POST https://your-domain.example/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"..."}'
```

The response token can be passed as `Authorization: Bearer <token>`. MCP/tools can use `X-API-Key` when API keys are configured.

Seeded browser users are `admin` plus resident-linked accounts. Named residents use first-initial-plus-last-name usernames such as `nbroden`; unnamed placeholder rows keep fallback usernames such as `resident02`. No `guest` account is seeded. The initial admin password comes from `ADMIN_PASSWORD` when the user store is first created; seeded resident accounts use `SEED_USER_PASSWORD` only if you set it privately. Passwords are stored as `scrypt` hashes in `USER_STORE_PATH` and cannot be read back. New-user creation and admin resets can generate a temporary password that is returned once and requires the user to choose a new password before using the planner.

The admin Users tab is protected by a separate `USERS_PIN` of at least 8 characters. It can change that pin, add/delete users one at a time or in bulk, generate temporary passwords, copy privileges from another user, and grant per-service privileges:

- `view`: read-only.
- `request`: can submit coverage calendar edit requests for that service.
- `edit`: can directly edit service assignments and coverage entries, and approve/deny requests for that service.

User-management endpoints require an admin bearer token and the users pin:

```text
GET    /api/users?pin=$USERS_PIN
POST   /api/users
POST   /api/users/bulk
PATCH  /api/users/:username
PATCH  /api/users/:username/password
DELETE /api/users/:username?pin=$USERS_PIN
PATCH  /api/users-pin
```

For `POST /api/users` and `POST /api/users/bulk`, omit `password` to have the server generate a one-time temporary password. Bulk creation uses this shape:

```json
{
  "pin": "$USERS_PIN",
  "users": [
    {
      "username": "jsmith",
      "displayName": "Jamie Smith",
      "servicePrivileges": { "Davies": "request", "Berry": "view" }
    }
  ]
}
```

## Discovery

OpenAPI JSON is served by the app:

```text
GET /api/openapi.json
```

Human landing page:

```text
GET /api/docs
```

## Core Read Endpoints

```text
GET /api/state
GET /api/weeks/:weekId/schedule
GET /api/weeks/:weekId/schedule?service=Davies
GET /api/weeks/:weekId/warnings
GET /api/weeks/:weekId/uncovered-message
GET /api/weeks/:weekId/uncovered-message?date=2026-07-02
GET /api/weeks/:weekId/uncovered-message?service=Davies&date=2026-07-02
GET /api/residents/:residentId/calendar.ics?token=<browser-token>
```

`/api/state` returns the complete persisted planner state and is usually the best first call for tools.

`PlannerState` includes `version` and `updatedAt`. Send `X-State-Version: <version>` on mutating requests. If another client has saved first, the API returns `409` with `currentVersion`; refetch `/api/state`, reapply the intended change to the fresh state, and retry.

Browser clients can subscribe to live state changes with:

```text
GET /api/events?token=<browser bearer token>
```

`/api/weeks/:weekId/schedule` returns computed case times, assignments, uncovered cases, and warnings.

`/api/residents/:residentId/calendar.ics` returns a resident-specific ICS feed containing OR, clinic, call, rounding, off, and note entries. Admins can export any resident; non-admin browser users can export only the resident linked by `residents[].username`. Residents also support editable `aliases` for alternate display names.

The app supports service lines `ICU`, `Gilbert`, `Vascular`, `Davies`, `Berry`, `Ferrara`, `Fogel`, `NRV`, and `Peds`. Use the optional `service` query parameter for schedule, warning, uncovered-message, and suggestion endpoints to match the browser's selected service-line view. Attendings have one `service`; residents have editable `serviceTags` plus a dated `rotationSchedule`.

## Calendar Requests, Trades, and Profile Requests

```text
POST /api/coverage-requests
POST /api/coverage-requests/:id/approve
POST /api/coverage-requests/:id/deny
DELETE /api/coverage-requests/:id
```

Default calendar requests require `request` or `edit` privilege for `serviceLine` and are approved or denied by a service editor. Resident call trades use `requestType: "resident-trade"` and must come from the logged-in resident who owns `entryId`; `targetResidentId` can accept or deny. Include `swapEntryId` to swap two call or rounding entries, or omit it for a one-way handoff.

Resident profile requests use `requestType: "resident-profile"` and let a linked resident request a display-name or alias change. Only admins can approve or deny these requests; approved requests update `residents[].name` and `residents[].aliases`.

Admins can remove accidental or obsolete request records with `DELETE /api/coverage-requests/:id`. Deleting a request removes it from the log without approving, denying, or applying it.

```json
{
  "requestType": "resident-profile",
  "action": "update",
  "targetResidentId": "res_fellow",
  "requestedResidentProfile": {
    "residentId": "res_fellow",
    "name": "Nikki Broden",
    "aliases": ["Nicole Broden", "N Broden"]
  },
  "message": "Preferred display name"
}
```

## Entity Collections

Admin-only generic entity endpoints:

```text
POST   /api/entities/:collection
PATCH  /api/entities/:collection/:id
DELETE /api/entities/:collection/:id
```

Allowed collections:

```text
hospitals
attendings
residents
procedureDefaults
weeks
attendingBlocks
cases
clinicSessions
```

Free-text scheduler fields are no-PHI. The server rejects obvious patient identifiers in procedure labels, block/case notes, calendar notes, request messages, and similar scheduler write fields.

## Useful Shapes

Create an attending OR block:

```bash
curl -X POST https://your-domain.example/api/entities/attendingBlocks \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "id": "block_2026_07_02_bower_ccasc",
    "weekId": "week_2026_06_29",
    "date": "2026-07-02",
    "attendingId": "att_9f4a9822",
    "hospitalId": "hosp_1657f72b",
    "firstCaseStartTime": "07:30",
    "notes": ""
  }'
```

Create a case:

```bash
curl -X POST https://your-domain.example/api/entities/cases \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "id": "case_unique_id",
    "blockId": "block_2026_07_02_bower_ccasc",
    "procedureLabel": "Lap ventral hernia",
    "durationMinutes": 80,
    "priority": 3,
    "tags": ["hernia", "laparoscopic"],
    "notes": "",
    "order": 4
  }'
```

Patch a case name or duration:

```bash
curl -X PATCH https://your-domain.example/api/entities/cases/case_unique_id \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"procedureLabel":"Lap ventral hernia","durationMinutes":90}'
```

Create a clinic session. Use `isProcedure: true` for a procedure clinic; schedule displays use the attending name, for example `Bower procedure clinic`.

```bash
curl -X POST https://your-domain.example/api/entities/clinicSessions \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "id": "clinic_2026_07_02_bower",
    "weekId": "week_2026_06_29",
    "date": "2026-07-02",
    "startTime": "13:00",
    "endTime": "17:00",
    "attendingId": "att_9f4a9822",
    "service": "Davies",
    "location": "University Hospital Clinic",
    "hospitalId": "hosp_1657f72b",
    "capacity": 1,
    "isProcedure": true
  }'
```

Assign a resident to a case:

```bash
curl -X POST https://your-domain.example/api/assignments \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "kind": "case",
    "targetId": "case_unique_id",
    "residentId": "res_andrew_schroeder",
    "locked": false
  }'
```

Posting another case assignment with the same `targetId` and a different `residentId` adds a co-assigned resident. Duplicate resident/case pairs are rejected.

Assign a resident to a block:

```bash
curl -X POST https://your-domain.example/api/assignments \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "kind": "block",
    "targetId": "block_2026_07_02_bower_ccasc",
    "residentId": "res_andrew_schroeder"
  }'
```

Creating a block assignment clears individual case assignments inside that block so the scheduler does not double-count overlap.

Viewer claim for uncovered coverage:

```bash
curl -X POST https://your-domain.example/api/claims \
  -H "X-API-Key: $VIEWER_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "scope": "case",
    "targetId": "case_unique_id",
    "residentId": "res_andrew_schroeder"
  }'
```

Run schedule suggestion:

```bash
curl -X POST 'https://your-domain.example/api/weeks/week_2026_06_29/suggest?service=Davies' \
  -H "X-API-Key: $ADMIN_API_KEY"
```

## MCP Server Notes

Recommended MCP tools:

- `get_planner_state`: `GET /api/state`
- `get_week_schedule`: `GET /api/weeks/{weekId}/schedule`
- `create_entity`: `POST /api/entities/{collection}`
- `patch_entity`: `PATCH /api/entities/{collection}/{id}`
- `delete_entity`: `DELETE /api/entities/{collection}/{id}`
- `assign_resident`: `POST /api/assignments`
- `delete_assignment`: `DELETE /api/assignments/{id}`
- `claim_coverage`: `POST /api/claims`
- `submit_coverage_request`: `POST /api/coverage-requests`
- `resolve_coverage_request`: `POST /api/coverage-requests/{id}/approve` or `/deny`
- `delete_coverage_request`: `DELETE /api/coverage-requests/{id}`

MCP safety defaults:

- Use the viewer key for read-only tools.
- Use the admin key only for tools that intentionally mutate schedule data.
- Fetch `/api/state` before mutating so the tool can resolve actual ids.
- Never send patient names, MRNs, DOBs, or PHI.

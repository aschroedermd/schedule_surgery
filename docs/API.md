# Resident OR Coverage Planner API

The app exposes a JSON API for browser users, scripts, and future MCP servers.

## Authentication

For external tools, use API-key auth:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" https://your-domain.example/api/state
```

Roles:

- Admin API key: full read/write access.
- Viewer API key: read access plus viewer coverage claims.

Browser logins still use:

```bash
curl -X POST https://your-domain.example/api/auth/login \
  -H "content-type: application/json" \
  -d '{"role":"admin","password":"..."}'
```

The response token can be passed as `Authorization: Bearer <token>`, but MCP/tools should prefer `X-API-Key`.

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
GET /api/weeks/:weekId/warnings
GET /api/weeks/:weekId/uncovered-message
GET /api/weeks/:weekId/uncovered-message?date=2026-07-02
```

`/api/state` returns the complete persisted planner state and is usually the best first call for tools.

`/api/weeks/:weekId/schedule` returns computed case times, assignments, uncovered cases, and warnings.

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
curl -X POST https://your-domain.example/api/weeks/week_2026_06_29/suggest \
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

MCP safety defaults:

- Use the viewer key for read-only tools.
- Use the admin key only for tools that intentionally mutate schedule data.
- Fetch `/api/state` before mutating so the tool can resolve actual ids.
- Never send patient names, MRNs, DOBs, or PHI.

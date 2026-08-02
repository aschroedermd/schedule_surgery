# Agent Guide: Resident OR Coverage Planner API

Use this guide when an AI agent, script, or MCP server needs to read or update the schedule or perform supported webapp administration.

Live app/API base URL: `http://159.89.226.139`. Set `BASE_URL=http://159.89.226.139` when using the curl examples below. If a domain name or HTTPS endpoint is added later, prefer the current configured `PUBLIC_BASE_URL`.

Security prerequisite: the numeric live URL currently shown here is plain HTTP. Do not send an admin API key, bearer token, or temporary password over it from an untrusted network. Configure the documented HTTPS domain first (preferred), or use a trusted SSH tunnel, then set `BASE_URL` to that protected endpoint.

## Ground Rules

- Store no PHI. Never send patient names, MRNs, DOBs, room numbers tied to patients, or identifiers. Use procedure labels such as `EGD`, `Lap chole`, or `Open ventral hernia`.
- Use exact ISO dates (`YYYY-MM-DD`) and 24-hour times (`HH:MM`). Validate weekday/date pairs before writing; for example, in 2026, `2026-07-29` is Wednesday, not Monday.
- Before a planner-state mutation, fetch `GET /api/state` and resolve actual `id` values for residents, attendings, hospitals, and weeks from the live state. Browser-account endpoints are a separate user store and do not use `state.version`.
- Include `X-State-Version: state.version` on planner-state mutations (`/api/entities`, assignments, coverage entries/requests, claims, Gold Stars, and suggestions). On `409`, refetch state, reapply the intended change to the fresh state, and retry once only if the change is still appropriate. Do not send this header to login, password, browser-user management, or chat-settings endpoints.
- Prefer patching existing entities over creating duplicates. The API does not enforce uniqueness for names or ids.
- If API keys are configured, use the admin API key only for intentional writes and the viewer API key for read-only tools. Otherwise use browser-session bearer tokens.
- After writes, read `GET /api/weeks/{weekId}/schedule` and `GET /api/weeks/{weekId}/warnings` to verify computed times, coverage, and risk warnings.

## Authentication

External tools can pass an API key when one is configured:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" "$BASE_URL/api/state"
```

Authentication roles:

- `admin`: full planner access. A browser-session admin can manage all browser users. The admin API key can create accounts, reset passwords, manage assistant model settings, and read/change/reset per-user voice quotas, but cannot list, update, or delete browser users.
- `attending`: browser-session account linked to exactly one existing `attendings[]` record. It can create, update, and delete that attending's OR blocks and cases without a service edit grant. It cannot use that ownership exception for clinics, resident assignments, coverage entries, suggestions, or account management; those require the normal service privilege or admin role.
- `viewer`: read access unless a browser user has explicit per-service `request` or `edit` privileges.

`attending` is a browser-user role, not an API-key role. An API-key tool is authenticated as `admin` or `viewer` only. Send browser tokens as `Authorization: Bearer <token>` (the SSE endpoint also accepts `?token=<token>` for `EventSource`). A temporary-password session may call `POST /api/me/password/skip` to use planner endpoints for that current session; the password-change gate returns on the next username/password login unless it calls `PATCH /api/me/password`.

Browser sessions use username/password login, not the API-key role names:

```bash
curl -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"..."}'
```

Seeded browser users are `admin` plus account-eligible resident-linked accounts when `SEED_USER_PASSWORD` is configured privately. Named residents use first-initial-plus-last-name usernames such as `aadeleke`; outside-program rotators with `accountEligible: false` stay manually assignable but do not receive seeded accounts, while Plastic Surgery (`Pl Sx`) rotators are account-eligible by default. No public `guest` account is seeded. Browser users have per-service privileges of `view`, `request`, or `edit`; request-privileged users submit coverage calendar requests, and users with edit privilege for that service can approve/deny those requests.

Only a logged-in admin browser session can call `GET /api/users` or `PATCH/DELETE /api/users/{username}`. An admin API key can call `POST /api/users`, `POST /api/users/bulk`, `PATCH /api/users/{username}/password`, and the per-user voice-quota endpoints documented below. API-key creations use `accountType: "user"`, `accountType: "attending"`, or `accountType: "medical-student"` (`user` is stored as the browser `viewer` role); a medical-student account creates a linked Medical Student roster entry that is assignable to cases only. They can set `servicePrivileges` and cannot create an admin account. When creating an account, use exactly one password mode: `password` for a permanent password, `temporaryPassword` for an admin-chosen first-login password, or omit both to receive the `schroeder1` temporary password exactly once. Temporary-password accounts return to the password-change screen after every login until their password is changed. An `attending` account must include an `attendingId` that exists in the current planner state.

Example attending account creation (with an admin API key):

```json
{
  "username": "rkatz",
  "displayName": "Dr. Katz",
  "accountType": "attending",
  "attendingId": "att_katz",
  "temporaryPassword": "ChangeMeSafely123"
}
```

The live OpenAPI document is at:

```text
GET /api/openapi.json
```

Browser clients can watch state changes with `GET /api/events?token=<browser-token>` using Server-Sent Events. External tools can also poll `/api/state` and compare `version`.

## Admin API Quick Reference

Use the admin API key only from a trusted secret store. Never place it, a temporary password, the OpenAI key, the OpenRouter key, or the ElevenLabs key in planner data, shell history, chat transcripts, or activity notes.

### Read, change, or reset a user's voice quota

Every user starts with 12 spoken responses per Eastern-time day. Read one user's configured limit and today's usage:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" \
  "$BASE_URL/api/admin/users/cblue/voice-quota"
```

Change the daily limit, reset today's `used` count to `0`, or do both in one request:

```bash
curl -X PATCH "$BASE_URL/api/admin/users/cblue/voice-quota" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"limit":20,"resetUsed":true}'
```

Use `{"limit":20}` to change only the limit or `{"resetUsed":true}` to reset only today's usage. The response contains `username`, Eastern-time `date`, `used`, `remaining`, and `limit`. No `X-State-Version` header is needed.

### Reset a browser user's password

Omit the body to generate a random temporary password. The response returns `temporaryPassword` once, stores only its hash, invalidates the user's existing bearer sessions, and sets `mustChangePassword: true`:

```bash
curl -X PATCH "$BASE_URL/api/users/cblue/password" \
  -H "X-API-Key: $ADMIN_API_KEY"
```

To choose the temporary password, prompt for it so the value is not written into shell history, then send it to the API:

```bash
read -s "TEMP_PASSWORD?Temporary password: "
echo
curl -X PATCH "$BASE_URL/api/users/cblue/password" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  --data-binary "$(jq -nc --arg password "$TEMP_PASSWORD" '{temporaryPassword:$password}')"
unset TEMP_PASSWORD
```

Deliver the returned password once through an approved private channel. Do not write it to a file or repeat it in a later response. The admin API key cannot reset the built-in `admin` browser account; that requires an existing browser-admin session. The endpoint does not need `X-State-Version`.

### Read or change the assistant's text provider, models, and voice

Read the active configuration:

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" \
  "$BASE_URL/api/admin/chat-settings"
```

Switch only the primary OpenAI chat model:

```bash
curl -X PATCH "$BASE_URL/api/admin/chat-settings" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"primaryModel":"gpt-5.6-luna"}'
```

Switch the text provider for all users. Omitting model fields resets them to that provider's defaults:

```bash
curl -X PATCH "$BASE_URL/api/admin/chat-settings" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"chatProvider":"openrouter"}'
```

Voice buttons map to these persisted settings:

- Voice 1 (default): ElevenLabs, default voice id `kSvMZug5ZFM9sKGpLAei` (James).
- Voice 2: ElevenLabs, default voice id `dWAnId3mzfl4fTszwtOG`.
- Voice 3: ElevenLabs, default voice id `0rEo3eAjssGDUCXHYENf`.
- Voice 4: ElevenLabs, default voice id `onwK4e9ZLuTAKqWW03F9`.
- Voice 5: ElevenLabs, default voice id `ia2hmHnWgMXcUgmY4yVU`.

Switch the ElevenLabs model and all five button voices:

```bash
curl -X PATCH "$BASE_URL/api/admin/chat-settings" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "elevenLabsModel":"eleven_multilingual_v2",
    "elevenLabsVoiceIds":[
      "kSvMZug5ZFM9sKGpLAei",
      "dWAnId3mzfl4fTszwtOG",
      "0rEo3eAjssGDUCXHYENf",
      "onwK4e9ZLuTAKqWW03F9",
      "ia2hmHnWgMXcUgmY4yVU"
    ]
  }'
```

`elevenLabsVoiceIds` must contain exactly five ids in button order. ElevenLabs requests use `POST /v1/text-to-speech/{voice_id}` and the server-only `ELEVENLABS_API_KEY`; see the [ElevenLabs API introduction](https://elevenlabs.io/docs/api-reference/introduction) and [text-to-speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

The complete shape is:

```json
{
  "chatProvider": "openai",
  "primaryModel": "gpt-5.6-luna",
  "fallbackModels": ["gpt-5.6-terra"],
  "transcriptionModel": "nvidia/parakeet-tdt-0.6b-v3",
  "voiceModel": "fish-audio/s2.1-pro-free:free",
  "voiceName": "David Attenborough Dramatic",
  "elevenLabsModel": "eleven_multilingual_v2",
  "elevenLabsVoiceIds": [
    "kSvMZug5ZFM9sKGpLAei",
    "dWAnId3mzfl4fTszwtOG",
    "0rEo3eAjssGDUCXHYENf",
    "onwK4e9ZLuTAKqWW03F9",
    "ia2hmHnWgMXcUgmY4yVU"
  ]
}
```

`chatProvider` selects `openai` or `openrouter` for text responses. `primaryModel` and `fallbackModels` must be model ids for that provider. `transcriptionModel` remains an OpenRouter model id. `elevenLabsModel` is an ElevenLabs TTS model id, and `elevenLabsVoiceIds` contains the five ElevenLabs voice ids in button order. `fallbackModels` is ordered, accepts up to five entries, and may be empty. A partial `PATCH` preserves omitted fields, except that changing only `chatProvider` resets the text models to the new provider's defaults. Changes apply to new requests immediately and persist in `CHAT_SETTINGS_PATH` (by default `chat-settings.json` beside `USER_STORE_PATH`). The API validates identifier shape, but not provider availability, account access, price, tool-calling support, or voice/model compatibility. After changing a provider or voice setting, read the settings back and make one representative request with the changed path.

Environment variables provide defaults only when no persisted settings exist: `CHAT_PROVIDER`, `OPENAI_PRIMARY_MODEL`, comma-separated `OPENAI_FALLBACK_MODELS`, `OPENROUTER_PRIMARY_MODEL`, comma-separated `OPENROUTER_FALLBACK_MODELS`, `OPENROUTER_TRANSCRIPTION_MODEL`, `OPENROUTER_VOICE_MODEL`, `OPENROUTER_VOICE_NAME`, `ELEVENLABS_MODEL_ID`, and comma-separated `ELEVENLABS_VOICE_IDS`. `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and `ELEVENLABS_API_KEY` remain environment-only and are never returned by this API.

## Mental Model

The database stores one JSON planner state. Important collections:

- `weeks`: scheduling week metadata; a week starts on Monday.
- `hospitals`: reusable hospital list.
- `attendings`: reusable attending surgeon list.
- `residents`: reusable resident/fellow/rotator list, optional login username link, display-name aliases, one-character marker, source program metadata, `accountEligible`, general availability blocks, and vacation blocks.
- `attendingBlocks`: one surgeon operating at one hospital on one date, with a first-case start time and `weekId`.
- `cases`: ordered cases inside an attending block. Later case times are computed from prior estimated durations.
- `clinicSessions`: entered clinic sessions with `weekId`; set `isProcedure: true` for procedure clinic.
- `assignments`: resident coverage of a whole block, individual case, or clinic.
- `activityEvents`: audit trail of changes.
- `goldStarAwards`: weekly Gold Star Chart awards for the resident-facing Residents tab.

Browser-user records live in a separate protected user store, not in `PlannerState`. An attending account's `attendingId` is the explicit link to its planner `attendings[]` record; do not infer that link from a display name.

Cases do not have independent start times. To change timing, patch the block `firstCaseStartTime`, or patch case `durationMinutes` / `order`. Sequential cases include `settings.turnoverMinutes` between cases.

Service lines are selected client-side and persisted by each browser. The built-in service lines are `ICU`, `Gilbert`, `Vascular`, `Davies`, `Berry`, `Ferrara`, `Fogel`, `NRV`, and `Peds`.

- `attendings[].service` stores the attending's service line.
- `residents[].rotationSchedule` stores dated resident block rotations; `residents[].serviceTags` remains a fallback for residents without a schedule. `residents[].vacation` is an optional list of inclusive `{ id, startDate, endDate }` intervals, kept separate from general `unavailable` blocks. `rosterKind: "off-service"` plus `sourceProgramAbbreviation` marks outside rotators from the MedHub side label, and `accountEligible: false` means selectable without seeded browser login.
- `residents[].aliases` stores alternate resident display names for matching and lookup.
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
GET    /api/healthz
GET    /api/openapi.json
GET    /api/session
GET    /api/events?token=<browser-token>
GET    /api/admin/chat-settings           (admin browser session or admin API key)
PATCH  /api/admin/chat-settings           (admin browser session or admin API key)
GET    /api/admin/users/{username}/voice-quota   (admin browser session or admin API key)
PATCH  /api/admin/users/{username}/voice-quota   (admin browser session or admin API key)
GET    /api/users                         (admin browser session only)
POST   /api/users                         (admin browser session or admin API key)
POST   /api/users/bulk                    (admin browser session or admin API key)
PATCH  /api/users/{username}              (admin browser session only)
PATCH  /api/users/{username}/password     (admin browser session or admin API key)
DELETE /api/users/{username}              (admin browser session only)
PATCH  /api/me/password
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
POST   /api/coverage-entries
PATCH  /api/coverage-entries/{id}
DELETE /api/coverage-entries/{id}
POST   /api/claims
POST   /api/gold-stars
POST   /api/import/preview                 (admin only; currently returns a not-configured response)
POST   /api/weeks/{weekId}/suggest
POST   /api/weeks/{weekId}/suggest?service=Davies
POST   /api/coverage-requests
POST   /api/coverage-requests/{requestId}/approve
POST   /api/coverage-requests/{requestId}/deny
DELETE /api/coverage-requests/{requestId}
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

For an attending-session write, first call `GET /api/session` and use its `attendingId`. Only create or modify an `attendingBlock` whose `attendingId` exactly matches that value, and only create or modify a `case` whose existing `blockId` belongs to that attending. Do not attempt to assign residents, change clinics, or edit another attending's block unless the account also has the required service privilege.

Calendar `call` entries are global across services. For each Friday-Sunday surgery call date, create one `coverageEntries[]` item for each position: `callPosition: "senior"`, `callPosition: "mid-level"`, and `callPosition: "intern"`, with `residentId` resolved from `state.residents`. Do not put role labels, source text, imported PDF labels, or names in `note`; those positions belong in `callPosition`. For the one SCC/ICU call resident, create one additional `kind: "call"` entry and either leave `note` blank when the resident's rotation is already SCC/ICU or set `note` to exactly `SCC` or `ICU`; omit `callPosition` for SCC/ICU. The API rejects duplicate same-day call residents, duplicate surgery call positions, missing `callPosition` on surgery call entries, more than one SCC/ICU call resident, and free-text call notes. The Calendar and CALL tab use `callPosition` for senior/mid-level/intern ordering but display compact last names only.

For attending coverage, create one `kind: "attending-call"` entry for each Friday, Saturday, or Sunday with `dayAttendingId` and `nightAttendingId` resolved from `state.attendings`. Use the same ID in both fields when one attending covers day and night; use different IDs when coverage is split. Only one attending-call entry is allowed per date. The CALL tab keeps this to one Attending line, adding day/night labels only when the names differ.

Read attending call from `GET /api/state` by filtering `coverageEntries[]` for `kind === "attending-call"`. Create or replace the line with the coverage-entry endpoints:

```bash
# One attending for both day and night
curl -X POST "$BASE_URL/api/coverage-entries" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "X-State-Version: $STATE_VERSION" \
  -H "content-type: application/json" \
  -d '{
    "date": "2026-08-01",
    "kind": "attending-call",
    "dayAttendingId": "att_chen",
    "nightAttendingId": "att_chen",
    "serviceLine": "Davies"
  }'

# Split day/night coverage on an existing attending-call entry
curl -X PATCH "$BASE_URL/api/coverage-entries/cover_example" \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "X-State-Version: $STATE_VERSION" \
  -H "content-type: application/json" \
  -d '{
    "dayAttendingId": "att_chen",
    "nightAttendingId": "att_patel",
    "serviceLine": "Davies"
  }'
```

Always replace the example IDs with IDs from the latest state response. After a successful write, use the returned state version for any subsequent mutation.

Calendar `rounding` entries are service-specific and also support multiple same-day residents on Saturday-Sunday; set `coverageEntries[].serviceLine` when the rounder should count for a service other than the resident's dated rotation. To add another person, create a new `coverageEntries[]` item; to change an existing person, patch or delete that entry by `id`.

Posting a case assignment for a different resident on the same `targetId` adds that resident as a co-assignee. The API rejects duplicate resident/case pairs.

When reading `GET /api/weeks/{weekId}/schedule`, use each scheduled case's `assignments[]` array for the full effective resident list. A case can include an inherited `kind: "block"` assignment plus one or more direct `kind: "case"` assignments. The singular `assignment` field is only the primary/compatibility assignment and may omit co-assignees.

To change an existing displayed resident, patch that assignment by id with `PATCH /api/assignments/{id}`. If the assignment has `kind: "block"`, changing it updates the whole attending block. To add a second resident to only one case, create a new `kind: "case"` assignment for that case. To remove that second resident, delete the direct case assignment id.

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

## Gold Star Chart

Any logged-in browser account can award one weekly star from the Residents tab. The server computes the current Monday-starting week, rejects self-awards for resident-linked accounts, and rejects a second award from the same authenticated username in that week. An account does not need a resident or attending profile link to award a resident.

```json
{
  "recipientResidentId": "res_fellow"
}
```

Use `POST /api/gold-stars` with a browser bearer token. Do not use API keys or an unlinked admin session for this workflow. User-facing tools should display weekly recipient counts only and should not surface giver identity; filtered state hides other users' giver identifiers.

## Resident Profile Requests

Admins can directly edit `residents[].name` and `residents[].aliases`. Linked resident users submit profile changes through the request queue; only admins can approve or deny `requestType: "resident-profile"` requests.

```json
{
  "requestType": "resident-profile",
  "action": "update",
  "targetResidentId": "res_fellow",
  "requestedResidentProfile": {
    "residentId": "res_fellow",
    "name": "Dayo Adeleke",
    "aliases": ["Adedayo Adeleke", "A Adeleke"]
  },
  "message": "Preferred display name"
}
```

Admins can remove accidental or obsolete request records with `DELETE /api/coverage-requests/{requestId}`. This removes the request from the log without applying, approving, or denying it.

## Resident Vacation

Vacation is stored as the complete `residents[].vacation` list. Each interval is inclusive, uses ISO dates, automatically appears as a read-only `VAC` calendar entry (and in the resident ICS feed), and blocks case or rounding assignment during the interval:

```json
{
  "id": "vac_bradley_august",
  "startDate": "2026-08-10",
  "endDate": "2026-08-14"
}
```

An admin browser session or the admin API key can directly replace a resident's vacation list with `PATCH /api/entities/residents/{residentId}`. Fetch the live state first, preserve any intervals that should remain, and send the full replacement list with `X-State-Version`:

```json
{
  "vacation": [
    {
      "id": "vac_bradley_august",
      "startDate": "2026-08-10",
      "endDate": "2026-08-14"
    }
  ]
}
```

Any logged-in non-admin browser user can instead submit a request; only an admin can approve or deny it. The request replaces the target resident's full vacation list when approved:

```json
{
  "requestType": "resident-vacation",
  "action": "update",
  "targetResidentId": "res_bradley",
  "requestedResidentVacation": {
    "residentId": "res_bradley",
    "vacation": [
      {
        "id": "vac_bradley_august",
        "startDate": "2026-08-10",
        "endDate": "2026-08-14"
      }
    ]
  },
  "message": ""
}
```

Send this to `POST /api/coverage-requests`. After an admin approves it, refetch `GET /api/state` and verify the resident's `vacation` list.

All-day `coverageEntries[]` items with `kind: "off"` also block case and rounding assignment for that resident on the matching date. Timed `unavailable` blocks remain partial-day constraints; all-day `unavailable` blocks block those assignments as well.

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

Assign Adeleke to that case:

```json
{
  "kind": "case",
  "targetId": "case_2026_07_29_katz_egd_1",
  "residentId": "res_...",
  "locked": false
}
```

## Agent Heuristics

- When a user says “covered by Adeleke,” resolve Adeleke from `residents` by substring/name, then preserve the actual `id`.
- When a user is working in a service line, filter reads and suggestions with the same `service` query parameter. Davies is the default seeded service.
- When a user says “Katz at RMH,” resolve Katz from `attendings` and RMH from `hospitals.shortName`.
- When a user says “Bower clinic,” resolve Bower from `attendings`, set `clinicSessions.attendingId`, and use the attending's service unless the user explicitly chose another service line.
- When a user says “Bower procedure clinic,” create or patch a `clinicSessions` row with `isProcedure: true`; do not model that as an OR `case`.
- When creating an attending browser account, resolve the exact `attendingId` from `state.attendings`; never create an account based only on an attending name. Give the user the returned/generated temporary password once, through an approved private channel, and do not store it in planner notes or agent logs.
- When acting as an attending, keep writes to that account's own blocks and cases. Use the account's `attendingId`, not the selected service line or a name match, as the ownership check.
- When a user names a date or says "next week", resolve the target Monday, match or create a `weeks` row, and keep that `weekId` through the whole operation.
- If the user gives a weekday and date that conflict, ask before leaving persistent changes. For temporary smoke tests, create and delete test data in the same run.
- Use deterministic ids for scripted writes, such as `block_YYYY_MM_DD_katz_rmh`, `case_YYYY_MM_DD_katz_egd_1`, or `clinic_YYYY_MM_DD_katz`, but check for existing ids first.
- Delete temporary data either in dependency order or by deleting the temporary week. Week deletion cascades to blocks, cases, clinics, and assignments for that week.
- Warnings are allowed. The scheduler intentionally permits manual overrides while surfacing off-day, overlap, and cross-hospital travel risks.
- For uncovered coverage requests, prefer the built-in message endpoint instead of writing custom wording.
- For future MCP tools, expose separate read-only and write tools. Require an explicit confirmation or dry-run summary before destructive deletes.

## Recommended Next Admin APIs

These are useful follow-ups but are not implemented yet:

- Scoped, rotatable API credentials instead of one broad admin key—for example `schedule:write`, `users:reset`, `assistant:configure`, and `integrations:sync`—with key id, expiry, last-used time, and revocation.
- A model configuration test endpoint that makes a minimal tool-call request before promotion, plus an automatic rollback to the previous known-good configuration after repeated provider failures.
- Read-only operational status for OpenAI/OpenRouter configuration, database connectivity, QGenda last sync, job health, and recent error counts without returning secrets.
- Admin-controlled chat quota limits and usage summaries. Return aggregate counts; avoid storing or exposing prompt text.
- A backup/export and validated restore workflow for planner state, browser users, chat settings, and integration settings. Restores should require a dry run and explicit confirmation.
- Idempotency keys and a batch mutation endpoint for multi-step schedule changes, so an agent can retry safely without creating duplicate entities or leaving half-applied updates.
- Full API-key user lifecycle management only after scoped keys and stronger audit logging exist. Until then, keep user listing, privilege changes, and deletion restricted to browser-admin sessions.

## Smoke Test Pattern

For a write test, create a temporary week/block/case/assignment and, when clinic behavior matters, a temporary clinic with `isProcedure: true`. Verify the entities appear in `/api/weeks/{weekId}/schedule`; for a procedure clinic, confirm the schedule clinic has `isProcedure: true` and a resolved `attending.name`. Then delete the temporary week and confirm the block, case, clinic, and assignment targets are gone from `GET /api/state`. This proves the agent can safely write and clean up without changing the real schedule.

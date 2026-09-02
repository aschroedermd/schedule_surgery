# Resident OR Coverage Planner

A no-PHI shared planner for weekly resident/fellow coverage of attending OR blocks and clinic sessions.

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install the local Call Builder solver (Python 3.11+):
   ```bash
   python3 -m venv .local/call-builder-venv
   .local/call-builder-venv/bin/pip install -r requirements-call-builder.txt
   ```
3. Start Postgres:
   ```bash
   npm run db:up
   ```
4. Copy `.env.example` to `.env` and set local passwords/API keys:
   ```bash
   cp .env.example .env
   ```
5. Start the app:
   ```bash
   npm run dev
   ```

Open http://localhost:5173.

If Docker Desktop is not running and you only need a temporary preview, start without persistence:

```bash
DATABASE_URL=memory npm run dev
```

## What Is Implemented

- Username/password browser logins. Seeded account-eligible residents use first-initial-plus-last-name usernames such as `aadeleke`; login also accepts one accidental alphabetic middle initial immediately after the first initial when no exact username exists. Off-service rotators from outside programs remain assignable-only unless `accountEligible` is enabled. Set `SEED_USER_PASSWORD` privately if those accounts should be login-ready.
- The signed-in landing page is a schedule assistant powered by the OpenAI Responses API by default. It uses `gpt-5.6-luna`, with `gpt-5.6-terra` as its automatic fallback. Admins can change the text provider and model ids for all users in the chatbot settings panel or through `/api/admin/chat-settings`; OpenRouter remains available as an alternate text provider. The assistant can read OR/clinic, call, calendar, and vacation context through permission-aware tools. Each user has 20 requests per Eastern-time day and receives a warning at five remaining.
- The assistant has a server-persisted, API-editable residency wiki with linked articles for program rules, services, hospitals, attendings, workflows, and reviewed clinical references. It injects a small relevant wiki context when possible and can search/read linked pages when more detail is needed. Structured clarification and confirmation questions render as response buttons in chat.
- A private, nested Git wiki workspace can pull the server knowledge base, ingest PDF/DOCX/text sources into agent-generated drafts, preserve source hashes and review metadata, validate links and publication requirements, and transactionally sync approved changes back through the admin API.
- Hold-to-record voice messages are transcribed server-side with `nvidia/parakeet-tdt-0.6b-v3`; set `OPENROUTER_API_KEY` privately before starting the app.
- The assistant's muted speaker control enables concise spoken-response mode with five ElevenLabs voice buttons. The default IDs are `kSvMZug5ZFM9sKGpLAei` (James), `dWAnId3mzfl4fTszwtOG`, `0rEo3eAjssGDUCXHYENf`, `onwK4e9ZLuTAKqWW03F9`, and `ia2hmHnWgMXcUgmY4yVU`. Each user's last selected voice is saved across sign-ins. Set `ELEVENLABS_API_KEY` privately, and use the admin APIs to change provider settings or each user's daily quota. Every user starts with 12 spoken responses per Eastern-time day. See the [ElevenLabs TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
- No `guest` account is seeded. `admin` starts with the private `ADMIN_PASSWORD` configured when the user store is first created.
- Admins get a Users tab for single or bulk user creation, deleting users, generating temporary reset passwords, linking attending accounts to roster records, and granting per-service `view`, `request`, or `edit` privileges. The `ADMIN_API_KEY` can also list users, create new accounts, safely update non-admin privileges such as Call Builder access, and generate or set a temporary reset password; role changes, identity relinking, admin-account mutation, and deletion remain browser-session-only.
- New accounts can use view/request/edit presets, custom service privileges, or copied privileges from an existing user. If neither `password` nor `temporaryPassword` is supplied, the temporary password is `schroeder1`; it is shown once and opens the password-change screen on every login until the user chooses a new password. Users can select `Skip for now` to continue in the current session; a fresh login shows the screen again.
- Residents may save one priority and one secondary call-off request per rotation block from the Call tab. Replacing a block's priority request requires confirmation and resets its submission timestamp. Call Builder favors priority before secondary requests, then PGY-4/5 before PGY-2/3 before PGY-1, and finally earlier submissions within each seniority group.
- Passwords are stored as `scrypt` hashes in `USER_STORE_PATH` instead of plaintext, so current passwords are not viewable; admin resets and generated new-user passwords are temporary and shown once.
- Weekly Monday-Friday board with OR blocks, turnover-aware sequential case timing, clinic sessions, warnings, and activity feed.
- Monthly rounding calendar with resident colors, shared Friday-Sunday call-team summaries, service-specific Saturday-Sunday rounders, weekday off/note entries, and red weekend blocks when the visible service has neither an on-service call resident nor an assigned rounder.
- Dedicated attending coverage on the Call tab for EGS, Trauma, SCC, consolidated ACS night call, day/night backup, Practice/Elective, Vascular, Pediatrics, and NRV/New River Valley. The four independent lines support separate day/night assignments on every date, automatic night-to-day fallback, and weekend-day carryover for missing Friday-Sunday entries. Backward-compatible weekend shorthand runs through Monday 6 AM, starting Friday morning for NRV and Friday 5 PM for the other lines. Call-day cards expand to the full team and the main calendar shows compact PR/V/PEDS/NRV coverage. A designated minimally invasive fellow may cover Practice weekend call while remaining outside the resident call pool.
- Every signed-in resident can submit one priority and one secondary Friday, Saturday, Sunday, or full-weekend call-off request per block from the Call tab, with an optional no-PHI reason. Requests are persisted, visible to Call Builder users, and may be withdrawn by their owner.
- A dedicated per-user **Call Builder** privilege unlocks a block-aware resident call scheduler. A local CP-SAT constraint solver combines rotations, PGY levels, vacation and approved-unavailable dates, resident requests, prior main drafts, and published call history; enforces non-negotiable rules; and optimizes the stated goals in strict hierarchy order. PGY-4/5 residents may exceptionally cover a mid-level slot when that prevents a worse three-call-equivalent burden, but the solver minimizes such cross-coverage immediately afterward. Builders can also select and lock a chief manually in a mid-level slot, request coordinated minimum-change improvements, review optimality and per-goal results, and save timestamped collaborative drafts without changing CALL coverage. All Call Builder users can view and load the drafts, one may be selected as the default main draft for each block, and only the draft's creator may delete it. Admins can grant the privilege from the Users tab.
- QGenda published-schedule synchronization on every server startup and daily around 03:00 Eastern, with an admin **Sync now** action, persisted success/failure status, transactional ACS-night validation, and manual/API coverage endpoints.
- Request-privileged calendar edits are submitted as requests; users with edit privilege for that service can approve or deny them from the Requests tab.
- Manual setup for hospitals, attendings, residents/fellows, off-service rotators, resident block rotations, unavailable time, case defaults, OR blocks, cases, and clinic sessions.
- Auto-suggestion that preserves non-suggestion assignments and prioritizes safe OR coverage before clinic assignment; assignable-only off-service rotators stay out of suggestions unless they are account-eligible.
- Warning-but-allow behavior for roster/calendar off days, post-call assignments, overlapping coverage, cross-hospital split risk under the 90-minute buffer, and same-day arrangement checks when a resident has a stronger interest-matched case available.
- Optimistic concurrency with state versions, 409 conflict responses, and browser auto-refresh over Server-Sent Events.
- Personal "Mine" view, per-resident one-character markers, per-resident ICS export, and browser print support.
- Copyable uncovered day/week messages.
- Postgres-backed shared state using `DATABASE_URL`.
- Browser user credentials are stored separately from planner state using `USER_STORE_PATH` (local default `.local/users.json`, production default `/data/users.json` through a Docker volume).

## Verification

```bash
npm run lint
npm test
npm run build
npm audit
```

## Privacy Boundary

The app is designed for no-PHI scheduling metadata only. Do not enter patient names, MRNs, DOBs, or patient identifiers into procedure labels or notes.

## Wiki Authoring

```bash
npm run wiki -- init --workspace ../residency-knowledge --server https://your-domain.example --remote YOUR_PRIVATE_GIT_URL
npm run wiki -- pull --workspace ../residency-knowledge
npm run wiki -- ingest ./path/to/reviewed-source.docx --workspace ../residency-knowledge --source-type direct-review --author "Reviewer name"
npm run wiki -- validate --workspace ../residency-knowledge
npm run wiki -- diff --workspace ../residency-knowledge
npm run wiki -- deploy --workspace ../residency-knowledge --dry-run
```

The separate private Git workspace opens directly as an Obsidian vault and is the canonical knowledge source. `wiki deploy` publishes its validated state to the web app; the server retains a searchable runtime copy for the assistant. Agent-generated material remains draft until explicitly reviewed and published. See [docs/WIKI_INGESTION.md](docs/WIKI_INGESTION.md) for the complete ingestion, provenance, review, deployment, and private-backup workflow.

## Deployment And API

- DigitalOcean deployment guide: [docs/DEPLOY_DIGITALOCEAN.md](docs/DEPLOY_DIGITALOCEAN.md)
- API/MCP guide: [docs/API.md](docs/API.md)
- Agent API and remote rebuild guide: [docs/AGENT_API_GUIDE.md](docs/AGENT_API_GUIDE.md#rebuild-and-deploy-the-production-server)
- Private wiki ingestion and synchronization: [docs/WIKI_INGESTION.md](docs/WIKI_INGESTION.md)
- OpenAPI is served at `/api/openapi.json` when the app is running.
- Configure the QGenda poller with `QGENDA_SYNC_ENABLED`, `QGENDA_PUBLIC_LINK_URL`, and the optional sync-window/time-zone variables documented in [docs/API.md](docs/API.md#attending-coverage-and-qgenda).

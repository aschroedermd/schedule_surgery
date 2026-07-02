# Resident OR Coverage Planner

A no-PHI shared planner for weekly resident/fellow coverage of attending OR blocks and clinic sessions.

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start Postgres:
   ```bash
   npm run db:up
   ```
3. Copy `.env.example` to `.env` and set local passwords/API keys:
   ```bash
   cp .env.example .env
   ```
4. Start the app:
   ```bash
   npm run dev
   ```

Open http://localhost:5173.

If Docker Desktop is not running and you only need a temporary preview, start without persistence:

```bash
DATABASE_URL=memory npm run dev
```

## What Is Implemented

- Username/password browser logins. Seeded resident users are anonymized placeholders such as `resident01`; set `SEED_USER_PASSWORD` privately if those accounts should be login-ready.
- No `guest` account is seeded. `admin` starts with the private `ADMIN_PASSWORD` configured when the user store is first created.
- Admins get a pinned Users tab, protected by the private `USERS_PIN`, for single or bulk user creation, deleting users, changing the pin, generating temporary reset passwords, and granting per-service `view`, `request`, or `edit` privileges.
- New accounts can use view/request/edit presets, custom service privileges, or copied privileges from an existing user. Server-generated temporary passwords are shown once and force the user to choose a new password.
- Passwords are stored as `scrypt` hashes in `USER_STORE_PATH` instead of plaintext, so current passwords are not viewable; admin resets and generated new-user passwords are temporary and shown once.
- Weekly Monday-Friday board with OR blocks, turnover-aware sequential case timing, clinic sessions, warnings, and activity feed.
- Monthly call and rounding calendar with resident colors, Friday-Sunday call slots, Saturday-Sunday rounding slots, weekday off/note entries, and red unassigned weekend blocks when neither call nor rounding is assigned.
- Request-privileged calendar edits are submitted as requests; users with edit privilege for that service can approve or deny them from the Requests tab.
- Manual setup for hospitals, attendings, residents/fellows, resident block rotations, unavailable time, case defaults, OR blocks, cases, and clinic sessions.
- Auto-suggestion that preserves non-suggestion assignments and prioritizes safe OR coverage before clinic assignment.
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

## Deployment And API

- DigitalOcean deployment guide: [docs/DEPLOY_DIGITALOCEAN.md](docs/DEPLOY_DIGITALOCEAN.md)
- API/MCP guide: [docs/API.md](docs/API.md)
- OpenAPI is served at `/api/openapi.json` when the app is running.

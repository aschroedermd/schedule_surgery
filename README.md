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

- Two roles: admin can edit everything; viewer can view and claim uncovered cases or blocks.
- Weekly Monday-Friday board with OR blocks, sequential case timing, clinic sessions, warnings, and activity feed.
- Manual setup for hospitals, attendings, residents/fellows, unavailable time, case defaults, OR blocks, cases, and clinic sessions.
- Auto-suggestion that preserves non-suggestion assignments and prioritizes safe OR coverage before clinic assignment.
- Warning-but-allow behavior for off days, overlapping coverage, cross-hospital split risk under the 90-minute buffer, and same-day arrangement checks when a resident has a stronger interest-matched case available.
- Copyable uncovered day/week messages.
- Postgres-backed shared state using `DATABASE_URL`.

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

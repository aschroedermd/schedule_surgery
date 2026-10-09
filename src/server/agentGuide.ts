import { AGENT_IMPORT_GUIDE } from "./agentImportGuide";

export function getAgentGuideDocument() {
  return {
    name: "Resident OR Coverage Planner",
    summary: "Account-scoped, no-PHI API for OR blocks, cases, assignments, call schedules, and schedule questions.",
    agentPage: "/agent",
    openapi: "/api/openapi.json",
    humanDocs: "/agent",
    authentication: {
      login: {
        method: "POST",
        path: "/api/auth/login",
        body: { username: "<username supplied by the user>", password: "<password supplied by the user>" },
        next: "Use the returned token as Authorization: Bearer <token>. If mustChangePassword is true, have the user complete the password change first."
      },
      inspect: "GET /api/session shows the account identity and current servicePrivileges.",
      personalKey: "The user can create a key on the Account tab and supply it for X-API-Key. POST /api/me/api-key requires a browser bearer session and rotates any existing key, so only call it when the user requests a new key."
    },
    commonRequests: [
      { method: "GET", path: "/api/state", purpose: "Read visible weeks, blocks, cases, people, assignments, and state.version." },
      { method: "GET", path: "/api/weeks/{weekId}/schedule", purpose: "Read computed block and case timing." },
      { method: "GET", path: "/api/calendar-events?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD", purpose: "Read residency conferences, meeting links, and expanded recurring occurrences." },
      { method: "POST", path: "/api/calendar-events", purpose: "Admin: publish a residency-wide conference with title/date and optional times, location, meetingUrl, description and weekly/monthly recurrence." },
      { method: "PATCH", path: "/api/calendar-events/{id}", purpose: "Admin: correct a conference or recurring series. Patch calendar_friday_mm to add supplied Friday M&M details." },
      { method: "GET", path: "/api/contacts", purpose: "Look up authoritative directory phone numbers." },
      { method: "GET", path: "/api/attending-coverage?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD", purpose: "Read attending effectiveCoverage, including day/night and weekend fallback." },
      {
        method: "POST", path: "/api/chat", purpose: "Ask about blocks, call assignments or totals, and directory phone numbers.",
        body: { serviceLine: "<service from state>", messages: [{ role: "user", content: "Who is on call this weekend?" }] }
      },
      { method: "POST", path: "/api/entities/cases", purpose: "Add a case to a block when the account can edit that service." },
      { method: "POST", path: "/api/assignments", purpose: "Assign a resident to a case or block when the account can edit that service." }
    ],
    scheduleModel: {
      residentCall: "Generic 'who is on call?' usually means the Friday-Sunday resident surgery team: senior/chief, mid-level, and intern. These are call coverageEntries with callPosition; SCC/ICU call may be separate.",
      attendingCall: "Generic 'attending on call' usually means ACS. ACS is the consolidated EGS/Trauma/SCC night line; separate day lines also exist. Practice attending or Berry (sometimes said Barry), Davies, or Fogel attending means the Practice line. If Practice coverage is absent, report it as unscheduled rather than using ACS.",
      rotations: "Residents have dated rotationSchedule blocks on services such as Berry, Davies, and Fogel. Active service shapes expected OR/clinic work; actual coverage comes from block, case, clinic, and resident assignments."
    },
    writeRules: "Resolve ids from GET /api/state and send its version as X-State-Version on planner writes. A 403 means the account lacks the required privilege. Keep patient identifiers and other PHI out of all requests.",
    residencyCalendar: {
      read: "GET /api/calendar-events returns definitions and version; startDate/endDate also returns occurrences. Events also appear in state.calendarEvents and on Main residency calendar for all services.",
      write: "Admin account or admin API key required; send X-State-Version. POST title/date, omit unknown optional location/endTime, preserve supplied Teams URLs in meetingUrl. Read back after posting; saved elsewhere does not mean posted to this app.",
      recurrence: "weekly or monthly; daysOfWeek uses 0=Sunday through 6=Saturday. Monthly weekOfMonth 1–5 or -1 (last). date is first eligible day; untilDate is inclusive. Omit recurrence for a single event.",
      absences: "A conference event does not mark anyone unavailable. Goldman or another resident's vacation/conference absence requires exact date(s); resolve residentId from state and update vacation/unavailable or create dated kind: off coverage entries. Do not invent absence dates."
    },
    weeklyScheduleImport: {
      workflow: [
        "1. GET /api/session: inspect role, attendingId, and servicePrivileges. A personal key has its owner's current rights. A linked attending may write only their own blocks/cases without a service edit grant; a service editor can write that service's blocks/cases/clinics.",
        "2. GET /api/state: record version; resolve the Monday week, attending IDs, hospital IDs, turnoverMinutes, and existing target entities. Do not infer cases for omitted surgeons.",
        "3. Reuse a week with matching startDate. If missing, only an admin can POST /api/entities/weeks using example.week; a service editor must ask an admin to create it before continuing.",
        "4. For every source OR date/site, match an existing block by week/date + attending + hospital + first start. Create a missing block with POST /api/entities/attendingBlocks using example.block; cases cannot be posted before their parent block exists.",
        "5. Match cases by block + zero-based order + procedure label. Preserve repeated identical procedures at separate orders. POST /api/entities/cases for new cases, PATCH a confirmed correction; use source duration, documented default, then an explicitly labeled 90-minute estimate. Exact endoscopy intervals are one case.",
        "6. Match clinics by date + attending + interval. POST /api/entities/clinicSessions using example.clinic; set service explicitly. Clinic location defaults and Endo site rules are in locationPolicy.",
        "7. After every successful mutation, use response.version for the next X-State-Version. On timeout or 409, read back before retrying and update the per-entity journal.",
        "8. GET both /api/weeks/{weekId}/schedule?service={service} and /api/weeks/{weekId}/warnings?service={service}; compare source entities, timing, and uncovered work separately."
      ],
      endpoints: {
        session: "GET /api/session",
        state: "GET /api/state",
        createWeek: "POST /api/entities/weeks (admin only)",
        createBlock: "POST /api/entities/attendingBlocks",
        createCase: "POST /api/entities/cases",
        createClinic: "POST /api/entities/clinicSessions",
        patchEntity: "PATCH /api/entities/{collection}/{id}",
        schedule: "GET /api/weeks/{weekId}/schedule?service={service}",
        warnings: "GET /api/weeks/{weekId}/warnings?service={service}"
      },
      exampleRequestHeaders: { "Authorization": "Bearer <user login token> (or X-API-Key: <user-supplied personal key>)", "Content-Type": "application/json", "X-State-Version": "<latest state.version; planner writes only>" },
      ...AGENT_IMPORT_GUIDE,
      timing: "Case order is zero-based. Without startTimeOverride, the first case begins at block.firstCaseStartTime; each later case begins after the preceding case's duration plus state.settings.turnoverMinutes. startTimeOverride accepts HH:mm for an exact fixed start. Confirm computed start/end in the schedule response.",
      permissions: {
        personalKey: "Same current role and privileges as owner; may read and perform only owner-authorized writes. Key creation/rotation requires the owner's browser bearer session and permanent password.",
        browserSession: "Login token uses the account's current role and privileges; password-change gate may block planner endpoints.",
        serviceEditor: "May create/patch/delete attendingBlocks, cases, and clinicSessions on granted services; may assign residents on that service when explicitly requested. Cannot create weeks or edit roster records.",
        linkedAttending: "May create/patch/delete their own blocks and cases without service edit; clinics and resident assignments still need service edit.",
        admin: "May create weeks and edit all planner entities. Do not use admin-only actions unless the user requested them."
      },
      scope: "Posting attending OR/clinic schedules alone does not authorize assigning residents, running suggestions, changing roster services, rotating API keys, or deleting entries.",
      errors: { "400": "Invalid payload, field, date/time, or ID; fix the request.", "401": "Missing or invalid authentication; obtain a valid user token/key.", "403": "Authenticated but password gate or privilege denies the action; inspect /api/session.", "404": "Endpoint or target entity missing; refetch state and IDs.", "409": "State version conflict; refetch, compare target, and retry only if still needed." }
    },
    credentialSafety: "Use HTTPS or a trusted tunnel. Keep passwords, bearer tokens, and API keys private; never put them in schedule notes or logs."
  };
}

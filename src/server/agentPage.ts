import { AGENT_IMPORT_GUIDE } from "./agentImportGuide";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function jsonExample(value: unknown): string {
  return `<pre><code>${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
}

export function getAgentPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="A concise guide for agents using the Schedule Assistant API to answer OR, clinic, resident call, attending call, and directory questions." />
    <title>Agent Guide | Schedule Assistant</title>
    <link rel="alternate" type="application/json" href="/api/agent-guide" title="Machine-readable agent guide" />
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #17352f; background: #f3f7f5; line-height: 1.55; }
      a { color: #126452; text-underline-offset: 3px; }
      a:hover { color: #0b4336; }
      .wrap { width: min(1080px, calc(100% - 40px)); margin: 0 auto; }
      header { border-bottom: 1px solid #d9e4df; background: #fff; }
      .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 0; }
      .brand { font-size: 15px; font-weight: 800; letter-spacing: .02em; text-decoration: none; color: #17352f; }
      nav { display: flex; flex-wrap: wrap; gap: 18px; font-size: 14px; }
      .hero { padding: 58px 0 38px; }
      .eyebrow { margin: 0 0 12px; color: #217864; font-size: 12px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
      h1 { max-width: 780px; margin: 0; font-size: clamp(34px, 5vw, 56px); line-height: 1.1; letter-spacing: -.04em; }
      .lead { max-width: 760px; margin: 19px 0 0; color: #49645b; font-size: 18px; }
      h2 { margin: 0 0 16px; font-size: 23px; letter-spacing: -.02em; }
      h3 { margin: 0 0 8px; font-size: 17px; }
      p { margin: 0 0 12px; }
      section { margin-bottom: 25px; }
      .panel { padding: 26px; border: 1px solid #d9e4df; border-radius: 16px; background: #fff; box-shadow: 0 8px 30px rgba(23, 53, 47, .035); }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      .card { padding: 22px; border: 1px solid #d9e4df; border-radius: 14px; background: #fff; }
      .card p:last-child, .panel p:last-child { margin-bottom: 0; }
      .number { display: inline-grid; place-items: center; width: 30px; height: 30px; margin-bottom: 13px; border-radius: 9px; color: #fff; background: #18745f; font-weight: 800; }
      .muted { color: #526b62; }
      code, pre { border-radius: 5px; background: #edf4f0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      code { padding: 2px 5px; font-size: .91em; overflow-wrap: anywhere; }
      pre { margin: 12px 0 0; padding: 15px; overflow-x: auto; font-size: 13px; line-height: 1.5; }
      pre code { padding: 0; background: none; }
      .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      ul { margin: 8px 0 0; padding-left: 21px; }
      li { margin: 7px 0; }
      .callout { border-left: 4px solid #18745f; background: #e8f3ec; }
      .routes { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
      .routes th, .routes td { padding: 9px 12px 9px 0; border-bottom: 1px solid #e5ece8; vertical-align: top; }
      .routes th { color: #526b62; font-size: 12px; text-transform: uppercase; letter-spacing: .07em; }
      .routes tr:last-child td { border-bottom: 0; }
      footer { padding: 28px 0 45px; color: #526b62; font-size: 13px; }
      @media (max-width: 780px) { .grid, .rules { grid-template-columns: 1fr; } .hero { padding-top: 42px; } .topbar { align-items: flex-start; flex-direction: column; } .panel { padding: 21px; } }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap topbar">
        <a class="brand" href="/">SCHEDULE ASSISTANT</a>
        <nav aria-label="Guide links">
          <a href="/api/agent-guide">JSON quick guide</a>
          <a href="/api/openapi.json">OpenAPI contract</a>
          <a href="/api/docs">API overview</a>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <div class="hero">
        <p class="eyebrow">Public guide for AI agents</p>
        <h1>Read and post the schedule with confidence.</h1>
        <p class="lead">Use the account-scoped API to answer questions about OR and clinic schedules, resident and attending call, rotations, and directory phone numbers. Follow the weekly import recipe below when adding a few cases or a full supplied week. Keep all scheduling text free of patient identifiers.</p>
      </div>

      <section aria-labelledby="start-title">
        <h2 id="start-title">Start in three steps</h2>
        <div class="grid">
          <div class="card"><span class="number">1</span><h3>Authenticate</h3><p>With credentials supplied privately by the account holder, <code>POST /api/auth/login</code> with <code>{"username":"…","password":"…"}</code>. Send the returned token as <code>Authorization: Bearer &lt;token&gt;</code>. A user-provided personal key works in <code>X-API-Key</code>.</p></div>
          <div class="card"><span class="number">2</span><h3>Check context</h3><p>Call <code>GET /api/session</code> for identity and service privileges. Call <code>GET /api/state</code> for current IDs, weeks, rotations, assignments, and <code>version</code>. Use <code>GET /api/weeks/{weekId}/schedule</code> for computed OR and clinic coverage.</p></div>
          <div class="card"><span class="number">3</span><h3>Ask or edit</h3><p>Use <code>POST /api/chat</code> for natural-language questions. Service editors can add cases through <code>POST /api/entities/cases</code> and assign residents through <code>POST /api/assignments</code>. Send <code>X-State-Version</code> on planner writes.</p></div>
        </div>
      </section>

      <section class="panel" aria-labelledby="questions-title">
        <h2 id="questions-title">Useful questions and routes</h2>
        <table class="routes">
          <thead><tr><th>Need</th><th>Use</th></tr></thead>
          <tbody>
            <tr><td>OR blocks, cases, clinic coverage, or rotations</td><td><code>GET /api/state</code>, <code>GET /api/weeks/{weekId}/schedule</code>, or <code>POST /api/chat</code></td></tr>
            <tr><td>Resident call team or call totals</td><td><code>coverageEntries</code> in state, or <code>POST /api/chat</code></td></tr>
            <tr><td>Attending call</td><td><code>GET /api/attending-coverage?startDate=YYYY-MM-DD&amp;endDate=YYYY-MM-DD</code>; read <code>effectiveCoverage</code></td></tr>
            <tr><td>Phone numbers</td><td><code>GET /api/contacts</code> or <code>POST /api/chat</code>; use the directory as the source</td></tr>
          </tbody>
        </table>
        <pre><code>POST /api/chat
{"serviceLine":"Davies","messages":[{"role":"user","content":"Who is on call this weekend?"}]}</code></pre>
      </section>

      <section class="panel" aria-labelledby="calendar-title">
        <h2 id="calendar-title">Residency conferences and calendar events</h2>
        <p><code>GET /api/calendar-events</code> returns event definitions and the planner version. Supply <code>startDate</code> and <code>endDate</code> to expand weekly or monthly recurrences. An admin may publish with <code>POST /api/calendar-events</code> using <code>title</code> and <code>date</code>, plus optional <code>startTime</code>, <code>endTime</code>, <code>location</code>, <code>meetingUrl</code>, <code>description</code>, and <code>recurrence</code>. Send <code>X-State-Version</code> and verify the saved event by reading it back.</p>
        <p>Unknown locations and end times may be omitted. Preserve supplied Teams links. These events appear on the Main residency calendar for all services. Use <code>PATCH /api/calendar-events/{id}</code> to update an existing event or series, including <code>calendar_friday_mm</code> for Friday M&amp;M details. Resident vacation/conference absence is separate and requires exact dates before updating vacation, unavailable time, or dated off entries.</p>
      </section>

      <section aria-labelledby="call-title">
        <h2 id="call-title">How call is organized</h2>
        <div class="rules">
          <div class="panel"><h3>Resident surgery call</h3><p>Each Friday, Saturday, and Sunday has three resident positions: <strong>senior/chief</strong>, <strong>mid-level</strong>, and <strong>intern</strong>. In the API these are <code>coverageEntries</code> with <code>kind: "call"</code> and <code>callPosition</code> values <code>senior</code>, <code>mid-level</code>, or <code>intern</code>.</p><p>When someone asks “who is on call?”, they usually mean this three-person resident team. An SCC/ICU call resident may appear separately, without a <code>callPosition</code>.</p></div>
          <div class="panel"><h3>Attending call</h3><p>A generic “who is the attending on call?” usually means the <strong>ACS attending</strong>. The <code>ACS</code> line consolidates EGS, Trauma, and SCC night call; those services have separate daytime coverage.</p><p>“Practice attending” or “attending for Berry, Davies, or Fogel” means the independent <code>Practice</code> line. Berry may be spoken as “Barry.” Practice coverage is being populated; if no entry is returned, say it is not scheduled yet rather than substituting ACS. Vascular, Pediatrics, and NRV have their own lines.</p></div>
        </div>
      </section>

      <section class="panel callout" aria-labelledby="blocks-title">
        <h2 id="blocks-title">Residency blocks and services</h2>
        <p>Residents rotate through dated blocks on services such as Berry, Davies, and Fogel. Their <code>rotationSchedule</code> identifies the active service for a date, which shapes expected OR and clinic work. Check the actual block, case, clinic, and resident assignments before saying where someone is working; service membership alone is not a case assignment.</p>
        <p>For attending call, read the API’s <code>effectiveCoverage</code> over the requested date range so day/night and weekend carryover rules are applied. Ask for a date or shift when a call question is ambiguous.</p>
      </section>

      <section class="panel" aria-labelledby="import-title">
        <h2 id="import-title">Weekly schedule import</h2>
        <p>Use this sequence for one case, a clinic, or a whole source list. Each create returns the <strong>full updated planner state</strong> with a new <code>version</code>; send that value as <code>X-State-Version</code> on the next write. The IDs below are illustrative: resolve attending and hospital IDs from the live state.</p>
        <ol>
          <li><strong>Inspect access.</strong> <code>GET /api/session</code>; check <code>role</code>, <code>attendingId</code>, and <code>servicePrivileges</code>. A personal key uses its owner's current rights. A linked attending can edit their own OR blocks and cases; clinics require service edit privilege.</li>
          <li><strong>Fetch and reconcile.</strong> <code>GET /api/state</code>; record <code>version</code>, resolve existing attending/hospital IDs, find the Monday week, and inspect existing blocks, cases, and clinics before creating anything.</li>
          <li><strong>Resolve the week.</strong> Reuse <code>weeks[].startDate</code> for the target Monday. If absent, an admin creates it with <code>POST /api/entities/weeks</code>; a service editor asks an admin to create it first. ${jsonExample(AGENT_IMPORT_GUIDE.example.week)}</li>
          <li><strong>Resolve or create each parent block.</strong> Match by week/date, attending, hospital, and first start. Use <code>POST /api/entities/attendingBlocks</code> only when missing. ${jsonExample(AGENT_IMPORT_GUIDE.example.block)}</li>
          <li><strong>Add ordered cases.</strong> Use <code>POST /api/entities/cases</code> for each new case. <code>order</code> starts at 0. These two identical procedures are separate source rows and must remain separate cases. ${jsonExample(AGENT_IMPORT_GUIDE.example.cases)}</li>
          <li><strong>Add clinics.</strong> Use <code>POST /api/entities/clinicSessions</code>; the clinic must state its <code>service</code> explicitly. This example omits optional <code>hospitalId</code> because Riverside 3 is a clinic location rather than a verified hospital ID. ${jsonExample(AGENT_IMPORT_GUIDE.example.clinic)}</li>
          <li><strong>Verify.</strong> Read both <code>GET /api/weeks/{weekId}/schedule?service=Davies</code> and <code>GET /api/weeks/{weekId}/warnings?service=Davies</code>, then compare the source with the returned dates, people, sites, order, clinics, and computed times. Read another service with the same filter on both routes.</li>
        </ol>
        <p>Send <code>Content-Type: application/json</code>, a bearer token or personal <code>X-API-Key</code>, and <code>X-State-Version: &lt;latest state.version&gt;</code> on each planner write. Create returns HTTP 201; patch returns HTTP 200. The response is a full <code>PlannerState</code>, shaped like:</p>
        ${jsonExample(AGENT_IMPORT_GUIDE.example.mutationResponseExcerpt)}
        <p class="muted">This is an excerpt; the actual response includes all planner collections.</p>
      </section>

      <section class="panel" aria-labelledby="routing-title">
        <h2 id="routing-title">Service routing and name resolution</h2>
        <p>${escapeHtml(AGENT_IMPORT_GUIDE.serviceRouting.rule)}</p>
        <table class="routes"><thead><tr><th>Service</th><th>Usual attending name candidates</th></tr></thead><tbody>
          ${Object.entries(AGENT_IMPORT_GUIDE.serviceRouting.commonAttendings).map(([service, names]) => `<tr><td>${escapeHtml(service)}</td><td>${escapeHtml(names.join(", "))}</td></tr>`).join("")}
        </tbody></table>
        <p><code>Barry</code> means <code>Berry</code>; <code>S. Adkins</code> means Stacie Adkins/Berry; <code>F. Adkins</code> means Farrell Adkins/Fogel; Ashley Gerrish is Davies. These aliases help select an existing <code>attendingId</code>; they never rename roster records. Confirm C. Bower against K. Bower using first name or initial and the live roster. Cases inherit their service through the block's attending; clinics require their own <code>service</code>.</p>
        <p>An omitted attending may be away. Enter only the cases or clinics supplied; no missing name implies an empty schedule.</p>
      </section>

      <section class="panel" aria-labelledby="timing-title">
        <h2 id="timing-title">Timing, durations, and locations</h2>
        <p>Cases run in zero-based <code>order</code>. The first follows <code>firstCaseStartTime</code>; each later case follows the previous case plus <code>state.settings.turnoverMinutes</code>. Use optional <code>startTimeOverride: "HH:mm"</code> for an exact fixed start. Model a sourced endoscopy interval as one case with its exact duration and verify its exact end time.</p>
        <p>${escapeHtml(AGENT_IMPORT_GUIDE.durationPolicy)}</p>
        <p>For a sourced 07:30–09:30 Endoscopy interval at CCASC, resolve CCASC's live hospital ID, create or reuse this block, then post its single case:</p>
        ${jsonExample(AGENT_IMPORT_GUIDE.example.endoscopyBlock)}
        ${jsonExample(AGENT_IMPORT_GUIDE.example.endoscopyCase)}
        <table class="routes"><thead><tr><th>Procedure</th><th>Default minutes</th></tr></thead><tbody>
          ${Object.entries(AGENT_IMPORT_GUIDE.durationDefaultsMinutes).map(([label, minutes]) => `<tr><td>${escapeHtml(label)}</td><td>${minutes}</td></tr>`).join("")}
        </tbody></table>
        <p>${escapeHtml(AGENT_IMPORT_GUIDE.locationPolicy)}</p>
      </section>

      <section class="panel" aria-labelledby="safety-title">
        <h2 id="safety-title">Duplicates, corrections, and retries</h2>
        <ul>
          <li>Block match: ${escapeHtml(AGENT_IMPORT_GUIDE.duplicateKeys.block)}.</li>
          <li>Case match: ${escapeHtml(AGENT_IMPORT_GUIDE.duplicateKeys.case)}.</li>
          <li>Clinic match: ${escapeHtml(AGENT_IMPORT_GUIDE.duplicateKeys.clinic)}.</li>
          <li>${escapeHtml(AGENT_IMPORT_GUIDE.correctionPolicy)}</li>
          <li>${escapeHtml(AGENT_IMPORT_GUIDE.retryPolicy)}</li>
          <li>${escapeHtml(AGENT_IMPORT_GUIDE.verificationPolicy)}</li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="access-title">
        <h2 id="access-title">Access and errors</h2>
        <table class="routes"><thead><tr><th>Identity</th><th>Schedule import access</th></tr></thead><tbody>
          <tr><td>Personal key / browser session</td><td>Current account privileges; a key does not add permission. The account holder creates or rotates a personal key from a browser session.</td></tr>
          <tr><td>Service editor</td><td>Blocks, cases, and clinics for granted services; resident assignment only when requested. No week or roster creation.</td></tr>
          <tr><td>Linked attending</td><td>Own blocks and cases; clinics and resident assignments need a service edit grant.</td></tr>
          <tr><td>Admin</td><td>May create weeks and edit all planner entities.</td></tr>
        </tbody></table>
        <p><code>400</code> invalid request; <code>401</code> missing/invalid credentials; <code>403</code> password gate or insufficient privilege; <code>404</code> missing route/entity; <code>409</code> stale state version. After a 409 or timeout, refetch and inspect the target before retrying.</p>
        <p>Posting an attending schedule does not authorize resident assignments, suggestions, roster-service changes, API-key rotation, or deletion. A missing source entry or “nothing scheduled” does not authorize removal. Keep a per-entity progress journal so an interrupted import can resume safely.</p>
      </section>

      <footer>Use HTTPS, keep credentials and tokens private, and put no patient identifiers or other PHI in API requests. Full request schemas: <a href="/api/openapi.json">OpenAPI</a>.</footer>
    </main>
  </body>
</html>`;
}

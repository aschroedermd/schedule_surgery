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
        <h1>Understand the schedule before answering it.</h1>
        <p class="lead">Use the account-scoped API to answer questions about OR and clinic schedules, resident and attending call, rotations, and directory phone numbers. Keep all scheduling text free of patient identifiers.</p>
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

      <footer>Use HTTPS, keep credentials and tokens private, and put no patient identifiers or other PHI in API requests. Full request schemas: <a href="/api/openapi.json">OpenAPI</a>.</footer>
    </main>
  </body>
</html>`;
}

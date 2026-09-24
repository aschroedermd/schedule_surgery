export function getAgentGuideDocument() {
  return {
    name: "Resident OR Coverage Planner",
    summary: "Account-scoped, no-PHI API for OR blocks, cases, assignments, call schedules, and schedule questions.",
    openapi: "/api/openapi.json",
    humanDocs: "/api/docs",
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
      {
        method: "POST", path: "/api/chat", purpose: "Ask about blocks, call assignments or totals, and directory phone numbers.",
        body: { serviceLine: "<service from state>", messages: [{ role: "user", content: "Who is on call this weekend?" }] }
      },
      { method: "POST", path: "/api/entities/cases", purpose: "Add a case to a block when the account can edit that service." },
      { method: "POST", path: "/api/assignments", purpose: "Assign a resident to a case or block when the account can edit that service." }
    ],
    writeRules: "Resolve ids from GET /api/state and send its version as X-State-Version on planner writes. A 403 means the account lacks the required privilege. Keep patient identifiers and other PHI out of all requests.",
    credentialSafety: "Use HTTPS or a trusted tunnel. Keep passwords, bearer tokens, and API keys private; never put them in schedule notes or logs."
  };
}

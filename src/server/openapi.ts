import { CALL_POSITIONS, SERVICE_LINES } from "../shared/types";

export function getOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Resident OR Coverage Planner API",
      version: "0.1.0",
      description:
        "API for viewing and editing resident OR coverage planner data. Use X-API-Key for external tools and MCP servers, or a browser login token for app sessions."
    },
    servers: [
      {
        url: process.env.PUBLIC_BASE_URL || "/"
      }
    ],
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key"
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      },
      parameters: {
        StateVersionHeader: {
          name: "X-State-Version",
          in: "header",
          required: false,
          schema: { type: "number" },
          description: "PlannerState.version from the latest GET /api/state. Stale values return 409 with currentVersion."
        }
      },
      schemas: {
        LoginRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" }
          }
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            username: { type: "string" },
            displayName: { type: "string" },
            role: { type: "string", enum: ["admin", "attending", "viewer", "medical-student"] },
            attendingId: { type: "string", description: "Required for attending accounts; links the account to an attending record." },
            servicePrivileges: {
              type: "object",
              additionalProperties: { type: "string", enum: ["view", "request", "edit"] }
            },
            passwordUpdatedAt: { type: "string", format: "date-time" },
            mustChangePassword: { type: "boolean" }
          }
        },
        UserSummary: {
          type: "object",
          properties: {
            username: { type: "string" },
            displayName: { type: "string" },
            role: { type: "string", enum: ["admin", "attending", "viewer", "medical-student"] },
            attendingId: { type: "string" },
            servicePrivileges: {
              type: "object",
              additionalProperties: { type: "string", enum: ["view", "request", "edit"] }
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            passwordUpdatedAt: { type: "string", format: "date-time" },
            mustChangePassword: { type: "boolean" }
          }
        },
        UserInput: {
          type: "object",
          required: ["username"],
          properties: {
            username: { type: "string" },
            displayName: { type: "string" },
            accountType: {
              type: "string",
              enum: ["user", "attending", "medical-student"],
              description: "Use this for account creation, especially with X-API-Key. user is stored as the viewer role; medical-student accounts also create a case-assignable medical-student roster entry. Defaults to user."
            },
            role: {
              type: "string",
              enum: ["admin", "attending", "viewer", "medical-student"],
              description: "Browser-admin compatibility field. X-API-Key callers can create user/viewer, attending, or medical-student accounts."
            },
            attendingId: { type: "string", description: "Required when role is attending." },
            password: { type: "string", description: "Optional permanent password. Cannot be combined with temporaryPassword." },
            temporaryPassword: {
              type: "string",
              description: "Optional temporary password chosen by the admin. Requires a password change on first login; omit password and temporaryPassword to use schroeder1."
            },
            servicePrivileges: {
              type: "object",
              additionalProperties: { type: "string", enum: ["view", "request", "edit"] }
            }
          }
        },
        UserCreationResult: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/UserSummary" },
            temporaryPassword: {
              type: "string",
              description: "Returned once for temporary-password accounts, including the schroeder1 default."
            }
          }
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        ConflictResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            currentVersion: { type: "number" }
          }
        },
        AssignmentInput: {
          type: "object",
          required: ["kind", "targetId", "residentId"],
          properties: {
            kind: { type: "string", enum: ["case", "block", "clinic"] },
            targetId: { type: "string" },
            residentId: { type: "string" },
            locked: { type: "boolean", default: false }
          }
        },
        ClaimInput: {
          type: "object",
          required: ["scope", "targetId", "residentId"],
          properties: {
            scope: { type: "string", enum: ["case", "block"] },
            targetId: { type: "string" },
            residentId: { type: "string" }
          }
        },
        GoldStarInput: {
          type: "object",
          required: ["recipientResidentId"],
          properties: {
            recipientResidentId: { type: "string", description: "Resident receiving this week's gold star." }
          }
        },
        CoverageEntryInput: {
          type: "object",
          required: ["date", "kind"],
          properties: {
            date: { type: "string", format: "date" },
            kind: { type: "string", enum: ["call", "rounding", "off", "note"] },
            residentId: { type: "string" },
            serviceLine: { type: "string", enum: [...SERVICE_LINES] },
            callPosition: {
              type: "string",
              enum: [...CALL_POSITIONS],
              description: "Required for surgery call entries. Use senior, mid-level, or intern. Omit for SCC/ICU call."
            },
            note: {
              type: "string",
              description: "For call entries, omit this unless marking the one SCC/ICU resident with exactly SCC or ICU."
            }
          }
        },
        VacationBlockInput: {
          type: "object",
          required: ["id", "startDate", "endDate"],
          properties: {
            id: { type: "string" },
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date", description: "Inclusive. Must be on or after startDate." }
          }
        },
        ResidentVacationChange: {
          type: "object",
          required: ["residentId", "vacation"],
          properties: {
            residentId: { type: "string" },
            vacation: { type: "array", items: { $ref: "#/components/schemas/VacationBlockInput" } }
          }
        },
        CoverageRequestInput: {
          type: "object",
          required: ["action"],
          properties: {
            serviceLine: { type: "string", enum: [...SERVICE_LINES] },
            requestType: { type: "string", enum: ["calendar", "resident-trade", "resident-profile", "resident-vacation"], default: "calendar" },
            action: { type: "string", enum: ["create", "update", "delete"] },
            entryId: { type: "string" },
            requestedEntry: { $ref: "#/components/schemas/CoverageEntryInput" },
            requestedResidentProfile: {
              type: "object",
              properties: {
                residentId: { type: "string" },
                name: { type: "string" },
                aliases: { type: "array", items: { type: "string" } }
              }
            },
            requestedResidentVacation: { $ref: "#/components/schemas/ResidentVacationChange" },
            targetResidentId: { type: "string", description: "For resident-trade, resident-profile, and resident-vacation requests, the target resident." },
            swapEntryId: { type: "string", description: "Optional resident-trade entry owned by targetResidentId to swap back to the requester." },
            requesterName: { type: "string" },
            message: { type: "string" }
          }
        }
      }
    },
    paths: {
      "/api/healthz": {
        get: {
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "Server is healthy"
            }
          }
        }
      },
      "/api/openapi.json": {
        get: {
          summary: "OpenAPI document",
          security: [],
          responses: {
            "200": {
              description: "OpenAPI JSON"
            }
          }
        }
      },
      "/api/auth/login": {
        post: {
          summary: "Create a browser-session bearer token",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Login token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LoginResponse" }
                }
              }
            },
            "401": { description: "Invalid login" }
          }
        }
      },
      "/api/session": {
        get: {
          summary: "Show authenticated role",
          responses: {
            "200": { description: "Current role and auth type" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/events": {
        get: {
          summary: "Subscribe to planner state updates",
          description: "Server-Sent Events stream. Browser EventSource clients pass a bearer token as ?token= because EventSource cannot set Authorization headers.",
          parameters: [{ name: "token", in: "query", required: false, schema: { type: "string" } }],
          responses: {
            "200": { description: "text/event-stream with state version events" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/users": {
        get: {
          summary: "List browser users",
          description: "Requires a logged-in admin browser session. API keys are not accepted for browser-user management.",
          responses: {
            "200": {
              description: "User list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      users: { type: "array", items: { $ref: "#/components/schemas/UserSummary" } }
                    }
                  }
                }
              }
            },
            "403": { description: "Non-admin user or API-key auth" }
          }
        },
        post: {
          summary: "Create browser user",
          description:
            "Requires a logged-in admin browser session or the admin X-API-Key. API-key callers can create user, attending, or medical-student accounts, set servicePrivileges, and set temporaryPassword. Use accountType user, attending, or medical-student; omit both password fields to use the schroeder1 temporary password. Temporary passwords force a password change on next login.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserInput" }
              }
            }
          },
          responses: {
            "201": {
              description: "Created user, optional temporary password, and refreshed user list",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/UserCreationResult" },
                      {
                        type: "object",
                        properties: {
                          users: { type: "array", items: { $ref: "#/components/schemas/UserSummary" } }
                        }
                      }
                    ]
                  }
                }
              }
            },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/users/bulk": {
        post: {
          summary: "Create multiple browser users",
          description:
            "Requires a logged-in admin browser session or the admin X-API-Key. API-key callers can create user, attending, or medical-student accounts, set servicePrivileges, and set temporaryPassword. Omit both password fields to use the schroeder1 temporary password.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["users"],
                  properties: {
                    users: { type: "array", items: { $ref: "#/components/schemas/UserInput" } }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Created users and refreshed user list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      created: { type: "array", items: { $ref: "#/components/schemas/UserCreationResult" } },
                      users: { type: "array", items: { $ref: "#/components/schemas/UserSummary" } }
                    }
                  }
                }
              }
            },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/users/{username}": {
        patch: {
          summary: "Update browser user privileges",
          description: "Requires a logged-in admin browser session. API keys are not accepted for browser-user management.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated user and refreshed user list" },
            "403": { description: "Non-admin user or API-key auth" }
          }
        },
        delete: {
          summary: "Delete browser user",
          description: "Requires a logged-in admin browser session. API keys are not accepted for browser-user management. The built-in admin account cannot be deleted.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Refreshed user list" },
            "403": { description: "Non-admin user or API-key auth" }
          }
        }
      },
      "/api/users/{username}/password": {
        patch: {
          summary: "Generate a temporary password",
          description:
            "Requires a logged-in admin browser session. API keys are not accepted for browser-user management. Generates a temporary password, returns it once, stores only its hash, and requires the user to change it on next login.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Temporary password, updated user, and refreshed user list" },
            "403": { description: "Non-admin user or API-key auth" }
          }
        }
      },
      "/api/me/password": {
        patch: {
          summary: "Change current browser user's password",
          responses: {
            "200": { description: "Password changed" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/me/password/skip": {
        post: {
          summary: "Defer the current session's required password change",
          description:
            "Allows the current temporary-password session to use the planner. The password-change screen returns after the next username/password login unless the password is changed.",
          responses: {
            "200": { description: "Replacement session token" },
            "400": { description: "Password change is not required" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/state": {
        get: {
          summary: "Get complete planner state",
          description: "Best endpoint for AI tools that need a full current snapshot.",
          responses: {
            "200": { description: "PlannerState JSON" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/weeks/{weekId}/schedule": {
        get: {
          summary: "Get computed weekly schedule",
          parameters: [
            { name: "weekId", in: "path", required: true, schema: { type: "string" } },
            { name: "service", in: "query", required: false, schema: { type: "string", enum: [...SERVICE_LINES] } }
          ],
          responses: {
            "200": { description: "WeekSchedule JSON with computed case times and warnings" }
          }
        }
      },
      "/api/weeks/{weekId}/warnings": {
        get: {
          summary: "Get assignment warnings",
          parameters: [
            { name: "weekId", in: "path", required: true, schema: { type: "string" } },
            { name: "service", in: "query", required: false, schema: { type: "string", enum: [...SERVICE_LINES] } }
          ],
          responses: {
            "200": { description: "Warning array" }
          }
        }
      },
      "/api/weeks/{weekId}/uncovered-message": {
        get: {
          summary: "Generate uncovered coverage text",
          parameters: [
            { name: "weekId", in: "path", required: true, schema: { type: "string" } },
            { name: "date", in: "query", required: false, schema: { type: "string", format: "date" } },
            { name: "service", in: "query", required: false, schema: { type: "string", enum: [...SERVICE_LINES] } }
          ],
          responses: {
            "200": { description: "Copyable uncovered message" }
          }
        }
      },
      "/api/residents/{residentId}/calendar.ics": {
        get: {
          summary: "Export a resident calendar feed",
          description: "Returns text/calendar with OR, clinic, call, rounding, off, note, and vacation entries. Non-admin users can export only their linked resident profile.",
          parameters: [
            { name: "residentId", in: "path", required: true, schema: { type: "string" } },
            { name: "token", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "ICS calendar feed" },
            "403": { description: "Calendar export is not allowed for this user" },
            "404": { description: "Resident not found" }
          }
        }
      },
      "/api/weeks/{weekId}/suggest": {
        post: {
          summary: "Run schedule suggestion",
          description: "Admin only. Preserves locked/manual assignments and fills uncovered cases/clinics.",
          parameters: [
            { name: "weekId", in: "path", required: true, schema: { type: "string" } },
            { name: "service", in: "query", required: false, schema: { type: "string", enum: [...SERVICE_LINES] } }
          ],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/entities/{collection}": {
        post: {
          summary: "Create an entity",
          description:
            "Admin only. Collection must be one of hospitals, attendings, residents, procedureDefaults, weeks, attendingBlocks, cases, clinicSessions.",
          parameters: [{ name: "collection", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/entities/{collection}/{id}": {
        patch: {
          summary: "Patch an entity",
          description: "Admin only. Partial updates are merged into the entity with the matching id.",
          parameters: [
            { name: "collection", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        },
        delete: {
          summary: "Delete an entity",
          description: "Admin only.",
          parameters: [
            { name: "collection", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/assignments": {
        post: {
          summary: "Create an assignment",
          description:
            "Requires edit privilege for the assignment target service, or admin/API admin access. Case assignments can add a second resident to the same case, but duplicate resident/case pairs are rejected. Creating a block assignment replaces the same-target block assignment and clears case-level assignments within that block.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AssignmentInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "400": { description: "Invalid or duplicate assignment" },
            "403": { description: "Edit privilege required" }
          }
        }
      },
      "/api/assignments/{id}": {
        patch: {
          summary: "Patch an assignment",
          description: "Requires edit privilege for the assignment target service, or admin/API admin access. Use this to change residentId or locked status.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "200": { description: "Updated PlannerState" }
          }
        },
        delete: {
          summary: "Delete an assignment",
          description: "Requires edit privilege for the assignment target service, or admin/API admin access.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" }
          }
        }
      },
      "/api/claims": {
        post: {
          summary: "Viewer/admin claim uncovered coverage",
          description:
            "Requires edit privilege for the target service, or admin/API admin access. Auto-assigns the selected resident to an uncovered case or block and records activity.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClaimInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" }
          }
        }
      },
      "/api/gold-stars": {
        post: {
          summary: "Award this week's Gold Star Chart star",
          description:
            "Requires a logged-in browser account. Each account can award one star per Monday-starting week; a resident-linked account cannot award its own resident profile. State responses support anonymous weekly chart counts.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoldStarInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "400": { description: "Invalid recipient, self-award, or weekly star already used" }
          }
        }
      },
      "/api/coverage-entries": {
        post: {
          summary: "Create a call calendar entry",
          description:
            "Requires edit privilege for serviceLine, or admin/API admin access. Call is allowed Friday-Sunday and is shared across services. Each surgery call date uses one residentId from the resident list for each callPosition: senior, mid-level, and intern. Each position can be filled once per date. The one SCC/ICU resident is an additional call entry with note SCC or ICU and no callPosition. Do not put role names, source labels, or free text in call note. Rounding is allowed Saturday-Sunday and supports multiple service-specific rounders. Patch or delete by id to change an existing entry.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CoverageEntryInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "400": { description: "Invalid coverage entry" },
            "403": { description: "Edit privilege required" }
          }
        }
      },
      "/api/coverage-entries/{id}": {
        patch: {
          summary: "Patch a call calendar entry",
          description: "Requires edit privilege for serviceLine, or admin/API admin access.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Edit privilege required" }
          }
        },
        delete: {
          summary: "Delete a call calendar entry",
          description: "Requires edit privilege for serviceLine, or admin/API admin access.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Edit privilege required" }
          }
        }
      },
      "/api/coverage-requests": {
        post: {
          summary: "Submit a schedule change request",
          description: "Default calendar requests require request or edit privilege for serviceLine and are resolved by a service editor. Resident-trade requests use requestType=resident-trade, must come from the linked resident who owns entryId, and are resolved by targetResidentId. Resident-profile requests use requestType=resident-profile, must come from the linked resident profile, and require admin approval. Resident-vacation requests use requestType=resident-vacation and require admin approval.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CoverageRequestInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" }
          }
        }
      },
      "/api/coverage-requests/{id}": {
        delete: {
          summary: "Remove a coverage request from the request log",
          description: "Admin-only cleanup for accidental or obsolete requests. This removes the request record without applying, approving, or denying it.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/coverage-requests/{id}/approve": {
        post: {
          summary: "Approve and apply a calendar request",
          description: "Requires edit privilege for the request serviceLine, admin/API admin access, the target resident on a resident-trade request, or admin access for resident-profile and resident-vacation requests.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Edit privilege required" }
          }
        }
      },
      "/api/coverage-requests/{id}/deny": {
        post: {
          summary: "Deny a calendar request",
          description: "Requires edit privilege for the request serviceLine, admin/API admin access, the target resident on a resident-trade request, or admin access for resident-profile and resident-vacation requests.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Edit privilege required" }
          }
        }
      }
    }
  };
}

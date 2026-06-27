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
      schemas: {
        LoginRequest: {
          type: "object",
          required: ["role", "password"],
          properties: {
            role: { type: "string", enum: ["admin", "viewer"] },
            password: { type: "string" }
          }
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            role: { type: "string", enum: ["admin", "viewer"] }
          }
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" }
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
        CoverageEntryInput: {
          type: "object",
          required: ["date", "kind"],
          properties: {
            date: { type: "string", format: "date" },
            kind: { type: "string", enum: ["call", "rounding", "off", "note"] },
            residentId: { type: "string" },
            note: { type: "string" }
          }
        },
        CoverageRequestInput: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["create", "update", "delete"] },
            entryId: { type: "string" },
            requestedEntry: { $ref: "#/components/schemas/CoverageEntryInput" },
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
          parameters: [{ name: "weekId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "WeekSchedule JSON with computed case times and warnings" }
          }
        }
      },
      "/api/weeks/{weekId}/warnings": {
        get: {
          summary: "Get assignment warnings",
          parameters: [{ name: "weekId", in: "path", required: true, schema: { type: "string" } }],
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
            { name: "date", in: "query", required: false, schema: { type: "string", format: "date" } }
          ],
          responses: {
            "200": { description: "Copyable uncovered message" }
          }
        }
      },
      "/api/weeks/{weekId}/suggest": {
        post: {
          summary: "Run schedule suggestion",
          description: "Admin only. Preserves locked/manual assignments and fills uncovered cases/clinics.",
          parameters: [{ name: "weekId", in: "path", required: true, schema: { type: "string" } }],
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
          summary: "Create or replace an assignment",
          description:
            "Admin only. Case and block assignments replace same-target assignments. Creating a block assignment clears case-level assignments within that block.",
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
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/assignments/{id}": {
        patch: {
          summary: "Patch an assignment",
          description: "Admin only. Use this to change residentId or locked status.",
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
          description: "Admin only.",
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
            "Viewer-accessible. Auto-assigns the selected resident to an uncovered case or block and records activity.",
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
      "/api/coverage-entries": {
        post: {
          summary: "Create or replace a call calendar entry",
          description:
            "Admin only. Call is allowed Friday-Sunday; rounding is allowed Saturday-Sunday. Call/rounding entries replace the same date/kind slot.",
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
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/coverage-entries/{id}": {
        patch: {
          summary: "Patch a call calendar entry",
          description: "Admin only.",
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
            "403": { description: "Admin access required" }
          }
        },
        delete: {
          summary: "Delete a call calendar entry",
          description: "Admin only.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/coverage-requests": {
        post: {
          summary: "Submit a viewer-edit calendar request",
          description: "Viewer-accessible. Creates a pending request for an admin to approve or deny.",
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
      "/api/coverage-requests/{id}/approve": {
        post: {
          summary: "Approve and apply a calendar request",
          description: "Admin only.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/coverage-requests/{id}/deny": {
        post: {
          summary: "Deny a calendar request",
          description: "Admin only.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" }
          }
        }
      }
    }
  };
}

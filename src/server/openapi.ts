import {
  ATTENDING_COVERAGE_LINES,
  CALL_POSITIONS,
  SERVICE_LINES,
  WIKI_ARTICLE_KINDS,
  WIKI_AUTHORITIES,
  WIKI_CATEGORIES,
  WIKI_CLINICAL_PHASES,
  WIKI_RELATIONSHIP_TYPES,
  WIKI_SOURCE_TYPES,
  WIKI_STATUSES
} from "../shared/types";

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
            canAddContacts: { type: "boolean", description: "Allows adding directory contacts without admin approval." },
            preferredVoicePreset: { type: "integer", minimum: 1, maximum: 5, default: 1 },
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
            canAddContacts: { type: "boolean" },
            voiceDailyLimit: { type: "integer", minimum: 0, maximum: 10000, default: 12 },
            preferredVoicePreset: { type: "integer", minimum: 1, maximum: 5, default: 1 },
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
            },
            canAddContacts: { type: "boolean", description: "Grant direct contact publishing; otherwise submissions require approval." }
          }
        },
        DirectoryContactInput: {
          type: "object",
          required: ["name", "phoneNumber", "category"],
          properties: {
            name: { type: "string", maxLength: 120 },
            phoneNumber: { type: "string", description: "Telephone number containing 7 to 15 digits; formatting is allowed." },
            alternatePhoneNumbers: {
              type: "array",
              items: { type: "string" },
              description: "Optional additional telephone numbers containing 7 to 15 digits each."
            },
            aliases: {
              type: "array",
              items: { type: "string", maxLength: 120 },
              description: "Optional alternate names included in directory search."
            },
            category: { type: "string", maxLength: 80 },
            directoryType: {
              type: "string",
              enum: ["Hospital", "Residents", "Faculty & Staff"],
              default: "Hospital",
              description: "Top-level Contacts tab filter."
            },
            facility: {
              type: "string",
              enum: ["RMH", "NRV", "FMH", "Giles", "Tazewell", "Rockbridge"],
              default: "RMH",
              description: "Hospital subdirectory. Ignored for non-hospital contacts."
            },
            building: { type: "string", maxLength: 120 },
            importance: { type: "string", enum: ["essential", "extended"], default: "extended" },
            organization: { type: "string", maxLength: 120, description: "Optional; defaults from directoryType." }
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
        ChatModelSettings: {
          type: "object",
          required: [
            "chatProvider",
            "primaryModel",
            "fallbackModels",
            "transcriptionModel",
            "voiceModel",
            "voiceName",
            "elevenLabsModel",
            "elevenLabsVoiceIds",
            "updatedAt"
          ],
          properties: {
            chatProvider: { type: "string", enum: ["openai", "openrouter"], example: "openai" },
            primaryModel: { type: "string", example: "gpt-5.6-luna" },
            fallbackModels: {
              type: "array",
              maxItems: 5,
              items: { type: "string" },
              description: "Ordered fallback model ids for the selected text provider. May be empty."
            },
            transcriptionModel: { type: "string", example: "nvidia/parakeet-tdt-0.6b-v3" },
            voiceModel: { type: "string", example: "fish-audio/s2.1-pro-free:free" },
            voiceName: { type: "string", example: "David Attenborough Dramatic" },
            elevenLabsModel: { type: "string", example: "eleven_multilingual_v2" },
            elevenLabsVoiceIds: {
              type: "array",
              minItems: 5,
              maxItems: 5,
              items: { type: "string" },
              example: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf", "onwK4e9ZLuTAKqWW03F9", "ia2hmHnWgMXcUgmY4yVU"]
            },
            updatedAt: { type: ["string", "null"], format: "date-time" }
          }
        },
        AdminVoiceQuota: {
          type: "object",
          required: ["username", "date", "used", "remaining", "limit"],
          properties: {
            username: { type: "string" },
            date: { type: "string", format: "date", description: "Current Eastern-time quota date." },
            used: { type: "integer", minimum: 0 },
            remaining: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 0, maximum: 10000 }
          }
        },
        WikiArticle: {
          type: "object",
          required: [
            "id",
            "slug",
            "title",
            "summary",
            "body",
            "category",
            "aliases",
            "tags",
            "links",
            "status",
            "authority",
            "revision",
            "contentHash",
            "sourceRefs",
            "createdAt",
            "updatedAt"
          ],
          properties: {
            id: { type: "string", readOnly: true },
            slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            title: { type: "string", maxLength: 120 },
            summary: { type: "string", maxLength: 500 },
            body: { type: "string", maxLength: 20000 },
            category: { type: "string", enum: WIKI_CATEGORIES },
            kind: { type: "string", enum: WIKI_ARTICLE_KINDS },
            scope: {
              type: "object",
              properties: {
                services: { type: "array", items: { type: "string" } },
                attendings: { type: "array", items: { type: "string" } },
                procedures: { type: "array", items: { type: "string" } },
                hospitals: { type: "array", items: { type: "string" } },
                phases: { type: "array", items: { type: "string", enum: WIKI_CLINICAL_PHASES } },
                patientPopulations: { type: "array", items: { type: "string" } }
              }
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "target"],
                properties: {
                  type: { type: "string", enum: WIKI_RELATIONSHIP_TYPES },
                  target: { type: "string" },
                  note: { type: "string" }
                }
              }
            },
            audience: { type: "array", items: { type: "string" }, description: "Descriptive audience labels; not access control." },
            aliases: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            links: {
              type: "array",
              items: { type: "string" },
              description: "Outbound links expressed as wiki article slugs. Links may target articles created later."
            },
            status: { type: "string", enum: WIKI_STATUSES },
            authority: { type: "string", enum: WIKI_AUTHORITIES },
            revision: { type: "integer", minimum: 1, readOnly: true },
            contentHash: { type: "string", readOnly: true },
            sourceRefs: {
              type: "array",
              items: {
                type: "object",
                required: ["sourceId"],
                properties: {
                  sourceId: { type: "string" },
                  locator: { type: "string" },
                  supports: { type: "string" }
                }
              }
            },
            owner: { type: "string", description: "Responsible local person, role, or group for review." },
            reviewedBy: { type: "string" },
            reviewedAt: { type: "string", format: "date" },
            reviewDueAt: { type: "string", format: "date" },
            supersedes: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time", readOnly: true },
            updatedAt: { type: "string", format: "date-time", readOnly: true },
            updatedBy: { type: "string", readOnly: true }
          }
        },
        WikiArticleInput: {
          type: "object",
          required: ["slug", "title", "summary", "body", "category"],
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            body: { type: "string" },
            category: { type: "string", enum: WIKI_CATEGORIES },
            kind: { type: "string", enum: WIKI_ARTICLE_KINDS },
            scope: {
              type: "object",
              properties: {
                services: { type: "array", items: { type: "string" } },
                attendings: { type: "array", items: { type: "string" } },
                procedures: { type: "array", items: { type: "string" } },
                hospitals: { type: "array", items: { type: "string" } },
                phases: { type: "array", items: { type: "string", enum: WIKI_CLINICAL_PHASES } },
                patientPopulations: { type: "array", items: { type: "string" } }
              }
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "target"],
                properties: {
                  type: { type: "string", enum: WIKI_RELATIONSHIP_TYPES },
                  target: { type: "string" },
                  note: { type: "string" }
                }
              }
            },
            audience: { type: "array", items: { type: "string" } },
            aliases: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            links: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: WIKI_STATUSES },
            authority: { type: "string", enum: WIKI_AUTHORITIES },
            sourceRefs: {
              type: "array",
              items: {
                type: "object",
                required: ["sourceId"],
                properties: {
                  sourceId: { type: "string" },
                  locator: { type: "string" },
                  supports: { type: "string" }
                }
              }
            },
            owner: { type: "string" },
            reviewedBy: { type: "string" },
            reviewedAt: { type: "string", format: "date" },
            reviewDueAt: { type: "string", format: "date" },
            supersedes: { type: "array", items: { type: "string" } }
          }
        },
        WikiSource: {
          type: "object",
          required: ["id", "title", "sourceType", "capturedAt", "contentHash"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            sourceType: { type: "string", enum: WIKI_SOURCE_TYPES },
            author: { type: "string" },
            origin: { type: "string" },
            capturedAt: { type: "string", format: "date-time" },
            effectiveDate: { type: "string", format: "date" },
            contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
            referenceFile: {
              type: "object",
              description: "Present when the original source should remain available as a resident-downloadable reference.",
              required: ["filename", "mediaType", "byteSize"],
              properties: {
                filename: { type: "string" },
                mediaType: { type: "string" },
                byteSize: { type: "integer", minimum: 1, maximum: 26214400 },
                available: { type: "boolean", readOnly: true, description: "True only after the server has verified and stored the binary." }
              }
            },
            downloadUrl: { type: "string", readOnly: true },
            notes: { type: "string" },
            createdAt: { type: "string", format: "date-time", readOnly: true },
            updatedAt: { type: "string", format: "date-time", readOnly: true },
            updatedBy: { type: "string", readOnly: true }
          }
        },
        WikiSyncInput: {
          type: "object",
          required: ["baseRevision"],
          properties: {
            baseRevision: {
              type: "integer",
              minimum: 0,
              description: "Wiki revision from the most recent export or pull. A stale value is rejected."
            },
            articles: { type: "array", items: { $ref: "#/components/schemas/WikiArticleInput" } },
            sources: { type: "array", items: { $ref: "#/components/schemas/WikiSource" } },
            deleteArticles: { type: "array", items: { type: "string" } },
            deleteSources: { type: "array", items: { type: "string" } }
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
            kind: { type: "string", enum: ["call", "attending-call", "rounding", "off", "note"] },
            residentId: { type: "string" },
            dayAttendingId: {
              type: "string",
              description: "Required with nightAttendingId for attending-call. May match nightAttendingId for one attending all day."
            },
            nightAttendingId: {
              type: "string",
              description: "Required with dayAttendingId for attending-call. May differ for split day/night coverage."
            },
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
        AttendingCoverageInput: {
          type: "object",
          required: ["date", "line", "shift", "role"],
          properties: {
            date: { type: "string", format: "date" },
            line: {
              type: "string",
              enum: [...ATTENDING_COVERAGE_LINES, "Elective"],
              description: "Use ACS for the shared EGS/Trauma/SCC primary night assignment. Elective is accepted as an alias for Practice."
            },
            shift: {
              type: "string",
              enum: ["day", "night", "24h", "weekend"],
              description: "Practice/Elective, Vascular, Pediatrics, and NRV accept separate day/night coverage on every date, including weekends. Missing nights inherit effective day coverage, and missing Friday-Sunday dates inherit within that weekend. The Friday-anchored weekend shift remains shorthand through Monday 6 AM; NRV shorthand begins Friday morning, while the other independent lines begin Friday at 5 PM."
            },
            role: { type: "string", enum: ["primary", "backup"] },
            attendingId: { type: "string", description: "Exactly one of attendingId or fellowResidentId is required." },
            fellowResidentId: {
              type: "string",
              description: "A resident profile designated minimally-invasive-fellow; valid only for primary Practice weekend call."
            },
            note: { type: "string", description: "Optional no-PHI scheduling note." }
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
      "/api/me/voice-preset": {
        patch: {
          summary: "Save the current user's spoken-response voice",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["preferredVoicePreset"],
                  properties: {
                    preferredVoicePreset: { type: "integer", minimum: 1, maximum: 5 }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Saved voice selection" },
            "400": { description: "Invalid voice preset" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/wiki": {
        get: {
          summary: "List or search residency wiki articles",
          description: "Available to all authenticated users. Returns article summaries; pass query for lexical local-knowledge search.",
          parameters: [
            { name: "query", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 8 } },
            {
              name: "includeUnpublished",
              in: "query",
              required: false,
              description: "Admin-only switch for draft, review, and archived articles.",
              schema: { type: "boolean", default: false }
            }
          ],
          responses: { "200": { description: "Matching wiki article summaries" } }
        },
        post: {
          summary: "Create a residency wiki article",
          description: "Requires an admin browser session or the admin X-API-Key. Wiki text must remain no-PHI.",
          parameters: [{ $ref: "#/components/parameters/StateVersionHeader" }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WikiArticleInput" } } }
          },
          responses: {
            "201": { description: "Created article" },
            "403": { description: "Admin access required" },
            "409": { description: "Duplicate slug or stale state version" }
          }
        }
      },
      "/api/wiki/export": {
        get: {
          summary: "Export the complete versioned wiki",
          description: "Admin-only endpoint for local backup and authoring workspace synchronization.",
          responses: {
            "200": { description: "Wiki revision, articles, source records, and export timestamp" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/wiki/changes": {
        get: {
          summary: "Read the wiki change feed",
          description: "Admin-only incremental change feed. Use export when the requested revision predates retained events.",
          parameters: [
            { name: "after", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }
          ],
          responses: {
            "200": { description: "Current revision, article/source change events, and whether a full export is required" }
          }
        }
      },
      "/api/wiki/sources": {
        get: {
          summary: "List wiki provenance records",
          description: "Admin-only source metadata, including protected download URLs for retained reference files.",
          responses: {
            "200": { description: "Wiki source records and current wiki revision" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/wiki/sources/{sourceId}/file": {
        get: {
          summary: "Download a retained wiki reference file",
          description: "Authenticated users may download a file only when a published article references its source. Admins may download draft-source files.",
          parameters: [{ name: "sourceId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Original reference file", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
            "404": { description: "Reference file not found or not visible" }
          }
        },
        put: {
          summary: "Upload or replace a retained wiki reference file",
          description: "Admin API key or admin session required. The binary SHA-256 must match the source contentHash.",
          parameters: [
            { name: "sourceId", in: "path", required: true, schema: { type: "string" } },
            { name: "X-Wiki-Filename", in: "header", required: true, schema: { type: "string" }, description: "URI-encoded download filename" }
          ],
          requestBody: {
            required: true,
            content: { "application/octet-stream": { schema: { type: "string", format: "binary", maxLength: 26214400 } } }
          },
          responses: {
            "200": { description: "Existing matching reference file refreshed" },
            "201": { description: "Reference-file metadata created" },
            "400": { description: "Hash, filename, or file body is invalid" },
            "403": { description: "Admin access required" }
          }
        },
        delete: {
          summary: "Remove a retained wiki reference file",
          description: "Admin-only. Removes the protected binary and clears its reference-file metadata.",
          parameters: [{ name: "sourceId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Reference file removed" },
            "403": { description: "Admin access required" },
            "404": { description: "Reference file not found" }
          }
        }
      },
      "/api/wiki/sync/preview": {
        post: {
          summary: "Validate and preview a wiki synchronization",
          description: "Admin-only, read-only semantic preview. No server state is changed.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WikiSyncInput" } } }
          },
          responses: {
            "200": { description: "Create/update/delete counts and knowledge-base validation results" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/wiki/sync/apply": {
        post: {
          summary: "Transactionally apply a wiki synchronization",
          description: "Admin-only. Rejects stale base revisions and invalid provenance or publication metadata.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WikiSyncInput" } } }
          },
          responses: {
            "200": { description: "Applied wiki revision and change summary" },
            "400": { description: "Knowledge-base validation failed" },
            "403": { description: "Admin access required" },
            "409": { description: "Wiki base revision is stale" }
          }
        }
      },
      "/api/wiki/{slug}": {
        get: {
          summary: "Read one linked residency wiki article",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Article, outbound linked summaries, and backlinks" },
            "404": { description: "Article not found" }
          }
        },
        patch: {
          summary: "Update a residency wiki article",
          description: "Requires an admin browser session or the admin X-API-Key. Renaming a slug updates inbound links.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WikiArticleInput" } } }
          },
          responses: {
            "200": { description: "Updated article" },
            "403": { description: "Admin access required" },
            "404": { description: "Article not found" },
            "409": { description: "Duplicate slug or stale state version" }
          }
        },
        delete: {
          summary: "Delete a residency wiki article",
          description: "Requires an admin browser session or the admin X-API-Key. Removes inbound links to the deleted article.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          responses: {
            "200": { description: "Deleted article slug" },
            "403": { description: "Admin access required" },
            "404": { description: "Article not found" },
            "409": { description: "Stale state version" }
          }
        }
      },
      "/api/admin/chat-settings": {
        get: {
          summary: "Get the assistant's text and voice provider settings",
          description: "Requires an admin browser session or the admin X-API-Key. Does not expose provider API keys.",
          responses: {
            "200": {
              description: "Current persisted model settings",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ChatModelSettings" } } }
            },
            "403": { description: "Admin access required" }
          }
        },
        patch: {
          summary: "Update the assistant's text and voice provider settings",
          description:
            "Requires an admin browser session or the admin X-API-Key. Send one or more fields. Changes apply to new chat, transcription, or speech requests and persist across restarts.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    chatProvider: { type: "string", enum: ["openai", "openrouter"] },
                    primaryModel: { type: "string" },
                    fallbackModels: { type: "array", maxItems: 5, items: { type: "string" } },
                    transcriptionModel: { type: "string" },
                    voiceModel: { type: "string" },
                    voiceName: { type: "string" },
                    elevenLabsModel: { type: "string" },
                    elevenLabsVoiceIds: {
                      type: "array",
                      minItems: 5,
                      maxItems: 5,
                      items: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated persisted model settings",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ChatModelSettings" } } }
            },
            "400": { description: "Invalid assistant provider settings" },
            "403": { description: "Admin access required" }
          }
        }
      },
      "/api/admin/users/{username}/voice-quota": {
        get: {
          summary: "Read a user's voice quota and today's usage",
          description: "Requires an admin browser session or the admin X-API-Key.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Configured limit and current Eastern-day usage",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AdminVoiceQuota" } } }
            },
            "403": { description: "Admin access required" },
            "404": { description: "User not found" }
          }
        },
        patch: {
          summary: "Change a user's voice limit and/or reset today's usage",
          description: "Requires an admin browser session or the admin X-API-Key. Send limit, resetUsed: true, or both.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    limit: { type: "integer", minimum: 0, maximum: 10000 },
                    resetUsed: { type: "boolean", const: true, description: "Sets today's used count to zero." }
                  },
                  anyOf: [{ required: ["limit"] }, { required: ["resetUsed"] }]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated quota and usage",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AdminVoiceQuota" } } }
            },
            "400": { description: "Invalid limit or empty update" },
            "403": { description: "Admin access required" },
            "404": { description: "User not found" }
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
      "/api/contacts": {
        get: {
          summary: "List directory contacts",
          description: "Returns all published contacts. Admins also receive all requests; other users receive only their own requests.",
          responses: { "200": { description: "Published contacts and visible contact requests" } }
        },
        post: {
          summary: "Add or request a directory contact",
          description: "The admin X-API-Key, admins, and accounts with canAddContacts publish immediately. Other browser accounts create a pending admin request. The X-Contact-Disposition response header is added or requested.",
          parameters: [{ $ref: "#/components/parameters/StateVersionHeader" }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/DirectoryContactInput" } } }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "409": { description: "Contact exists or already has a pending request" }
          }
        }
      },
      "/api/contacts/{id}": {
        patch: {
          summary: "Update a directory contact",
          description: "Admin browser session or admin X-API-Key required. Omitted fields retain their current values.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/DirectoryContactInput" } } }
          },
          responses: {
            "200": { description: "Updated PlannerState" },
            "403": { description: "Admin access required" },
            "404": { description: "Contact not found" },
            "409": { description: "Updated contact would duplicate an existing contact" }
          }
        },
        delete: {
          summary: "Remove a directory contact",
          description: "Admin browser session or admin X-API-Key required.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          responses: { "200": { description: "Updated PlannerState" }, "403": { description: "Admin access required" } }
        }
      },
      "/api/contact-requests/{id}/approve": {
        post: {
          summary: "Approve and publish a requested contact",
          description: "Admin browser session or admin X-API-Key required.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          responses: { "200": { description: "Updated PlannerState" }, "403": { description: "Admin access required" } }
        }
      },
      "/api/contact-requests/{id}/reject": {
        post: {
          summary: "Reject a requested contact",
          description: "Admin browser session or admin X-API-Key required.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/StateVersionHeader" }
          ],
          responses: { "200": { description: "Updated PlannerState" }, "403": { description: "Admin access required" } }
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
              description: "Created user and optional temporary password. Browser-admin sessions also receive the refreshed user list.",
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
              description: "Created users. Browser-admin sessions also receive the refreshed user list.",
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
            "Requires a logged-in admin browser session or the admin X-API-Key. The API key cannot reset the built-in browser admin account. Omit temporaryPassword to generate one, or send temporaryPassword to choose it. The response returns the temporary password once, only its hash is stored, existing sessions are invalidated, and the user must change it on a later login.",
          parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    temporaryPassword: { type: "string", minLength: 4 }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Temporary password and updated user. Browser-admin sessions also receive the refreshed user list.",
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
          summary: "Award this week's ✨⭐️",
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
            "Requires edit privilege for serviceLine, or admin/API admin access. Call is allowed Friday-Sunday and is shared across services. Each surgery call date uses one residentId from the resident list for each callPosition: senior, mid-level, and intern. Each position can be filled once per date. The one SCC/ICU resident is an additional call entry with note SCC or ICU and no callPosition. Attending coverage uses one attending-call entry per date with dayAttendingId and nightAttendingId; use the same ID for all-day coverage or different IDs for split day/night coverage. Do not put role names, source labels, or free text in call notes. Rounding is allowed Saturday-Sunday and supports multiple service-specific rounders. Patch or delete by id to change an existing entry.",
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
      "/api/attending-coverage": {
        get: {
          summary: "List attending coverage assignments",
          description: "Returns the canonical stored assignments. Optional startDate, endDate, and line query parameters filter the result. When both dates are supplied, effectiveCoverage also expands independent weekend call across Friday-Sunday plus Monday before 6 AM and resolves weekday night fallback.",
          parameters: [
            { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "line", in: "query", schema: { type: "string", enum: [...ATTENDING_COVERAGE_LINES, "Elective"] } }
          ],
          responses: {
            "200": { description: "Filtered stored assignments, resolved effective coverage for ranged reads, and current state version" },
            "400": { description: "Invalid date range or coverage line" }
          }
        },
        post: {
          summary: "Create an attending coverage assignment",
          description:
            "Admin only. API-key writes are marked source=api; browser writes are marked source=manual. EGS, Trauma, and SCC primary night coverage must be submitted once as line=ACS and shift=night. Practice (alias Elective), Vascular, Pediatrics, and NRV accept separate day and night assignments on every date including weekends. Missing nights inherit effective day coverage and missing Friday-Sunday dates inherit within that weekend. A Friday-anchored weekend assignment remains supported as shorthand through Monday 6 AM; NRV begins Friday morning and the other independent lines begin Friday at 5 PM. A minimally invasive fellow may be assigned through fellowResidentId only to the Practice weekend slot.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AttendingCoverageInput" }
              }
            }
          },
          responses: {
            "201": { description: "Updated PlannerState" },
            "400": { description: "Invalid assignment" },
            "409": { description: "Coverage slot is already assigned" }
          }
        }
      },
      "/api/attending-coverage/{id}": {
        patch: {
          summary: "Patch a manual or API attending coverage assignment",
          description: "Admin only. QGenda-owned assignments return 409 and must be changed in QGenda.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AttendingCoverageInput" }
              }
            }
          },
          responses: {
            "200": { description: "Updated PlannerState" },
            "409": { description: "QGenda-owned assignment or duplicate slot" }
          }
        },
        delete: {
          summary: "Delete a manual or API attending coverage assignment",
          description: "Admin only. QGenda-owned assignments return 409 and must be changed in QGenda.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated PlannerState" },
            "409": { description: "QGenda-owned assignment" }
          }
        }
      },
      "/api/integrations/qgenda/sync": {
        post: {
          summary: "Run the QGenda attending-coverage sync now",
          description:
            "Admin only. Reads the configured published QGenda link, replaces QGenda-managed slots in the sync window, preserves manual/API-only lines, and returns the updated state plus import counts.",
          responses: {
            "200": { description: "QGenda sync result" },
            "500": { description: "QGenda fetch or validation failed; the prior assignments remain in place" }
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

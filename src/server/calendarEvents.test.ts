import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { buildCalendarEvent } from "./calendarEvents";
import { createInitialState } from "./sampleData";
import { MemoryStateStore, normalizePlannerState } from "./store";

const conference = { id: "journal_club", title: "Journal Club", date: "2026-10-14", startTime: "17:00",
  meetingUrl: "https://teams.microsoft.com/l/meetup-join/example?context=%7B%22Tid%22%3A%22example%22%7D",
  recurrence: { frequency: "monthly", weekOfMonth: 2, daysOfWeek: [3] } };

describe("conference validation", () => {
  it("allows unknown location/end time and preserves meeting URLs, while rejecting invalid dates and links", () => {
    expect(buildCalendarEvent(conference)).toMatchObject(conference);
    expect(buildCalendarEvent(conference).endTime).toBeUndefined();
    for (const patch of [{ date: "2026-02-30" }, { startTime: "25:00" }, { endTime: "16:00" },
      { meetingUrl: "javascript:alert(1)" }, { meetingUrl: "https://user:password@example.com" },
      { recurrence: { frequency: "daily" } }, { recurrence: { frequency: "weekly", interval: 0 } },
      { recurrence: { frequency: "weekly", daysOfWeek: [7] } },
      { recurrence: { frequency: "weekly", untilDate: "2026-01-01" } }, { residentId: "unknown" }]) {
      expect(() => buildCalendarEvent({ ...conference, ...patch })).toThrow();
    }
  });
  it("preserves patch fields, supports clearing optional details, and migrates without resurrecting deleted events", () => {
    const existing = buildCalendarEvent(conference);
    expect(buildCalendarEvent({ location: "Education room" }, existing)).toMatchObject({ ...existing, location: "Education room", updatedAt: expect.any(String) });
    const cleared = buildCalendarEvent({ recurrence: null, meetingUrl: null }, existing);
    expect(cleared.recurrence).toBeUndefined();
    expect(cleared.meetingUrl).toBeUndefined();
    expect(() => buildCalendarEvent({ id: "changed" }, existing)).toThrow();
    const state = createInitialState();
    const { calendarEvents: _events, ...legacy } = state;
    expect(normalizePlannerState(legacy).calendarEvents[0].id).toBe("calendar_friday_mm");
    expect(normalizePlannerState({ ...state, calendarEvents: [] }).calendarEvents).toEqual([]);
  });
});

describe("residency conference API", () => {
  beforeEach(() => {
    process.env.APP_SECRET = "calendar-test-secret";
    process.env.ADMIN_API_KEY = "calendar-admin-key";
    process.env.VIEWER_API_KEY = "calendar-viewer-key";
  });
  it("publishes, reads recurring occurrences, patches, and deletes with version protection", async () => {
    const store = new MemoryStateStore(createInitialState());
    const app = createApp(store);
    const initial = await request(app).get("/api/calendar-events").set("x-api-key", "calendar-viewer-key").expect(200);
    const added = await request(app).post("/api/calendar-events").set("x-api-key", "calendar-admin-key")
      .set("x-state-version", String(initial.body.version)).send(conference).expect(201);
    expect(added.body.calendarEvents.find((event: { id: string }) => event.id === conference.id)).toMatchObject(conference);
    expect(added.body.version).toBe(initial.body.version + 1);
    await request(app).post("/api/calendar-events").set("x-api-key", "calendar-admin-key").send(conference).expect(409);
    const read = await request(app).get("/api/calendar-events?startDate=2026-10-01&endDate=2026-11-30")
      .set("x-api-key", "calendar-viewer-key").expect(200);
    expect(read.body.occurrences.filter((row: { eventId: string }) => row.eventId === conference.id).map((row: { date: string }) => row.date)).toEqual(["2026-10-14", "2026-11-11"]);
    await request(app).patch(`/api/calendar-events/${conference.id}`).set("x-api-key", "calendar-admin-key")
      .set("x-state-version", String(initial.body.version)).send({ location: "Education room" }).expect(409);
    const updated = await request(app).patch(`/api/calendar-events/${conference.id}`).set("x-api-key", "calendar-admin-key")
      .set("x-state-version", String(added.body.version)).send({ location: "Education room", endTime: "18:00" }).expect(200);
    expect(updated.body.calendarEvents.find((event: { id: string }) => event.id === conference.id)).toMatchObject({ location: "Education room", endTime: "18:00", meetingUrl: conference.meetingUrl });
    const removed = await request(app).delete(`/api/calendar-events/${conference.id}`).set("x-api-key", "calendar-admin-key")
      .set("x-state-version", String(updated.body.version)).expect(200);
    expect(removed.body.calendarEvents.some((event: { id: string }) => event.id === conference.id)).toBe(false);
    await request(app).patch(`/api/calendar-events/${conference.id}`).set("x-api-key", "calendar-admin-key").send({ title: "Missing" }).expect(404);
  });
  it("enforces admin writes, authenticated reads, validation and discoverable schemas", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    await request(app).get("/api/calendar-events").expect(401);
    for (const method of ["post", "patch", "delete"] as const) {
      await request(app)[method](method === "post" ? "/api/calendar-events" : "/api/calendar-events/calendar_friday_mm")
        .set("x-api-key", "calendar-viewer-key").send(conference).expect(403);
    }
    await request(app).post("/api/calendar-events").set("x-api-key", "calendar-admin-key").send({ title: "Missing date" }).expect(400);
    for (const query of ["startDate=2026-10-01", "startDate=2026-10-20&endDate=2026-10-01", "startDate=2026-01-01&endDate=2028-01-01", "startDate=2026-02-30&endDate=2026-03-01"]) {
      await request(app).get(`/api/calendar-events?${query}`).set("x-api-key", "calendar-viewer-key").expect(400);
    }
    const schema = (await request(app).get("/api/openapi.json").expect(200)).body;
    expect(schema.paths["/api/calendar-events"].post).toBeDefined();
    expect(schema.components.schemas.ResidencyCalendarEventInput.required).toEqual(["title", "date"]);
    expect(schema.components.schemas.ResidencyCalendarEventPatch.required).toEqual([]);
    const guide = (await request(app).get("/api/agent-guide").expect(200)).body;
    expect(guide.residencyCalendar.write).toContain("omit unknown optional location/endTime");
  });
});

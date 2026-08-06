import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore } from "./store";

describe("hospital contact administration", () => {
  beforeEach(() => {
    process.env.APP_SECRET = "contact-test-secret";
    process.env.ADMIN_API_KEY = "contact-admin-key";
    process.env.VIEWER_API_KEY = "contact-viewer-key";
  });

  it("defaults legacy hospital contacts to RMH and lets admins add, edit, and delete organized contacts", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    const initial = await request(app)
      .get("/api/contacts")
      .set("x-api-key", "contact-viewer-key")
      .expect(200);
    expect(initial.body.contacts.find((contact: { name: string }) => contact.name === "PACU")).toMatchObject({
      facility: "RMH",
      importance: "extended"
    });

    const added = await request(app)
      .post("/api/contacts")
      .set("x-api-key", "contact-admin-key")
      .send({
        name: "Security Dispatch",
        phoneNumber: "(540) 555-0180",
        category: "Emergency, Security & Safety",
        directoryType: "Hospital",
        facility: "Giles",
        building: "Main hospital",
        aliases: ["hospital police"],
        importance: "essential"
      })
      .expect(201);
    const contact = added.body.contacts.find((candidate: { name: string }) => candidate.name === "Security Dispatch");
    expect(contact).toMatchObject({ facility: "Giles", building: "Main hospital", importance: "essential" });

    await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set("x-api-key", "contact-viewer-key")
      .send({ name: "Security Dispatch RMH" })
      .expect(403);

    const updated = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set("x-api-key", "contact-admin-key")
      .send({
        name: "Security Dispatch RMH",
        facility: "RMH",
        building: "Emergency Department",
        aliases: ["hospital police", "public safety"]
      })
      .expect(200);
    expect(updated.body.contacts.find((candidate: { id: string }) => candidate.id === contact.id)).toMatchObject({
      name: "Security Dispatch RMH",
      facility: "RMH",
      building: "Emergency Department",
      aliases: ["hospital police", "public safety"]
    });

    const removed = await request(app)
      .delete(`/api/contacts/${contact.id}`)
      .set("x-api-key", "contact-admin-key")
      .expect(200);
    expect(removed.body.contacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: contact.id })]));
  });

  it("rejects unknown hospital facilities", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    await request(app)
      .post("/api/contacts")
      .set("x-api-key", "contact-admin-key")
      .send({
        name: "Unknown Campus Desk",
        phoneNumber: "(540) 555-0181",
        category: "Main Numbers & Information",
        directoryType: "Hospital",
        facility: "Unknown"
      })
      .expect(400);
  });
});

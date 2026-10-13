import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore } from "./store";
import type { Resident } from "../shared/types";
beforeEach(() => {
  process.env.USER_STORE_PATH = `/tmp/student-picker-${randomUUID()}.json`;
  process.env.ADMIN_PASSWORD = "admin-dev-password";
  process.env.APP_SECRET = "test-secret";
});
async function setup() {
  const state = createInitialState(); state.assignments = [];
  const store = new MemoryStateStore(state); const app = createApp(store);
  const login = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin-dev-password" }).expect(200);
  return { app, store, auth: `Bearer ${login.body.token}` };
}
const newStudent = { name: "Greg Smith", distinctPerson: false, placement: { service: "Berry", startDate: "2026-10-13", endDate: "2026-11-02" } };
it("creates and assigns atomically, confirms duplicate identities, and keeps students out of calendar duties", async () => {
  const { app, store, auth } = await setup();
  const first = await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent }).expect(201);
  const student = first.body.residents.find((r: Resident) => r.name === "Greg Smith");
  expect(student.studentPlacements).toEqual([newStudent.placement]);
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "clinic", targetId: "clinic_hpb_tue", newStudent }).expect(409);
  expect((await store.load()).residents.filter(r => r.name === "Greg Smith")).toHaveLength(1);
  const second = await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "clinic", targetId: "clinic_hpb_tue", newStudent: { ...newStudent, distinctPerson: true } }).expect(201);
  expect(second.body.residents.filter((r: Resident) => r.name === "Greg Smith")).toHaveLength(2);
  await request(app).post("/api/coverage-entries").set("authorization", auth).send({ kind: "rounding", date: "2026-10-13", residentId: student.id, serviceLine: "Berry" }).expect(400);
});
it("replaces a case assignee with a new student and rejects invalid dates without creating a profile", async () => {
  const { app, store, auth } = await setup();
  const first = await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent }).expect(201);
  const assignment = first.body.assignments[0];
  await request(app).patch(`/api/assignments/${assignment.id}`).set("authorization", auth).send({ newStudent: { ...newStudent, name: "Taylor Learner", placement: { ...newStudent.placement, endDate: "2026-10-01" } } }).expect(400);
  expect((await store.load()).residents.some(r => r.name === "Taylor Learner")).toBe(false);
  const replaced = await request(app).patch(`/api/assignments/${assignment.id}`).set("authorization", auth).send({ newStudent: { ...newStudent, name: "Taylor Learner" } }).expect(200);
  expect(replaced.body.assignments).toHaveLength(1);
  expect(replaced.body.assignments[0].residentId).not.toBe(assignment.residentId);
});
it("allows three people without replacing coverage and rolls back a fourth student's creation", async () => {
  const { app, store, auth } = await setup();
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent }).expect(201);
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent: { ...newStudent, name: "Second Person" } }).expect(201);
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent: { ...newStudent, name: "Third Person" } }).expect(201);
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent: { ...newStudent, name: "Fourth Person" } }).expect(400);
  const saved = await store.load();
  expect(saved.assignments).toHaveLength(3);
  expect(saved.residents.some(r => r.name === "Fourth Person")).toBe(false);
});
it("replaces inherited coverage for one case with a student while preserving other cases", async () => {
  const { app, store, auth } = await setup();
  const state = await store.load();
  const surgeryCase = state.cases.find(item => item.id === "case_chen_whipple")!;
  const resident = state.residents.find(person => person.trainingLevel === "PGY5")!;
  const assigned = await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "block", targetId: surgeryCase.blockId, residentId: resident.id }).expect(201);
  const block = assigned.body.assignments[0];
  const changed = await request(app).patch(`/api/assignments/${block.id}`).set("authorization", auth).send({ caseId: surgeryCase.id, newStudent }).expect(200);
  const student = changed.body.residents.find((person: Resident) => person.name === newStudent.name);
  expect(changed.body.assignments).toContainEqual(expect.objectContaining({ kind: "case", targetId: surgeryCase.id, residentId: student.id }));
  for (const other of state.cases.filter(item => item.blockId === surgeryCase.blockId && item.id !== surgeryCase.id)) {
    expect(changed.body.assignments).toContainEqual(expect.objectContaining({ kind: "case", targetId: other.id, residentId: resident.id }));
  }
  expect(changed.body.assignments.some((item: {kind:string}) => item.kind === "block")).toBe(false);
});

it("removes one person or everyone from one case while preserving other inherited cases", async () => {
  const { app, store, auth } = await setup();
  const state = await store.load();
  const resident = state.residents.find(person => person.trainingLevel === "PGY5")!;
  await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "block", targetId: "block_chen_mon", residentId: resident.id }).expect(201);
  const added = await request(app).post("/api/assignments").set("authorization", auth).send({ kind: "case", targetId: "case_chen_whipple", newStudent }).expect(201);
  const student = added.body.residents.find((person: Resident) => person.name === newStudent.name);
  const removed = await request(app).delete("/api/assignment-targets/case/case_chen_whipple").set("authorization", auth).send({ residentId: resident.id }).expect(200);
  expect(removed.body.assignments).toContainEqual(expect.objectContaining({ targetId: "case_chen_whipple", residentId: student.id }));
  expect(removed.body.assignments).toContainEqual(expect.objectContaining({ targetId: "case_chen_chole", residentId: resident.id }));
  const cleared = await request(app).delete("/api/assignment-targets/case/case_chen_whipple").set("authorization", auth).send({}).expect(200);
  expect(cleared.body.assignments.some((item: {targetId:string}) => item.targetId === "case_chen_whipple")).toBe(false);
  expect(cleared.body.assignments).toContainEqual(expect.objectContaining({ targetId: "case_chen_chole", residentId: resident.id }));
});

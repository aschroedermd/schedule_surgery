// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResidentPicker } from "./ResidentPicker";
import { createInitialState } from "../server/sampleData";
import { getAssignmentService } from "../shared/services";
let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onSelect.mockReset();
  const residents = createInitialState().residents.slice(0, 2).map((resident, index) => ({ ...resident,
    id: String(index), name: index ? "Zoe Team" : "Alex Other", serviceTags: [index ? "ENDO" : "Berry"], rotationSchedule: [] }));
  act(() => root.render(<ResidentPicker residents={residents} service="ENDO" value="1" date="2026-10-10" label="Zoe Team" onSelect={onSelect} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function open() { act(() => container.querySelector<HTMLButtonElement>("button")!.click()); }
it("groups the endoscopy team first and marks the current resident", async () => {
  open();
  const choices = document.querySelectorAll<HTMLButtonElement>(".resident-picker-option");
  expect(choices[0].textContent).toContain("Zoe Team");
  expect(choices[0].getAttribute("aria-pressed")).toBe("true");
  expect(choices[1].textContent).toContain("Alex Other");
  await act(async () => choices[1].click());
  expect(onSelect).toHaveBeenCalledWith("0", expect.any(Function));
});
it.each([
  ...(["Davies", "Berry"] as const).flatMap(team =>
    (["case", "block", "clinic"] as const).flatMap(kind =>
      [true, false].map(endo => ({ team, kind, endo }))))
])("groups $team $kind assignments with endoscopy=$endo by team and home specialty", ({ team, kind, endo }) => {
  const state = createInitialState();
  const date = "2026-10-26";
  const block = state.attendingBlocks[0];
  const attending = state.attendings.find(item => item.id === block.attendingId)!;
  attending.service = team;
  attending.name = "Dr. Katz";
  block.date = date;
  block.notes = endo ? "Endoscopy" : "";
  state.cases.filter(item => item.blockId === block.id).forEach(item => {
    item.procedureLabel = endo ? "Endoscopy" : "Surgery"; item.notes = ""; item.tags = [];
  });
  const clinic = state.clinicSessions[0];
  clinic.attendingId = attending.id;
  clinic.date = date;
  clinic.service = endo ? "ENDO" : team;
  clinic.location = "Clinic";
  const targetId = kind === "block" ? block.id : kind === "case" ? state.cases.find(item => item.blockId === block.id)!.id : clinic.id;
  const base = { ...state.residents[0], rotationSchedule: [], studentPlacements: undefined, vacation: [], unavailable: [], rosterKind: "primary" as const, sourceProgram: "General Surgery", sourceProgramAbbreviation: "" };
  const residents = [
    ...["Dentistry", "Pediatrics", "Podiatric Medicine and Surgery", "Neurosurgery"].map(program => ({ ...base, id: program, name: program, rosterKind: "off-service" as const, sourceProgram: program, serviceTags: [team, "ENDO"] })),
    { ...base, id: "other", name: "Other General", serviceTags: [team === "Davies" ? "Berry" : "Davies"] },
    { ...base, id: "plastic", name: "Other Plastics", rosterKind: "off-service" as const, sourceProgram: "Plastic Surgery", serviceTags: [] },
    { ...base, id: "team", name: "Home Team", serviceTags: [], rotationSchedule: [{ id: "rotation", blockNumber: 5, startDate: date, endDate: "2026-11-22", service: team }] },
    { ...base, id: "endo", name: "Endo Resident", serviceTags: ["ENDO", team] }
  ];
  act(() => root.render(<ResidentPicker residents={residents} state={state} kind={kind} targetId={targetId}
    service={getAssignmentService(state, kind, targetId, "Fogel")} date={date} label="Unassigned" onSelect={onSelect} />));
  open();
  const sections = [...document.querySelectorAll(".resident-picker-results section")];
  expect(sections.map(section => section.querySelector("h4")?.textContent)).toEqual([
    ...(endo ? ["ENDO team · Suggested"] : []), `${team} team · Suggested`,
    "Other surgery residents · General & Plastic Surgery", "Other residents · Off-service"
  ]);
  const names = (section: Element) => [...section.querySelectorAll(".resident-picker-option strong")].map(item => item.textContent);
  if (endo) expect(names(sections[0])).toEqual(["Endo Resident"]);
  expect(names(sections[endo ? 1 : 0])).toEqual(endo ? ["Home Team"] : ["Home Team", "Endo Resident"]);
  expect(names(sections.at(-2)!)).toEqual(["Other General", "Other Plastics"]);
  expect(names(sections.at(-1)!)).toEqual(["Dentistry", "Pediatrics", "Podiatric Medicine and Surgery", "Neurosurgery"]);
  expect(document.querySelectorAll(".resident-picker-option")).toHaveLength(residents.length);
});
it("keeps missing rotations and dated ED absences out of suggested teams", () => {
  const state = createInitialState();
  const brown = state.residents.find(person => person.id === "res_external_hannah_brown")!;
  const adeleke = state.residents.find(person => person.id === "res_fellow")!;
  act(() => root.render(<ResidentPicker residents={[{ ...brown, serviceTags: ["Davies"] }, adeleke]}
    service="Davies" date="2026-10-26" label="Unassigned" onSelect={onSelect} />));
  open();
  expect(document.querySelector(".resident-picker-suggested-heading")).toBeNull();
  expect(document.querySelector(".resident-picker-results")?.textContent).toContain("Hannah Brown");
  act(() => root.render(<ResidentPicker residents={[adeleke]} service="Berry" date="2026-10-26" label="Unassigned" onSelect={onSelect} />));
  expect(document.querySelector(".resident-picker-suggested-heading")).toBeNull();
  act(() => root.render(<ResidentPicker residents={[adeleke]} service="Berry" date="2026-11-09" label="Unassigned" onSelect={onSelect} />));
  expect(document.querySelector(".resident-picker-suggested-heading")?.textContent).toContain("Berry");
});
it("searches names, shows empty results, and restores focus on Escape", () => {
  open();
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const fill = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fill("alex");
  expect(document.querySelectorAll(".resident-picker-option")).toHaveLength(1);
  expect(document.querySelector(".resident-picker-option")?.textContent).toContain("Alex Other");
  fill("nobody");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("No residents found");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});
it("supports arrow navigation and keeps failed saves open", async () => {
  onSelect.mockImplementation(async () => {}); // onMutate handles errors without invoking close.
  open();
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { input.focus(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(document.activeElement?.textContent).toContain("Zoe Team");
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it("clears the assignment and closes only when the save succeeds", async () => {
  onSelect.mockImplementation(async (_id, close) => close());
  open();
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-panel footer button")!.click());
  expect(onSelect).toHaveBeenCalledWith("", expect.any(Function));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("shows a save error inside the dialog and allows retry", async () => {
  onSelect.mockRejectedValueOnce(new Error("Offline"));
  open();
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-option")!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(document.querySelector<HTMLButtonElement>(".resident-picker-option")!.disabled).toBe(false);
  onSelect.mockImplementationOnce(async (_id, close) => close());
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-option")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps a narrow searchable picker without day schedule controls and flags overlapping coverage", () => {
  const state = createInitialState();
  const resident = state.residents[0];
  state.assignments = [{ id: "assignment", kind: "block", targetId: "block_patel_mon", residentId: resident.id, locked: false, source: "admin", createdAt: "", updatedAt: "" }];
  act(() => root.render(<ResidentPicker state={state} kind="block" targetId="block_chen_mon" residents={[resident]} service="Davies" label="Unassigned" onSelect={onSelect} />));
  vi.spyOn(container.querySelector<HTMLButtonElement>("button")!, "getBoundingClientRect").mockReturnValue({ left: 900, bottom: 36 } as DOMRect);
  open();
  expect(document.querySelector(".resident-picker-target")?.textContent).toContain("Dr. Chen");
  expect(document.querySelector(".resident-workload")?.textContent).toContain("overlapping assignment");
  expect(document.querySelector<HTMLElement>(".resident-picker-panel")?.style.left).toBe(`${window.innerWidth - 420 - 12}px`);
  expect(document.querySelector(".resident-picker-panel")?.classList.contains("has-context")).toBe(false);
  expect(document.querySelector('input[aria-label="Search residents"]')).not.toBeNull();
  expect(document.querySelector(".resident-picker-option")?.textContent).toContain(resident.name);
  expect(document.querySelector('aside[aria-label="Day schedule"]')).toBeNull();
  expect(document.querySelector(".resident-day-toggle, .resident-inspect, .resident-mobile-detail")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});
it("shows the current name, separates students, and adds without replacing coverage", async () => {
  const residents = createInitialState().residents.slice(0, 3).map((resident, index) => ({ ...resident, id: String(index), name: ["Current Person", "Other Resident", "Greg Smith"][index], trainingLevel: index === 2 ? "Student" as const : "PGY2" as const }));
  const onAdd = vi.fn(async (_id, close) => close());
  act(() => root.render(<ResidentPicker residents={residents} service="Berry" value="0" label="Current Person" kind="case" onSelect={onSelect} onAdd={onAdd} />));
  open();
  expect(document.querySelector('h3')?.textContent).toBe("Current Person");
  expect([...document.querySelectorAll('.resident-picker-option')].map(item => item.textContent).join()).not.toContain("Greg Smith");
  act(() => document.querySelector<HTMLButtonElement>('.picker-add-person')!.click());
  act(() => [...document.querySelectorAll<HTMLButtonElement>('.picker-audience button')].find(item => item.textContent === "Students")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.resident-picker-option')!.click());
  expect(onAdd).toHaveBeenCalledWith("2", expect.any(Function));
  expect(onSelect).not.toHaveBeenCalled();
});
it("requires a same-name confirmation before creating a separate student", async () => {
  const residents = [{ ...createInitialState().residents[0], id: "student", name: "Greg Smith", trainingLevel: "Student" as const }];
  const onCreate = vi.fn();
  act(() => root.render(<ResidentPicker residents={residents} service="Berry" date="2026-10-13" label="Unassigned" kind="case" onSelect={onSelect} onCreateStudent={onCreate} />));
  open();
  expect(document.querySelector('h3')?.textContent).toBe("Unassigned");
  act(() => [...document.querySelectorAll<HTMLButtonElement>('.picker-audience button')].find(item => item.textContent === "Students")!.click());
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Greg Smith"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => document.querySelector<HTMLButtonElement>('.picker-new-student')!.click());
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onCreate).not.toHaveBeenCalled();
  expect(document.querySelector('.student-match')?.textContent).toContain("Is this the same student?");
  act(() => [...document.querySelectorAll<HTMLButtonElement>('.student-match button')].find(item => item.textContent?.startsWith("No,"))!.click());
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onCreate).toHaveBeenCalledWith({ name: "Greg Smith", distinctPerson: true, placement: { service: "Berry", startDate: "2026-10-13", endDate: "2026-11-02" } }, false, expect.any(Function));
});

it("shows all assigned people with compact badges and distinguishes individual removal from clearing all", async () => {
  const residents = createInitialState().residents.slice(0, 3);
  const onRemove = vi.fn(async (_id, saved) => saved());
  const onClearAll = vi.fn(async saved => saved());
  act(() => root.render(<ResidentPicker residents={residents} assignedPeople={residents} service="Berry" value={residents[0].id} label={residents[0].name} kind="case" onSelect={onSelect} onRemove={onRemove} onClearAll={onClearAll} />));
  open();
  expect(document.querySelectorAll('.picker-assigned-badge')).toHaveLength(3);
  expect(document.querySelector('.picker-assigned-list')?.textContent).toContain(residents[2].name);
  await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="Unassign ${residents[1].name}"]`)!.click());
  expect(onRemove).toHaveBeenCalledWith(residents[1].id, expect.any(Function));
  expect(onClearAll).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('.picker-unassign')!.click());
  expect(onClearAll).toHaveBeenCalledWith(expect.any(Function));
  expect(onSelect).not.toHaveBeenCalled();
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Back to schedule"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

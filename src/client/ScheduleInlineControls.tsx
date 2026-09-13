import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createEntity, deleteEntity, moveCase, updateEntity } from "./api";
import { createId } from "../shared/id";
import { ENDOSCOPY_SERVICE_LINE, getAttendingsForService } from "../shared/services";
import type { AttendingBlock, ClinicSession, PlannerState, ScheduledBlock, ScheduledCase, SurgeryCase } from "../shared/types";

type Mutation = (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
type EditingProps = { token: string; onMutate: Mutation };

function useSave(onMutate: Mutation) {
  const [busy, setBusy] = useState(false);
  async function save(action: () => Promise<PlannerState>, message: string, done?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await onMutate(async () => {
        const result = await action();
        done?.();
        return result;
      }, message);
    } finally { setBusy(false); }
  }
  return { busy, save };
}

export function DeleteScheduleItem({ token, onMutate, collection, id, label }: EditingProps & {
  collection: "attendingBlocks" | "clinicSessions" | "cases"; id: string; label: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, save } = useSave(onMutate);
  return confirming ? <div className="schedule-delete-confirm" role="group" aria-label={`Confirm delete ${label}`}>
    <span>{collection === "attendingBlocks" ? "Delete block and all its cases?" : `Delete ${label}?`}</span>
    <button type="button" className="secondary-button schedule-danger" disabled={busy}
      onClick={() => void save(() => deleteEntity(token, collection, id), "Deleted", () => setConfirming(false))}>Delete</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
  </div> : <button type="button" className="icon-button schedule-danger" title={`Delete ${label}`} aria-label={`Delete ${label}`}
    onClick={() => setConfirming(true)}><Trash2 size={16} /></button>;
}

export function AddScheduleItem({ state, weekId, date, selectedService, editableAttendingId, token, onMutate }: EditingProps & {
  state: PlannerState; weekId: string; date: string; selectedService: string; editableAttendingId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"clinic" | "or" | "endo" | null>(null);
  const attendings = (selectedService === ENDOSCOPY_SERVICE_LINE ? state.attendings : getAttendingsForService(state.attendings, selectedService))
    .filter(attending => !editableAttendingId || attending.id === editableAttendingId);
  const [attendingId, setAttendingId] = useState(attendings[0]?.id ?? "");
  const [hospitalId, setHospitalId] = useState(state.hospitals[0]?.id ?? "");
  const [startTime, setStartTime] = useState("07:30");
  const [endTime, setEndTime] = useState("17:00");
  const { busy, save } = useSave(onMutate);
  const close = () => { setOpen(false); setKind(null); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const attending = attendings.find(candidate => candidate.id === attendingId);
    if (!attending || !hospitalId || !kind) return;
    if (kind === "clinic") {
      await save(() => createEntity<ClinicSession>(token, "clinicSessions", {
        id: createId("clinic"), weekId, date, attendingId, hospitalId, startTime, endTime,
        service: attending.service, location: state.hospitals.find(hospital => hospital.id === hospitalId)?.shortName ?? "",
        capacity: 1, isProcedure: false
      }), "Clinic added", close);
    } else {
      await save(() => createEntity<AttendingBlock>(token, "attendingBlocks", {
        id: createId("block"), weekId, date, attendingId, hospitalId, firstCaseStartTime: startTime,
        notes: kind === "endo" ? "Endoscopy" : ""
      }), `${kind === "endo" ? "Endoscopy" : "OR"} block added`, close);
    }
  }
  return <div className="schedule-day-add">
    <button type="button" className="secondary-button schedule-add-button" aria-expanded={open}
      onClick={() => open ? close() : setOpen(true)}><Plus size={17} />Add block</button>
    {open && !kind && <div className="schedule-add-options" aria-label="Block type">
      {!editableAttendingId && selectedService !== ENDOSCOPY_SERVICE_LINE && <button type="button" onClick={() => { setKind("clinic"); setStartTime("13:00"); }}>Clinic</button>}
      {selectedService !== ENDOSCOPY_SERVICE_LINE && <button type="button" onClick={() => { setKind("or"); setStartTime("07:30"); }}>OR block</button>}
      <button type="button" onClick={() => { setKind("endo"); setStartTime("07:30"); }}>Endoscopy block</button>
    </div>}
    {open && kind && <form className="schedule-inline-form" aria-label={`Add ${kind === "or" ? "OR" : kind === "endo" ? "endoscopy" : "clinic"} block`} onSubmit={submit}>
      <fieldset disabled={busy}>
        <strong>{kind === "clinic" ? "New clinic" : kind === "endo" ? "New endoscopy block" : "New OR block"}</strong>
        <label>Attending<select required value={attendingId} onChange={event => setAttendingId(event.target.value)}>
          {attendings.map(attending => <option key={attending.id} value={attending.id}>{attending.name}{selectedService === ENDOSCOPY_SERVICE_LINE ? ` · ${attending.service}` : ""}</option>)}
        </select></label>
        <label>Location<select required value={hospitalId} onChange={event => setHospitalId(event.target.value)}>
          {state.hospitals.map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.shortName}</option>)}
        </select></label>
        <div className="schedule-form-times">
          <label>Start<input required type="time" value={startTime} onInput={event => setStartTime(event.currentTarget.value)} /></label>
          {kind === "clinic" && <label>End<input required type="time" min={startTime} value={endTime} onInput={event => setEndTime(event.currentTarget.value)} /></label>}
        </div>
        <div className="schedule-edit-actions"><button className="primary-button" disabled={!attendings.length || !hospitalId || (kind === "clinic" && endTime <= startTime)}>Add</button>
          <button type="button" className="secondary-button" onClick={close}>Cancel</button></div>
      </fieldset>
    </form>}
  </div>;
}

export function InlineBlockSettings({ state, block, token, onMutate }: EditingProps & { state: PlannerState; block: ScheduledBlock }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(block.firstCaseStartTime);
  const [hospitalId, setHospitalId] = useState(block.hospitalId);
  const { busy, save } = useSave(onMutate);
  return <>
    <button type="button" className="icon-button" title="Edit block" aria-label={`Edit ${block.attending.name} block`} aria-expanded={open}
      onClick={() => { setStart(block.firstCaseStartTime); setHospitalId(block.hospitalId); setOpen(!open); }}><Pencil size={16} /></button>
    {open && <form className="schedule-inline-form" aria-label="Block settings" onSubmit={event => {
      event.preventDefault();
      void save(() => updateEntity<AttendingBlock>(token, "attendingBlocks", block.id, { firstCaseStartTime: start, hospitalId }), "Block updated", () => setOpen(false));
    }}><fieldset disabled={busy}>
      <label>First case start<input required type="time" value={start} onInput={event => setStart(event.currentTarget.value)} /></label>
      <label>Location<select value={hospitalId} onChange={event => setHospitalId(event.target.value)}>
        {state.hospitals.map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.shortName}</option>)}
      </select></label>
      <div className="schedule-edit-actions"><button className="primary-button">Save</button><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button></div>
    </fieldset></form>}
  </>;
}

function CaseForm({ surgeryCase, blockId, order, token, onMutate, onClose }: EditingProps & {
  surgeryCase?: ScheduledCase; blockId: string; order: number; onClose: () => void;
}) {
  const [name, setName] = useState(surgeryCase?.procedureLabel ?? "");
  const [duration, setDuration] = useState(String(surgeryCase?.durationMinutes ?? 90));
  const [startTime, setStartTime] = useState(surgeryCase?.startTimeOverride ?? "");
  const { busy, save } = useSave(onMutate);
  return <form className="schedule-inline-form" aria-label={surgeryCase ? "Edit case" : "Add case"} onSubmit={event => {
    event.preventDefault();
    const patch = { procedureLabel: name.trim(), durationMinutes: Number(duration), startTimeOverride: startTime };
    if (!patch.procedureLabel || !Number.isInteger(patch.durationMinutes) || patch.durationMinutes < 1) return;
    void save(() => surgeryCase
      ? updateEntity<SurgeryCase>(token, "cases", surgeryCase.id, patch)
      : createEntity<SurgeryCase>(token, "cases", { id: createId("case"), blockId, order, ...patch, priority: 3, tags: [], notes: "" }),
    surgeryCase ? "Case updated" : "Case added", onClose);
  }}><fieldset disabled={busy}>
    <label>Case name<input required autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
    <label>Start time<input type="time" value={startTime} onInput={event => setStartTime(event.currentTarget.value)} /></label>
    <span className="schedule-form-hint">Leave start blank to follow the block order. Moving cases recalculates start times.</span>
    <label>Duration (minutes)<input required type="number" inputMode="numeric" min={1} step={1} value={duration} onChange={event => setDuration(event.target.value)} /></label>
    <div className="schedule-edit-actions"><button className="primary-button">{surgeryCase ? "Save" : "Add case"}</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
  </fieldset></form>;
}

export function AddCaseControl({ block, token, onMutate }: EditingProps & { block: ScheduledBlock }) {
  const [open, setOpen] = useState(false);
  return open ? <CaseForm blockId={block.id} order={Math.max(-1, ...block.cases.map(item => item.order)) + 1} token={token} onMutate={onMutate} onClose={() => setOpen(false)} />
    : <button type="button" className="secondary-button schedule-add-button" onClick={() => setOpen(true)}><Plus size={16} />Add case</button>;
}

export function CaseEditingControls({ surgeryCase, isFirst, isLast, token, onMutate }: EditingProps & {
  surgeryCase: ScheduledCase; isFirst: boolean; isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { busy, save } = useSave(onMutate);
  return <>
    <div className="schedule-edit-actions" role="group" aria-label={`Edit ${surgeryCase.procedureLabel}`}>
      <button type="button" className="icon-button" title="Edit case" aria-label={`Edit ${surgeryCase.procedureLabel}`} aria-expanded={open} onClick={() => setOpen(!open)}><Pencil size={16} /></button>
      <button type="button" className="icon-button" title="Move case up" aria-label={`Move ${surgeryCase.procedureLabel} up`} disabled={isFirst || busy}
        onClick={() => void save(() => moveCase(token, surgeryCase.id, "up"), "Case moved")}><ArrowUp size={16} /></button>
      <button type="button" className="icon-button" title="Move case down" aria-label={`Move ${surgeryCase.procedureLabel} down`} disabled={isLast || busy}
        onClick={() => void save(() => moveCase(token, surgeryCase.id, "down"), "Case moved")}><ArrowDown size={16} /></button>
      <DeleteScheduleItem token={token} onMutate={onMutate} collection="cases" id={surgeryCase.id} label={surgeryCase.procedureLabel} />
    </div>
    {open && <CaseForm surgeryCase={surgeryCase} blockId={surgeryCase.blockId} order={surgeryCase.order} token={token} onMutate={onMutate} onClose={() => setOpen(false)} />}
  </>;
}

export function InlineClinicSettings({ clinic, token, onMutate }: EditingProps & { clinic: ClinicSession }) {
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState(clinic.startTime);
  const [endTime, setEndTime] = useState(clinic.endTime);
  const [location, setLocation] = useState(clinic.location);
  const { busy, save } = useSave(onMutate);
  return <>
    <button type="button" className="icon-button" title="Edit clinic" aria-label="Edit clinic" aria-expanded={open} onClick={() => {
      setStartTime(clinic.startTime); setEndTime(clinic.endTime); setLocation(clinic.location); setOpen(!open);
    }}><Pencil size={16} /></button>
    {open && <form className="schedule-inline-form" aria-label="Clinic settings" onSubmit={event => {
      event.preventDefault();
      void save(() => updateEntity<ClinicSession>(token, "clinicSessions", clinic.id, { startTime, endTime, location: location.trim() }), "Clinic updated", () => setOpen(false));
    }}><fieldset disabled={busy}>
      <div className="schedule-form-times"><label>Start<input required type="time" value={startTime} onInput={event => setStartTime(event.currentTarget.value)} /></label>
      <label>End<input required type="time" min={startTime} value={endTime} onInput={event => setEndTime(event.currentTarget.value)} /></label></div>
      <label>Location<input required value={location} onChange={event => setLocation(event.target.value)} /></label>
      <div className="schedule-edit-actions"><button className="primary-button" disabled={endTime <= startTime}>Save</button><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button></div>
    </fieldset></form>}
  </>;
}

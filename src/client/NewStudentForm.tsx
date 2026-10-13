import { useState } from "react";
import { addDays } from "../shared/date";
import { matchingStudents, type NewStudentInput } from "../shared/students";
import { SERVICE_LINES, type Resident, type ServiceLine } from "../shared/types";

export function NewStudentForm({ residents, initialName, date, service, busy, onExisting, onSave, onCancel }: {
  residents: Resident[]; initialName: string; date: string; service: string; busy: boolean;
  onExisting: (id: string) => void; onSave: (input: NewStudentInput) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [distinct, setDistinct] = useState(false);
  const [team, setTeam] = useState<ServiceLine>(SERVICE_LINES.includes(service as ServiceLine) ? service as ServiceLine : "Berry");
  const [start, setStart] = useState(date);
  const [end, setEnd] = useState(addDays(date, 20));
  const matches = matchingStudents(residents, name);
  return <form className="student-create-form" onSubmit={event => {
    event.preventDefault();
    if (matches.length && !distinct) return;
    onSave({ name: name.trim(), distinctPerson: distinct, placement: { service: team, startDate: start, endDate: end } });
  }}>
    <h4>New student</h4>
    <label>Full name<input required minLength={2} maxLength={100} value={name} disabled={busy} onChange={event => { setName(event.target.value); setDistinct(false); }} /></label>
    {matches.length > 0 && !distinct ? <div className="student-match" role="status"><strong>Is this the same student?</strong>
      {matches.map(person => <button key={person.id} type="button" disabled={busy} onClick={() => onExisting(person.id)}><strong>{person.name}</strong><small>{person.username ? `Account: ${person.username}` : "No linked account"}{person.studentPlacements?.map(p => ` · ${p.service}: ${p.startDate} – ${p.endDate}`).join("") || ` · ${person.serviceTags.join(", ") || "No current team"}`}</small><span>Yes, use this student</span></button>)}
      <button type="button" disabled={busy} onClick={() => setDistinct(true)}>No, this is a different student</button>
    </div> : <>
      {distinct && <p>A separate student profile will be created.</p>}
      <label>Team<select value={team} disabled={busy} onChange={event => setTeam(event.target.value as ServiceLine)}>{SERVICE_LINES.map(line => <option key={line}>{line}</option>)}</select></label>
      <div className="student-placement-dates"><label>Starts<input type="date" required value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label><label>Ends<input type="date" required min={start} value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label></div>
      <div className="student-duration" aria-label="Placement duration">{[1, 2, 3, 4].map(weeks => <button type="button" key={weeks} disabled={busy || !start} aria-pressed={end === addDays(start || date, weeks * 7 - 1)} onClick={() => setEnd(addDays(start, weeks * 7 - 1))}>{weeks} {weeks === 1 ? "week" : "weeks"}</button>)}</div>
      <p>Team placement ends automatically after this date. The student’s profile and past assignments are kept.</p>
      <button type="submit" className="primary-button" disabled={busy}>{matches.length && !distinct ? "Check matching student" : "Create & assign student"}</button>
    </>}
    <button type="button" disabled={busy} onClick={onCancel}>Back to students</button>
  </form>;
}

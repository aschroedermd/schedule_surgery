import { FormEvent, lazy, Suspense, useState } from 'react';
const Tester = lazy(() => import('@surgical-board-simulator/tester-ui'));
const BASE = '/api/boards-tester';
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || `Request failed (${response.status})`);
  return body;
}
interface Entry { id: string; author: string; text: string; session: { scenario: string }; status?: string; category: string; }
export default function BoardsTesterAccount({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<{ displayName: string; reviewer: boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      setAccess(await request('/access', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }));
      setPassword('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not unlock simulator'); }
    finally { setBusy(false); }
  }
  async function loadFeedback() {
    setError('');
    try { setEntries((await request('/feedback')).entries); setReview(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load feedback'); }
  }
  async function triage(entry: Entry, status: string, note: string) {
    try {
      await request(`/feedback/${entry.id}/triage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note }) });
      await loadFeedback();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update feedback'); }
  }
  return <section className="panel">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>oral boards simulator</button>
    {open && <>
    <h2>Oral boards simulator</h2>
    <p>Practice surgical boards and send feedback to the simulator team. Simulator access expires after two hours. Updates end active cases; saved feedback is retained.</p>
    {error && <p role="alert">{error}</p>}
    {!access ? <form onSubmit={unlock}>
      <label>Additional simulator password <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" required maxLength={1024} /></label>
      <button disabled={busy} type="submit">{busy ? 'Checking…' : 'Unlock simulator'}</button>
    </form> : <>
      <div className="header-actions">
        <button onClick={async () => { await request('/access', { method: 'DELETE' }).catch(() => undefined); setAccess(undefined); setReview(false); setOpen(false); }}>Lock simulator</button>
        {access.reviewer && <button onClick={() => void loadFeedback()}>Review global feedback</button>}
        {review && <button onClick={() => setReview(false)}>Return to tester</button>}
      </div>
      {review ? <div><h3>Feedback review</h3>{entries.map(entry => <FeedbackEntry key={entry.id} entry={entry} onTriage={triage} />)}</div> :
        <Suspense fallback={<p>Loading simulator…</p>}><Tester apiBase={BASE} userName={access.displayName} backHref="/" /></Suspense>}
    </>}
    </>}
  </section>;
}
function FeedbackEntry({ entry, onTriage }: { entry: Entry; onTriage: (entry: Entry, status: string, note: string) => Promise<void> }) {
  const [status, setStatus] = useState(entry.status || 'open');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return <article className="panel">
    <p><strong>{entry.author}</strong> · {entry.session.scenario} · {entry.category}</p><p>{entry.text}</p>
    <a href={`${BASE}/feedback/${entry.id}/bundle`}>Download replay evidence</a>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onTriage(entry, status, note); } finally { setBusy(false); } }}>
      <label>Status <select value={status} onChange={e => setStatus(e.target.value)}>{['open', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Review note <input value={note} onChange={e => setNote(e.target.value)} maxLength={4000} /></label>
      <button disabled={busy}>Save triage</button>
    </form>
  </article>;
}

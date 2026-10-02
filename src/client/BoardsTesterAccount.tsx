import './BoardsTesterPage.css';
import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
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
  return <section className="panel"><button type="button" onClick={() => window.location.assign('/oral-boards')}>oral boards simulator</button><p>Open the simulator in its own page. Your account and the simulator password are required.</p></section>;
}
export function BoardsTesterPage({ token }: { token: string }) {
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<{ displayName: string; reviewer: boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let active = true;
    request('/access').then(value => { if (active) setAccess(value); }).catch(() => {}).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [token]);
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
  return <div className="boards-page">
    {access ? <>
      <nav className="boards-toolbar" aria-label="Simulator access">
        <a href={`${BASE}/comments/export`}>Download my comments</a>
        {access.reviewer && <><a href={`${BASE}/feedback/export`}>All comments · JSON</a><a href={`${BASE}/feedback/export?format=csv`}>All comments · CSV</a></>}
        <button onClick={async () => { await request('/access', { method: 'DELETE' }).catch(() => undefined); setAccess(undefined); setReview(false); }}>Lock simulator</button>
        {access.reviewer && <button onClick={() => void loadFeedback()}>Review global feedback</button>}
        {review && <button onClick={() => setReview(false)}>Return to tester</button>}
      </nav>
      {error && <p role="alert">{error}</p>}
      {review ? <section className="boards-access"><a href="/?section=account">← Account</a><h1>Feedback review</h1>{entries.map(entry => <FeedbackEntry key={entry.id} entry={entry} onTriage={triage} />)}</section> :
        <Suspense fallback={<p className="boards-access">Loading simulator…</p>}><Tester apiBase={BASE} userName={access.displayName} voiceComments backHref="/?section=account" /></Suspense>}
    </> : <section className="boards-access">
      <a href="/?section=account">← Back to Account</a>
      <h1>Oral boards simulator</h1>
      <p>Practice a case and leave feedback as you go.</p>
      {error && <p role="alert">{error}</p>}
      {checking ? <p>Checking simulator access…</p> : <form onSubmit={unlock}>
        <label>Simulator password <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" required maxLength={1024} autoFocus /></label>
        <button disabled={busy} type="submit">{busy ? 'Checking…' : 'Open simulator'}</button>
      </form>}
    </section>}
  </div>;
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

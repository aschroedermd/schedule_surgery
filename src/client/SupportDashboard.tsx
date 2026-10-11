import { useEffect, useRef, useState } from "react";
import type { SupportConversation } from "../shared/support";
import { fetchSupportSessions, supportAdminAction } from "./api";

export function SupportDashboard({ token, username }: { token: string; username: string }) {
  const [sessions, setSessions] = useState<SupportConversation[]>([]);
  const [selected, setSelected] = useState<string>();
  const [owned, setOwned] = useState<string>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const leaseToken = useRef(crypto.randomUUID());
  const ownedRef = useRef<string>();
  const current = sessions.find(session => session.id === selected);
  const pendingId = current?.pendingRequestId;

  useEffect(() => { setDraft(""); }, [selected, pendingId]);
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        if (ownedRef.current) {
          try { await supportAdminAction(token, ownedRef.current, "heartbeat", leaseToken.current); }
          catch (claimError) {
            ownedRef.current = undefined;
            if (!cancelled) { setOwned(undefined); setError(claimError instanceof Error ? claimError.message : "Support ownership ended"); }
          }
        }
        const next = await fetchSupportSessions(token);
        if (!cancelled) setSessions(next);
      } catch (refreshError) {
        if (!cancelled) setError(refreshError instanceof Error ? refreshError.message : "Sessions couldn't load");
      } finally { refreshing = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onVisibility = () => {
      if (document.visibilityState !== "visible" && ownedRef.current) {
        const id = ownedRef.current; ownedRef.current = undefined; setOwned(undefined);
        void supportAdminAction(token, id, "release", leaseToken.current).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true; window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (ownedRef.current) {
        void supportAdminAction(token, ownedRef.current, "release", leaseToken.current).catch(() => undefined);
        ownedRef.current = undefined;
      }
    };
  }, [token]);

  async function selectSession(id: string) {
    if (working) return;
    setWorking(true);
    try {
      if (ownedRef.current && ownedRef.current !== id) {
        await supportAdminAction(token, ownedRef.current, "release", leaseToken.current);
        ownedRef.current = undefined; setOwned(undefined);
      }
      setSelected(id);
    } catch (selectError) { setError(selectError instanceof Error ? selectError.message : "Support couldn't leave this conversation"); }
    finally { setWorking(false); }
  }

  async function action(kind: "claim" | "release" | "reply") {
    if (!current || working || (kind === "claim" && document.visibilityState !== "visible")) return;
    setWorking(true); setError("");
    try {
      if (kind === "claim" && ownedRef.current && ownedRef.current !== current.id) {
        await supportAdminAction(token, ownedRef.current, "release", leaseToken.current);
        ownedRef.current = undefined; setOwned(undefined);
      }
      await supportAdminAction(token, current.id, kind, leaseToken.current,
        kind === "reply" ? { text: draft, requestId: pendingId } : {});
      if (kind === "claim") { ownedRef.current = current.id; setOwned(current.id); }
      if (kind === "release") { ownedRef.current = undefined; setOwned(undefined); }
      if (kind === "reply") setDraft("");
      setSessions(await fetchSupportSessions(token));
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Support action failed"); }
    finally { setWorking(false); }
  }

  return <section className="support-dashboard" aria-label="Private user interactions">
    <p className="support-help">Join an active conversation as the assistant to answer its next question. Leaving returns the conversation to the API assistant.</p>
    {error && <p role="alert" className="chat-error">{error}</p>}
    <div className="support-layout">
      <aside className="support-session-list" aria-label="Active assistant users">
        {!sessions.length && <p>No users currently have the assistant open.</p>}
        {sessions.map(session => <button type="button" key={session.id} className={session.id === selected ? "active" : ""} disabled={working} onClick={() => void selectSession(session.id)}>
          <strong>{session.displayName || session.username}</strong>
          <span>{session.serviceLine ? `${session.serviceLine} · ` : ""}{session.owner ? `Support: ${session.owner}` : session.busy ? "AI responding" : "Assistant open"}</span>
        </button>)}
      </aside>
      <div className="support-conversation">
        {!current ? <p>Select an active user to view their conversation.</p> : <>
          <div className="support-heading"><h2>{current.displayName || current.username}</h2>
            {owned === current.id ? <button disabled={working} onClick={() => void action("release")}>Return to API assistant</button> :
              <button disabled={working || current.busy || !!current.owner} onClick={() => void action("claim")}>Join as assistant</button>}
          </div>
          {current.owner && owned !== current.id && <p className="support-help">{current.owner === username ? "Another one of your sessions" : current.owner} is handling this conversation.</p>}
          <div className="support-transcript" aria-label="Conversation history">
            {!current.messages.length && <p>No messages yet.</p>}
            {current.messages.map(message => <article key={message.id} className={`support-message ${message.role}`}>
              <small>{message.role === "user" ? current.displayName || current.username : "AI assistant"}</small>
              <p>{message.content}</p>
            </article>)}
          </div>
          {owned === current.id && <form onSubmit={event => { event.preventDefault(); void action("reply"); }}>
            <label htmlFor="support-reply">{pendingId ? "Reply to the user's question" : "Waiting for the user's next question"}</label>
            <textarea id="support-reply" value={draft} onChange={event => setDraft(event.target.value)} maxLength={16000} rows={4} disabled={!pendingId || working} />
            <button type="submit" disabled={!pendingId || !draft.trim() || working}>Send reply</button>
          </form>}
        </>}
      </div>
    </div>
  </section>;
}

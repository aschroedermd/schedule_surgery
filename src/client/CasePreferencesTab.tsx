import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, ClipboardList, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { Attending } from "../shared/types";
import { casePreferenceLibrary, casePreferenceTemplate, matchesCasePreferenceQuery, PREFERENCE_CATEGORIES, PREFERENCE_CATEGORY_LABELS, resolveCasePreferences, rudderowExample, type CaseContingency, type CasePreferenceCard, type CasePreferenceInput, type PreferenceChange, type PreferenceItem } from "../shared/casePreferences";
import { deleteCasePreferenceCard, fetchCasePreferenceCards, saveCasePreferenceCard } from "./casePreferencesApi";
import "./CasePreferencesTab.css";

const uid = () => crypto.randomUUID();
const newItem = (): PreferenceItem => ({ id: uid(), category: "disposable", quantity: 1, preferences: [""], notes: "" });

export function CasePreferencesTab({ token, canEdit, attendings, onToast, onDirtyChange }: { token: string; canEdit: boolean; attendings: Attending[]; onToast: (message: string) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [cards, setCards] = useState<CasePreferenceCard[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [browseBy, setBrowseBy] = useState<"surgeon" | "procedure">("procedure");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<CasePreferenceInput | null>(null);
  const [revision, setRevision] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const library = casePreferenceLibrary(cards, attendings.map((attending) => attending.name));
  const selectedEntry = library.find((entry) => entry.key === selectedId);
  const selected = selectedEntry?.card;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCasePreferenceCards(token).then((result) => { if (!cancelled) { setCards(result); setError(""); } })
      .catch((error) => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);
  useEffect(() => { if (!canEdit) setDraft(null); }, [canEdit]);
  useEffect(() => { onDirtyChange?.(Boolean(draft)); return () => onDirtyChange?.(false); }, [Boolean(draft), onDirtyChange]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  function edit(card: CasePreferenceInput, nextRevision?: number) {
    setCreating(false); setDraft(structuredClone(card)); setRevision(nextRevision); setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const card = await saveCasePreferenceCard(token, draft, revision);
      setCards((current) => [...current.filter((entry) => entry.id !== card.id), card]);
      setSelectedId(card.id); setGroup(""); setQuery(""); setDraft(null); onToast("Case preference card saved");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save card"); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError("");
    try { setCards(await fetchCasePreferenceCards(token)); onToast("Saved cards reloaded. Any open draft is preserved."); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to reload"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || selectedEntry?.inherited || !window.confirm(`Delete ${selected.surgeonName}’s ${selected.procedureName} card?`)) return;
    setBusy(true); setError("");
    try { await deleteCasePreferenceCard(token, selected); setCards((current) => current.filter((card) => card.id !== selected.id)); setSelectedId(""); onToast("Case card deleted"); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to delete"); }
    finally { setBusy(false); }
  }
  const field = browseBy === "surgeon" ? "surgeonName" : "procedureName";
  const matches = library.filter(({ card, inherited }) => (browseBy !== "surgeon" || !card.isDefault || inherited) && matchesCasePreferenceQuery(card, query));
  const groups = [...new Set(matches.map(({ card }) => card[field]))].sort((a, b) => a.localeCompare(b));
  const shownCards = matches.filter(({ card }) => !group || card[field] === group).sort((a, b) => a.card[field === "surgeonName" ? "procedureName" : "surgeonName"].localeCompare(b.card[field === "surgeonName" ? "procedureName" : "surgeonName"]));
  const surgeonNames = [...new Set([...attendings.map((attending) => attending.name), ...cards.filter((card) => !card.isDefault).map((card) => card.surgeonName), "Dr. John Rudderow"])].sort();

  return <section className="case-preferences">
    <header className="cp-page-header"><div><p className="eyebrow">Operating room · Preference library</p><h2>Case preferences</h2><p>Find the surgeon. Choose the case. See exactly what to pull.</p></div>
      <div className="cp-actions"><button className="secondary-button" disabled={busy || loading} onClick={reload}>Reload saved cards</button>{canEdit && !draft && !creating && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> New case card</button>}</div>
    </header>
    {error && <div className="cp-error" role="alert">{error}</div>}
    {creating && canEdit ? <CardStarter cards={cards} choose={edit} cancel={() => setCreating(false)} /> : draft && canEdit ? <div className="cp-edit-layout">
      <form onSubmit={save} className="cp-editor">
        <header className="cp-section-header"><div><p className="eyebrow">{draft.id ? "Edit card" : "New card"}</p><h3>Build the setup</h3></div><span className="cp-badge">Unsaved draft</span></header>
        <fieldset disabled={busy}>
          <label className="cp-default-choice"><input type="checkbox" checked={Boolean(draft.isDefault)} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked, surgeonName: e.target.checked ? "" : draft.surgeonName })} /> Procedure default</label>
          <div className="cp-field-grid"><label>Attending surgeon<input required={!draft.isDefault} disabled={draft.isDefault} list="cp-surgeons" value={draft.isDefault ? "All surgeons without a custom card" : draft.surgeonName} onChange={(e) => setDraft({ ...draft, surgeonName: e.target.value })} placeholder="Choose or add a surgeon" /></label>
          <label>Procedure<input required list="cp-procedures" value={draft.procedureName} onChange={(e) => setDraft({ ...draft, procedureName: e.target.value })} placeholder="e.g. Laparoscopic appendectomy" /></label></div>
          <datalist id="cp-surgeons">{surgeonNames.map((name) => <option key={name} value={name} />)}</datalist>
          <datalist id="cp-procedures">{[...new Set(cards.map((card) => card.procedureName))].sort().map((name) => <option key={name} value={name} />)}</datalist>
          <label>Setup notes<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Details that apply to the whole case" /></label>
          <h3>Primary setup</h3><p className="cp-help">Add one row per item. Each row has a first choice and an ordered list of acceptable substitutes.</p>
          {draft.items.map((item, index) => <EditorFoldout className="cp-edit-item" key={item.id} initialOpen={!item.preferences[0]} title={item.preferences[0] || "New instrument or tray"} subtitle={`${PREFERENCE_CATEGORY_LABELS[item.category]} · ×${item.quantity}${item.preferences.length > 1 ? ` · ${item.preferences.length - 1} alternative${item.preferences.length > 2 ? "s" : ""}` : ""}`}>
            <header><strong>Item {index + 1}</strong><div className="cp-actions"><MoveButtons index={index} length={draft.items.length} move={(direction) => setDraft({ ...draft, items: move(draft.items, index, direction) })} label={`item ${index + 1}`} />
              <button type="button" className="icon-button" aria-label={`Remove item ${index + 1}`} onClick={() => {
                const referenced = draft.contingencies.some((scenario) => scenario.changes.some((change) => change.action !== "add" && change.itemId === item.id));
                if (referenced && !window.confirm("Remove this item and its changes from all contingencies?")) return;
                setDraft({ ...draft, items: draft.items.filter((entry) => entry.id !== item.id), contingencies: draft.contingencies.map((scenario) => ({ ...scenario, changes: scenario.changes.filter((change) => change.action === "add" || change.itemId !== item.id) })).filter((scenario) => scenario.changes.length > 0) });
              }}><Trash2 size={15} /></button></div></header>
            <ItemFields item={item} change={(next) => setDraft({ ...draft, items: draft.items.map((entry) => entry.id === item.id ? next : entry) })} />
          </EditorFoldout>)}
          <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, items: [...draft.items, newItem()] })}><Plus size={15} /> Add instrument or tray</button>
          <div className="cp-section-header"><div><h3>Contingencies</h3><p className="cp-help">Describe a situation, then specify what to replace, remove, or add. These apply only to this card.</p></div></div>
          {draft.contingencies.map((scenario, index) => <ContingencyEditor key={scenario.id} scenario={scenario} items={draft.items} index={index} change={(next) => setDraft({ ...draft, contingencies: draft.contingencies.map((entry) => entry.id === scenario.id ? next : entry) })} remove={() => setDraft({ ...draft, contingencies: draft.contingencies.filter((entry) => entry.id !== scenario.id) })} />)}
          <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, contingencies: [...draft.contingencies, { id: uid(), name: "", conditions: [], changes: [] }] })}><Plus size={15} /> Add contingency</button>
        </fieldset>
        <footer className="cp-edit-footer"><button className="secondary-button" type="button" disabled={busy} onClick={() => { if (window.confirm("Discard this unsaved draft?")) setDraft(null); }}>Cancel</button>
          {draft.id && <button className="secondary-button" type="button" disabled={busy} onClick={() => { const saved = cards.find((card) => card.id === draft.id); if (saved && window.confirm("Replace this draft with the latest reloaded card?")) edit(saved, saved.revision); }}>Use reloaded version</button>}
          <button className="primary-button" disabled={busy || !draft.items.length}>{busy ? "Saving…" : "Save case card"}</button></footer>
      </form>
      <aside className="cp-preview"><p className="eyebrow">Live preview · Unsaved</p><CaseCardView key={draft.id || "new"} card={draft} /></aside>
    </div> : <div className="cp-library-layout">
      <aside className="cp-browser"><div className="cp-browse-switch" aria-label="Browse case preferences"><button aria-pressed={browseBy === "procedure"} onClick={() => { setBrowseBy("procedure"); setGroup(""); }}>By case</button><button aria-pressed={browseBy === "surgeon"} onClick={() => { setBrowseBy("surgeon"); setGroup(""); }}>By surgeon</button></div>
        <label className="cp-search"><Search size={17} /><input type="search" aria-label="Search surgeons or cases" placeholder="Search surgeons or cases" value={query} onChange={(e) => { setQuery(e.target.value); setGroup(""); }} /></label>
        <p className="cp-help">{loading ? "Loading library…" : `${cards.length} saved card${cards.length === 1 ? "" : "s"}`}</p>
        <button className="cp-group cp-all" aria-pressed={!group} onClick={() => setGroup("")}>All {browseBy === "procedure" ? "cases" : "surgeons"}</button>
        {groups.map((name) => <button key={name} className="cp-group" aria-pressed={group === name} onClick={() => setGroup(name)}><span>{name}</span><span className="cp-count">{matches.filter(({ card }) => card[field] === name).length}</span></button>)}
        {group && <p className="cp-help">{browseBy === "procedure" ? "Choose a surgeon" : "Choose a case"}</p>}
        <div className="cp-card-results">{shownCards.map(({ key, card }) => <button key={key} className="cp-card-result" aria-pressed={key === selectedId} onClick={() => setSelectedId(key)}><span><strong>{group ? card[browseBy === "procedure" ? "surgeonName" : "procedureName"] : card.procedureName}</strong><small>{group ? card[field] : card.surgeonName}</small>{card.isDefault && <span className="cp-default-flag">Default</span>}</span><ChevronRight size={16} /></button>)}</div>
        {!loading && !shownCards.length && <p role="status" className="cp-help">{cards.length ? "No matching case cards. Try another name or procedure." : "No saved case cards yet."}</p>}
      </aside>
      <main className="cp-detail">{selected && selectedEntry ? <><div className="cp-card-toolbar"><span className="cp-help">Updated {new Date(selected.updatedAt).toLocaleDateString()} by {selected.updatedBy}</span>{canEdit && <div className="cp-actions">
        {selectedEntry.inherited ? <button disabled={busy} className="secondary-button" onClick={() => edit({ ...selected, id: "", isDefault: false })}><Pencil size={14} /> Customize for surgeon</button> : <button disabled={busy} className="secondary-button" onClick={() => edit(selectedEntry.source, selected.revision)}><Pencil size={14} /> {selected.isDefault ? "Edit procedure default" : "Edit card"}</button>}
        {!selected.isDefault && <button disabled={busy} className="secondary-button" onClick={() => edit({ ...selected, id: "", surgeonName: "", isDefault: false })}>Copy card</button>}
        {!selectedEntry.inherited && <button disabled={busy} className="icon-button" aria-label="Delete case card" onClick={remove}><Trash2 size={16} /></button>}
      </div>}</div><CaseCardView key={`${selectedEntry.key}-${selected.revision}`} card={selected} /></> : <div className="cp-empty"><ClipboardList size={38} /><h3>{cards.length ? "Choose a case card" : "A clear setup starts here"}</h3><p>{cards.length ? "Browse by case to compare surgeons, or by surgeon to find their procedures." : "Keep the primary setup, acceptable alternatives, and case-specific changes together."}</p>{canEdit && <><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Create a case card</button><button className="secondary-button" onClick={() => edit(rudderowExample())}>Start with the Rudderow example</button><small>The example opens as a draft for review.</small></>}</div>}</main>
    </div>}
  </section>;
}

export function CaseCardView({ card }: { card: CasePreferenceInput }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [contingenciesOpen, setContingenciesOpen] = useState(false);
  const [pulled, setPulled] = useState<string[]>([]);
  const { rows, conflicts } = resolveCasePreferences(card, selected);
  const active = rows.filter((row) => row.status !== "removed");
  const changed = rows.filter((row) => row.status !== "unchanged");
  const complete = active.filter((row) => pulled.includes(row.id)).length;
  const scenarioListId = useId();
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]); setPulled([]); }
  useEffect(() => { setPulled([]); setSelected((current) => current.filter((id) => card.contingencies.some((scenario) => scenario.id === id))); }, [card]);
  function renderItem(item: typeof rows[number]) {
    const removed = item.status === "removed";
    return <div className={`cp-pull-row cp-${item.status} ${pulled.includes(item.id) ? "is-pulled" : ""}`} key={item.id}>
      {removed ? <X size={17} className="cp-removed-icon" /> : <label className="cp-pull-check"><input type="checkbox" aria-label={`Mark ${item.preferences[0]} as pulled`} disabled={conflicts.length > 0} checked={pulled.includes(item.id)} onChange={(e) => setPulled(e.target.checked ? [...pulled, item.id] : pulled.filter((id) => id !== item.id))} /><Check size={15} /></label>}
      <div className="cp-item-content">{item.status !== "unchanged" && <div className="cp-change-label">{removed ? "Do not pull" : item.status === "conflict" ? "Conflict — review required" : item.status === "replaced" ? "Replaced" : "Added"} · {item.sources.join(" + ")}</div>}
        {!removed && item.preferences.length > 1 ? <details><summary><strong>{item.preferences[0] || "Instrument name"}</strong><span>{item.preferences.length - 1} alternative{item.preferences.length > 2 ? "s" : ""}</span></summary><ol className="cp-alternatives">{item.preferences.slice(1).map((name, i) => <li key={i}><span>Choice {i + 2}</span><strong>{name}</strong></li>)}</ol></details> : <strong>{item.preferences[0] || "Instrument name"}</strong>}
        {item.status === "replaced" && <p className="cp-was">Instead of {item.original?.preferences[0]}{item.original && item.original.quantity !== item.quantity ? ` (quantity ${item.original.quantity})` : ""}</p>}
        {!removed && item.notes && <p className="cp-item-notes">{item.notes}</p>}
      </div><span className="cp-quantity" title="Quantity">×{item.quantity}</span>
    </div>;
  }
  return <article className="cp-case-card">
    <header className="cp-case-heading"><p className="eyebrow">{card.surgeonName || (card.isDefault ? "Procedure default" : "Attending surgeon")}</p><h3>{card.procedureName || "Procedure name"}</h3>{card.isDefault && <span className="cp-default-flag">Default card</span>}{card.notes && <p className="cp-setup-notes">{card.notes}</p>}</header>
    {card.contingencies.length > 0 && <div className="cp-contingency-controls">
      <button type="button" className={`secondary-button cp-contingency-toggle ${contingenciesOpen ? "is-pressed" : ""}`} aria-expanded={contingenciesOpen} aria-pressed={contingenciesOpen} aria-controls={scenarioListId} onClick={() => setContingenciesOpen(!contingenciesOpen)}>Contingencies{selected.length > 0 && <span className="cp-active-count">{selected.length} active</span>}</button>
      {contingenciesOpen ? <section className="cp-scenarios" id={scenarioListId}>
        {card.contingencies.map((scenario) => <label key={scenario.id} className={`cp-scenario ${selected.includes(scenario.id) ? "is-selected" : ""}`}><input type="checkbox" checked={selected.includes(scenario.id)} onChange={() => toggle(scenario.id)} /><span><strong>{scenario.name || "Untitled contingency"}</strong>{scenario.conditions.length > 0 && <small>{scenario.conditions.filter(Boolean).join(" · ")}</small>}</span></label>)}
      </section> : selected.length > 0 && <div className="cp-active-scenarios" id={scenarioListId}>{card.contingencies.filter((scenario) => selected.includes(scenario.id)).map((scenario) => <button type="button" className="cp-active-scenario" key={scenario.id} aria-label={`Remove contingency ${scenario.name}`} onClick={() => toggle(scenario.id)}><span>{scenario.name}</span><X size={13} /></button>)}</div>}
    </div>}
    {conflicts.length > 0 && <div role="alert" className="cp-error"><strong>Resolve overlapping contingencies before pulling instruments.</strong><p>{conflicts.map((row) => row.preferences[0]).join(", ")} changed by more than one selected situation. Deselect a conflicting situation.</p></div>}
    <div className="cp-setup-summary" aria-live="polite"><div><strong>{selected.length ? "Adjusted setup" : "Primary setup"}</strong>{selected.length > 0 && <span>{changed.length} changes</span>}</div><span>{conflicts.length ? "Setup needs review" : `${complete} / ${active.length} pulled`}</span></div>
    {PREFERENCE_CATEGORIES.map((category) => {
      const items = rows.filter((item) => item.category === category);
      if (!items.length) return null;
      const groups = [...new Set(items.map((item) => item.group || ""))];
      return <section className="cp-item-section" key={category}><h4>{PREFERENCE_CATEGORY_LABELS[category]}</h4>{groups.map((group) => <div className="cp-item-group" key={group}>{(group || groups.length > 1) && <h5>{group || "Instruments & supplies"}</h5>}{items.filter((item) => (item.group || "") === group).map(renderItem)}</div>)}</section>;
    })}
    {!rows.length && <p className="cp-help">Add a tray, scope, or instrument to see the setup here.</p>}
  </article>;
}

function move<T>(items: T[], index: number, direction: number): T[] { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }
function MoveButtons({ index, length, move, label }: { index: number; length: number; move: (direction: number) => void; label: string }) {
  return <><button type="button" className="icon-button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => move(-1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" disabled={index === length - 1} aria-label={`Move ${label} down`} onClick={() => move(1)}><ArrowDown size={14} /></button></>;
}
function PreferencesFields({ values, change }: { values: string[]; change: (values: string[]) => void }) {
  return <div className="cp-preference-fields">{values.map((name, index) => <div className="cp-preference-input" key={index}><label>{index === 0 ? "First choice" : `Alternative ${index} · Choice ${index + 1}`}<input required value={name} onChange={(e) => change(values.map((value, i) => i === index ? e.target.value : value))} placeholder={index === 0 ? "Instrument name, size, and associated supplies" : "Acceptable substitute"} /></label><div className="cp-actions"><MoveButtons index={index} length={values.length} move={(direction) => change(move(values, index, direction))} label={`choice ${index + 1}`} /><button type="button" className="icon-button" disabled={values.length === 1} aria-label={`Remove choice ${index + 1}`} onClick={() => change(values.filter((_, i) => i !== index))}><X size={14} /></button></div></div>)}<button type="button" className="cp-text-button" onClick={() => change([...values, ""])}><Plus size={14} /> Add alternative</button></div>;
}
function ItemFields({ item, change }: { item: PreferenceItem; change: (item: PreferenceItem) => void }) {
  return <><div className="cp-field-grid"><label>Section<select value={item.category} onChange={(e) => change({ ...item, category: e.target.value as PreferenceItem["category"] })}>{PREFERENCE_CATEGORIES.map((category) => <option value={category} key={category}>{PREFERENCE_CATEGORY_LABELS[category]}</option>)}</select></label><label>Quantity<input required type="number" min={1} max={100} value={item.quantity} onChange={(e) => change({ ...item, quantity: Number(e.target.value) })} /></label></div><label>Subgroup<input list={`cp-item-groups-${item.id}`} value={item.group ?? ""} onChange={(e) => change({ ...item, group: e.target.value })} placeholder="e.g. Laparoscopic trocars or Closure" /></label><datalist id={`cp-item-groups-${item.id}`}><option value="Laparoscopic trocars" /><option value="Closure" /></datalist><PreferencesFields values={item.preferences} change={(preferences) => change({ ...item, preferences })} /><label>Item notes<input value={item.notes} onChange={(e) => change({ ...item, notes: e.target.value })} placeholder="Optional setup instructions" /></label></>;
}
function ContingencyEditor({ scenario, items, index, change, remove }: { scenario: CaseContingency; items: PreferenceItem[]; index: number; change: (scenario: CaseContingency) => void; remove: () => void }) {
  function updateChange(id: string, next: PreferenceChange) { change({ ...scenario, changes: scenario.changes.map((entry) => entry.id === id ? next : entry) }); }
  function replacement(id: string, itemId: string): PreferenceChange { const item = items.find((item) => item.id === itemId); return { id, action: "replace", itemId, preferences: [""], quantity: item?.quantity ?? 1, notes: "" }; }
  return <EditorFoldout className="cp-edit-contingency" title={scenario.name || "New contingency"} subtitle={`${scenario.changes.length} setup changes`} initialOpen={!scenario.name}><header><strong>Contingency {index + 1}</strong><button type="button" className="icon-button" aria-label={`Remove contingency ${index + 1}`} onClick={remove}><Trash2 size={15} /></button></header>
    <label>Situation name<input required value={scenario.name} onChange={(e) => change({ ...scenario, name: e.target.value })} placeholder="e.g. Roux-en-Y gastric bypass + BMI < 40" /></label>
    <label>Conditions · All must apply<textarea value={scenario.conditions.join("\n")} onChange={(e) => change({ ...scenario, conditions: e.target.value.split("\n") })} placeholder={"One condition per line\nBMI less than 40\nPrior Roux-en-Y gastric bypass"} /></label>
    {scenario.changes.map((entry, changeIndex) => <div className="cp-edit-change" key={entry.id}><header><strong>Change {changeIndex + 1}</strong><button type="button" className="icon-button" aria-label={`Remove change ${changeIndex + 1}`} onClick={() => change({ ...scenario, changes: scenario.changes.filter((other) => other.id !== entry.id) })}><X size={14} /></button></header>
      <div className="cp-field-grid"><label>Action<select value={entry.action} onChange={(e) => {
        const action = e.target.value;
        if (action === "add") updateChange(entry.id, { id: entry.id, action: "add", item: newItem() });
        else { const target = entry.action === "add" ? items[0]?.id ?? "" : entry.itemId; updateChange(entry.id, action === "remove" ? { id: entry.id, action: "remove", itemId: target } : replacement(entry.id, target)); }
      }}><option value="replace" disabled={!items.length}>Replace item</option><option value="remove" disabled={!items.length}>Remove item & alternatives</option><option value="add">Add item</option></select></label>
      {entry.action !== "add" && <label>Primary item<select required value={entry.itemId} onChange={(e) => updateChange(entry.id, { ...entry, itemId: e.target.value })}><option value="">Choose an item</option>{items.map((item) => <option key={item.id} value={item.id} disabled={scenario.changes.some((other) => other.id !== entry.id && other.action !== "add" && other.itemId === item.id)}>{item.preferences[0] || "Unnamed item"}</option>)}</select></label>}</div>
      {entry.action === "remove" && <p className="cp-help">This removes the first choice and every alternative from the pull list.</p>}
      {entry.action === "replace" && <><PreferencesFields values={entry.preferences} change={(preferences) => updateChange(entry.id, { ...entry, preferences })} /><div className="cp-field-grid"><label>Replacement quantity<input type="number" required min={1} max={100} value={entry.quantity} onChange={(e) => updateChange(entry.id, { ...entry, quantity: Number(e.target.value) })} /></label><label>Replacement notes<input value={entry.notes} onChange={(e) => updateChange(entry.id, { ...entry, notes: e.target.value })} /></label></div><p className="cp-help">Only the replacement’s listed alternatives apply.</p></>}
      {entry.action === "add" && <ItemFields item={entry.item} change={(item) => updateChange(entry.id, { ...entry, item })} />}
    </div>)}
    <button type="button" className="secondary-button" onClick={() => {
      const target = items.find((item) => !scenario.changes.some((entry) => entry.action !== "add" && entry.itemId === item.id));
      change({ ...scenario, changes: [...scenario.changes, target ? replacement(uid(), target.id) : { id: uid(), action: "add", item: newItem() }] });
    }}><Plus size={14} /> Add setup change</button>
  </EditorFoldout>;
}

function EditorFoldout({ className, title, subtitle, initialOpen, children }: { className: string; title: string; subtitle: string; initialOpen: boolean; children: ReactNode }) {
  const openAtMount = useRef(initialOpen);
  return <details className={className} open={openAtMount.current}><summary><strong>{title}</strong><small>{subtitle}</small></summary><div className="cp-foldout-content">{children}</div></details>;
}

function CardStarter({ cards, choose, cancel }: { cards: CasePreferenceCard[]; choose: (card: CasePreferenceInput) => void; cancel: () => void }) {
  const [copying, setCopying] = useState(false);
  const [search, setSearch] = useState("");
  const sources = cards.filter((card) => !card.isDefault && matchesCasePreferenceQuery(card, search));
  return <section className="cp-starter"><header className="cp-section-header"><h3>Start a case card</h3><button className="secondary-button" onClick={cancel}>Cancel</button></header>
    <div className="cp-template-options">
      <button onClick={() => choose(casePreferenceTemplate("open"))}><strong>Open</strong><small>Tray · Instruments · Closure</small></button>
      <button onClick={() => choose(casePreferenceTemplate("laparoscopic"))}><strong>Laparoscopic</strong><small>Tray · Scope · Trocars · Closure</small></button>
      <button onClick={() => choose(casePreferenceTemplate("empty"))}><strong>Empty</strong><small>Start from scratch</small></button>
      <button aria-pressed={copying} onClick={() => setCopying(!copying)}><strong>Copy from other card</strong><small>Find a surgeon’s custom setup</small></button>
    </div>
    {copying && <div className="cp-copy-picker"><label className="cp-search"><Search size={17} /><input type="search" aria-label="Search cards to copy" placeholder="Search procedure or surgeon" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      {sources.map((card) => <button key={card.id} className="cp-card-result" onClick={() => choose({ ...structuredClone(card), id: "", surgeonName: "", isDefault: false })}><span><strong>{card.procedureName}</strong><small>{card.surgeonName}</small></span><ChevronRight size={16} /></button>)}
      {!sources.length && <p className="cp-help" role="status">No matching surgeon cards.</p>}
    </div>}
  </section>;
}

import { Check, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ContactRequest, DirectoryContact, DirectoryContactType, PlannerState } from "../shared/types";
import { approveContactRequest, deleteContact, rejectContactRequest, submitContact } from "./api";
import { buildVCard, makeTelephoneUrl, vCardFilename } from "./vcard";

export function ContactsTab({
  state,
  token,
  username,
  isAdmin,
  canAddContacts,
  onMutate
}: {
  state: PlannerState;
  token: string;
  username: string;
  isAdmin: boolean;
  canAddContacts: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState<"All" | DirectoryContactType>("All");
  const [showAddForm, setShowAddForm] = useState(false);
  const typeContacts = state.contacts.filter(
    (contact) => directoryFilter === "All" || contact.directoryType === directoryFilter
  );
  const categories = useMemo(
    () => [...new Set(typeContacts.map((contact) => contact.category))].sort((a, b) => a.localeCompare(b)),
    [typeContacts]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredContacts = typeContacts.filter((contact) =>
    !normalizedQuery || [contact.name, contact.phoneNumber, ...(contact.alternatePhoneNumbers ?? []), contact.category, contact.organization]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  );
  const grouped = categories
    .map((category) => ({
      category,
      contacts: filteredContacts
        .filter((contact) => contact.category === category)
        .sort((a, b) => a.name.localeCompare(b.name))
    }))
    .filter((group) => group.contacts.length > 0);
  const visibleRequests = isAdmin
    ? state.contactRequests
    : state.contactRequests.filter((request) => request.requesterUsername === username);
  const pendingRequests = visibleRequests.filter((request) => request.status === "pending");

  function scrollToCategory(category: string) {
    document.getElementById(contactCategoryId(category))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="contacts-page">
      <div className="contacts-toolbar">
        <label className="contacts-search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">Search contacts</span>
          <input
            type="search"
            value={query}
            placeholder="Search names, numbers, or categories"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={17} />
            </button>
          )}
        </label>
        <button type="button" className="primary-button contacts-add-button" onClick={() => setShowAddForm((open) => !open)}>
          {showAddForm ? <X size={18} /> : <Plus size={18} />}
          <span>{showAddForm ? "Cancel" : "Add contact"}</span>
        </button>
      </div>

      <div className="contact-type-tabs" role="tablist" aria-label="Contact directories">
        {(["All", "Hospital", "Residents", "Faculty & Staff"] as const).map((directoryType) => (
          <button
            key={directoryType}
            type="button"
            role="tab"
            aria-selected={directoryFilter === directoryType}
            className={directoryFilter === directoryType ? "active" : ""}
            onClick={() => setDirectoryFilter(directoryType)}
          >
            {directoryType}
          </button>
        ))}
      </div>

      {showAddForm && (
        <ContactAddForm
          categories={categories}
          publishesImmediately={isAdmin || canAddContacts}
          onCancel={() => setShowAddForm(false)}
          onSubmit={async (contact) => {
            await onMutate(
              () => submitContact(token, contact),
              isAdmin || canAddContacts ? "Contact added" : "Contact sent for admin approval"
            );
            setShowAddForm(false);
          }}
        />
      )}

      {!query && categories.length > 1 && (
        <nav className="contact-category-nav" aria-label="Contact categories">
          {categories.map((category) => (
            <button type="button" key={category} onClick={() => scrollToCategory(category)}>{category}</button>
          ))}
        </nav>
      )}

      <div className="contact-groups" aria-live="polite">
        {grouped.map(({ category, contacts }) => (
          <section className="contact-group" id={contactCategoryId(category)} key={category}>
            <h2>{category}</h2>
            <div className="contact-list">
              {contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  canDelete={isAdmin}
                  onDelete={() => {
                    if (!window.confirm(`Remove ${contact.name} from the directory?`)) return;
                    void onMutate(() => deleteContact(token, contact.id), "Contact removed");
                  }}
                />
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && (
          <div className="contacts-empty">
            <Search size={28} />
            <strong>{query ? "No contacts found" : `No ${directoryFilter === "All" ? "" : `${directoryFilter} `}contacts yet`}</strong>
            <span>{query ? "Try a different name, number, or category." : "Use Add contact to submit the first one."}</span>
          </div>
        )}
      </div>

      {pendingRequests.length > 0 && (
        <ContactRequests
          requests={pendingRequests}
          isAdmin={isAdmin}
          onApprove={(id) => onMutate(() => approveContactRequest(token, id), "Contact approved")}
          onReject={(id) => onMutate(() => rejectContactRequest(token, id), "Contact rejected")}
        />
      )}
    </section>
  );
}

function ContactAddForm({
  categories,
  publishesImmediately,
  onSubmit,
  onCancel
}: {
  categories: string[];
  publishesImmediately: boolean;
  onSubmit: (contact: { name: string; phoneNumber: string; category: string; directoryType: DirectoryContactType; organization: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [category, setCategory] = useState("");
  const [directoryType, setDirectoryType] = useState<DirectoryContactType>("Hospital");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const organization = directoryType === "Hospital"
        ? "Hospital Directory"
        : directoryType === "Residents"
          ? "Carilion Clinic General Surgery Residency"
          : "Carilion Clinic Department of Surgery";
      await onSubmit({ name: name.trim(), phoneNumber: phoneNumber.trim(), category: category.trim(), directoryType, organization });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="contact-add-form" onSubmit={submit}>
      <div className="contact-add-heading">
        <div>
          <p className="eyebrow">Hospital Directory</p>
          <h2>New contact</h2>
        </div>
        <p>{publishesImmediately ? "This contact will be added immediately." : "An admin will review this contact before it appears."}</p>
      </div>
      <div className="contact-add-fields">
        <label>
          Directory
          <select value={directoryType} onChange={(event) => setDirectoryType(event.target.value as DirectoryContactType)}>
            <option value="Hospital">Hospital</option>
            <option value="Residents">Residents</option>
            <option value="Faculty & Staff">Faculty &amp; Staff</option>
          </select>
        </label>
        <label>
          Name
          <input required maxLength={120} value={name} placeholder="e.g. OR Front Desk" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Phone number
          <input required type="tel" inputMode="tel" value={phoneNumber} placeholder="(540) 555-0123" onChange={(event) => setPhoneNumber(event.target.value)} />
        </label>
        <label>
          Category
          <input required maxLength={80} list="contact-category-options" value={category} placeholder="Choose or enter a category" onChange={(event) => setCategory(event.target.value)} />
          <datalist id="contact-category-options">
            {categories.map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
      </div>
      <div className="contact-add-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={submitting}>
          <Plus size={17} />
          {submitting ? "Submitting…" : publishesImmediately ? "Add contact" : "Request contact"}
        </button>
      </div>
    </form>
  );
}

function ContactRow({ contact, canDelete, onDelete }: { contact: DirectoryContact; canDelete: boolean; onDelete: () => void }) {
  const telephoneUrl = makeTelephoneUrl(contact.phoneNumber);
  const display = splitContactNameAndTitle(contact.name);
  return (
    <article className="contact-row">
      <a className="contact-main" href={telephoneUrl} aria-label={`Call ${contact.name} at ${contact.phoneNumber}`}>
        <span className="contact-avatar" aria-hidden="true">{contact.name.trim().charAt(0).toLocaleUpperCase()}</span>
        <span className="contact-copy">
          <strong>{display.name}</strong>
          {display.title && <span className="contact-title">{display.title}</span>}
          <small>{contact.phoneNumber}</small>
          {contact.alternatePhoneNumbers?.map((phoneNumber) => (
            <small key={phoneNumber}>Alternate: {phoneNumber}</small>
          ))}
        </span>
      </a>
      <div className="contact-actions">
        <VCardDownloadLink contact={contact} />
        <a className="contact-action contact-call" href={telephoneUrl} title={`Call ${contact.name}`} aria-label={`Call ${contact.name}`}>
          <Phone size={19} />
        </a>
        {contact.alternatePhoneNumbers?.map((phoneNumber, index) => (
          <a
            key={phoneNumber}
            className="contact-action contact-call"
            href={makeTelephoneUrl(phoneNumber)}
            title={`Call ${contact.name} alternate number ${index + 1}`}
            aria-label={`Call ${contact.name} at alternate number ${phoneNumber}`}
          >
            <Phone size={16} />
          </a>
        ))}
        {canDelete && (
          <button type="button" className="contact-action contact-delete" title={`Remove ${contact.name}`} aria-label={`Remove ${contact.name}`} onClick={onDelete}>
            <Trash2 size={17} />
          </button>
        )}
      </div>
    </article>
  );
}

export function splitContactNameAndTitle(value: string): { name: string; title?: string } {
  const credentialMatch = value.match(/^(.+?),\s*((?:NP|PA)\b.*)$/i);
  if (credentialMatch) return { name: credentialMatch[1].trim(), title: credentialMatch[2].trim() };

  const separatorIndex = value.indexOf(" - ");
  if (separatorIndex > 0) {
    return {
      name: value.slice(0, separatorIndex).trim(),
      title: value.slice(separatorIndex + 3).trim()
    };
  }
  return { name: value.trim() };
}

function ContactRequests({
  requests,
  isAdmin,
  onApprove,
  onReject
}: {
  requests: ContactRequest[];
  isAdmin: boolean;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  return (
    <section className="contact-requests-panel">
      <div>
        <p className="eyebrow">{isAdmin ? "Approval pool" : "My requests"}</p>
        <h2>{isAdmin ? "Pending contacts" : "Awaiting approval"}</h2>
      </div>
      <div className="contact-request-list">
        {requests.map((request) => (
          <article key={request.id} className="contact-request-row">
            <div>
              <strong>{request.contact.name}</strong>
              <span>{request.contact.phoneNumber} · {request.contact.category}</span>
              {isAdmin && <small>Requested by {request.requesterName}</small>}
            </div>
            {isAdmin && (
              <div>
                <button type="button" className="secondary-button" onClick={() => void onReject(request.id)}><X size={15} />Reject</button>
                <button type="button" className="primary-button" onClick={() => void onApprove(request.id)}><Check size={15} />Approve</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function VCardDownloadLink({ contact }: { contact: DirectoryContact }) {
  const [href, setHref] = useState("");
  useEffect(() => {
    const blobUrl = URL.createObjectURL(new Blob([buildVCard(contact)], { type: "text/vcard;charset=utf-8" }));
    setHref(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [contact]);
  return (
    <a
      className="contact-action contact-download"
      href={href || undefined}
      download={vCardFilename(contact)}
      title={`Add ${contact.name} to contacts`}
      aria-label={`Download ${contact.name} contact card`}
      onClick={(event) => { if (!href) event.preventDefault(); }}
    >
      <Plus size={20} />
    </a>
  );
}

function contactCategoryId(category: string): string {
  return `contacts-${category.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

import { Check, Pencil, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ContactRequest,
  DirectoryContact,
  DirectoryContactType,
  HOSPITAL_CONTACT_FACILITIES,
  HospitalContactFacility,
  PlannerState
} from "../shared/types";
import { comparePersonNames } from "../shared/names";
import { approveContactRequest, deleteContact, rejectContactRequest, submitContact, updateContact } from "./api";
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
  const [directoryFilter, setDirectoryFilter] = useState<"All" | DirectoryContactType>("Hospital");
  const [facilityFilter, setFacilityFilter] = useState<HospitalContactFacility>("RMH");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContact, setEditingContact] = useState<DirectoryContact | null>(null);
  const typeContacts = state.contacts.filter(
    (contact) => (directoryFilter === "All" || contact.directoryType === directoryFilter) &&
      (directoryFilter !== "Hospital" || (contact.facility ?? "RMH") === facilityFilter)
  );
  const categories = useMemo(
    () => [...new Set(typeContacts.map((contact) => contact.category))].sort((a, b) => a.localeCompare(b)),
    [typeContacts]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredContacts = typeContacts.filter((contact) =>
    !normalizedQuery || [
      contact.name,
      contact.phoneNumber,
      ...(contact.alternatePhoneNumbers ?? []),
      ...(contact.aliases ?? []),
      contact.category,
      contact.organization,
      contact.facility,
      contact.building
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
  );
  const grouped = categories
    .map((category) => ({
      category,
      contacts: filteredContacts
        .filter((contact) => contact.category === category)
        .sort((a, b) => (
          (a.importance === "essential" ? 0 : 1) - (b.importance === "essential" ? 0 : 1) ||
          comparePersonNames(a.name, b.name)
        ))
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
        <button type="button" className="primary-button contacts-add-button" onClick={() => {
          setEditingContact(null);
          setShowAddForm((open) => !open);
        }}>
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
            onClick={() => {
              setDirectoryFilter(directoryType);
              setEditingContact(null);
            }}
          >
            {directoryType}
          </button>
        ))}
      </div>

      {directoryFilter === "Hospital" && (
        <div className="contact-facility-tabs" role="tablist" aria-label="Hospital facilities">
          {HOSPITAL_CONTACT_FACILITIES.map((facility) => (
            <button
              key={facility}
              type="button"
              role="tab"
              aria-selected={facilityFilter === facility}
              className={facilityFilter === facility ? "active" : ""}
              onClick={() => {
                setFacilityFilter(facility);
                setEditingContact(null);
              }}
            >
              {facility}
            </button>
          ))}
        </div>
      )}

      {(showAddForm || editingContact) && (
        <ContactAddForm
          key={editingContact?.id ?? "new-contact"}
          categories={categories}
          initialContact={editingContact ?? undefined}
          defaultFacility={facilityFilter}
          publishesImmediately={Boolean(editingContact) || isAdmin || canAddContacts}
          onCancel={() => {
            setShowAddForm(false);
            setEditingContact(null);
          }}
          onSubmit={async (contact) => {
            await onMutate(
              () => editingContact
                ? updateContact(token, editingContact.id, contact)
                : submitContact(token, contact),
              editingContact
                ? "Contact updated"
                : isAdmin || canAddContacts ? "Contact added" : "Contact sent for admin approval"
            );
            setShowAddForm(false);
            setEditingContact(null);
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
                  canEdit={isAdmin}
                  onEdit={() => {
                    setShowAddForm(false);
                    setEditingContact(contact);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
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
  initialContact,
  defaultFacility,
  publishesImmediately,
  onSubmit,
  onCancel
}: {
  categories: string[];
  initialContact?: DirectoryContact;
  defaultFacility: HospitalContactFacility;
  publishesImmediately: boolean;
  onSubmit: (contact: {
    name: string;
    phoneNumber: string;
    alternatePhoneNumbers?: string[];
    aliases?: string[];
    category: string;
    directoryType: DirectoryContactType;
    facility?: HospitalContactFacility;
    building?: string;
    importance?: DirectoryContact["importance"];
    organization: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialContact?.name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(initialContact?.phoneNumber ?? "");
  const [alternatePhoneNumbers, setAlternatePhoneNumbers] = useState((initialContact?.alternatePhoneNumbers ?? []).join(", "));
  const [aliases, setAliases] = useState((initialContact?.aliases ?? []).join(", "));
  const [category, setCategory] = useState(initialContact?.category ?? "");
  const [directoryType, setDirectoryType] = useState<DirectoryContactType>(initialContact?.directoryType ?? "Hospital");
  const [facility, setFacility] = useState<HospitalContactFacility>(initialContact?.facility ?? defaultFacility);
  const [building, setBuilding] = useState(initialContact?.building ?? "");
  const [importance, setImportance] = useState<NonNullable<DirectoryContact["importance"]>>(initialContact?.importance ?? "extended");
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
      await onSubmit({
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        alternatePhoneNumbers: parseContactList(alternatePhoneNumbers),
        aliases: parseContactList(aliases),
        category: category.trim(),
        directoryType,
        facility: directoryType === "Hospital" ? facility : undefined,
        building: directoryType === "Hospital" ? building.trim() || undefined : undefined,
        importance: directoryType === "Hospital" ? importance : undefined,
        organization
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="contact-add-form" onSubmit={submit}>
      <div className="contact-add-heading">
        <div>
          <p className="eyebrow">{initialContact ? "Admin editor" : "Hospital Directory"}</p>
          <h2>{initialContact ? `Edit ${initialContact.name}` : "New contact"}</h2>
        </div>
        <p>{initialContact
          ? "Changes are published immediately."
          : publishesImmediately ? "This contact will be added immediately." : "An admin will review this contact before it appears."}</p>
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
        {directoryType === "Hospital" && (
          <label>
            Facility
            <select value={facility} onChange={(event) => setFacility(event.target.value as HospitalContactFacility)}>
              {HOSPITAL_CONTACT_FACILITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        )}
        <label>
          Name
          <input required maxLength={120} value={name} placeholder="e.g. OR Front Desk" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Phone number
          <input required type="tel" inputMode="tel" value={phoneNumber} placeholder="(540) 555-0123" onChange={(event) => setPhoneNumber(event.target.value)} />
        </label>
        <label>
          Alternate numbers
          <input value={alternatePhoneNumbers} placeholder="Comma-separated" onChange={(event) => setAlternatePhoneNumbers(event.target.value)} />
        </label>
        <label>
          Category
          <input required maxLength={80} list="contact-category-options" value={category} placeholder="Choose or enter a category" onChange={(event) => setCategory(event.target.value)} />
          <datalist id="contact-category-options">
            {categories.map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
        {directoryType === "Hospital" && (
          <>
            <label>
              Building / location
              <input maxLength={120} value={building} placeholder="e.g. Crystal Spring Tower" onChange={(event) => setBuilding(event.target.value)} />
            </label>
            <label>
              Visibility
              <select value={importance} onChange={(event) => setImportance(event.target.value as NonNullable<DirectoryContact["importance"]>)}>
                <option value="essential">Essential</option>
                <option value="extended">All services</option>
              </select>
            </label>
          </>
        )}
        <label>
          Search aliases
          <input value={aliases} placeholder="Comma-separated" onChange={(event) => setAliases(event.target.value)} />
        </label>
      </div>
      <div className="contact-add-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={submitting}>
          <Plus size={17} />
          {submitting ? "Submitting…" : initialContact ? "Save changes" : publishesImmediately ? "Add contact" : "Request contact"}
        </button>
      </div>
    </form>
  );
}

function ContactRow({
  contact,
  canDelete,
  canEdit,
  onDelete,
  onEdit
}: {
  contact: DirectoryContact;
  canDelete: boolean;
  canEdit: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const telephoneUrl = makeTelephoneUrl(contact.phoneNumber);
  const display = splitContactNameAndTitle(contact.name);
  return (
    <article className="contact-row">
      <a className="contact-main" href={telephoneUrl} aria-label={`Call ${contact.name} at ${contact.phoneNumber}`}>
        <span className="contact-avatar" aria-hidden="true">{contact.name.trim().charAt(0).toLocaleUpperCase()}</span>
        <span className="contact-copy">
          <strong>{display.name}</strong>
          {display.title && <span className="contact-title">{display.title}</span>}
          {contact.building && <span className="contact-title">{contact.building}</span>}
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
        {canEdit && (
          <button type="button" className="contact-action contact-edit" title={`Edit ${contact.name}`} aria-label={`Edit ${contact.name}`} onClick={onEdit}>
            <Pencil size={16} />
          </button>
        )}
        {canDelete && (
          <button type="button" className="contact-action contact-delete" title={`Remove ${contact.name}`} aria-label={`Remove ${contact.name}`} onClick={onDelete}>
            <Trash2 size={17} />
          </button>
        )}
      </div>
    </article>
  );
}

function parseContactList(value: string): string[] | undefined {
  const items = [...new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
  return items.length ? items : undefined;
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

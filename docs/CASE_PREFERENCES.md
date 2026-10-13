# Case preferences

The Case preferences tab is a separate, shared library of surgeon/procedure cards. It does not alter scheduled cases or schedule editing privileges.

## Access

In **Users**, set **Case preferences access** to **No access**, **View case cards**, or **View and edit case cards**, then save the user. New and existing non-admin accounts default to no access. Admins always have edit access. The server checks the current account on every request, including personal API key requests; revocations take effect without waiting for sign-out. Users see their updated navigation when their session is refreshed or they sign in again.

## Viewing and authoring

Browse by case to see the available surgeons, or browse by surgeon to see their procedures. Search matches either name. Trays appear first, followed by scope, disposable instruments and supplies, and other equipment. Each item has a quantity, first choice, ordered alternatives, an optional subgroup (such as Laparoscopic trocars or Closure), and optional notes. Compact rows keep long setups easy to scan. Expand an item to see its alternatives.

New cards start from an Open, Laparoscopic, or Empty template, or from a searchable copy of another surgeon’s custom card. Template placeholders are completed by the author before saving. Editors can edit cards with a live setup preview and delete a card. Surgeon names can be chosen from the attending roster and saved library or entered directly. The Rudderow appendectomy example is available as an unsaved starter draft. Review it before saving; it is not automatically published as an operational preference.

Contingencies are authored individually within each card. Their condition descriptions are combined with AND. Users manually select applicable contingencies; no patient information is entered or inferred. Each contingency may replace an item (with its own ordered alternatives, quantity, and notes), remove an item and all its alternatives, or add equipment. Selected changes are labeled and highlighted. Removed items stay in their original group and position, marked “Do not pull,” with all alternatives hidden. The Contingencies button beneath the procedure name starts collapsed and turns green while expanded. Closing the list keeps selected contingencies active and displays them as removable chips. Multiple selected contingencies targeting the same item create a visible conflict and disable pull checks until the conflicting selection is resolved. No implicit rule priority is applied.

Pull checks are temporary, local to the open view, and reset when contingencies change. They are not shared or persisted. Cards are saved only when the editor selects Save case card. Failed saves preserve the draft. Concurrent edits are rejected with a conflict response; reload the saved cards, then use the reloaded version to reconcile changes. Browser unload and navigation away from the tab warn about unsaved drafts.

## Procedure defaults

In the editor, select **Procedure default** to save a shared setup for a procedure rather than a surgeon. There is one default per procedure. When browsing by surgeon, the library shows that default for every roster surgeon who has no custom card for the procedure, with a **Default card** flag. A custom card takes precedence. Defaults are linked to the shared card, so editing the default updates all fallback views without generating stored copies. Deleting a custom card restores the fallback when one exists.

The copy-from-other-card picker includes only real surgeon-specific cards. Shared defaults and their fallback views are excluded. On a fallback view, **Customize for surgeon** opens a new surgeon-specific draft without changing the default. Shared defaults can be found and edited in case browsing; they are not presented as surgeons in surgeon browsing.

Existing saved cards remain surgeon-specific unless explicitly changed to a procedure default. Optional `isDefault` and item `group` fields keep earlier cards compatible. Surgeon matching ignores a leading Dr./Dr honorific, case, and extra spaces; procedure matching ignores case and extra spaces.

## Persistence and deployment

Cards are kept in `case-preferences.json` beside `USER_STORE_PATH` by default. This follows the existing durable private account-file storage pattern: local `.local/case-preferences.json`, production `/data/case-preferences.json` in the `planner-users` volume. `CASE_PREFERENCES_PATH` can override the location. The file is private and writes are serialized and published with an atomic rename. Back up this file along with `users.json`; the PostgreSQL schedule backup does not include either file. The app currently assumes one server process owns this file, as it does for the user store.

## API

All routes require authentication and a password-ready session (or supported API key). GET requires view or edit access; mutations require edit access.

- `GET /api/case-preferences`: `{ cards: CasePreferenceCard[] }`
- `POST /api/case-preferences`: `{ card: CasePreferenceInput }`; returns `{ card }`, status 201.
- `PUT /api/case-preferences/:id`: `{ card: CasePreferenceInput, expectedRevision: number }`; returns `{ card }`.
- `DELETE /api/case-preferences/:id`: `{ expectedRevision: number }`; returns status 204.

Card IDs, revisions, update timestamps, and editor names are assigned by the server. Updates/deletes require the current revision (409 on stale writes). Validation rejects missing first choices, invalid quantities, dangling contingency targets, duplicate IDs, and multiple changes to the same base item within a contingency. The library permits one custom card per normalized surgeon/procedure name pair and one default per normalized procedure name. Default cards have `isDefault: true` and an empty `surgeonName`; ordinary cards have `isDefault: false` (or omit the field in older data). Item `group` is an optional string, limited to 100 characters.

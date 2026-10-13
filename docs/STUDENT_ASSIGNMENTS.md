# Student assignments

The OR/clinic person picker separates Residents and Students. Its title identifies the current assignee; an empty slot says Unassigned. Add person keeps existing coverage and creates another case or clinic assignment, subject to the case limit of three people or the clinic capacity. Each header row includes an Assigned badge and a remove button for that person. Unassign all clears everyone from the selected target. The back arrow closes the picker. Students cannot cover an entire OR block or participate in the coverage calendar or call pool.

New students can be created from the Students tab. Names and aliases are compared ignoring case, whitespace and punctuation. Matching profiles are shown for explicit selection; choosing a different person creates a separate identity even when names match. Existing account-linked students retain their IDs and personal schedules. Creating a student here does not create an account or automatically link accounts by name.

A new profile includes a team placement with inclusive start and end dates. Service recommendations use the date of the case or clinic. After the end date the student no longer belongs to that team; their identity and historical assignments remain. Placements are stored as `Resident.studentPlacements`, separate from resident rotation blocks and call eligibility.

## API

`POST /api/assignments` and `PATCH /api/assignments/:id` accept `newStudent` instead of `residentId`:

```json
{
  "newStudent": {
    "name": "Greg Smith",
    "distinctPerson": false,
    "placement": {
      "service": "Berry",
      "startDate": "2026-10-13",
      "endDate": "2026-11-02"
    }
  }
}
```

POST also requires `kind` (case or clinic) and `targetId`. PATCH can use `caseId` to replace inherited block coverage for just one case. Creation and assignment are committed together, so validation failures do not leave unused student profiles. Existing matching names return 409 unless `distinctPerson: true` explicitly confirms a different person. Reusing an existing student sends their `residentId` instead. Editing privileges are required for both the assignment service and placement team.

The legacy `manualStudentName` API remains supported for existing integrations; the picker uses the explicit confirmation flow above.

`DELETE /api/assignment-targets/:kind/:targetId` clears all people from a target. An optional JSON `residentId` removes only that person. Case targets preserve inherited coverage on all other cases, atomically. The same service-edit permission as assignment editing is required.

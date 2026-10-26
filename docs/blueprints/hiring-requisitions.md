# Blueprint — Hiring slice 2: requisitions, planning, approval, JD, posting, library

Part of `docs/blueprints/hiring.md` (the module contract; ACs AC2.1–AC2.8 live there). This file
records what slice 2 builds and how it was verified.

Scope: app/api/hiring/requisitions/**, app/api/hiring/requests/**, app/api/hiring/planning-rounds/**, app/api/hiring/needs/**, app/api/hiring/library/**, app/api/hiring/me/**, app/api/hiring/directory/**, app/api/hiring/org-options/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**

## Stories

- As HR, I open a planning cycle for a company, canvass its departments, chase the silent ones,
  record and challenge each requirement, and raise a requisition only from what survived.
- As a hiring manager (or HR), I raise a hiring request — saved as a draft or submitted with a
  note to approvers — or create a requisition from a catalogued JD template.
- As the HR Manager and then the Operations Director for that company, I approve headcount and
  budget on a screen that shows the business case, the budget check against the envelope and who
  submitted it; I can also reject or send back with a note.
- As the hiring manager and HR, we sign the JD off in two named slots; a request for changes
  bumps the version.
- As HR, I post the role on the careers page and record the external channels.
- As HR, I maintain the knowledge base: grades and bands, competencies with rating anchors, JD
  templates and the question bank.

## Acceptance (verified)

Local API walk-through (40 checks, all pass): duplicate cycle 409; raise before challenge 422;
out-of-scope read 404 and list empty; raising for another company 403; submitter cannot sign;
the Operations Director cannot sign the HR step; one person cannot sign both steps; the HR
Manager signs, the Operations Director opens; the band hidden from a panelist and from a hiring
manager without "may see pay"; title locked after draft, JD editable; posting refused before JD
sign-off; drafter cannot sign HR; HR Specialist signs HR; hiring manager signs → APPROVED; Tawteen
forced Omani-preferred; careers post / withdraw / withdraw-again 409; Excel export; grade pay
hidden from a panelist; competency create idempotent on name; panelist cannot write the library.

## Worst paths

- Two approvers sign at once: the unique (submission, sequence) arbitrates; the loser gets 409.
- The chain changes while a requisition is pending: the server refuses and says to resubmit.
- A requisition is put on hold while a seat fills: the compare-and-swap leaves the hold in place.

Feature parity: n/a — port; parity is tracked against the port spec in `hiring.md`.

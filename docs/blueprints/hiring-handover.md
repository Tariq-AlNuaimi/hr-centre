# Blueprint — Hiring slice 8: pre-boarding, the hand-off to JML, and the employee record

Part of `docs/blueprints/hiring.md`. Ports Interview Hub steps 14–15 (`/candidates/[id]/preboarding`,
`lib/services/handover.ts`) onto HR Centre's own onboarding: at OFFER_ACCEPTED Hiring creates the
PRE_JOINER core employee through `lib/people/write.ts` and opens a draft JOIN case with JML's
`openJoinCase` (ADR-082 D8). Interview Hub's onboarding templates and tasks are deliberately not
ported (operator brief): JML is the onboarding system.

Scope: app/api/hiring/candidates/**, app/api/hiring/offers/**, app/[locale]/(dashboard)/hiring/**, app/[locale]/(dashboard)/people/[id]/page.tsx, components/hiring/**, components/people/RecordTabs.tsx, lib/hiring/**, lib/validations/hiring/**

## Stories

- As HR, when I record an offer acceptance (or move a candidate to Offer accepted on the rail),
  the hire appears on People as a pre-joiner and an onboarding draft opens in JML with the start
  date, probation, job title, company, department, contract type, contact details and the
  offered basic salary already filled in.
- As the recruiter, I clear the pre-boarding checklist (signed offer, package evidence confirmed
  or declined, national ID, joining date) and record the handover to an HR colleague — or record
  that I keep the hire.
- As anyone reading a person's record with hiring rights, I see how they were hired.

## Scenarios

Happy: the acceptance is recorded → toast "Pre-joiner record created and onboarding draft
opened" → People shows the pre-joiner → the JML joiner draft carries the planned start → the
recruiter (an HR manager) records the handover to an HR specialist with a note → the candidate
moves to Pre-onboarding.

Worst:

- The hand-off fails (no requisition, JML refuses, a race) → the acceptance still stands; the
  reply and a warning toast say why; Pre-boarding offers "Create pre-joiner and open onboarding".
- Acceptance recorded twice, or the rail and the form both reach Offer accepted → one employee
  (`employeeId` CAS) and one case (`sourceRef = hiring:<candidateId>`).
- The candidate withdraws or is rejected after accepting → the JML draft is discarded (an active
  onboarding is cancelled with its open work); the pre-joiner record stays for HR.
- D5: a declined package clears the package item (Interview Hub blocked step 14 forever).
- The requisition has no owner → handover refused (NO_OWNER), fail closed.
- A transfer to the recruiter themselves, or without a note → refused with a sentence.
- A viewer without hiring rights on the requisition never sees the record's Hiring tab.

## Architecture

- `lib/hiring/prejoiner.ts` (`handToJml`, `withdrawFromJml`) called from `afterStageChange`, so
  every path to OFFER_ACCEPTED (acceptance form, stage rail, comparison) hands off.
- `lib/hiring/preboarding.ts` (+ pure `preboarding-rules.ts`), route
  `/api/hiring/candidates/[id]/preboarding` (GET view; POST record | handoff).
- `lib/hiring/employee-tab.ts` + `components/hiring/EmployeeHiringTab.tsx`; `RecordTabs` gains
  "hiring". The sidebar shows every Hiring screen (the build-time live list is gone).

## Changes from Interview Hub

- Onboarding templates/tasks → JML's joiner case (operator decision).
- D4 already fixed in slice 5; D5 fixed here.
- The handover moves the candidate to Pre-onboarding; Interview Hub left the stage alone.

## Open questions

- HIRED is still set on the hiring rail; JML's day-one activation does not move the candidate
  (a later join between the two modules if HR wants it automatic).

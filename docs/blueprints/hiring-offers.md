# Blueprint — Hiring slice 5: offers, approvals, close-out

Part of `docs/blueprints/hiring.md` (the module contract; ACs AC5.1–AC5.3 live there). This file
records what slice 5 builds and how it was verified. The package request / decline / confirm /
reopen and payslip evidence (AC5.3) shipped with slice 3.

Scope: app/api/hiring/offers/**, app/api/hiring/close-out/**, app/api/hiring/candidates/**, app/api/hiring/settings/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**

## Stories

- As HR, once the decision is made I draft the offer: basic, each allowance, start date and
  terms. I see the approval chain the TOTAL monthly pay will route to — the COO joins at or above
  the threshold — and submit it.
- As an approver (HR Manager, Operations Director, COO …) I see the package, the band verdict and
  a "before you approve" checklist, and approve, send back or reject the step routed to me.
- As HR, I send the approved offer (the letter is a PDF I preview and send myself), log the
  negotiation, send a revised offer — which restarts approval only when the pay moves — and
  record the acceptance with the signed letter.
- As HR, I work the close-out queue: everyone not selected, with their notice ready, held (while
  another finalist's offer is open) or sent; I copy the routed notice, send it from my own mailbox
  and mark it sent.

## Scenarios

Happy: preferred candidate at Decision pending, package confirmed → offer drafted (candidate →
Offer drafted) at 2,000 basic + 600 housing → chain HR Manager → Operations Director → COO (total
2,600 ≥ 2,500) → three different people approve → sent (v1 recorded, candidate → Offer extended)
→ start date revised (v2, approvals stand) → acceptance on the offered start date → candidate →
Offer accepted, held notices on the requisition released, seat counted.

Worst:

- The submitter tries to approve → refused (segregation of duties). The person who approved step
  1 tries step 2 → refused (D17 — Interview Hub had this for requisitions only). The referrer is
  never routed and cannot decide.
- An offer is drafted for a candidate whose package evidence isn't settled → refused with the
  package gate's reason; nothing is created.
- A second offer for the same candidate → 409 with a link-back message.
- A sent offer's pay is revised → the offer goes back to Pending approval with a fresh chain and
  the old approvals cleared; the version history keeps both.
- The joining date differs from the offered start date → 409, "send a revised offer first".
- Someone without compensation access opens the offer → they see "Restricted", never figures; the
  letter, signed letter, negotiation thread and versions' terms are withheld.
- The hiring encryption key is missing → pay can't be written (503 with a sentence) and existing
  pay reads as "can't be read right now", while the rest of the offer works.
- Blob storage isn't configured → the signed-letter upload says so (503), everything else works.

## Architecture

- `lib/hiring/offer-rules.ts` (status machine, frozen fields, decision refusal incl. D17),
  `offer-package.ts` (breakdown, band verdict, revision diff, version summaries) — pure.
- `lib/hiring/offers.ts` — scoped load (HR, or an approver on the offer), `offerJson` — THE pay
  seam, which throws if a figure would reach a non-comp reader — list, detail.
- `offer-write.ts` (create = move to Offer drafted; update / submit / send; delete),
  `offer-approvals.ts` (chain view, decision, preview), `offer-versions.ts` (sealed versions,
  revision), `negotiations.ts`, `offer-acceptance.ts` (D4, signed letter in private blob storage),
  `offer-letter.tsx` (PDF, ADR-084), `close-out.ts`.
- Pay is sealed with the hiring comp key (ADR-080): offer salary / allowances, version terms and
  negotiated salary, each bound to its row and field.
- No migration: the slice-1 data model already has offers, approvals, versions and notes.

## Changes from Interview Hub

- D4: acceptance moves the candidate to Offer accepted (not straight to pre-onboarding), so the
  acceptance side effects run (held notices released, seat counted). Pre-onboarding is the
  handover (slice 8).
- D11: the letter states the basic as monthly and lists each allowance and the total.
- D17: nobody approves two steps of the same offer.
- Drafting an offer IS the move to Offer drafted, so the stage and package gates apply (Interview
  Hub created offers with no gate and took an unchecked position id). Sending moves the candidate
  to Offer extended. A candidate has at most one live offer.
- The revision dialog edits each allowance (Interview Hub collapsed them into one "allowances
  total" line, losing the breakdown).
- Sending back or rejecting requires a reason. Deleting is limited to offers never sent, or
  withdrawn / declined; deletion is soft.
- The close-out queue sends nothing (Interview Hub's last version could email). HR copies the
  routed notice text; the hold rule is unchanged.
- No e-signature integration (Interview Hub had none either): the signed letter is uploaded to
  private storage and opened through a five-minute signed link.

## Open questions

- None blocking. The PRE_JOINER employee and the JML joiner case at acceptance are slice 8.

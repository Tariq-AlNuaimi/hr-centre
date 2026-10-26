# ADR-078 — ID document numbers in the core record supersede Onboarding §17.1

**Status:** 🟢 Accepted — operator decision 2026-10-26 (foundation F-b; JML brief).
**Date:** 2026-10-27
**Related:** foundation blueprint §2 (F-b), ADR-067; `docs/blueprints/jml.md` D5.

## Context

The HR Onboarding artifact §17.1 / BR-014 / AC-CASE-011 forbade the system from storing civil ID
or passport numbers, bank details, files or email bodies, and a contract test enforced it. HR
Centre's foundation (F-b) stores civil ID and passport numbers in the core employee record,
AES-GCM encrypted under `ID_ENCRYPTION_KEY`, visible only with `people.viewIdDocuments`.

## Decision

For HR Centre the operator's F-b decision supersedes §17.1 as far as **ID numbers in the core
record** are concerned. The JML module itself still never collects them: the joiner form has no
ID-number field and the onboarding checklist keeps tracking receipt only ("Receive Civil ID where
applicable", "Receive passport"). **Bank details, document files and email bodies stay banned**
in JML; a JML contract test keeps that ban for the `jml_*` / `leave_*` tables.

## Consequences

HR records ID numbers on the employee record (People), under the existing field-level gate.

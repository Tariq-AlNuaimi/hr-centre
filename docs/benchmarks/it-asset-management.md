# Benchmark — IT asset management (ITAM)

**Refreshed:** 2026-07-17
**Owner:** Tariq Al-Naaimi
**Context:** Parity matrix for the Phase-2 pilot category (the Asset Tracker, V2-210). Produced by
`/benchmark`; feeds the full-track `/blueprint`'s Feature-Parity section (V2-202). Every row is
sourced; the OSS anchor is **Snipe-IT** (`grokability/snipe-it`), whose asset model was mined for
the real feature list rather than a marketing page, cross-checked against **GLPI**
(`glpi-project/glpi`) and two commercial suites.

> **What "mined" means here.** Snipe-IT's baseline is read from its own data model — Assets carry an
> **Asset Tag** (unique identifier) and belong to a **Model**, which rolls up to **Category** +
> **Manufacturer** + **Supplier**; **Status Labels** are a first-class object (deployable / pending /
> archived / undeployable meta-states, e.g. "Ready to Deploy", "Awaiting Re-Imaging"); **Checkout /
> Checkin** moves an asset in/out of a user/location/asset's possession; **Depreciation** is computed
> from purchase date + cost + a named depreciation schedule on the Model; **Custom Fields** attach via
> Fieldsets. That is the source of truth for the table-stakes rows below, not the product page.

---

## Products benchmarked

| Product             | Type              | Source mined                                                                     |
| ------------------- | ----------------- | -------------------------------------------------------------------------------- |
| **Snipe-IT**        | OSS (primary)     | `grokability/snipe-it` — asset/model/status-label/checkout schema + docs wiki    |
| **GLPI**            | OSS               | `glpi-project/glpi` — asset inventory + CMDB + ITIL service-desk feature set     |
| **ServiceNow ITAM** | Commercial (ent.) | product docs — HAM/SAM lifecycle, Discovery + CMDB, contract management          |
| **Asset Panda**     | Commercial (SMB)  | product docs — configurable asset records, mobile/barcode scanning, custom flows |

---

## Table-stakes (everyone has it — the MUST-build baseline)

| #   | Feature                                       | What it means                                                                                                     | Sourced from                                                                                        |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T1  | **Unique asset tag / ID**                     | Each asset carries a unique, human-usable identifier (asset tag) distinct from the DB primary key.                | Snipe-IT Asset Tag (unique per asset); GLPI inventory IDs; Asset Panda asset IDs                    |
| T2  | **Model → Category → Manufacturer hierarchy** | Assets are instances of a Model; Models roll up to a Category and a Manufacturer for standardized specs/defaults. | Snipe-IT Category/Manufacturer/Model/Supplier; GLPI item types + manufacturers                      |
| T3  | **Status / state labels**                     | First-class lifecycle states (e.g. deployed, ready to deploy, archived, pending) — not a free-text field.         | Snipe-IT Status Labels (deployable/pending/archived/undeployable meta); ServiceNow lifecycle stages |
| T4  | **Assignee / location tracking**              | An asset is assigned to a user, a location, or another asset ("assigned to").                                     | Snipe-IT checkout target (user/location/asset); GLPI locations + users                              |
| T5  | **Check-out / check-in workflow**             | Move an asset into/out of someone's possession; the current holder is always known.                               | Snipe-IT Checkout/Checkin (optional EULA + acceptance); Asset Panda check-in/out                    |
| T6  | **Purchase & warranty / financial fields**    | Purchase date, cost, supplier, warranty expiry captured per asset.                                                | Snipe-IT purchase date/cost/warranty; ServiceNow acquisition stage; GLPI financial info             |
| T7  | **Depreciation**                              | Book value computed from purchase cost + date against a named depreciation schedule.                              | Snipe-IT Depreciation (Settings → Depreciation, attached on Model); ServiceNow financial mgmt       |
| T8  | **Full audit / activity history**             | Every assignment, status change, and check-in/out is logged and viewable per asset.                               | Snipe-IT action log (every asset action logged); GLPI historical logs                               |
| T9  | **Custom fields**                             | Admins add category-specific attributes the base schema doesn't cover.                                            | Snipe-IT Custom Fields via Fieldsets; Asset Panda fully configurable records                        |
| T10 | **Search + filter + list export**             | Filterable asset list with CSV/Excel export.                                                                      | Snipe-IT list filters + export; GLPI search engine; Asset Panda exports                             |
| T11 | **Bulk import (CSV)**                         | Seed/maintain the register by importing assets in bulk.                                                           | Snipe-IT CSV importer; GLPI import; Asset Panda import                                              |
| T12 | **Role-based access**                         | Admin vs limited/read-only users; not everyone can edit the register.                                             | Snipe-IT permissions/groups; GLPI profiles; ServiceNow roles                                        |

## Differentiators (only some have it — candidate wedges, not baseline)

| #   | Feature                                            | Why it's a wedge                                                                   | Sourced from                                                                                      |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| D1  | **Barcode / QR label generation & scanning**       | Print QR/UPC labels from the record; scan to look up. Strong in field-heavy shops. | Snipe-IT QR/barcode label generation; Asset Panda mobile barcode scanning                         |
| D2  | **Automated network discovery / agent inventory**  | Agents auto-populate hardware/software instead of manual entry.                    | GLPI Agent / OCS inventory; ServiceNow Discovery                                                  |
| D3  | **CMDB with CI relationship mapping**              | Assets modeled as configuration items with dependency/impact graphs.               | GLPI CMDB; ServiceNow CMDB integration                                                            |
| D4  | **Software license & entitlement management**      | Track license packs, seats, expiry alerts, and reconcile against installs.         | Snipe-IT Licenses (multi-pack + expiry email alerts); GLPI license/software audit; ServiceNow SAM |
| D5  | **Accessories / components / consumables**         | Secondary inventory (cables, RAM, toner) with their own checkout/stock semantics.  | Snipe-IT Accessories/Components/Consumables ("Secondary Assets"); GLPI consumables                |
| D6  | **Contract & vendor renewal management**           | Track contracts, renewal dates, and audit-threshold alerts alongside assets.       | ServiceNow contract management; GLPI contracts                                                    |
| D7  | **Maintenance / repair records**                   | Log maintenances (repairs, upgrades) against an asset with cost + dates.           | Snipe-IT Maintenances; GLPI interventions                                                         |
| D8  | **Requestable assets / self-service**              | End users request assets/consumables through a portal; admins approve.             | Snipe-IT requestable assets (GH #6520); ServiceNow request catalog                                |
| D9  | **Depreciation reporting & book-value dashboards** | Roll depreciation up into fleet-value reports, not just per-asset.                 | ServiceNow financial reporting; Snipe-IT depreciation report                                      |

## Anti-features (mature products deliberately do NOT build — scope guardrails)

| #   | Not built                                                      | Who refuses it & why                                                                                                                                                 | Sourced from                                                              |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A1  | **Ticketing / help desk**                                      | Snipe-IT is deliberately a **pure asset register — no ticketing, no service desk**; that is GLPI/ServiceNow territory. Don't bolt a help desk onto an asset tracker. | Snipe-IT stated scope (asset tracking, not ITSM); contrast GLPI ITIL desk |
| A2  | **Full ITIL service management (incident/problem/change/SLA)** | Only the heavy suites take this on; it is a separate product, not an asset-tracker feature.                                                                          | GLPI/ServiceNow have it; Snipe-IT/Asset Panda intentionally don't         |
| A3  | **Endpoint monitoring / MDM / remote control**                 | Asset registers track the record, not live device management (patching, remote wipe) — that's an MDM/RMM.                                                            | Absent from Snipe-IT & GLPI core asset scope by design                    |
| A4  | **Financial ledger / accounting system**                       | Depreciation is tracked for reporting, but these tools are **not** general-ledger accounting — they hand book values to finance, they don't replace it.              | ServiceNow/Snipe-IT compute depreciation for reporting only               |
| A5  | **Procurement / PO approval workflow engine**                  | Purchase fields are recorded; a full requisition-to-PO approval chain is ERP scope, not ITAM.                                                                        | Purchase data captured, not procurement workflow, across all four         |

---

## How this maps to the template (Asset Tracker pilot, V2-210)

- **T1–T12 are the `/blueprint` user-story baseline** — the Asset Tracker's full-track blueprint must
  trace a story (or an explicit "out of scope + why") against each table-stakes row. A missing T-row is
  a parity gap surfaced at spec time, not UAT.
- **Model → Category → Manufacturer (T2)** maps to Prisma models via `/scaffold-entity` (`--relations`);
  **Status Labels (T3)** map to a `status` enum; **audit history (T8)** is already automatic via
  `auditExtension`; **check-in/out (T5)** is a state transition + audit row.
- **Differentiators are `/scale-up` candidates**, not floor: barcode (D1), discovery agents (D2), and
  CMDB (D3) are deliberately deferred unless a fork asks. **Anti-features A1–A5 are the guardrails** —
  do not grow the pilot into a help desk or an MDM.

---

## Sources

- Snipe-IT (OSS, primary): [github.com/grokability/snipe-it](https://github.com/grokability/snipe-it) ·
  [snipeitapp.com/product](https://snipeitapp.com/product) ·
  [managing assets](https://snipe-it.readme.io/docs/managing-assets) ·
  [asset models & relationships](https://deepwiki.com/grokability/snipe-it/2.3-asset-models-and-relationships) ·
  [accessories & components](https://deepwiki.com/grokability/snipe-it/3.2-accessories-and-components) ·
  [requestable assets #6520](https://github.com/grokability/snipe-it/issues/6520)
- GLPI (OSS): [github.com/glpi-project/glpi](https://github.com/glpi-project/glpi) ·
  [glpi-project.org/en/features](https://www.glpi-project.org/en/features/) ·
  [glpi-project.org/en/cmdb-software](https://www.glpi-project.org/en/cmdb-software/)
- ServiceNow ITAM: [servicenow.com/products/it-asset-management](https://www.servicenow.com/products/it-asset-management.html)
- Asset Panda: [capterra.com/p/150016/Snipe-IT](https://www.capterra.com/p/150016/Snipe-IT/) (comparative) ·
  product configurable-record + mobile-scanning docs

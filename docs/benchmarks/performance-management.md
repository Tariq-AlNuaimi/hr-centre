# Benchmark — Performance management

Refreshed: 2026-10-22

**Products:** Lattice (Performance + Goals + Grow/1:1s + Engagement + Compensation) · Culture Amp (Perform + Engage) · 15Five (Perform + Compensation) · **OSS mined from source:** Frappe HRMS `github.com/frappe/hrms` (HEAD `862c653`, 2026-10-22) — Appraisal Cycle / Appraisal / Appraisal Template / KRA / Goal / Employee Performance Feedback doctypes; Odoo — `hr_appraisal` is **Enterprise-only** (absent from `odoo/odoo@18.0/addons/`: `addons/hr_appraisal/__manifest__.py` → HTTP 404, while `addons/hr` and `addons/hr_skills` → 200); OCA community substitute `github.com/OCA/hr` branch 18.0 `hr_appraisal_oca` (v18.0.1.2.0, AGPL-3; not present on 17.0 branch).

Method: vendor help-centre pages (fetched or search-extracted) for commercial products; source read for OSS. Pricing/marketing claims and anything not seen in a primary source are marked "unverified".

---

## A. Product snapshots

**Lattice.** Full people suite. Review cycles (self/manager/peer/upward) with rating questions; calibration in a table view + "box view" (2 questions on x/y axes = 9-box), filters by manager/department/custom field, drag-to-recalibrate, bulk-accept manager ratings; talent reviews kept separate and never shared with reviewee [L1]. Goals/OKRs with cascading parent alignment and optional custom-weighted key results [L2][L3]. Compensation cycles pull a _completed_ review cycle's rating question (or weighted score) into raise guidance [L4]. Comp access via custom roles (global / targeted subset / cycle-scoped) plus separate per-field visibility (Base Pay, Variable Pay, Bonus Plan, Equity, Pay Zone) [L5]. Manager graph owned by HRIS — manager changes must be made in HRIS and arrive on next sync [L6].

**Culture Amp.** Engagement-survey heritage + Perform. Calibration Views bring reviews, self-reflections, goals, peer/upward feedback into one grid; compare up to 3 past cycles; "Ratings Preview" pre-session task for calibrators; ratings distribution chart + "Ratings Matrix"; admins edit by dropdown or bulk CSV; scoped admins limited to their demographic scope; **View Activity log records who changed which rating, when, via which path** (from Nov 2025); original rating stays visible [C1]. Goals at individual/team/department/company level, 1-on-1s, anytime feedback, shoutouts, engagement surveys via email/Teams/Slack [C2]. HRIS sync via Merge with manager ID/name/email auto-mapped; imports blocked when a manager isn't in the employee list [C3].

**15Five.** Manager-enablement framing. "Best-Self Review" = self/manager/peer/upward (≥1 required); question templates (default or custom) with optional competency, Manager Effectiveness and Private Manager Assessment (hidden from employee); Performance Ratings+ = formula + rubric producing a rating; calibration sessions after manager deadline, locked by a calibrations deadline; results feed Talent Matrix (9-box); nudges, extensions, Lifecycle (auto) reviews; results not auto-shared; writer side-panel shows check-ins, High Fives, past reviews [F1][F2]. Weekly Check-ins, 1-on-1 agendas, High Fives recognition [F3]. 15Five Compensation "powered by Comprehensive": pay ranges, Unified Compensation Reviews using performance data [F4]. HRIS Connector: one active HRIS, daily sync 01:00 UTC, inactive employees excluded, arbitrary fields as custom attributes; Merge underneath [F5][F6].

**Frappe HRMS (OSS).** Appraisal Cycle (dates, company/branch/dept/designation filters → "Get Employees" → Appraisee child rows each with a template; status Not Started/In Progress/Completed; KRA evaluation "Automated Based on Goal Progress" or "Manual"; optional Python `final_score_formula`) [O1]. Appraisal (submittable) holds weighted KRA rows (`per_weightage`, `goal_completion`, `goal_score`), self-rating rows, reflections, `total_score`/`self_score`/`avg_feedback_score`/`final_score` [O2]. Default final score = mean of goal, self, feedback scores; else `frappe.safe_eval` of the cycle formula over cycle+employee+appraisal fields [O3]. Goal is a nested-set tree (`is_tree`, `parent_goal`) — parent progress = AVG of non-archived children [O4]. Employee Performance Feedback (submittable) = reviewer → employee with weighted criteria ratings; self-review blocked [O5]. **No calibration, no distribution curve, no comp linkage, no anonymity.**

**OCA `hr_appraisal_oca` (Odoo CE).** Minimal: `hr.appraisal` with employee + manager_ids, HTML employee/manager feedback (from template), per-side "published" toggles, `visibility` all/managers-only, state To Confirm → Confirmed → Done, tags, mail.thread tracking + activities, request wizard; record rules for user vs HR officer + multi-company [O6]. No ratings, goals, 360, or calibration.

---

## B. Parity matrix

### Table-stakes

| Capability                                      | Lattice                              | Culture Amp                       | 15Five                                  | OSS (Frappe / OCA)                                                                            | Source                 |
| ----------------------------------------------- | ------------------------------------ | --------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- |
| Cycle with participant selection by org filters | Yes                                  | Yes                               | Yes (manual or Lifecycle auto)          | Frappe: cycle filters → Appraisee rows. OCA: per-employee request only                        | L1, C1, F1, O1, O6     |
| Templates / question sets                       | Yes                                  | Yes                               | Default or custom templates             | Frappe: Appraisal Template (KRA weights + rating criteria). OCA: HTML templates               | F1, O1, O6             |
| Self + manager review                           | Yes                                  | Yes                               | Yes                                     | Frappe: self_ratings + reflections; manager via KRA scoring. OCA: two HTML fields             | F1, O2, O6             |
| Peer / upward (360)                             | Yes                                  | Yes (peer + upward feedback)      | Yes                                     | Frappe: Employee Performance Feedback (any reviewer). OCA: none (Odoo EE has 360 via Surveys) | L7, C1, F1, O5, O7     |
| Goals with weights + progress roll-up           | Cascading goals, custom-weighted KRs | Individual→company goals          | Objectives (weights unverified)         | Frappe: KRA % weight + goal tree AVG roll-up                                                  | L2, L3, C2, F2, O2, O4 |
| Overall score formula                           | Weighted score option                | Average rating column             | Ratings+ formula + rubric               | Frappe: mean or Python formula                                                                | L4, C1, F1, O3         |
| Deadlines, nudges, phases                       | Phases (e.g. peer selection)         | Cycle deadlines                   | Milestones, nudges, extend              | Frappe: cycle dates + "employees without goals/feedback" counters; OCA: mail activities       | L7, F1, F2, O1, O6     |
| Role-based visibility of results                | Per-deliverable settings             | Full vs limited by relationship   | Role-based; not auto-shared; PMA hidden | Frappe: role perms only. OCA: publish toggles + visibility                                    | L1, C1, F1, O1, O6     |
| HRIS-owned manager graph                        | HRIS sync, manager edits blocked     | Merge, manager fields auto-mapped | HRIS Connector daily                    | Native (same DB as Employee)                                                                  | L6, C3, F5             |
| Rating-change audit trail                       | unverified                           | View Activity log (who/what/when) | unverified                              | OCA: mail tracking on state/publish; Frappe: submit/amend + version log (framework)           | C1, O6                 |

### Differentiators

| Capability                               | Lattice                                                  | Culture Amp                            | 15Five                                | OSS (Frappe / OCA)             | Source         |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------- | ------------------------------------- | ------------------------------ | -------------- |
| Calibration grid + 9-box drag            | Box view, 2 axes, ≤250 reviewees, labels, distribution % | Ratings Matrix + distribution chart    | Talent Matrix (9-box)                 | None                           | L1, C1, F1     |
| Distribution targets (forced curve)      | Shows % per box; targets unverified                      | Distribution chart; targets unverified | unverified                            | None                           | L1, C1         |
| Pre-calibration ratings preview          | No evidence                                              | Ratings Preview task                   | No evidence                           | None                           | C1             |
| Historic-cycle comparison in calibration | Pre vs calibrated score                                  | Up to 3 past cycles                    | unverified                            | None                           | L1, C1         |
| Pay ↔ performance linkage                | Comp cycle imports ended review ratings → raise guidance | Not native (unverified)                | 15Five Compensation (Comprehensive)   | None (Frappe payroll separate) | L4, F4         |
| Field-level comp permissions             | Custom roles + per-field visibility                      | n/a                                    | unverified                            | None                           | L5             |
| Continuous signals feed review           | Updates, 1:1s                                            | Anytime feedback, shoutouts            | Check-ins, High Fives in writer panel | None                           | L8, C2, F1, F3 |
| Bundled engagement surveys               | Lattice Engagement                                       | Core product                           | Engage (unverified detail)            | None                           | L8, C2         |
| Talent review separate from perf review  | Yes, never shared                                        | unverified                             | Talent Matrix                         | None                           | L1             |
| Pluggable score formula                  | No evidence                                              | No                                     | Ratings+ formula                      | Frappe: arbitrary Python expr  | F1, O3         |

### Anti-features (avoid)

| Anti-feature                                     | Lattice                                                             | Culture Amp                                       | 15Five     | OSS (Frappe / OCA)                                                                                                             | Source         |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Reviewer identity exposed to employee by default | Hidden during cycle; names shown only if deliverable setting allows | Admins can delete inappropriate feedback          | PMA hidden | Frappe: `get_feedback_history` returns `reviewer_name`/`reviewer_designation` to anyone with Appraisal read — **no anonymity** | L7, C4, F1, O8 |
| Audit lost on publish                            | —                                                                   | After publish only final change per question kept | —          | —                                                                                                                              | C1             |
| Editing manager in perf tool when HRIS-synced    | Blocked by design (good)                                            | Import blocked on orphan manager (good)           | —          | —                                                                                                                              | L6, C3         |
| Comp visible without explicit field grant        | Requires separate field-visibility step (good)                      | —                                                 | —          | Frappe/OCA: no comp in appraisal (n/a)                                                                                         | L5             |
| Unsafe eval of admin-entered formula             | —                                                                   | —                                                 | —          | Frappe uses `sanitize_expression` + `safe_eval`; still code-in-config                                                          | O3             |

---

## C. Look & feel

- **Employee view.** All three put "my review tasks" + goals front and centre; 15Five pairs the review writer with a resources panel (check-ins, High Fives, past reviews, career path) so writing is evidence-led [F1]. Culture Amp employee nav: Goals, 1-on-1s, Feedback, Surveys menus [C2].
- **Manager view.** Direct reports list with review status; Culture Amp grants direct and skip-level managers "full access" profiles (history, feedback, self-reflections) vs "limited" for peers [C1].
- **HR/admin view.** Lattice admin path Admin > Performance > Reviews > cycle > Calibrate Ratings > group > Box view [L1]; settings under Admin > Settings > People/Platform [L5][L6].
- **Calibration UI.** Two modes everywhere: dense **table** (pre vs calibrated score, flag, notes, average, demographics columns) and **grid** (avatar chips on a 3×3 with per-box %, renameable labels, side context panel with review packet/notes/tags) [L1][C1]. Culture Amp shares read-only views with filters; CSV export [C1].
- **Visual language.** Culture Amp publishes its design system **Kaizen** (`github.com/cultureamp/kaizen-design-system`, React, MIT; docs cultureamp.design; tokens `@kaizen/design-tokens`) [C5]. Lattice/15Five: light, white-card SaaS layouts with a single brand accent (from product screenshots — unverified as a documented system).
- **OSS.** Frappe = Desk forms (child tables for KRAs/ratings, star `Rating` field, cycle summary counters) — dense, admin-centric; OCA = standard Odoo form + kanban, chatter, colour tags [O1][O6].

---

## D. How it is built

**Data model (consensus).**

```
Cycle ──< Participant(employee, template, reviewer set) ──< Review(type: self|manager|peer|upward, status, submitted_at)
                                                              └──< Response(question_id, rating, text)
Cycle ──< CalibrationGroup ──< CalibratedRating(pre, post, changed_by, at, note)
Goal (tree, owner, weight, progress, period) — separate aggregate, linked to cycle by period/cycle_id
CompCycle ── reads ended Cycle's rating question / weighted score (read-only snapshot)
```

- Frappe concretely: `hrms/hr/doctype/appraisal_cycle/appraisal_cycle.json` (cycle + `appraisees` Table→`appraisee`), `appraisal/appraisal.json` (submittable; `appraisal_kra`, `goals`, `self_ratings` child tables; `amended_from` = immutable-submit + amend versioning), `appraisal_template/appraisal_template.json` (`goals`→`appraisal_template_goal{key_result_area, per_weightage}`, `rating_criteria`→`employee_feedback_rating{criteria, per_weightage, rating}`), `goal/goal.json` (`is_tree`, `lft/rgt`, `parent_goal`, `kra`, `appraisal_cycle`), `employee_performance_feedback/employee_performance_feedback.json` (submittable, `reviewer`, `feedback_ratings`) [O1–O5].
- Goals are a separate aggregate in every product; reviews _reference_ them (Culture Amp calibration pulls goals in; Frappe pushes goal progress into Appraisal KRA via `goal.py:update_goal_progress_in_appraisal`) [C1][O4].
- Cycle lifecycle guards: Frappe `appraisal_cycle.py:complete_cycle` throws on unsubmitted appraisals; `validate_evaluation_method_change` blocks switching method once appraisals exist [O1].

**HRIS sync pattern (the key lesson).**

- SaaS tools **do not own** the employee/manager graph. Culture Amp and 15Five use **Merge** unified HRIS API; Culture Amp auto-maps Manager ID/Name/Email and matches manager by work email; auto-sync off by default, then daily [C3]; 15Five one connector, daily 01:00 UTC, inactive excluded, custom attributes [F5][F6]. Lattice: native HRIS connectors + SFTP; manager is read-only in Lattice when HRIS-synced [L6].
- Failure mode they all guard: orphan manager references → import rejected, not silently flattened [C3].
- Frappe/Odoo avoid the problem by living in the HRIS DB (Appraisal links `Employee`; OCA `manager_ids` defaults from `employee.parent_id` — unverified exact default).

**Permissions on sensitive data.**

- Ratings: relationship-scoped (self / direct / skip-level / scoped admin / calibrator) [C1]; calibrators edit, participants view [L1]; talent scores never to reviewee [L1].
- Comp: separate role + **field-level** grants, targeted subsets, cycle-scoped admins; shared statements irrevocable [L5].
- Frappe: role-level DocPerms in JSON (Employee has write on Appraisal and Feedback) + per-site User Permissions on Employee for row scoping; `goal.py:validate_goal_access` checks own-goal or HR role; `get_appraisal_cycle_summary` does `frappe.has_permission` [O1][O4]. OCA: `ir.rule` user vs HR officer + multi-company `security/hr_appraisal_security.xml` [O6].

**Comp/payroll integration.** Lattice and 15Five compute raise guidance inside the suite and export/sync outward (payroll write-back unverified) [L4][F4]. No OSS appraisal module links to salary.

---

## E. Implications for Rihal Performance app

1. **Odoo is the HRIS — sync, don't own.** Replace Excel import with a scheduled pull of Odoo `hr.employee` (incl. `parent_id` manager, department, company, `contract.wage` for basic salary) keyed on work email/employee ID; reject orphan-manager rows like Culture Amp, and make manager read-only in-app as Lattice does. Odoo CE has no `hr_appraisal`, so Rihal's app is not duplicating anything they already license (unless on EE — confirm).
2. **Keep goals separate from reviews.** Rihal's weighted KPIs + change requests map to Frappe's KRA-weight + goal-tree model; snapshot KPI weights into the review at year-end (Frappe `appraisal_kra`) so later change requests don't rewrite history.
3. **Calibration: add a 9-box/distribution grid alongside the table**, showing actual vs target bell-curve % per bucket (target enforcement is Rihal's differentiator — none of the three document a hard forced curve; verify before claiming).
4. **Audit every rating change** (pre, post, actor, timestamp, reason/note) and keep it after publish — Culture Amp's post-publish truncation is the anti-pattern to avoid.
5. **Bonus = read-only snapshot of a closed, calibrated cycle** (Lattice pattern), with basic salary field-gated to HR/Finance roles — salary must not reach managers or calibrators by default.
6. **360 anonymity threshold**: hide peer identity and suppress aggregates below N (e.g. 3) responses; Frappe's reviewer-name exposure is the anti-feature.
7. **Score formula as configured data, not code** — Rihal's strategy/department weighting should be typed weights, not an eval'd expression (Frappe's `safe_eval` is a risk surface).
8. **Defer bundled extras** (engagement surveys, check-ins, recognition) — they are suite differentiators, not table-stakes for an annual-cycle tool.

---

## Sources

- [L1] https://help.lattice.com/hc/en-us/articles/8562633154455 (calibration box view)
- [L2] https://help.lattice.com/hc/en-us/articles/360061289693 (cascading goals); https://help.lattice.com/en-us/articles/16664537-change-the-parent-goal-of-a-key-result
- [L3] https://help.lattice.com/en-us/articles/16542761-set-custom-weighted-goals ; https://help.lattice.com/en-us/articles/15179450-understand-progress-calculation-in-lattice
- [L4] https://help.lattice.com/hc/en-us/articles/6498012907415 (comp cycle rules & ratings)
- [L5] https://help.lattice.com/en-us/articles/15179036-compensation-roles-and-permissions ; https://help.lattice.com/en-us/articles/15178928-launch-total-compensation-to-employees
- [L6] https://help.lattice.com/hc/en-us/articles/38339296912791-Unable-to-Update-an-Employee-s-Manager-When-Synced-With-HRIS
- [L7] https://help.lattice.com/en-us/articles/15178325-can-reviewees-see-a-list-of-their-peer-reviewers
- [L8] https://lattice.com/de/blog/introducing-lattice-engagement ; https://www.gartner.com/reviews/product/lattice (third-party)
- [C1] https://support.cultureamp.com/en/articles/10425688-create-and-share-calibration-views ; https://support.cultureamp.com/en/articles/11721269-calibrator-guide-understanding-your-role-in-a-calibration-view
- [C2] https://support.cultureamp.com/en/articles/7048506-how-to-navigate-culture-amp ; https://support.cultureamp.com/en/articles/8278542-getting-started-with-culture-amp-employees
- [C3] https://support.cultureamp.com/en/articles/9044649-how-to-sync-hris-data-from-adp-using-the-merge-api ; .../9323274-how-to-sync-hris-data-from-trinet-via-the-merge-api ; .../11664449-how-to-sync-hris-data-from-humaans-using-the-merge-api
- [C4] Culture Amp feedback deletion FAQ (search-extracted, support.cultureamp.com) — 360 anonymity threshold **unverified**
- [C5] https://storybook.js.org/showcase/culture-amp-kaizen ; https://www.npmjs.com/org/kaizen
- [F1] https://success.15five.com/hc/en-us/articles/360002700091-Reviews-Feature-Overview
- [F2] https://www.15five.com/blog/ensure-fair-and-consistent-performance-reviews-with-calibrations ; https://success.15five.com/hc/en-us/articles/37859328667931
- [F3] https://www.15five.com/products/perform
- [F4] https://www.15five.com/compensation ; https://www.15five.com/blog/introducing-15five-compensation-connecting-pay-and-performance-to-retain-top-talent
- [F5] https://success.15five.com/hc/en-us/articles/50988630109979 (HRIS Connector)
- [F6] https://merge.dev/case-studies/15five
- [O1] frappe/hrms `hrms/hr/doctype/appraisal_cycle/appraisal_cycle.{json,py}` (`complete_cycle`, `validate_evaluation_method_change`, `get_appraisal_cycle_summary`, `get_employees_without_feedback`)
- [O2] frappe/hrms `hrms/hr/doctype/appraisal/appraisal.json`, `appraisal_kra/appraisal_kra.json`, `appraisal_template/appraisal_template.json`, `appraisal_template_goal/…json`, `employee_feedback_rating/…json`
- [O3] frappe/hrms `hrms/hr/doctype/appraisal/appraisal.py:224` `calculate_final_score`
- [O4] frappe/hrms `hrms/hr/doctype/goal/goal.{json,py}` (`update_parent_progress` L128, `validate_goal_access` L231, `update_goal_progress_in_appraisal` L152)
- [O5] frappe/hrms `hrms/hr/doctype/employee_performance_feedback/employee_performance_feedback.{json,py}` (`validate_employee` L57)
- [O6] OCA/hr@18.0 `hr_appraisal_oca/__manifest__.py`, `models/hr_appraisal.py` (state L61, visibility L105), `security/hr_appraisal_security.xml`
- [O7] https://www.odoo.com/documentation/saas-18.3/applications/hr/appraisals/360.html (Odoo EE 360 via Surveys); `raw.githubusercontent.com/odoo/odoo/18.0/addons/hr_appraisal/__manifest__.py` → 404
- [O8] frappe/hrms `hrms/hr/doctype/appraisal/appraisal.py:309` `get_feedback_history` (returns reviewer_name/designation)

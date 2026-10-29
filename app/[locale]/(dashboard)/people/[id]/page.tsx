import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import {
  employeeDetailSelect,
  serializeEmployeeDetail,
  type EmployeeRecordView,
} from "@/lib/core/employee-select";
import { IdSection, JobSection, PersonalSection } from "@/components/people/EmployeeRecordSections";
import { RecordActions, type RecordActionsProps } from "@/components/people/RecordActions";
import { RecordHeader } from "@/components/people/RecordHeader";
import { EmployeeHistory } from "@/components/people/EmployeeHistory";
import { employeeHistory } from "@/lib/people/history";
import { recordView } from "@/components/people/record-view";
import { LoginPanel } from "@/components/people/LoginPanel";
import { RecordTabs, parseRecordTab, type RecordTab } from "@/components/people/RecordTabs";
import { EmployeeTickets } from "@/components/hive/TicketTaskPanels";
import { EmployeeJmlTab } from "@/components/jml/EmployeeJmlTab";
import { EmployeeHiringTab } from "@/components/hiring/EmployeeHiringTab";
import { employeeHiring, hiringTabVisible } from "@/lib/hiring/employee-tab";
import type { Session } from "next-auth";
import { canFor, jmlActor } from "@/lib/jml/access";
import { employeeJml, jmlTabVisible } from "@/lib/jml/employee-tab";
import { hasHivePermission } from "@/lib/hive/services/permissions";
import { recordFormValues } from "@/components/people/record-form-values";
import { actorCan, canActOnEmployee, canViewEmployee } from "@/lib/core/permissions";
import { placementOf } from "@/lib/rbac/resolve";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { departurePreview } from "@/lib/pms/departure";
import { isHrSuperAdmin } from "@/lib/core/permissions";
import { ThreeSixtyResultCard } from "@/components/pms/ThreeSixtyResultCard";
import { EmployeeDocuments } from "@/components/people/EmployeeDocuments";
import { listEmployeeDocuments } from "@/lib/core/documents/employee-documents";
import { canViewEvidence } from "@/lib/pms/evidence";
import type { UpdateEmployeeInput } from "@/lib/validations/employee";

/**
 * The record in the UPDATE schema's own vocabulary, for the hand-edit form.
 *
 * `PUT /api/employees/[id]` replaces the whole row, so the form must hold every
 * field whether it offers to change it or not. Building that snapshot here — in
 * the server component that already has the row — rather than letting the form
 * fetch it keeps one read, and typing it `UpdateEmployeeInput` means a field
 * added to the schema later is a build error here rather than a column silently
 * wiped on the next save.
 *
 * `dateOfJoining` and `lastWorkingDay` are cut back to the ISO calendar DAY the
 * schema accepts: both columns are dates, §11.4 pro-rates over days, and the
 * instant's time component is not information the form should round-trip.
 */
function toUpdateInput(employee: {
  name: string;
  email: string;
  dateOfJoining: Date | null;
  departmentId: string | null;
  team: { id: string } | null;
  entityId: string;
  managerId: string | null;
  roleTrack: string;
  status: string;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
  basicSalary: string | null;
}): UpdateEmployeeInput {
  return {
    name: employee.name,
    email: employee.email,
    dateOfJoining: employee.dateOfJoining?.toISOString().slice(0, 10) ?? null,
    departmentId: employee.departmentId,
    teamId: employee.team?.id ?? null,
    entityId: employee.entityId,
    managerId: employee.managerId,
    roleTrack: employee.roleTrack as UpdateEmployeeInput["roleTrack"],
    // F-c — the legacy field the PUT schema still carries; the route ignores
    // it (HR authority lives on role assignments now).
    basicSalary: employee.basicSalary,
    status: employee.status as UpdateEmployeeInput["status"],
    lastWorkingDay: employee.lastWorkingDay?.toISOString().slice(0, 10) ?? null,
    unpaidLeaveDays: employee.unpaidLeaveDays,
  };
}

type Actor = Awaited<ReturnType<typeof resolveActor>>;
type Subject = NonNullable<Awaited<ReturnType<typeof placementOf>>>;

/** F-b/F-c — the record-details edit, offered only where the actor may edit this person. */
function recordEdit(
  actor: Actor,
  subject: Subject,
  record: EmployeeRecordView,
): RecordActionsProps["record"] {
  if (!actorCan(actor, "people.edit", subject)) return null;
  return {
    initial: recordFormValues(record),
    canEditPersonal: actorCan(actor, "people.viewPersonal", subject),
    // A number the server key cannot open is not offered for editing: the
    // empty box would read as "none" and saving it would clear it.
    canEditIdDocuments:
      actorCan(actor, "people.viewIdDocuments", subject) && !record.idDocuments?.unavailable,
  };
}

/** F-d — the login panel, for whoever holds logins.manage for this person's scope. */
function loginPanel(actor: Actor, subject: Subject, employee: { id: string; name: string }) {
  if (!actorCan(actor, "logins.manage", subject)) return null;
  return (
    <div id="login">
      <LoginPanel employeeId={employee.id} name={employee.name} />
    </div>
  );
}

/**
 * §4.5 / §11.6 — the compensation block exists only when the viewer is
 * entitled to it. `basicSalary` is `undefined` exactly when the SELECT omitted
 * the ciphertext column; the page reads the server's decision, not re-making it.
 */
function compensationCard(t: (key: string) => string, basicSalary: string | null | undefined) {
  if (basicSalary === undefined) return null;
  return (
    <SectionCard title={t("detail.compensation")} subtitle={t("detail.compensationNote")}>
      <DescriptionList
        items={[
          {
            key: "basicSalary",
            label: t("basicSalary"),
            value:
              basicSalary === null ? (
                <span className="text-muted-foreground">{t("noSalaryOnFile")}</span>
              ) : (
                <span className="font-mono tabular-nums">{basicSalary}</span>
              ),
          },
        ]}
        columns={2}
      />
    </SectionCard>
  );
}

/**
 * One employee's record — spec §4.2 / §4.5. Detail archetype.
 *
 * A server component: the visibility check and the compensation `select` happen
 * before any markup exists, so an unauthorised viewer's browser never receives
 * the row at all. Doing this in a client component would mean shipping the data
 * and then choosing not to draw it.
 */
/**
 * HR tickets tab: only with `tickets.see` (company-wide by design). Without it
 * the tab is absent and its URL shows the overview — no question leaks.
 */
async function tabsFor(session: Session, employeeId: string, requested: RecordTab) {
  const hiddenTabs: RecordTab[] = [];
  if (!(await hasHivePermission(session.user.id, "seeTickets"))) hiddenTabs.push("tickets");
  // JML tab: only for someone who may see JML cases for this person's placement;
  // its data loads only when it is the open tab.
  const jml = await jmlActor(session);
  if (!(await jmlTabVisible(jml, employeeId))) hiddenTabs.push("jml");
  // Hiring tab: only when the person came through Hiring and the viewer may see that requisition.
  const hiringData = requested === "hiring" ? await employeeHiring(session, employeeId) : null;
  if (requested === "hiring" ? !hiringData : !(await hiringTabVisible(session, employeeId))) {
    hiddenTabs.push("hiring");
  }
  const tab: RecordTab = hiddenTabs.includes(requested) ? "overview" : requested;
  const jmlData = tab === "jml" ? await employeeJml(jml, employeeId) : null;
  return { tab, hiddenTabs, jmlData, hiringData };
}

/** A module's tab on the record (HR tickets, JML, Hiring) — each module renders its own. */
function ModuleTab({
  tab,
  jmlData,
  hiringData,
  employeeId,
  locale,
}: {
  tab: "tickets" | "jml" | "hiring";
  jmlData: Awaited<ReturnType<typeof employeeJml>>;
  hiringData: Awaited<ReturnType<typeof employeeHiring>>;
  employeeId: string;
  locale: string;
}) {
  if (tab === "hiring")
    return hiringData ? <EmployeeHiringTab data={hiringData} locale={locale} /> : null;
  if (tab === "jml") return jmlData ? <EmployeeJmlTab data={jmlData} locale={locale} /> : null;
  return <EmployeeTickets employeeId={employeeId} locale={locale} />;
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { locale, id } = await params;
  const requestedTab = parseRecordTab((await searchParams).tab);
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  const { tab, hiddenTabs, jmlData, hiringData } = await tabsFor(session, id, requestedTab);

  const t = await getTranslations("pms");
  const actor = await resolveActor(session);

  const descendants = await visibilityDescendants(actor);

  // 404 rather than 403, matching the API: a manager probing ids must not be
  // able to learn that someone exists outside their chain from the difference.
  if (!canViewEmployee(actor, id, descendants)) notFound();

  const subject = await placementOf(id);
  if (!subject) notFound();
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: employeeDetailSelect(actor, subject),
  });
  if (!employee) notFound();
  // F-c — what this actor may change HERE (scoped grants count for people.*).
  const canEditPerson = actorCan(actor, "people.edit", subject);
  // HR Centre F-b — the record groups the gated select returned (AC-F2.2/F2.3).
  const detail = serializeEmployeeDetail(employee);

  const canAct = canActOnEmployee(actor, { id: employee.id, managerId: employee.managerId });

  /*
    §4.5 / ADR-067 — compensation goes through the ONE serializer, as every
    other read path does. `serializeEmployee` opens the ciphertext only when the
    `select` above carried it, so the entitlement gate is still the query and
    this page is reading that decision rather than re-making it.

    `undefined` means "not entitled to see it"; `null` means "entitled, none on
    file". The two are different facts and the card below renders them
    differently.

    This page used to hand-roll the check as `"basicSalary" in employee` — a key
    `employeeSelect` has not returned since compensation moved to an encrypted
    envelope (it selects `basicSalaryEnc`). So the whole compensation block was
    dead: HR saw no salary on any individual record. It type-checked because
    `in` narrows on any key, and it was the only employee read in the app that
    skipped the serializer.
  */
  const basicSalary = detail.basicSalary;

  // R10 — the core-category tabs a viewer is not entitled to are absent (the
  // gated select already left their data out), and History is for whoever may
  // edit this person. An unentitled ?tab= shows the overview.
  // ADR-098 — Documents is the person's files from every module, so it shows
  // when any source is open to this viewer (ID documents, JML, Hiring, evidence).
  const documentsVisible =
    Boolean(detail.record.idDocuments) ||
    !hiddenTabs.includes("jml") ||
    !hiddenTabs.includes("hiring") ||
    canViewEvidence(actor, { id: employee.id, managerId: employee.managerId });
  const allHidden = [
    ...hiddenTabs,
    ...hiddenCoreTabs(detail, basicSalary, canEditPerson, documentsVisible),
  ];
  const shown: RecordTab = allHidden.includes(tab) ? "overview" : tab;
  const documents =
    shown === "documents"
      ? await listEmployeeDocuments(
          session,
          actor,
          { id: employee.id, managerId: employee.managerId },
          canEditPerson,
        )
      : null;
  const view = recordView(t, employee, detail.record.directorate, locale);

  // Joiner from the record (PRE_JOINER without a live onboarding) and a ticket
  // raised on the person's behalf (Drafters) — each route re-checks.
  const [canRaiseTicket, liveJoin] = await Promise.all([
    hasHivePermission(session.user.id, "draftEscalation"),
    employee.status === "PRE_JOINER"
      ? prisma.jmlCase.findFirst({
          where: { employeeId: employee.id, caseType: "JOIN", status: { not: "CANCELLED" } },
          select: { id: true },
        })
      : null,
  ]);

  const actions: RecordActionsProps = {
    employeeId: employee.id,
    employeeName: employee.name,
    // The `basicSalary !== undefined` guard is the type system's proof that the
    // snapshot carries a real salary rather than a hole: `PUT` replaces the
    // whole row, and a form that did not hold the salary would encrypt `null`
    // over payroll.
    core:
      canEditPerson && basicSalary !== undefined
        ? {
            initial: toUpdateInput({ ...employee, basicSalary }),
            managerName: employee.manager?.name ?? null,
          }
        : null,
    record: recordEdit(actor, subject, detail.record),
    links: recordLinks(actor, subject, employee, locale, canRaiseTicket),
    startJoiner:
      employee.status === "PRE_JOINER" && !liveJoin && canFor(actor, "jml.manageJoiners", subject),
    // UX review P0 (US-2) — a departure's PROCESS is a Joiners & leavers case;
    // recording it directly is only the HR Super Admin correction, with a reason.
    departure:
      isHrSuperAdmin(actor) && employee.status !== "LEAVER"
        ? { preview: await departurePreview(employee.id) }
        : null,
  };

  return (
    <div className="space-y-6">
      <RecordHeader
        name={employee.name}
        meta={[detail.record.jobTitle, employee.department?.name, employee.entity.name]}
        status={view.status}
        manager={view.manager}
        reportsToLabel={t("detail.reportsTo")}
        actions={<RecordActions {...actions} />}
      />

      {/* F-e / R10 — the record's tabs; later modules add theirs (RecordTabs). */}
      <RecordTabs basePath={`/${locale}/people/${employee.id}`} active={shown} hidden={allHidden} />

      <RecordPanel
        tab={shown}
        view={view}
        locale={locale}
        employeeId={employee.id}
        record={detail.record}
        jmlData={jmlData}
        hiringData={hiringData}
        documents={documents}
        compensation={compensationCard(t, basicSalary)}
        login={loginPanel(actor, subject, employee)}
        footer={
          <>
            {/*
              §9.8's individual 360 report, gated on the org-wide capability
              the route enforces. Never on the 360 console: pairing who rated
              whom with what came back is the join §13.1's anonymity prevents.
            */}
            {actor.capabilities.orgWide ? <ThreeSixtyResultCard employeeId={employee.id} /> : null}
            {/* §4.2 — tell a viewer which side of the view/act line they are on. */}
            <p className="text-sm text-muted-foreground">
              {canAct ? t("detail.youCanAct") : t("detail.viewOnly")}
            </p>
          </>
        }
      />
    </div>
  );
}

/** R10 — core-category tabs this viewer is not entitled to (their data is not in the select). */
function hiddenCoreTabs(
  detail: ReturnType<typeof serializeEmployeeDetail>,
  basicSalary: string | null | undefined,
  canSeeHistory: boolean,
  documentsVisible: boolean,
): RecordTab[] {
  const hidden: RecordTab[] = [];
  if (!detail.record.personal) hidden.push("personal");
  if (!documentsVisible) hidden.push("documents");
  if (basicSalary === undefined) hidden.push("compensation");
  if (!canSeeHistory) hidden.push("history");
  return hidden;
}

/** The open tab's panel. Each panel renders only what the gated select returned. */
async function RecordPanel(props: {
  tab: RecordTab;
  view: ReturnType<typeof recordView>;
  locale: string;
  employeeId: string;
  record: EmployeeRecordView;
  jmlData: Awaited<ReturnType<typeof employeeJml>>;
  hiringData: Awaited<ReturnType<typeof employeeHiring>>;
  documents: Awaited<ReturnType<typeof listEmployeeDocuments>> | null;
  compensation: React.ReactNode;
  login: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = await getTranslations("pms");
  const { tab, view, record } = props;
  switch (tab) {
    case "tickets":
    case "jml":
    case "hiring":
      return (
        <ModuleTab
          tab={tab}
          jmlData={props.jmlData}
          hiringData={props.hiringData}
          employeeId={props.employeeId}
          locale={props.locale}
        />
      );
    case "overview":
      return (
        <>
          <SectionCard title={t("detail.summary")}>
            <DescriptionList items={view.summary} columns={2} />
          </SectionCard>
          {/* F-d — logins for whoever holds logins.manage for this person's scope. */}
          {props.login}
        </>
      );
    case "job":
      return (
        <>
          <SectionCard title={t("detail.placement")}>
            <DescriptionList items={view.placement} columns={2} />
          </SectionCard>
          <SectionCard title={t("detail.employment")}>
            <DescriptionList items={view.employment} columns={2} />
          </SectionCard>
          <JobSection record={record} />
        </>
      );
    case "personal":
      return <PersonalSection record={record} />;
    case "documents":
      return (
        <>
          {record.idDocuments ? <IdSection record={record} /> : null}
          {props.documents ? (
            <EmployeeDocuments
              employeeId={props.employeeId}
              locale={props.locale}
              items={props.documents.items.map((d) => ({ ...d, date: d.date.toISOString() }))}
              canUpload={props.documents.canUpload}
            />
          ) : null}
        </>
      );
    case "compensation":
      return props.compensation;
    case "history":
      return <EmployeeHistory entries={await employeeHistory(props.employeeId)} />;
    default:
      return props.footer;
  }
}

/**
 * The record's Actions menu links (UX review R10, P0 US-2): lifecycle cases
 * for whoever may open them for this person's placement, the org chart, and
 * the login panel for whoever manages logins here. Each destination re-checks.
 */
function recordLinks(
  actor: Actor,
  subject: Subject,
  employee: { id: string; name: string; status: string },
  locale: string,
  canRaiseTicket: boolean,
): RecordActionsProps["links"] {
  const prefill = new URLSearchParams({ employeeId: employee.id, name: employee.name });
  const links: RecordActionsProps["links"] = [];
  if (employee.status === "ACTIVE" && canFor(actor, "jml.manageMovers", subject))
    links.push({ label: "startMover", href: `/${locale}/jml/movers/new?${prefill}` });
  if (employee.status !== "LEAVER" && canFor(actor, "jml.manageLeavers", subject))
    links.push({ label: "startLeaver", href: `/${locale}/jml/leavers/new?${prefill}` });
  if (canRaiseTicket && employee.status !== "LEAVER")
    links.push({
      label: "raiseTicket",
      href: `/${locale}/tickets/new?${new URLSearchParams({ employeeId: employee.id })}`,
    });
  links.push({
    label: "orgChart",
    href: `/${locale}/org?${new URLSearchParams({ q: employee.name })}`,
  });
  if (actorCan(actor, "logins.manage", subject))
    links.push({ label: "manageLogin", href: `/${locale}/people/${employee.id}#login` });
  return links;
}

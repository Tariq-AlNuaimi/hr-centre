-- UX P1 (docs/blueprints/ux-p1-nav.md AC-6.2): new tickets are HR-0001.
-- Only the column default changes; prisma migrate's drift noise (hand-written
-- composite FKs and trigram indexes it cannot model) is deliberately omitted.
ALTER TABLE "hive_ticket_settings" ALTER COLUMN "ticketPrefix" SET DEFAULT 'HR';

-- UX P1 (docs/blueprints/ux-p1-nav.md AC-6.2): the module is "HR tickets", so
-- an unedited legacy prefix moves to HR once. An admin's own prefix is kept.
UPDATE "hive_ticket_settings" SET "ticketPrefix" = 'HR' WHERE "ticketPrefix" = 'HIVE';

-- AC-7.3: built-in role names in Title Case. Only a name that is still the old
-- default is changed; an admin's own rename is never overwritten.
UPDATE "access_roles" SET "name" = 'Hiring Admin' WHERE "starter_key" = 'HIRING_ADMIN' AND "name" = 'Hiring admin';
UPDATE "access_roles" SET "name" = 'Ticket Viewer' WHERE "starter_key" = 'TICKETS_VIEWER' AND "name" = 'Ticket viewer';
UPDATE "access_roles" SET "name" = 'Ticket Drafter' WHERE "starter_key" = 'TICKETS_DRAFTER' AND "name" = 'Ticket drafter';
UPDATE "access_roles" SET "name" = 'Ticket Approver' WHERE "starter_key" = 'TICKETS_APPROVER' AND "name" = 'Ticket approver';
UPDATE "access_roles" SET "name" = 'Tickets Admin' WHERE "starter_key" = 'TICKETS_ADMIN' AND "name" = 'Tickets admin';

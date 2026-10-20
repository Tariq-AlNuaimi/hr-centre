-- UAT Scenario C — §6.2's mid-year flow gains the employee's acknowledgment.
--
-- ENUM VALUES ONLY, and that is not tidiness. PostgreSQL refuses to USE a new
-- enum value in the same transaction that added it ("unsafe use of new value of
-- enum type"), and Prisma wraps each migration in one. The CHECK constraint in
-- the next migration names 'NOT_ACKNOWLEDGED', so the value has to be committed
-- first. Splitting the pair is the fix; collapsing them back will fail on a
-- fresh database while appearing to work on one where the value already exists.

ALTER TYPE "ChangeRequestStatus" ADD VALUE IF NOT EXISTS 'NOT_ACKNOWLEDGED';

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'CHANGE_REQUEST_RAISED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'CHANGE_REQUEST_ACKNOWLEDGED';

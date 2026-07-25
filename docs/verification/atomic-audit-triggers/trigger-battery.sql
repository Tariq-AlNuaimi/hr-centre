-- Verification battery for recipe shared-security/4 (atomic audit triggers).
-- Each block prints a PASS/FAIL line. Run with -v ON_ERROR_STOP=1.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

-- helper: clean slate
-- delete users FIRST (that fires DELETE triggers), THEN clear the log, so leftover
-- rows from a previous run can't pollute the counts.
DELETE FROM users WHERE email LIKE 'trig-%';
DELETE FROM audit_logs;

-- ===== T1: single INSERT -> CREATE audit row =====
INSERT INTO users (id,email,name,"passwordHash",role,"updatedAt")
VALUES ('u-t1','trig-1@x.com','T1','$argon2-SECRET-HASH','VIEWER',now());
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END || '  T1 single INSERT -> 1 CREATE row'
FROM audit_logs WHERE "entityType"='User' AND action='CREATE' AND "entityId"='u-t1';

-- ===== T2: scrubbing — passwordHash must be redacted in the snapshot =====
SELECT CASE WHEN (after->>'passwordHash')='[redacted]' THEN 'PASS' ELSE 'FAIL' END
  || '  T2 scrub passwordHash (got: ' || coalesce(after->>'passwordHash','<null>') || ')'
FROM audit_logs WHERE "entityId"='u-t1' AND action='CREATE';

-- ===== T3: UPDATE -> UPDATE row with a changes diff =====
UPDATE users SET name='T1-renamed', "updatedAt"=now() WHERE id='u-t1';
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END
  || '  T3 UPDATE -> 1 UPDATE row (changes.name.to=' || coalesce(min(changes->'name'->>'to'),'<null>') || ')'
FROM audit_logs WHERE "entityId"='u-t1' AND action='UPDATE';

-- ===== T4: soft-delete (deletedAt set) -> DELETE action =====
UPDATE users SET "deletedAt"=now(), "updatedAt"=now() WHERE id='u-t1';
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END || '  T4 soft-delete -> DELETE action'
FROM audit_logs WHERE "entityId"='u-t1' AND action='DELETE';

-- ===== T5: restore (deletedAt cleared) -> RESTORE action =====
UPDATE users SET "deletedAt"=NULL, "updatedAt"=now() WHERE id='u-t1';
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END || '  T5 restore -> RESTORE action'
FROM audit_logs WHERE "entityId"='u-t1' AND action='RESTORE';

-- ===== T6: BULK update (the app extension's blind spot) -> one row PER row =====
DELETE FROM audit_logs;
INSERT INTO users (id,email,name,role,"updatedAt") VALUES
 ('u-b1','trig-b1@x.com','B1','VIEWER',now()),
 ('u-b2','trig-b2@x.com','B2','VIEWER',now()),
 ('u-b3','trig-b3@x.com','B3','VIEWER',now());
SELECT CASE WHEN count(*)=3 THEN 'PASS' ELSE 'FAIL' END
  || '  T6a multi-row INSERT (createMany) -> 3 CREATE rows (got ' || count(*) || ')'
FROM audit_logs WHERE action='CREATE';

UPDATE users SET role='EDITOR', "updatedAt"=now() WHERE email LIKE 'trig-b%';
SELECT CASE WHEN count(*)=3 THEN 'PASS' ELSE 'FAIL' END
  || '  T6b bulk UPDATE (updateMany) -> 3 UPDATE rows (got ' || count(*) || ')'
FROM audit_logs WHERE action='UPDATE';

-- ===== T7: upsert (ON CONFLICT) -> audit row =====
DELETE FROM audit_logs;
INSERT INTO users (id,email,name,role,"updatedAt") VALUES ('u-b1','trig-b1@x.com','B1-upserted','VIEWER',now())
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "updatedAt"=now();
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END
  || '  T7 upsert -> 1 audit row (got ' || count(*) || ')'
FROM audit_logs;

-- ===== T8: ATOMICITY — a rolled-back tx must leave NO audit row =====
DELETE FROM audit_logs;
BEGIN;
  INSERT INTO users (id,email,name,role,"updatedAt") VALUES ('u-rb','trig-rb@x.com','RB','VIEWER',now());
ROLLBACK;
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END
  || '  T8 ROLLBACK -> 0 audit rows (atomicity; got ' || count(*) || ')'
FROM audit_logs;
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END || '  T8b rolled-back user absent'
FROM users WHERE id='u-rb';

-- ===== T9: actor GUC -> userId populated =====
DELETE FROM audit_logs;
INSERT INTO users (id,email,name,role,"updatedAt") VALUES ('u-actor','trig-actor@x.com','Actor','ADMIN',now());
DELETE FROM audit_logs;
SELECT set_config('app.user_id','u-actor',false);
SELECT set_config('app.ip_address','203.0.113.9',false);
UPDATE users SET name='Actor2', "updatedAt"=now() WHERE id='u-actor';
SELECT CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END
  || '  T9 actor GUC -> userId+ip captured'
FROM audit_logs WHERE "userId"='u-actor' AND "ipAddress"='203.0.113.9';

-- ===== T10: HAZARD — actor GUC holding a NON-EXISTENT user id =====
-- audit_logs.userId is a FK to users.id. If a stale/spoofed GUC survives, does the
-- DML itself fail? This is the failure mode a fork would hit in production.
SELECT set_config('app.user_id','no-such-user-id',false);
DO $$
BEGIN
  UPDATE users SET name='Actor3', "updatedAt"=now() WHERE id='u-actor';
  RAISE NOTICE 'PASS  T10 stale actor GUC did NOT break the DML';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'FAIL  T10 stale actor GUC BREAKS THE WRITE (FK violation on audit_logs.userId)';
END $$;
SELECT set_config('app.user_id','',false);

-- UX review P0 (docs/blueprints/ux-p0.md, AC-5.2): the bootstrap administrator
-- gets every module's admin starter role at Whole group, ONCE.
--
-- Why a migration: it runs exactly once per database, so an administrator who
-- later removes one of these assignments on purpose is not overruled by the
-- next deploy (a seed step would re-grant it on every build).
--
-- Who: the login behind the seeded "BOOTSTRAP-ADMIN" employee record — the
-- SEED_ADMIN_EMAIL user (prisma/seed-foundation.ts) — matched by link or, if the
-- record was never linked, by email. Nobody else is touched.
--
-- On a database where a module's starter role does not exist yet (a fresh
-- install: the hiring and ticket roles are seeded after migrations run) the
-- join simply finds nothing; seed-foundation's first-run bootstrap grants the
-- same set once instead.
INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "scope_id", "note", "updated_at")
SELECT
  'uxp0boot_' || md5(u."id" || ':' || ar."id"),
  u."id",
  ar."id",
  'GROUP',
  NULL,
  'Bootstrap administrator: every module''s admin role (one-time grant)',
  CURRENT_TIMESTAMP
FROM "employees" e
JOIN "users" u
  ON u."deletedAt" IS NULL
 AND (u."id" = e."userId" OR (e."userId" IS NULL AND lower(u."email") = lower(e."email")))
JOIN "access_roles" ar
  ON ar."starter_key" IN ('HR_SUPER_ADMIN', 'JML_HR_MANAGER', 'HIRING_ADMIN', 'TICKETS_ADMIN')
 AND ar."deleted_at" IS NULL
WHERE e."odoo_id" = 'BOOTSTRAP-ADMIN'
  AND e."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "role_assignments" ra
    WHERE ra."user_id" = u."id" AND ra."role_id" = ar."id" AND ra."scope_type" = 'GROUP'
  );

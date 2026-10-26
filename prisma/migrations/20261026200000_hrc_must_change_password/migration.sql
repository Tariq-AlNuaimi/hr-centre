-- HR Centre foundation F-d — temporary passwords must be changed at first sign-in
-- (blueprint §4, AC-F4.2). Additive: one NOT NULL column with a default, so every
-- existing login reads "no forced change" and the running version is unaffected.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

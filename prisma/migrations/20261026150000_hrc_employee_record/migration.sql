-- HR Centre foundation F-b — the full employee record (blueprint §2).
--
-- HAND-WRITTEN like its siblings. Additive only: two new enum types and fifteen
-- NULLABLE columns on `employees`. Nothing existing is read, rewritten or
-- dropped, so the running version keeps working through the deploy.
--
-- The two *_enc columns hold AES-256-GCM envelopes (lib/crypto/field-encryption.ts,
-- ID_DOCUMENT_KEYRING) bound to odoo_id — never plaintext. Expiry dates are
-- deliberately plain: they drive "expiring soon" lists.

CREATE TYPE "ContractType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'INTERN', 'PART_TIME', 'SECONDMENT');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "employees"
  ADD COLUMN "job_title"           TEXT,
  ADD COLUMN "grade"               TEXT,
  ADD COLUMN "contract_type"       "ContractType",
  ADD COLUMN "probation_end_date"  DATE,
  ADD COLUMN "work_location"       TEXT,
  ADD COLUMN "work_phone"          TEXT,
  ADD COLUMN "personal_email"      TEXT,
  ADD COLUMN "personal_phone"      TEXT,
  ADD COLUMN "date_of_birth"       DATE,
  ADD COLUMN "gender"              "Gender",
  ADD COLUMN "nationality"         TEXT,
  ADD COLUMN "civil_id_number_enc" TEXT,
  ADD COLUMN "civil_id_expiry"     DATE,
  ADD COLUMN "passport_number_enc" TEXT,
  ADD COLUMN "passport_expiry"     DATE;

-- Backstop for the encryption contract: a value in either *_enc column must be
-- a v1 envelope (v1.<iv>.<ct>.<tag>), so a writer that forgot to encrypt fails
-- loudly instead of storing an ID number in the clear.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_civil_id_enc_envelope_check"
  CHECK ("civil_id_number_enc" IS NULL OR "civil_id_number_enc" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$');

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_passport_enc_envelope_check"
  CHECK ("passport_number_enc" IS NULL OR "passport_number_enc" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$');

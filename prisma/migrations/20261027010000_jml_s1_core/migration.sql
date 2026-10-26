-- JML S1 (docs/blueprints/jml.md): core changes owned by the JML module.
-- Hand-trimmed from `prisma migrate diff`: only this slice's objects (the diff also
-- proposes dropping hand-written constraints that the schema cannot model).

-- CreateEnum
CREATE TYPE "LeaveReasonLevel1" AS ENUM ('VOLUNTARY_ATTRACTED_AWAY', 'VOLUNTARY_DISSATISFACTION', 'VOLUNTARY_PERSONAL', 'INVOLUNTARY_PERFORMANCE', 'INVOLUNTARY_CONDUCT', 'INVOLUNTARY_BUSINESS', 'CONTRACT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- AlterEnum (ADR-076: one employment-type list)
ALTER TYPE "ContractType" ADD VALUE 'SUMMER_INTERN';
ALTER TYPE "ContractType" ADD VALUE 'TRAINEE';
ALTER TYPE "ContractType" ADD VALUE 'FREELANCER';
ALTER TYPE "ContractType" ADD VALUE 'CONSULTANT';
ALTER TYPE "ContractType" ADD VALUE 'CONTRACTOR';
ALTER TYPE "ContractType" ADD VALUE 'TEMPORARY';

-- AlterEnum (ADR-075)
ALTER TYPE "EmployeeStatus" ADD VALUE 'PRE_JOINER';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "employee_code" TEXT,
ADD COLUMN     "position_classification_id" TEXT;

-- CreateTable
CREATE TABLE "employee_code_sequence" (
    "id" TEXT NOT NULL,
    "singleton" TEXT NOT NULL DEFAULT 'singleton',
    "prefix" TEXT NOT NULL DEFAULT 'EMP',
    "digits" INTEGER NOT NULL DEFAULT 4,
    "last_manual_id" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL,
    "cutover_at" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_code_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_schedule" (
    "id" TEXT NOT NULL,
    "singleton" TEXT NOT NULL DEFAULT 'singleton',
    "working_days" INTEGER[] DEFAULT ARRAY[7, 1, 2, 3, 4]::INTEGER[],
    "start_hour" INTEGER NOT NULL DEFAULT 8,
    "end_hour" INTEGER NOT NULL DEFAULT 17,
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Muscat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_parameters" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_classifications" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_reason_categories" (
    "id" TEXT NOT NULL,
    "level1" "LeaveReasonLevel1" NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_reason_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_reason_codes" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_reason_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_code_sequence_singleton_key" ON "employee_code_sequence"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "working_schedule_singleton_key" ON "working_schedule"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_date_key" ON "public_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_parameters_key_effective_from_key" ON "statutory_parameters"("key", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "position_classifications_code_key" ON "position_classifications"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_reason_categories_level1_key" ON "leave_reason_categories"("level1");

-- CreateIndex
CREATE UNIQUE INDEX "leave_reason_codes_code_key" ON "leave_reason_codes"("code");

-- CreateIndex
CREATE INDEX "leave_reason_codes_category_id_active_idx" ON "leave_reason_codes"("category_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_classification_id_fkey" FOREIGN KEY ("position_classification_id") REFERENCES "position_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_parameters" ADD CONSTRAINT "statutory_parameters_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_reason_codes" ADD CONSTRAINT "leave_reason_codes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "leave_reason_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

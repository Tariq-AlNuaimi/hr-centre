-- CreateEnum
CREATE TYPE "HiringWorkArrangement" AS ENUM ('ON_SITE', 'HYBRID', 'REMOTE');

-- AlterTable
ALTER TABLE "hiring_requisitions" ADD COLUMN     "location_city" TEXT NOT NULL DEFAULT 'Muscat',
ADD COLUMN     "location_country" TEXT NOT NULL DEFAULT 'OM',
ADD COLUMN     "work_arrangement" "HiringWorkArrangement" NOT NULL DEFAULT 'ON_SITE';

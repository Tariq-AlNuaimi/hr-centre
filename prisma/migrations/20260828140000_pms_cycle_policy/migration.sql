-- §6.2 / §7.1 / §8.7 as HR-settable policy on the cycle.
--
-- Purely additive, and every default reproduces the behaviour the code already
-- had, so applying this changes nothing until HR changes something. That is
-- deliberate: a policy mechanism that quietly re-decides an open question on
-- the day it ships is worse than no mechanism.
--
-- Existing rows take the defaults, which is why there is no backfill: the
-- defaults ARE the current behaviour.

CREATE TYPE "DivergenceReasonPolicy" AS ENUM ('REQUIRED', 'OPTIONAL', 'OFF');

ALTER TABLE "performance_cycles"
  ADD COLUMN "require_resign_after_change" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "divergence_reason" "DivergenceReasonPolicy" NOT NULL DEFAULT 'REQUIRED',
  ADD COLUMN "round_score_before_banding" BOOLEAN NOT NULL DEFAULT false;

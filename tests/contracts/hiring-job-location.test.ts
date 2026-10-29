import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countryName, jobPostingJsonLd, placeLabel } from "../../lib/hiring/careers-jd";
import {
  createRequisitionSchema,
  updateRequisitionSchema,
} from "../../lib/validations/hiring/requisition";

/** Overnight item 3 — requisition job location (docs/blueprints/hiring-job-location.md). */

const BASE = {
  title: "Data engineer",
  description: "Build pipelines",
  company: "Rihal",
  postedAt: "2026-10-20T08:00:00.000Z",
  validThrough: null,
  url: "https://hr.example/en/careers/data-engineer-cmvr6sie40003ia7d4z63r6vm",
};

test("on-site and hybrid roles carry their city and country, no telecommute", () => {
  for (const arrangement of ["ON_SITE", "HYBRID"] as const) {
    const ld = jobPostingJsonLd({
      ...BASE,
      location: { city: "Dubai", country: "AE", arrangement },
    });
    assert.deepEqual(ld.jobLocation, {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Dubai", addressCountry: "AE" },
    });
    assert.ok(!("jobLocationType" in ld));
  }
});

test("a remote role is TELECOMMUTE with the applicant country", () => {
  const ld = jobPostingJsonLd({
    ...BASE,
    location: { city: "Muscat", country: "OM", arrangement: "REMOTE" },
  });
  assert.equal(ld.jobLocationType, "TELECOMMUTE");
  assert.deepEqual(ld.applicantLocationRequirements, { "@type": "Country", name: "Oman" });
});

test("labels read as people write them", () => {
  assert.equal(countryName("OM"), "Oman");
  assert.equal(placeLabel({ city: "Muscat", country: "OM" }), "Muscat, Oman");
});

test("the form's location is validated; absent on create leaves the Muscat/OM/on-site defaults", () => {
  const base = {
    title: "Engineer",
    entityId: "e1",
    departmentId: "d1",
    description: "JD",
    competencies: ["SQL"],
    hiringManagerId: "u1",
    targetCloseDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    salaryBandMin: 1,
    salaryBandMax: 2,
  };
  const plain = createRequisitionSchema.parse(base);
  assert.equal(plain.locationCity, undefined);
  const ok = createRequisitionSchema.parse({
    ...base,
    locationCity: " Dubai ",
    locationCountry: "ae",
    workArrangement: "HYBRID",
  });
  assert.deepEqual(
    [ok.locationCity, ok.locationCountry, ok.workArrangement],
    ["Dubai", "AE", "HYBRID"],
  );
  assert.equal(updateRequisitionSchema.safeParse({ locationCountry: "Oman" }).success, false);
  assert.equal(updateRequisitionSchema.safeParse({ workArrangement: "MOON" }).success, false);
  assert.equal(updateRequisitionSchema.safeParse({ locationCity: "" }).success, false);
});

test("existing requisitions default to Muscat, OM, on-site (migration column defaults)", () => {
  const dir = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(dir, /locationCity\s+String\s+@default\("Muscat"\)/);
  assert.match(dir, /locationCountry\s+String\s+@default\("OM"\)/);
  assert.match(dir, /workArrangement\s+HiringWorkArrangement\s+@default\(ON_SITE\)/);
});

test("the careers board caches under a new key, so no pre-location row is served", () => {
  const src = readFileSync("lib/hiring/careers.ts", "utf8");
  assert.match(src, /"hiring-careers-board-v2"/);
  assert.match(src, /"hiring-careers-role-v2"/);
});

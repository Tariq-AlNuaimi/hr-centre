import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  weekTypeFor,
  presenceFor,
  weeksBetweenSundays,
  ANCHOR,
  type WeekType,
  matchCoverage,
} from "../../lib/hive/rotation";
import { expiryStateFor, muscatDate } from "../../lib/hive/civil";

// §4.4's rotation, which the spec is emphatic must be "computed live from today's
// real date — never hardcoded to a specific week, and never dependent on someone
// manually updating a schedule."
//
// It is the one HIVE answer that is wrong SILENTLY. A wrong leave figure reads
// oddly; a wrong rotation week reads perfectly and sends someone to an empty
// office, or keeps them home on a day their directorate is in. Nothing in the
// answer looks off, which is why the blueprint asks for a TDD suite here and
// only here.
//
// The anchor is load-bearing and independently verified: 29 March 2026 IS a
// Sunday (checked against the runtime's own calendar, not assumed), and §4.4
// names it as the start of a Type A week.

const A: WeekType = "A";
const B: WeekType = "B";

describe("§4.4 — the anchor, and parity from it", () => {
  test("the anchor is what §4.4 says it is", () => {
    assert.equal(ANCHOR.date, "2026-03-29");
    assert.equal(ANCHOR.type, "A");
  });

  test("the anchor date really is a Sunday", () => {
    // If this ever fails, every other assertion in this file is meaningless:
    // the whole calculation is "whole weeks from THAT Sunday".
    const day = new Date("2026-03-29T00:00:00Z").getUTCDay();
    assert.equal(day, 0, "29 March 2026 must be a Sunday for §4.4's anchor to mean anything");
  });

  test("the anchor week is Type A", () => {
    assert.equal(weekTypeFor("2026-03-29"), A);
  });

  test("every day of the anchor week is Type A, not just its Sunday", () => {
    for (const d of ["2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02"]) {
      assert.equal(weekTypeFor(d), A, `${d} is inside the anchor week`);
    }
  });

  test("the following week is Type B, and the one after that is A again", () => {
    assert.equal(weekTypeFor("2026-04-05"), B);
    assert.equal(weekTypeFor("2026-04-12"), A);
    assert.equal(weekTypeFor("2026-04-19"), B);
  });

  test("Friday and Saturday belong to the week that just ENDED, not the next one", () => {
    // The working week is Sun–Thu, so Fri/Sat sit at the end of their week. If
    // they were treated as the start of the next one, every "what about this
    // weekend" question would answer for the wrong week.
    assert.equal(weekTypeFor("2026-04-03"), A, "Friday after the anchor Sunday");
    assert.equal(weekTypeFor("2026-04-04"), A, "Saturday after the anchor Sunday");
    assert.equal(weekTypeFor("2026-04-05"), B, "the NEXT Sunday flips");
  });

  test("it alternates indefinitely — a year out is still right", () => {
    // "Alternates every single week, indefinitely, no gaps, until further
    // notice." 52 weeks later is an even number of weeks, so Type A.
    assert.equal(weekTypeFor("2027-03-28"), A, "52 weeks after the anchor");
    assert.equal(weekTypeFor("2027-04-04"), B, "53 weeks after the anchor");
  });

  test("dates BEFORE the anchor alternate backwards correctly", () => {
    // A negative week count. JS `%` returns a negative for negative operands, so
    // a naive `weeks % 2 === 0` gets this wrong in a way no forward-looking test
    // would ever catch — and HIVE is asked about last week often enough.
    assert.equal(weekTypeFor("2026-03-22"), B, "one week before the anchor");
    assert.equal(weekTypeFor("2026-03-15"), A, "two weeks before");
    assert.equal(weekTypeFor("2026-03-08"), B, "three weeks before");
  });

  test("weeksBetweenSundays is exact across a month boundary and a leap year", () => {
    assert.equal(weeksBetweenSundays("2026-03-29", "2026-03-29"), 0);
    assert.equal(weeksBetweenSundays("2026-03-29", "2026-04-05"), 1);
    assert.equal(weeksBetweenSundays("2026-03-29", "2026-03-22"), -1);
    // 2028 is a leap year; spanning 29 February must not drop or add a day.
    assert.equal(weeksBetweenSundays("2028-02-27", "2028-03-05"), 1);
  });
});

describe("§4.4 — who is in the office, and when", () => {
  // "Type A week: Group 1 in-office Sun/Mon, remote Tue–Thu. Group 2 in-office
  //  Tue–Thu, remote Sun/Mon. Type B week: reversed."
  const SUN = "2026-03-29";
  const MON = "2026-03-30";
  const TUE = "2026-03-31";
  const THU = "2026-04-02";

  test("Type A: Group 1 is in on Sunday and Monday", () => {
    assert.equal(presenceFor("GROUP_1", SUN).status, "office");
    assert.equal(presenceFor("GROUP_1", MON).status, "office");
    assert.equal(presenceFor("GROUP_1", TUE).status, "remote");
    assert.equal(presenceFor("GROUP_1", THU).status, "remote");
  });

  test("Type A: Group 2 is the mirror image", () => {
    assert.equal(presenceFor("GROUP_2", SUN).status, "remote");
    assert.equal(presenceFor("GROUP_2", MON).status, "remote");
    assert.equal(presenceFor("GROUP_2", TUE).status, "office");
    assert.equal(presenceFor("GROUP_2", THU).status, "office");
  });

  test("Type B reverses both groups", () => {
    const bSun = "2026-04-05";
    const bTue = "2026-04-07";
    assert.equal(presenceFor("GROUP_1", bSun).status, "remote");
    assert.equal(presenceFor("GROUP_2", bSun).status, "office");
    assert.equal(presenceFor("GROUP_1", bTue).status, "office");
    assert.equal(presenceFor("GROUP_2", bTue).status, "remote");
  });

  test("the two groups are never both remote on a working day", () => {
    // A structural check across a full cycle: every working day must have
    // somebody in, or the rotation has a hole in it.
    for (const day of [
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-05",
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
      "2026-04-09",
    ]) {
      const one = presenceFor("GROUP_1", day).status;
      const two = presenceFor("GROUP_2", day).status;
      assert.ok(
        one === "office" || two === "office",
        `${day}: neither group is in the office — the rotation has a gap`,
      );
      assert.notEqual(one, two, `${day}: the two groups must never mirror each other`);
    }
  });
});

describe("§4.4 — the constant, the weekend, and Codeline", () => {
  test("Operations is in-office EVERY working day, in both week types", () => {
    // "Operations (OPS) is in-office every working day (Sun–Thu) — never rotates."
    for (const day of [
      "2026-03-29",
      "2026-03-31",
      "2026-04-02",
      "2026-04-05",
      "2026-04-07",
      "2026-04-09",
    ]) {
      assert.equal(presenceFor("CONSTANT", day).status, "office", `Operations on ${day}`);
    }
  });

  test("Friday and Saturday are weekend for EVERYONE, Operations included", () => {
    // "Friday & Saturday — no rotation applies to anyone." Operations being the
    // constant must not leak into the weekend: §4.4 scopes it to Sun–Thu.
    for (const mode of ["CONSTANT", "GROUP_1", "GROUP_2"] as const) {
      assert.equal(presenceFor(mode, "2026-04-03").status, "weekend", `${mode} on Friday`);
      assert.equal(presenceFor(mode, "2026-04-04").status, "weekend", `${mode} on Saturday`);
    }
  });

  test("a presence answer carries the week type, so HIVE can say which week it is", () => {
    assert.equal(presenceFor("GROUP_1", "2026-03-29").weekType, "A");
    assert.equal(presenceFor("GROUP_1", "2026-04-05").weekType, "B");
    // Even on the weekend, because "is next week A or B" is a real question.
    assert.equal(presenceFor("GROUP_1", "2026-04-03").weekType, "A");
  });
});

describe("muscatDate — the timezone bug this would otherwise have", () => {
  test("an Omani evening is still the same day, not yesterday", () => {
    // Vercel runs in UTC. 20:00 in Muscat is 16:00 UTC — same day — but 00:30 in
    // Muscat is 20:30 UTC on the PREVIOUS day. Reading the server's date would
    // put the rotation a day out for four hours every night, and a WEEK out when
    // that night is a Saturday.
    assert.equal(muscatDate(new Date("2026-04-04T20:30:00Z")), "2026-04-05");
    assert.equal(muscatDate(new Date("2026-04-04T19:59:00Z")), "2026-04-04");
  });

  test("the Saturday-night case, which is the one that costs a whole week", () => {
    // 20:30 UTC on Saturday 4 April is 00:30 on Sunday 5 April in Muscat — the
    // first minutes of a Type B week. Reading UTC would answer Type A.
    const late = new Date("2026-04-04T20:30:00Z");
    assert.equal(weekTypeFor(muscatDate(late)), "B");
    assert.equal(weekTypeFor("2026-04-04"), "A", "the UTC reading would have said A");
  });

  test("midday is unambiguous either way (the check is not just about edges)", () => {
    assert.equal(muscatDate(new Date("2026-03-29T09:00:00Z")), "2026-03-29");
  });
});

describe("§4.1 — sub-team phrasings resolve, and nothing else does", () => {
  // "an employee saying 'I'm in Software Engineering' must correctly map to the
  //  Technology & Development directorate / Tech rotation group, the same as
  //  someone saying 'Tech' or 'DevOps' or 'QA'."
  //
  // Those aliases are DATA on the coverage row (§4.2 — Alaa teaches HIVE a new
  // sub-team name with no developer), so what is tested here is the MATCHER, not
  // the seed's current contents.
  const coverage = [
    { label: "Operations", aliases: ["OPS", "Ops"], mode: "CONSTANT" as const, orgUnitId: "u1" },
    { label: "Commercials", aliases: ["COM", "Sales"], mode: "GROUP_1" as const, orgUnitId: "u2" },
    {
      label: "Technology & Development",
      aliases: ["TECH", "Software Engineering", "DevOps", "UI/UX", "QA"],
      mode: "GROUP_2" as const,
      orgUnitId: "u3",
    },
  ];

  test("the official label matches", () => {
    assert.equal(matchCoverage(coverage, "Technology & Development")?.mode, "GROUP_2");
  });

  test("every alias reaches the same group", () => {
    for (const said of ["TECH", "Software Engineering", "DevOps", "QA"]) {
      assert.equal(matchCoverage(coverage, said)?.label, "Technology & Development", said);
    }
  });

  test("case, spacing and punctuation are all folded", () => {
    assert.equal(matchCoverage(coverage, "  devops ")?.mode, "GROUP_2");
    assert.equal(matchCoverage(coverage, "ui/ux")?.mode, "GROUP_2");
    assert.equal(matchCoverage(coverage, "UI UX")?.mode, "GROUP_2");
    assert.equal(matchCoverage(coverage, "technology and development")?.mode, undefined);
  });

  test("matching is EXACT, never a substring — in BOTH directions", () => {
    // §4.4 keeps rotation groups, HR-Tag routing and org directorates
    // independent, and they share vocabulary on purpose. A substring match is
    // how one structure silently starts answering for another.
    //
    // Both directions matter, and an earlier version of this test only covered
    // one. Mutation-testing caught it: swapping the matcher to
    // `label.includes(needle)` passed every assertion here, because all three
    // cases below were needles CONTAINING a label rather than contained BY one.
    // The first three lines are that original direction; the rest are the one
    // that was missing, and they are the more dangerous half — a two-letter
    // needle matching a whole directorate.
    assert.equal(matchCoverage(coverage, "I am not in Operations"), null);
    assert.equal(matchCoverage(coverage, "Operations Directorate"), null);
    assert.equal(matchCoverage(coverage, "Sales and Marketing"), null);

    assert.equal(matchCoverage(coverage, "Op"), null, "a prefix of a label must not match");
    // ("Tech" is deliberately NOT asserted here — it IS an alias in this
    //  fixture, and folding is supposed to match it. An earlier draft asserted
    //  null for it and was simply wrong about the fixture.)
    assert.equal(matchCoverage(coverage, "Dev"), null, "a prefix of the DevOps alias");
    assert.equal(matchCoverage(coverage, "e"), null, "a single letter inside several labels");
    assert.equal(matchCoverage(coverage, "Commercial"), null, "one character short of a label");
  });

  test("an unknown phrasing returns null rather than guessing", () => {
    // §4.1's fix for a missing phrasing is Alaa adding it as an alias, not the
    // code matching harder.
    assert.equal(matchCoverage(coverage, "the moon"), null);
    assert.equal(matchCoverage(coverage, ""), null);
    assert.equal(matchCoverage(coverage, "   "), null);
  });
});

describe("§4.5 — an expired discount is flagged, never silently shown", () => {
  // "The bot must compare today's real date against that expiry automatically
  //  and clearly flag an offer as expired... rather than silently continuing to
  //  show outdated information."
  //
  // This is the failure that is invisible: the answer reads perfectly right up
  // to the day it starts being wrong, and nothing about it looks stale.
  const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

  test("an offer is valid up to and including its last day", () => {
    // "Valid until 30 Sept 2026" includes the 30th. Off by one here means HIVE
    // calls a live offer dead on its busiest day.
    assert.equal(expiryStateFor(on("2026-09-30"), "2026-09-29"), "valid");
    assert.equal(expiryStateFor(on("2026-09-30"), "2026-09-30"), "valid");
    assert.equal(expiryStateFor(on("2026-09-30"), "2026-10-01"), "expired");
  });

  test("a null expiry is 'unspecified', not 'valid' and not 'expired'", () => {
    // §6.4's table has one: Alhut Alealamia Car Wash, "Not specified". Calling
    // it valid would be inventing a guarantee; calling it expired would hide a
    // live offer. Neither is what the table says.
    assert.equal(expiryStateFor(null, "2026-09-30"), "unspecified");
  });

  test("the comparison is in civil dates, not instants", () => {
    // `validUntil` is a `@db.Date`, which Prisma returns as midnight UTC. An
    // instant comparison against a Muscat "now" is four hours out — enough to
    // call an offer expired for the last four hours of its final day.
    assert.equal(expiryStateFor(on("2027-02-28"), "2027-02-28"), "valid");
  });

  test("every seeded expiry is a real date the check can read", () => {
    // §6.4's dates transcribed. Not a behaviour test — a guard that a future
    // seed edit cannot introduce a date string this function reads as expired.
    for (const iso of [
      "2026-09-30",
      "2026-10-11",
      "2027-02-28",
      "2027-05-11",
      "2027-05-20",
      "2027-06-02",
      "2027-06-27",
    ]) {
      assert.equal(expiryStateFor(on(iso), iso), "valid", `${iso} on its own last day`);
    }
  });
});

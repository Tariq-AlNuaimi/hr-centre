import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMailOptions, isEmailEnabled, selectTransport } from "../../lib/email";

// Save / restore env state so tests don't leak into each other.
function snapshot() {
  return {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_FROM: process.env.SMTP_FROM,
  };
}
function restore(s: { SMTP_HOST?: string; SMTP_FROM?: string }) {
  if (s.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = s.SMTP_HOST;
  if (s.SMTP_FROM === undefined) delete process.env.SMTP_FROM;
  else process.env.SMTP_FROM = s.SMTP_FROM;
}

test("buildMailOptions builds from + to + subject + text", () => {
  const s = snapshot();
  process.env.SMTP_FROM = "noreply@example.com";
  try {
    const opts = buildMailOptions({
      to: "user@example.com",
      subject: "Welcome",
      text: "Hi there",
    });
    assert.equal(opts.from, "noreply@example.com");
    assert.equal(opts.to, "user@example.com");
    assert.equal(opts.subject, "Welcome");
    assert.equal(opts.text, "Hi there");
  } finally {
    restore(s);
  }
});

test("buildMailOptions comma-joins multiple recipients", () => {
  const opts = buildMailOptions({
    to: ["a@example.com", "b@example.com"],
    subject: "x",
    text: "y",
  });
  assert.equal(opts.to, "a@example.com,b@example.com");
});

test("buildMailOptions falls back to noreply@localhost when SMTP_FROM unset", () => {
  const s = snapshot();
  delete process.env.SMTP_FROM;
  try {
    const opts = buildMailOptions({
      to: "u@example.com",
      subject: "s",
      text: "t",
    });
    assert.equal(opts.from, "noreply@localhost");
  } finally {
    restore(s);
  }
});

test("buildMailOptions allows explicit `from` override", () => {
  const s = snapshot();
  process.env.SMTP_FROM = "default@example.com";
  try {
    const opts = buildMailOptions({
      from: "custom@example.com",
      to: "u@example.com",
      subject: "s",
      text: "t",
    });
    assert.equal(opts.from, "custom@example.com");
  } finally {
    restore(s);
  }
});

test("buildMailOptions includes optional html", () => {
  const opts = buildMailOptions({
    to: "u@example.com",
    subject: "s",
    text: "t",
    html: "<p>x</p>",
  });
  assert.equal(opts.html, "<p>x</p>");
});

test("buildMailOptions leaves html undefined when not passed", () => {
  const opts = buildMailOptions({
    to: "u@example.com",
    subject: "s",
    text: "t",
  });
  assert.equal(opts.html, undefined);
});

// ---- Transport selection (Resend preferred over SMTP; lib/email.ts) ----

function transportSnapshot() {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
  };
}
function transportRestore(s: { RESEND_API_KEY?: string; SMTP_HOST?: string }) {
  for (const k of ["RESEND_API_KEY", "SMTP_HOST"] as const) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

test("selectTransport prefers Resend when RESEND_API_KEY is set", () => {
  const s = transportSnapshot();
  try {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.SMTP_HOST = "smtp.example.com"; // both set -> Resend still wins
    assert.equal(selectTransport(), "resend");
    assert.equal(isEmailEnabled(), true);
  } finally {
    transportRestore(s);
  }
});

test("selectTransport falls back to SMTP when only SMTP_HOST is set", () => {
  const s = transportSnapshot();
  try {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "smtp.example.com";
    assert.equal(selectTransport(), "smtp");
    assert.equal(isEmailEnabled(), true);
  } finally {
    transportRestore(s);
  }
});

test("selectTransport is 'none' when neither transport is configured", () => {
  const s = transportSnapshot();
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    assert.equal(selectTransport(), "none");
    assert.equal(isEmailEnabled(), false);
  } finally {
    transportRestore(s);
  }
});

test("empty-string env values count as unset for transport selection", () => {
  const s = transportSnapshot();
  try {
    process.env.RESEND_API_KEY = "";
    process.env.SMTP_HOST = "";
    assert.equal(selectTransport(), "none");
    assert.equal(isEmailEnabled(), false);
  } finally {
    transportRestore(s);
  }
});

test("isEmailEnabled mirrors transport presence (Resend or SMTP)", () => {
  const s = transportSnapshot();
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    assert.equal(isEmailEnabled(), false);
    process.env.SMTP_HOST = "smtp.example.com";
    assert.equal(isEmailEnabled(), true);
    delete process.env.SMTP_HOST;
    process.env.RESEND_API_KEY = "re_test_key";
    assert.equal(isEmailEnabled(), true);
  } finally {
    transportRestore(s);
  }
});

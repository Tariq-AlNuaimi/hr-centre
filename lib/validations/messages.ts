import { z, type core } from "zod";

/**
 * Readable validation messages for every schema that does not name its own
 * (QA D-15). zod's built-in English reads like a type checker — "Too small:
 * expected string to have >=8 characters" — and many routes return the issue
 * message verbatim, so that text reached people on the login page, the payment
 * form and the ticket draft.
 *
 * Installed once as zod's global `customError`, which zod consults only when a
 * schema gives no message of its own, so every hand-written message still wins.
 * Imported for its side effect by `lib/api-response.ts` (every API route) and
 * `components/shared/FormField.tsx` (every form), so server and client agree.
 *
 * @public
 */

type Issue = core.$ZodRawIssue;

function plural(n: number | bigint, one: string, many: string): string {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

function tooSmall(issue: Extract<Issue, { code: "too_small" }>): string {
  const min = issue.minimum;
  if (issue.origin === "string") {
    return Number(min) <= 1
      ? "This field is required."
      : `Enter at least ${plural(min, "character", "characters")}.`;
  }
  if (issue.origin === "array" || issue.origin === "set") {
    return `Choose at least ${plural(min, "item", "items")}.`;
  }
  if (issue.origin === "date") return "This date is too early.";
  return issue.inclusive === false ? `Enter more than ${min}.` : `Enter ${min} or more.`;
}

function tooBig(issue: Extract<Issue, { code: "too_big" }>): string {
  const max = issue.maximum;
  if (issue.origin === "string") {
    return `Keep this to ${plural(max, "character", "characters")} or fewer.`;
  }
  if (issue.origin === "array" || issue.origin === "set") {
    return `Choose at most ${plural(max, "item", "items")}.`;
  }
  if (issue.origin === "date") return "This date is too late.";
  return issue.inclusive === false ? `Enter less than ${max}.` : `Enter ${max} or less.`;
}

const FORMAT_MESSAGES: Record<string, string> = {
  email: "Enter a valid email address.",
  url: "Enter a valid web address (https://…).",
  date: "Enter a valid date.",
  datetime: "Enter a valid date.",
};

function readableIssue(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null
        ? "This field is required."
        : "This value is not in the expected form.";
    case "too_small":
      return tooSmall(issue);
    case "too_big":
      return tooBig(issue);
    case "invalid_format":
      return FORMAT_MESSAGES[issue.format] ?? "This value is not in the expected format.";
    case "invalid_value":
      return "Choose one of the allowed options.";
    case "not_multiple_of":
      return `Enter a multiple of ${issue.divisor}.`;
    case "unrecognized_keys":
      return `Unexpected field: ${issue.keys.join(", ")}.`;
    default:
      return undefined;
  }
}

z.config({ customError: readableIssue });

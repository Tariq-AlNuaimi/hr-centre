import { DEFAULT_ROUND_MINUTES, interviewEndsAt, roundLabel } from "./interview-rules";

/**
 * Calendar files for interviews — Interview Hub `lib/calendar/{event,ics}.ts`.
 * RFC 5545 text with a stable UID per interview, so re-importing an updated
 * invite moves the event instead of duplicating it.
 */

export type InterviewEventSource = {
  id: string;
  scheduledDate: Date;
  round: string;
  location?: string | null;
  meetingLink?: string | null;
  candidateName?: string | null;
  requisitionTitle?: string | null;
  durationMinutes?: number | null;
  roundOrdinal?: number | null;
};

const UID_DOMAIN = "hr-centre-hiring";

export function toIcsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Escape text values (RFC 5545 §3.3.11); strips CR so a value cannot inject a line. */
export function escapeIcs(v: string): string {
  return v
    .replace(/\r/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Fold a content line at 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function vevent(src: InterviewEventSource, stamp: Date): string[] {
  const start = new Date(src.scheduledDate);
  const end = interviewEndsAt(start, src.durationMinutes ?? DEFAULT_ROUND_MINUTES);
  const candidate = src.candidateName ?? "Candidate";
  const description = [
    `Requisition: ${src.requisitionTitle ?? "-"}`,
    `Candidate: ${candidate}`,
    src.meetingLink ? `Meeting link: ${src.meetingLink}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    "BEGIN:VEVENT",
    `UID:interview-${src.id}@${UID_DOMAIN}`,
    `DTSTAMP:${toIcsDate(stamp)}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(`${roundLabel(src.round, src.roundOrdinal)} interview — ${candidate}`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    src.location ? `LOCATION:${escapeIcs(src.location)}` : null,
    src.meetingLink ? `URL:${escapeIcs(src.meetingLink)}` : null,
    "END:VEVENT",
  ].filter((l): l is string => l !== null);
}

export function buildIcs(events: readonly InterviewEventSource[], stamp = new Date()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HR Centre//Hiring//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap((e) => vevent(e, stamp)),
    "END:VCALENDAR",
  ]
    .map(foldLine)
    .join("\r\n");
}

export function icsHeaders(filename: string): Record<string, string> {
  return {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `attachment; filename="${filename.replace(/[^a-z0-9.-]+/gi, "-")}"`,
    "cache-control": "no-store",
  };
}

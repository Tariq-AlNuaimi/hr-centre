#!/usr/bin/env node
// Authors the nine DEFAULT leaver document templates (ADR-083) as minimal,
// valid .docx files under prisma/jml-docs/. Each paragraph is ONE run, so a
// {placeholder} is never split across runs. The wording is deliberately plain
// and marked as a default: HR replaces each with its approved letter by
// uploading it on JML settings → Documents and activating it.
//
// Usage: node scripts/jml-author-docs.mjs   (rewrites the nine files)
import PizZip from "pizzip";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../prisma/jml-docs/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const NOTE = "Default template — replace with HR's approved wording (JML settings → Documents).";

const HEAD = ["{documentTitle}", "Reference: {caseRef}    Date: {issueDate}", ""];
const TO = ["{employeeName}", "{jobTitle}, {departmentName}", "{companyName}", ""];
const SIGN = ["", "Yours sincerely,", "", "{hrOwnerName}", "Human Resources, {companyName}"];

const DOCS = {
  ACCEPTANCE_OF_RESIGNATION: [
    ...HEAD,
    ...TO,
    "Dear {employeeName},",
    "We acknowledge and accept your resignation, with notice starting on {noticeStartDate} ({noticePeriodDays} days).",
    "Your last physical working day will be {lastPhysicalWorkingDay} and your last day of service {lastDayOfService}. Any period between the two is taken as leave.",
    "Please return all company assets to your line manager, {lineManagerName}, by your last physical working day. Your final settlement will be calculated as at your last day of service.",
    ...SIGN,
  ],
  TERMINATION_NOTIFICATION: [
    ...HEAD,
    ...TO,
    "Dear {employeeName},",
    "This letter notifies you that your employment with {companyName} is terminated ({exitType} — {exitSubtype}).",
    "Notice starts on {noticeStartDate}. Your last physical working day is {lastPhysicalWorkingDay} and your last day of service is {lastDayOfService}.",
    "The grounds have been documented and reviewed. Your final settlement will be calculated in line with the Labour Law.",
    ...SIGN,
  ],
  NON_RENEWAL_NOTIFICATION: [
    ...HEAD,
    ...TO,
    "Dear {employeeName},",
    "Your fixed-term contract with {companyName} will not be renewed. Your last day of service is {lastDayOfService}.",
    "Your last physical working day is {lastPhysicalWorkingDay}. Please arrange the handover of your work and the return of company assets with {lineManagerName}.",
    ...SIGN,
  ],
  BANK_TERMINATION_NOTICE: [
    ...HEAD,
    "To: the Relationship Manager",
    "",
    "Re: {employeeName} ({employeeExternalId})",
    "Please note that the employment of the above employee with {companyName} ends on {lastDayOfService}.",
    "Kindly update your records accordingly. Any salary-linked facility should be reviewed against the final settlement, which will be advised separately.",
    ...SIGN,
  ],
  REPATRIATION_TICKET_REQUEST: [
    ...HEAD,
    "To: Travel desk",
    "",
    "Please arrange a one-way repatriation ticket for {employeeName} ({jobTitle}, {departmentName}).",
    "Last day of service: {lastDayOfService}. Planned departure date: {departureDate}.",
    "Nationality branch: {nationality}.",
    ...SIGN,
  ],
  IT_ACCESS_REVOCATION_INSTRUCTION: [
    ...HEAD,
    "To: IT Operations",
    "",
    "Please revoke all access held by {employeeName} ({employeeExternalId}), {jobTitle}, {departmentName}.",
    "Revoke at the end of the last physical working day: {lastPhysicalWorkingDay}. Shared credentials known to the employee must be rotated, not only disabled.",
    "Confirm each item back to {hrOwnerName} with a ticket reference.",
    ...SIGN,
  ],
  FINAL_SETTLEMENT_WORKSHEET: [
    ...HEAD,
    "Employee: {employeeName} ({employeeExternalId}) — {jobTitle}, {departmentName}, {companyName}",
    "Exit type: {exitType}. Notice start: {noticeStartDate}. Last day of service: {lastDayOfService}.",
    "",
    "Figures are entered from the Settlement tab of case {caseRef} by those authorised to see them; this template carries no amounts.",
    "Gratuity — before 31 Jul 2023: ____________",
    "Gratuity — after 31 Jul 2023: ____________",
    "Leave encashment: ____________   Outstanding salary: ____________",
    "Deductions: ____________   Net payable: ____________",
    "",
    "Approved — HR Manager: ____________   Operations Director: ____________",
  ],
  SETTLEMENT_TRANSMITTAL_TO_FINANCE: [
    ...HEAD,
    "To: Finance",
    "",
    "Please process the approved final settlement for {employeeName} ({employeeExternalId}), {companyName}.",
    "Last day of service: {lastDayOfService}. The statutory payment window runs from that date.",
    "The signed settlement worksheet for case {caseRef} is attached separately.",
    ...SIGN,
  ],
  CERTIFICATE_OF_SERVICE: [
    ...HEAD,
    "To whom it may concern,",
    "",
    "This is to certify that {employeeName} was employed by {companyName} as {jobTitle} in {departmentName}, with service ending on {lastDayOfService}.",
    "This certificate is issued at the employee's request.",
    ...SIGN,
  ],
};

const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const para = (text, opts = {}) =>
  `<w:p>${opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : ""}<w:r>${
    opts.italic ? '<w:rPr><w:i/><w:color w:val="808080"/></w:rPr>' : ""
  }<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

function docx(lines) {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  );
  const body = [
    para(NOTE, { italic: true }),
    para(lines[0], { style: "Title" }),
    ...lines.slice(1).map((l) => para(l)),
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  // A fixed date keeps the committed files byte-stable across runs.
  return zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
    date: new Date("2026-10-27T00:00:00Z"),
  });
}

for (const [type, lines] of Object.entries(DOCS)) {
  writeFileSync(new URL(`${type}.docx`, OUT), docx(lines));
  console.log("wrote", `${type}.docx`);
}

// Rihal palette for the PDF renderer (UI-SPEC A.2). @react-pdf/renderer paints
// outside the DOM, so it CANNOT read the CSS custom properties in app/globals.css
// — the branded export must carry literal hex. This module is the single mirror of
// those tokens; every hex lives here (with a justified per-line rule disable, the
// documented escape for a genuine one-off) so the rest of lib/pdf/ references named
// constants and stays hex-free. Keep these values in sync with app/globals.css.
export const PDF_COLORS = {
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-ink
  ink: "#0b1b2b",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-deep
  deep: "#123047",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-azure
  azure: "#2e7da6",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-mist
  mist: "#eaf1f5",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-paper
  paper: "#fbfcfd",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-sand (evidence-trail accent)
  sand: "#c9a45b",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --rihal-line
  line: "#d8e0e6",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --signal-pass
  pass: "#2e8b6f",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --signal-partial
  partial: "#c58a2e",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- PDF mirror of --signal-below
  below: "#b4533e",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- muted body text
  muted: "#5b6b78",
  // eslint-disable-next-line rihal-template/no-raw-hex-color -- white
  white: "#ffffff",
} as const;

/** Band → on-token color (the calm 3-tone scale, never traffic-light). */
export function bandColor(band: "PASS" | "PARTIAL" | "BELOW"): string {
  if (band === "PASS") return PDF_COLORS.pass;
  if (band === "PARTIAL") return PDF_COLORS.partial;
  return PDF_COLORS.below;
}

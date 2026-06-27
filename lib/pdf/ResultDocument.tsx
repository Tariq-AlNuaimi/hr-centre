import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS as C, bandColor } from "./theme";
import type { ResultView } from "@/lib/services/result";

// Branded result PDF (UI-SPEC D.7 §8 "Export PDF" + A.1 brand). Renders in Node
// via @react-pdf/renderer — NO headless browser, so it sidesteps the serverless-PDF
// landmine (pdfkit/Puppeteer fragile on Vercel; CLAUDE.md). The export carries the
// same evidence-trail story as the screen: fit → competency → source, plus the
// methodology/provenance footer that makes the result audit-defensible.
//
// English-only by design for v1 (the manager-facing artifact); the bilingual story
// lives in the in-app surfaces. Numbers use the deterministic roll-up — the PDF
// never recomputes or editorializes.

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { backgroundColor: C.deep, color: C.white, padding: 16, borderRadius: 6, marginBottom: 16 },
  wordmark: { fontSize: 9, color: C.mist, letterSpacing: 1, textTransform: "uppercase" },
  hTitle: { fontSize: 18, color: C.white, marginTop: 4, fontFamily: "Helvetica-Bold" },
  hMeta: { fontSize: 9, color: C.mist, marginTop: 6 },
  fitRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  fitNum: { fontSize: 40, fontFamily: "Helvetica-Bold", color: C.deep },
  fitCaption: { fontSize: 9, color: C.muted, maxWidth: 320 },
  chip: { fontSize: 8, color: C.deep, backgroundColor: C.mist, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.deep, marginTop: 14, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: C.sand, paddingBottom: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4 },
  cName: { flex: 3, fontFamily: "Helvetica-Bold" },
  cScore: { flex: 1, textAlign: "right" },
  cBand: { flex: 1.4, textAlign: "center" },
  bandPill: { fontSize: 8, color: C.white, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 6, alignSelf: "center" },
  cCitation: { flex: 4, fontSize: 8, color: C.muted },
  driver: { fontSize: 7.5, color: C.muted },
  domainRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2 },
  domainName: { flex: 2, fontSize: 9, textTransform: "capitalize" },
  barTrack: { flex: 4, height: 7, backgroundColor: C.mist, borderRadius: 4 },
  barFill: { height: 7, backgroundColor: C.azure, borderRadius: 4 },
  domainPct: { width: 30, fontSize: 9, textAlign: "right", marginLeft: 6 },
  narrative: { fontSize: 9.5, color: C.ink, backgroundColor: C.mist, padding: 10, borderRadius: 6 },
  narrativeLabel: { fontSize: 8, color: C.muted, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  decision: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.deep },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7.5, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 6 },
});

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

function bandLabel(band: "PASS" | "PARTIAL" | "BELOW"): string {
  return band === "PASS" ? "Meets" : band === "PARTIAL" ? "Partial" : "Below";
}

export function ResultDocument({ view }: { view: ResultView }) {
  const candidate = view.candidateName ?? view.candidateEmail;
  return (
    <Document title={`Aptitude Result — ${candidate}`} author="Rihal Aptitude Platform">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Rihal · Aptitude Platform</Text>
          <Text style={styles.hTitle}>Assessment Result</Text>
          <Text style={styles.hMeta}>
            {candidate}   ·   {view.roleTitle} (v{view.roleProfileVersion})   ·   Completed{" "}
            {fmtDate(view.completedAt)}
          </Text>
        </View>

        <View style={styles.fitRow}>
          <View>
            <Text style={styles.fitNum}>{view.fitScore}</Text>
            <Text style={{ fontSize: 8, color: C.muted }}>FIT TO ROLE / 100</Text>
          </View>
          <View>
            <Text style={styles.fitCaption}>
              Fit to the documented requirements of this role. This is a profile-match
              against a standards-anchored target profile, not a measure of intelligence
              or job knowledge.
            </Text>
            {view.communityPercentile !== null && (
              <Text style={styles.chip}>
                Community percentile: {view.communityPercentile} (Johnson IPIP-NEO norms — secondary reference)
              </Text>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Competency breakdown</Text>
        {view.scores.competencyScores.map((c, i) => (
          <View key={i} wrap={false}>
            <View style={styles.row}>
              <Text style={styles.cName}>{c.name}</Text>
              <Text style={styles.cScore}>{c.score}</Text>
              <View style={styles.cBand}>
                <Text style={[styles.bandPill, { backgroundColor: bandColor(c.band) }]}>
                  {bandLabel(c.band)}
                </Text>
              </View>
              <Text style={styles.cCitation}>{c.sourceCitation ?? c.onetRef ?? "—"}</Text>
            </View>
            {c.drivers.length > 0 && (
              <Text style={styles.driver}>
                Driven by:{" "}
                {c.drivers.map((d) => `${d.facet.replace(/_/g, " ")} (${d.percentile}p)`).join(", ")}
              </Text>
            )}
          </View>
        ))}

        <Text style={styles.sectionTitle}>Trait domains (Big Five)</Text>
        {view.scores.domainScores.map((d, i) => (
          <View key={i} style={styles.domainRow}>
            <Text style={styles.domainName}>{d.domain.toLowerCase()}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, d.percentile))}%` }]} />
            </View>
            <Text style={styles.domainPct}>{d.percentile}</Text>
          </View>
        ))}

        {view.scores.sjtScores.total > 0 && (
          <>
            <Text style={styles.sectionTitle}>Situational judgement</Text>
            <Text style={{ fontSize: 9 }}>
              Judgement score:{" "}
              {view.scores.sjtScores.overall === null ? "—" : `${view.scores.sjtScores.overall} / 100`} (
              {view.scores.sjtScores.answered} of {view.scores.sjtScores.total} scenarios answered)
            </Text>
          </>
        )}

        {view.narrative && (
          <>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.narrative}>
              <Text style={styles.narrativeLabel}>
                AI summary of the results above — restates the computed numbers; not a recommendation.
              </Text>
              <Text>{view.narrative}</Text>
            </View>
          </>
        )}

        {view.decision && (
          <>
            <Text style={styles.sectionTitle}>Decision</Text>
            <Text style={styles.decision}>
              {view.decision}
              {view.decidedByName ? ` — by ${view.decidedByName}` : ""}
              {view.decidedAt ? ` on ${fmtDate(view.decidedAt)}` : ""}
            </Text>
            {view.decisionNote && <Text style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{view.decisionNote}</Text>}
          </>
        )}

        <Text style={styles.footer} fixed>
          Methodology: competencies are anchored to O*NET work styles and the Big Five trait
          literature; traits are measured with the public-domain IPIP-NEO-120 and scored
          deterministically (model {view.scoringModel}). Community percentiles derive from the
          Johnson IPIP-NEO research dataset (Western-skewed, 2001–2011) and are a secondary
          reference only. This measures dispositional fit, not capability or job knowledge.
          Generated {fmtDate(view.computedAt)}.
        </Text>
      </Page>
    </Document>
  );
}

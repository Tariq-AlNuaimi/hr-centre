// Shared AI-pattern primitives (MIGRATION.md; AI-Quality pillar, ADR-042).
// Thin, on-token, a11y/RTL-safe components encoding the Rihal AI contract: the
// royal ✦ mark, advisory framing, honest loading/failure states, a human always
// deciding. Prop-driven so every consumer localizes its own copy. The command
// palette (⌘K) lives in components/layout/CommandPalette.
export { AiMark } from "./AiMark";
export { AiAssistPanel } from "./AiAssistPanel";
export { AiStreaming } from "./AiStreaming";
export { ConfidenceChip } from "./ConfidenceChip";
export { CitationLink } from "./CitationLink";
export { ResponsibleAiBanner } from "./ResponsibleAiBanner";
export { AgentActivity, type AgentActivityItem } from "./AgentActivity";

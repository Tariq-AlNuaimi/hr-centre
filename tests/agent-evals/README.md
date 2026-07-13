# Agent-eval golden-set — who reviews the reviewers (ADR-054)

The exact mirror of `tests/ai-evals/` one layer up: `ai-eval` scores a fork's
_product_ AI endpoints; **agent-eval scores our own harness review agents**
(`senior-code-reviewer`, `security-architect`, `sre`) against a golden set of
known-planted defects. A prompt/model change that silently stops a reviewer from
finding a class of bug turns RED here instead of escaping to production.

## Layout

Each fixture is one self-contained directory:

```
tests/agent-evals/<fixture-name>/
  input.diff              the synthetic diff under review (the planted defect)
  context/                optional supporting files the reviewer must see
  expected-findings.json  the findings a good review MUST surface (ground truth)
  README.md               where the defect class came from + what a miss means
```

`expected-findings.json` shape:

```json
{
  "fixture": "<fixture-name>",
  "agent": "senior-code-reviewer",
  "derivedFrom": "<the real past finding this defect class reproduces>",
  "expectedFindings": [
    {
      "class": "<defect-class id>",
      "severity": "high",
      "summary": "<what the reviewer must catch>",
      "mustMentionAnyOf": [["keyword-a1", "keyword-a2"], ["keyword-b1"]]
    }
  ]
}
```

## Scoring (findings-recall, not plausibility)

`npm run agent-eval` (`scripts/agent-eval.mjs`) prompts the named agent (its
`.claude/agents/<agent>.md` body, frontmatter stripped) over `input.diff` +
`context/*` via `@/lib/ai`, then scores **recall of the planted findings**: an
expected finding counts as FOUND when EVERY group in `mustMentionAnyOf` has at
least one keyword present (case-insensitive) in the review output. All expected
findings found → PASS; any missed → FAIL (exit 1). LLM-judged plausibility was
deliberately rejected (ADR-054 Option A2): a judge with no ground truth cannot
tell that a reviewer _missed_ a real defect.

**Dormancy:** without `AI_API_KEY` the runner prints SKIP and exits 0 — same
posture as `scripts/ai-eval.mjs`, so a fork's `/ship` green is untouched.
Observe-only v1: NOT a `/ship` phase (promotion trigger in ADR-054: a review
agent regresses undetected in production).

## Growing the set

Fixtures are **derived from real escapes**: whenever a review agent misses a
finding in the wild, add a synthetic _minimal_ diff reproducing that defect
class (never the original diff — no real secrets/PII/product code), name the
class, and cite the escape in `derivedFrom`. The set tracks the actual threat
model instead of a snapshot.

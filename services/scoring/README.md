# Rihal Aptitude — Scoring Service

A small, stateless **Python FastAPI** microservice that turns raw IPIP-NEO-120
answers into deterministic Big-Five **facet/domain scores + percentiles**
(ARCHITECTURE §6, §12.2). It wraps the public-domain
[`five-factor-e`](https://github.com/NeuroQuestAi/five-factor-e) library.

It is **deliberately a separate service**, not a Next.js API route:

- The psychometric engine is Python; keeping it standalone means it runs
  anywhere (Cloud Run / Fly / Render / a container beside the DB) with **no
  Vercel lock-in**. The Next app reaches it through **one env var**:
  `SCORING_SERVICE_URL`.
- **Scoring is deterministic code, never an LLM.** The same answers always
  produce the same scores — it is plain arithmetic over the IPIP-NEO-120 scoring
  keys plus Johnson's community norms. (The LLM, in later phases, only drafts
  role-profile prose and narrates numbers a human approves — it never scores.)

## Endpoints

| Method | Path      | Purpose                                              |
| ------ | --------- | ---------------------------------------------------- |
| `GET`  | `/health` | Liveness probe (`{status, model, auth_required}`).   |
| `POST` | `/score`  | Score a completed 120-item questionnaire.            |

### `POST /score`

Request:

```json
{
  "answers": [{ "itemNumber": 1, "response": 3 }, "... 120 items ..."],
  "sex": "N",
  "age": 30
}
```

- `answers` — all **120** items exactly once; `itemNumber` 1..120 (the
  `AssessmentItemBank.itemNumber`), `response` 1..5 (Very Inaccurate .. Very
  Accurate).
- `sex` — `"M" | "F" | "N"`, default **`"N"`** (neutral; averages the male+female
  norms — the inclusive default so the platform does **not** norm hiring
  assessments by the candidate's sex).
- `age` — 10..110, default 30 (Johnson norms are age-banded).

Response (abridged):

```json
{
  "model": "IPIP-NEO-120",
  "deterministic": true,
  "norms": { "source": "Johnson IPIP-NEO community sample (OSF osf.io/jxpu4)", "via": "five-factor-e", "sex": "N", "age": 30 },
  "domains": [
    {
      "domain": "OPENNESS",
      "raw": 72,
      "percentile": 11.02,
      "score": "low",
      "facets": [
        { "facet": "imagination", "facetNumber": 1, "raw": 12, "percentile": 12.88, "score": "low" }
      ]
    }
  ]
}
```

- `raw` — the summed item responses **after** reverse-keying (facet 4..20,
  domain 24..120).
- `percentile` — 1..99 versus the Johnson norms (the population-relative score).
- `score` — `low` (<45) / `average` (45–55) / `high` (>55), the library's bands.

`domain` and `facet` use the **same identifiers as the Prisma schema**
(`Big5Domain` enum + the item bank's `facet` machine-name), so a score row joins
straight onto an `AssessmentItemBank` row.

## Run it

```bash
cd services/scoring
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt           # runtime + pytest/httpx
uvicorn app.main:app --reload --port 8000      # http://localhost:8000/docs
pytest                                         # unit + golden + API tests
```

Docker:

```bash
docker build -t rihal-scoring services/scoring
docker run -p 8000:8000 rihal-scoring
# auth-gated:
docker run -p 8000:8000 -e SCORING_SERVICE_TOKEN=$(openssl rand -hex 32) rihal-scoring
```

Then point the Next app at it: `SCORING_SERVICE_URL=http://localhost:8000` (and
the matching `SCORING_SERVICE_TOKEN` if the gate is armed).

## Auth

`SCORING_SERVICE_TOKEN` (optional). When set, every `POST /score` must carry
`Authorization: Bearer <token>` (constant-time compared). Unset = the service is
open, which is fine behind a private network or for local dev. This is defence in
depth — the Next app is the production front door.

## Regenerating the item bank

The Prisma seed loads `prisma/data/ipip-neo-120.ts`, which is **generated**, not
hand-written, from this library + the canonical questions:

```bash
cd services/scoring
pip install -r requirements.txt
python scripts/gen_items.py           # rewrites prisma/data/ipip-neo-120.ts
```

The (domain, facet, keyed) mapping is derived from the library's own scoring
algorithm and 55-item reverse-key list — **adopted, never transcribed**. Review
the diff before committing.

## The Johnson norms — provenance & limits

Percentiles come from **Dr. John A. Johnson's IPIP-NEO community dataset**, the
normative sample embedded in `five-factor-e`'s scoring tables. Provenance and the
limits a hiring decision must respect:

**Provenance**

- The IPIP-NEO-120 items are public domain (International Personality Item Pool,
  Oregon Research Institute) — a 120-item short form of the IPIP-NEO developed by
  Johnson (Johnson, 2014, _J. Research in Personality_ 51:78–89).
- The norms derive from Johnson's large web-collected sample (hundreds of
  thousands of online respondents). The de-identified item-level data is public
  on OSF: **<https://osf.io/jxpu4>** ("IPIP-NEO data repository").
- `five-factor-e` is MIT-licensed and applies IPIP's public-domain permissions;
  it bundles the age/sex norm tables and the cubic percentile transform we call.

**Limits (document these wherever a score is shown — UI-SPEC F)**

- **Self-selected, not census-representative.** The sample is internet volunteers
  curious about personality tests — skewed younger, more educated, English-
  speaking, Western. Percentiles are relative to *that* sample, not to Oman, the
  Gulf, or any specific applicant pool. Treat them as relative signal, not an
  absolute population rank.
- **Not built or validated as a selection instrument.** The IPIP-NEO measures
  normal-range personality; it is not a validated predictor of job performance on
  its own. Use scores as structured input to a human decision, alongside
  evidence — never as an automated gate. (This is why later phases keep a human
  in the loop and an audit trail; ARCHITECTURE §6.)
- **Language/translation.** Norms were collected in English. The Arabic item
  wording (`text_ar`) is a translation for comprehension; it does **not** come
  with its own validated Arabic norms. Cross-language measurement invariance is
  not established here — flag this when reporting Arabic-administered results.
- **Self-report.** Susceptible to social desirability / impression management,
  especially in a hiring context where candidates are motivated to present well.
- **Forced neutral sex norm by default.** We score with `sex="N"` (averaged
  norms) so candidates are not normed by sex; this trades a little norm precision
  for fairness and is the intended default.

## Sources

- five-factor-e — <https://github.com/NeuroQuestAi/five-factor-e> ·
  <https://pypi.org/project/five-factor-e/>
- Johnson IPIP-NEO data (OSF) — <https://osf.io/jxpu4>
- Johnson, J. A. (2014). Measuring thirty facets of the Five Factor Model with a
  120-item public domain inventory. _Journal of Research in Personality_, 51,
  78–89.
- IPIP — <https://ipip.ori.org>

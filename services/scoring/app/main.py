"""
Rihal Aptitude scoring microservice (ARCHITECTURE §6, §12.2).

A small, stateless FastAPI service that turns raw IPIP-NEO-120 answers into
deterministic Big-Five facet/domain scores + Johnson-normed percentiles. It is
DELIBERATELY a separate service (not a Next API route): the psychometric engine
is Python (`five-factor-e`), and keeping it standalone means it can run anywhere
(Cloud Run / Fly / Render / a container next to the DB) with NO Vercel lock-in.
The Next app reaches it through one env var, SCORING_SERVICE_URL.

Trust boundary: this service holds no DB, no PII store, and no secrets. It scores
the body it is given and returns. If SCORING_SERVICE_TOKEN is set, every request
must present `Authorization: Bearer <token>` (constant-time compared); unset = the
service is open (fine behind a private network / for local dev). The Next app's
withInternalAuth seam is the production front door; this is defence in depth.
"""

from __future__ import annotations

import hmac
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .schemas import ScoreRequest, ScoreResponse
from .scoring import score_answers

app = FastAPI(
    title="Rihal Aptitude Scoring Service",
    version="1.0.0",
    description="Deterministic IPIP-NEO-120 Big-Five scoring (five-factor-e + Johnson norms).",
)

_TOKEN = os.environ.get("SCORING_SERVICE_TOKEN")


def _check_auth(authorization: str | None) -> None:
    """Bearer-token gate (no-op when SCORING_SERVICE_TOKEN is unset)."""
    if not _TOKEN:
        return
    presented = ""
    if authorization and authorization.startswith("Bearer "):
        presented = authorization[len("Bearer ") :].strip()
    if not presented or not hmac.compare_digest(presented, _TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict:
    """Liveness probe. Reports whether the Bearer gate is armed (never the token)."""
    return {"status": "ok", "model": "IPIP-NEO-120", "auth_required": bool(_TOKEN)}


@app.post("/score", response_model=ScoreResponse)
def score(req: ScoreRequest, authorization: str | None = Header(default=None)) -> ScoreResponse:
    """Score a completed IPIP-NEO-120 questionnaire -> facet/domain scores + percentiles."""
    _check_auth(authorization)
    answers = {a.itemNumber: a.response for a in req.answers}
    try:
        result = score_answers(answers, sex=req.sex, age=req.age)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ScoreResponse(**result)


@app.exception_handler(HTTPException)
def _http_exc(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

"""Request/response contracts for the scoring service (mirrors lib/validations/scoring.ts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

NUM_ITEMS = 120


class Answer(BaseModel):
    """One item response."""

    itemNumber: int = Field(..., ge=1, le=NUM_ITEMS, description="IPIP-NEO-120 item id 1..120")
    response: int = Field(..., ge=1, le=5, description="Likert 1 (Very Inaccurate) .. 5 (Very Accurate)")


class ScoreRequest(BaseModel):
    """A completed IPIP-NEO-120 questionnaire to score."""

    answers: list[Answer] = Field(..., min_length=NUM_ITEMS, max_length=NUM_ITEMS)
    # Neutral is the inclusive default: it averages the male+female Johnson norms,
    # so the platform does not norm hiring assessments by the candidate's sex.
    sex: Literal["M", "F", "N"] = "N"
    age: int = Field(30, ge=10, le=110)

    @field_validator("answers")
    @classmethod
    def _all_items_present_once(cls, v: list[Answer]) -> list[Answer]:
        nums = [a.itemNumber for a in v]
        if len(set(nums)) != NUM_ITEMS:
            missing = sorted(set(range(1, NUM_ITEMS + 1)) - set(nums))
            dupes = sorted({n for n in nums if nums.count(n) > 1})
            raise ValueError(
                f"answers must cover items 1..{NUM_ITEMS} exactly once "
                f"(missing={missing[:5]}, duplicated={dupes[:5]})"
            )
        return v


class FacetScore(BaseModel):
    facet: str
    facetNumber: int
    raw: int
    percentile: float
    score: Literal["low", "average", "high"]


class DomainScore(BaseModel):
    domain: Literal[
        "OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "NEUROTICISM"
    ]
    raw: int
    percentile: float
    score: Literal["low", "average", "high"]
    facets: list[FacetScore]


class Norms(BaseModel):
    source: str
    via: str
    sex: Literal["M", "F", "N"]
    age: int


class ScoreResponse(BaseModel):
    model: Literal["IPIP-NEO-120"]
    deterministic: bool
    norms: Norms
    domains: list[DomainScore]

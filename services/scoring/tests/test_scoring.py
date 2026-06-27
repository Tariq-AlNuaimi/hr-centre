"""
Unit tests for the deterministic IPIP-NEO-120 scoring (ARCHITECTURE §12.2).

Locks: structure, determinism, reverse-keying direction, a golden regression
snapshot, and input validation. Run: `pytest` from services/scoring/.
"""

import pytest

from app.scoring import score_answers

DOMAINS = {"OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "NEUROTICISM"}


def _uniform(value: int) -> dict[int, int]:
    return {i: value for i in range(1, 121)}


def _facet(result: dict, domain: str, facet: str) -> dict:
    block = next(d for d in result["domains"] if d["domain"] == domain)
    return next(f for f in block["facets"] if f["facet"] == facet)


def test_structure_5_domains_6_facets_each():
    r = score_answers(_uniform(3))
    assert {d["domain"] for d in r["domains"]} == DOMAINS
    assert len(r["domains"]) == 5
    for d in r["domains"]:
        assert len(d["facets"]) == 6
        assert [f["facetNumber"] for f in d["facets"]] == [1, 2, 3, 4, 5, 6]
        for f in d["facets"]:
            assert 1.0 <= f["percentile"] <= 99.0
            assert f["score"] in {"low", "average", "high"}
            assert 4 <= f["raw"] <= 20  # 4 items x 1..5


def test_deterministic_same_input_same_output():
    vec = {i: ((i * 3) % 5) + 1 for i in range(1, 121)}
    assert score_answers(vec, "N", 30) == score_answers(vec, "N", 30)
    r = score_answers(vec)
    assert r["deterministic"] is True
    assert "osf.io/jxpu4" in r["norms"]["source"]


def test_neutral_midpoint_matches_library():
    # All-3 (neutral) -> the library's known normed openness percentile.
    r = score_answers(_uniform(3), sex="N", age=30)
    openness = next(d for d in r["domains"] if d["domain"] == "OPENNESS")
    assert openness["raw"] == 72  # 24 items x 3
    assert openness["percentile"] == pytest.approx(11.02, abs=0.01)


def test_reverse_keying_moves_facets_in_the_right_direction():
    # `imagination` (O1) item 1-pattern: strong agree vs strong disagree must flip
    # the facet from low to high once reverse-keying is applied by the library.
    low = _facet(score_answers(_uniform(1)), "OPENNESS", "imagination")
    high = _facet(score_answers(_uniform(5)), "OPENNESS", "imagination")
    assert low["raw"] < high["raw"]
    assert low["percentile"] < high["percentile"]
    assert low["score"] == "low" and high["score"] == "high"


def test_balanced_domain_raw_is_invariant_to_uniform_answers():
    # Openness has equal +/- keyed items, so a uniform response always nets the
    # domain midpoint (a real property of the instrument, not a bug).
    assert all(
        next(d for d in score_answers(_uniform(v))["domains"] if d["domain"] == "OPENNESS")["raw"] == 72
        for v in (1, 2, 3, 4, 5)
    )


def test_golden_regression_snapshot():
    # Fixed vector -> exact scores. If five-factor-e or our mapping changes, this
    # fails loudly so the change is a conscious one.
    vec = {i: ((i * 7) % 5) + 1 for i in range(1, 121)}
    r = score_answers(vec, sex="N", age=33)
    got = {d["domain"]: [d["raw"], d["percentile"], d["score"]] for d in r["domains"]}
    assert got == {
        "OPENNESS": [72, 11.02, "low"],
        "CONSCIENTIOUSNESS": [76, 24.5, "low"],
        "EXTRAVERSION": [96, 85.09, "high"],
        "AGREEABLENESS": [62, 1.0, "low"],
        "NEUROTICISM": [72, 55.31, "average"],
    }


@pytest.mark.parametrize(
    "answers,msg",
    [
        ({i: 3 for i in range(1, 120)}, "expected 120"),  # 119 answers
        ({**{i: 3 for i in range(1, 121)}, 5: 9}, "responses out of range"),
    ],
)
def test_invalid_inputs_raise(answers, msg):
    with pytest.raises(ValueError) as e:
        score_answers(answers)
    assert msg in str(e.value)

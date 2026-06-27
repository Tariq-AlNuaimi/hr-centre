"""
Deterministic IPIP-NEO-120 scoring (ARCHITECTURE §6, §12.2).

This module is a thin, DETERMINISTIC wrapper around the public-domain
`five-factor-e` library (NeuroQuestAi/five-factor-e, MIT). It NEVER calls an LLM:
the same answers always produce the same scores. Scoring is plain arithmetic over
the IPIP-NEO-120 scoring keys + Johnson's community norms.

We ADOPT the library rather than reinvent it:
  - reverse-keying           -> ipipneo.reverse.ReverseScored120 (the 55-item list)
  - facet/domain bucketing   -> ipipneo.facet.Facet.score / .domain
  - facet labels             -> ipipneo.model.Big5* enums
  - percentiles vs Johnson   -> ipipneo.IpipNeo(120).compute (norms baked into the lib)

We expose TWO layers the spec asks for:
  - raw facet/domain sums (post reverse-key, pre-norm)
  - Johnson-normed percentiles (1..99) + low/average/high bands

The library's `compute()` also returns a random uuid + a timestamp footer; we drop
those so the service response is a pure function of its inputs (testable, cacheable).
"""

from __future__ import annotations

import copy
from typing import Literal

from ipipneo import IpipNeo
from ipipneo.facet import Facet
from ipipneo.model import (
    Big5Agreeableness,
    Big5Conscientiousness,
    Big5Extraversion,
    Big5Neuroticism,
    Big5Openness,
)
from ipipneo.reverse import ReverseScored120
from ipipneo.utility import organize_list_json

# Domain letters in the order the library buckets facets (facet.b5create): the
# facet index cycles N, E, O, A, C. Mapped to the Prisma `Big5Domain` enum names
# so the Next app can join a score straight onto an AssessmentItemBank row.
_DOMAIN_LETTERS = ["N", "E", "O", "A", "C"]
_DOMAIN_ENUM = {
    "O": "OPENNESS",
    "C": "CONSCIENTIOUSNESS",
    "E": "EXTRAVERSION",
    "A": "AGREEABLENESS",
    "N": "NEUROTICISM",
}
# Library compute() order of the personalities array.
_COMPUTE_ORDER = [
    ("openness", "O"),
    ("conscientiousness", "C"),
    ("extraversion", "E"),
    ("agreeableness", "A"),
    ("neuroticism", "N"),
]
_FACET_NAMES = {
    "N": [t.value for t in Big5Neuroticism],
    "E": [t.value for t in Big5Extraversion],
    "O": [t.value for t in Big5Openness],
    "A": [t.value for t in Big5Agreeableness],
    "C": [t.value for t in Big5Conscientiousness],
}

NUM_ITEMS = 120
Sex = Literal["M", "F", "N"]


def _to_library_answers(answers: dict[int, int]) -> dict:
    """{item_number: response} -> five-factor-e's {"answers":[{id_question,id_select}]}."""
    return {
        "answers": [
            {"id_question": n, "id_select": answers[n]} for n in sorted(answers)
        ]
    }


def _raw_facet_sums(answers: dict[int, int]) -> list[int]:
    """
    Raw facet sums (1-indexed 1..30), reverse-keying applied via the library.

    Returns a list `ss` where ss[f] is the summed response for facet index f
    (each facet = 4 items, so 4..20). Mirrors the first half of IpipNeo.compute.
    """
    lib_answers = _to_library_answers(answers)
    reversed_answers = ReverseScored120(answers=copy.deepcopy(lib_answers))
    ordered = organize_list_json(answers=reversed_answers)  # 120 ints, sorted, reversed
    return Facet(NUM_ITEMS).score(answers=ordered)  # ss[0]=0, ss[1..30] facet sums


def score_answers(answers: dict[int, int], sex: Sex = "N", age: int = 30) -> dict:
    """
    Score a completed IPIP-NEO-120 questionnaire.

    Args:
        answers: {item_number(1..120): response(1..5)} -- all 120 required.
        sex:     "M" | "F" | "N" (N = neutral; averages the male+female norms,
                 the inclusive default for hiring -- avoids norming by sex).
        age:     respondent age (10..110); Johnson norms are age-banded.

    Returns a deterministic dict: per-domain raw sum + Johnson percentile + band,
    each with its six facets. No LLM, no randomness.
    """
    if len(answers) != NUM_ITEMS:
        raise ValueError(f"expected {NUM_ITEMS} answers, got {len(answers)}")
    bad = sorted(n for n in answers if not 1 <= n <= NUM_ITEMS)
    if bad:
        raise ValueError(f"item numbers out of range 1..{NUM_ITEMS}: {bad[:5]}")
    bad_resp = sorted({r for r in answers.values() if not 1 <= r <= 5})
    if bad_resp:
        raise ValueError(f"responses out of range 1..5: {bad_resp}")

    ss = _raw_facet_sums(answers)

    # Johnson-normed percentiles + bands (the library does the normalization).
    computed = IpipNeo(question=NUM_ITEMS).compute(
        sex=sex, age=age, answers=_to_library_answers(answers)
    )
    personalities = computed["person"]["result"]["personalities"]
    by_key = {list(p.keys())[0]: list(p.values())[0] for p in personalities}

    domains = []
    for key, letter in _COMPUTE_ORDER:
        block = by_key[key]
        facets = []
        for trait in block["traits"]:
            n = trait["trait"]  # 1..6
            name = _FACET_NAMES[letter][n - 1]
            # Raw facet sum: facet index for (letter, n) is position in the
            # N,E,O,A,C cycle. letter offset + (n-1)*5, 1-indexed.
            facet_index = _DOMAIN_LETTERS.index(letter) + 1 + (n - 1) * 5
            facets.append(
                {
                    "facet": name,
                    "facetNumber": n,
                    "raw": ss[facet_index],
                    "percentile": round(float(trait[name]), 2),
                    "score": trait["score"],
                }
            )
        domains.append(
            {
                "domain": _DOMAIN_ENUM[letter],
                "raw": sum(f["raw"] for f in facets),
                "percentile": round(float(block[letter]), 2),
                "score": block["score"],
                "facets": facets,
            }
        )

    return {
        "model": "IPIP-NEO-120",
        "deterministic": True,
        "norms": {
            "source": "Johnson IPIP-NEO community sample (OSF osf.io/jxpu4)",
            "via": "five-factor-e",
            "sex": sex,
            "age": age,
        },
        "domains": domains,
    }

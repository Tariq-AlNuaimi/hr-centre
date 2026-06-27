#!/usr/bin/env python3
"""
Regenerate the canonical IPIP-NEO-120 item dataset for the Prisma seed.

ADOPT, DON'T TRANSCRIBE: every (domain, facet, keyed) classification is derived
directly from the five-factor-e library's own scoring algorithm + reverse-key
list -- never hand-typed. Re-run this whenever five-factor-e ships a corrected
mapping; review the diff before committing prisma/data/ipip-neo-120.ts.

Sources of truth:
  - item text (text_en):   services/scoring/data/questions-120.json
                           (five-factor-e data repo; Oregon Research Institute,
                           public domain Johnson IPIP-NEO-120 wording).
  - facet/domain position: ipipneo.facet.Facet.score / b5create (the exact loop
                           the library uses to bucket items into 30 facets / 5
                           OCEAN domains).
  - keyed (+/-):           ipipneo.reverse.IPIP_NEO_ITEMS_REVERSED_120 (55 items).
  - facet names:           ipipneo.model.Big5* enums (the library's own labels).

Usage (from services/scoring/, with the venv that has five-factor-e installed):
    python scripts/gen_items.py
Optional overrides: python scripts/gen_items.py <questions.json> <out.ts>
"""
import json
import os
import sys

from ipipneo.model import (
    Big5Agreeableness,
    Big5Conscientiousness,
    Big5Extraversion,
    Big5Neuroticism,
    Big5Openness,
)
from ipipneo.reverse import IPIP_NEO_ITEMS_REVERSED_120

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_QUESTIONS = os.path.join(_HERE, "..", "data", "questions-120.json")
_DEFAULT_OUT = os.path.join(_HERE, "..", "..", "..", "prisma", "data", "ipip-neo-120.ts")

QUESTIONS_PATH = sys.argv[1] if len(sys.argv) > 1 else _DEFAULT_QUESTIONS
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else _DEFAULT_OUT

# Domain cycle as the library buckets facets 1..30 (facet.b5create): the facet
# index cycles N, E, O, A, C; each domain's six facet labels come from model.py.
DOMAIN_ORDER = ["N", "E", "O", "A", "C"]
DOMAIN_ENUM = {
    "N": "NEUROTICISM",
    "E": "EXTRAVERSION",
    "O": "OPENNESS",
    "A": "AGREEABLENESS",
    "C": "CONSCIENTIOUSNESS",
}
FACET_NAMES = {
    "N": [t.value for t in Big5Neuroticism],
    "E": [t.value for t in Big5Extraversion],
    "O": [t.value for t in Big5Openness],
    "A": [t.value for t in Big5Agreeableness],
    "C": [t.value for t in Big5Conscientiousness],
}

REVERSED = set(IPIP_NEO_ITEMS_REVERSED_120)
assert len(REVERSED) == 55, f"expected 55 reverse-keyed items, got {len(REVERSED)}"

with open(QUESTIONS_PATH) as f:
    questions = json.load(f)["questions"]
assert len(questions) == 120, f"expected 120 questions, got {len(questions)}"


def classify(item_number: int):
    """Map IPIP question id (1..120) -> (domain letter, facet_number 1..6, keyed)."""
    # facet.score(): item p accumulates into facet index ((p-1) % 30) + 1.
    facet_index = ((item_number - 1) % 30) + 1
    # facet.b5create(): facet index cycles N,E,O,A,C; facet_number counts per domain.
    domain = DOMAIN_ORDER[(facet_index - 1) % 5]
    facet_number = (facet_index - 1) // 5 + 1
    keyed = "MINUS" if item_number in REVERSED else "PLUS"
    return domain, facet_number, keyed


items = []
counts = {d: {} for d in DOMAIN_ORDER}
for q in questions:
    n = q["id"]
    domain, facet_number, keyed = classify(n)
    facet = FACET_NAMES[domain][facet_number - 1]
    items.append(
        {
            "itemNumber": n,
            "itemCode": f"IPIP120-{n:03d}",
            "domain": DOMAIN_ENUM[domain],
            "facet": facet,
            "facetNumber": facet_number,
            "keyed": keyed,
            "text_en": q["text"],
        }
    )
    counts[domain].setdefault(facet, 0)
    counts[domain][facet] += 1

# Structural invariants (5 domains x 6 facets x 4 items = 120; each facet has 4).
assert len(items) == 120
for d in DOMAIN_ORDER:
    assert len(counts[d]) == 6, f"{d} should have 6 facets, got {len(counts[d])}"
    for facet, c in counts[d].items():
        assert c == 4, f"{d}.{facet} should have 4 items, got {c}"

ts_lines = [
    "// AUTO-GENERATED -- do not edit by hand. Source of truth: the five-factor-e\n"
    "// library (NeuroQuestAi/five-factor-e, MIT) + its IPIP-NEO-120 questions.json\n"
    "// (Oregon Research Institute, public domain). Regenerate via\n"
    "// services/scoring/scripts/gen_items.py (ARCHITECTURE §12.2; Phase 2).\n"
    "//\n"
    "// 120 items = 5 OCEAN domains × 6 facets × 4 items. 55 are reverse-keyed\n"
    "// (keyed: \"MINUS\"); the scoring service recodes those before summing.\n",
    'import type { Big5Domain, ItemKey } from "../../generated/prisma/client";\n',
    "export type Ipip120Item = {",
    "  itemNumber: number;",
    "  itemCode: string;",
    "  domain: Big5Domain;",
    "  facet: string;",
    "  facetNumber: number;",
    "  keyed: ItemKey;",
    "  text_en: string;",
    "};\n",
    "export const IPIP_NEO_120: Ipip120Item[] = [",
]
for it in items:
    ts_lines.append(
        "  { "
        f'itemNumber: {it["itemNumber"]}, '
        f'itemCode: "{it["itemCode"]}", '
        f'domain: "{it["domain"]}", '
        f'facet: "{it["facet"]}", '
        f'facetNumber: {it["facetNumber"]}, '
        f'keyed: "{it["keyed"]}", '
        f'text_en: {json.dumps(it["text_en"])} '
        "},"
    )
ts_lines.append("];\n")

with open(os.path.normpath(OUT_PATH), "w") as f:
    f.write("\n".join(ts_lines))

print(f"Wrote {len(items)} items to {os.path.normpath(OUT_PATH)}")
print("Reverse-keyed:", sum(1 for it in items if it["keyed"] == "MINUS"))

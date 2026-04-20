"""Hebrew-aware phonetic distance for noisy child speech.

Children with autism frequently substitute within phonetic groups:
  - Gutturals: א ה ח ע
  - Sibilants: ס ש צ ז
  - Labials:   ב ו פ
  - Final letters: ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ

A well-tuned distance metric will fold these confusions before computing edit
distance. Generic Levenshtein over raw Unicode misses the structure.

The algorithm choice is still open (Soundex-for-Hebrew vs weighted Levenshtein
over a phonetic key — see the plan). This module exposes the *interface* both
will use so the rest of the system can be wired today.
"""

from __future__ import annotations

HEBREW_LETTERS: frozenset[str] = frozenset(
    "אבגדהוזחטיכלמנסעפצקרשתךםןףץ"
)

GUTTURAL_GROUP: frozenset[str] = frozenset("אהחע")
SIBILANT_GROUP: frozenset[str] = frozenset("ססשצז")
LABIAL_GROUP: frozenset[str] = frozenset("בופ")

# Final-form → standard-form folding.
_FINAL_FOLD: dict[str, str] = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}


def strip_nikud(word: str) -> str:
    """Remove Hebrew diacritics (U+0591..U+05C7). Leaves letters untouched."""
    return "".join(c for c in word if not ("\u0591" <= c <= "\u05C7"))


def phonetic_key(word: str) -> str:
    """Collapse a word to a phonetic signature.

    Skeleton behavior (good enough as a first approximation):
      1. Strip nikud.
      2. Fold final letters (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ).

    TODO: Fold each phonetic group to a single representative (ש→ס, ע→א, …)
    once validated with a speech-language pathologist. That change is
    intentionally deferred — collapsing too aggressively harms distinct words.
    """
    word = strip_nikud(word)
    return "".join(_FINAL_FOLD.get(c, c) for c in word)


def phonetic_distance(a: str, b: str) -> float:
    """Return a normalized distance in [0.0, 1.0].

    0.0 == identical phonetic keys; 1.0 == maximally different.
    Skeleton always raises — the policy and fuzzy_matcher call this, so the
    stub forces us to wire it explicitly when moving past skeleton.
    """
    raise NotImplementedError(
        "hebrew_phonetics.phonetic_distance not implemented — "
        "decide between Soundex-for-Hebrew and weighted Levenshtein first"
    )

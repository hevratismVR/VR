"""Fuzzy match child input to lexicon entries using Hebrew phonetic distance.

Built once from a lexicon; queried per turn. Returns up to top-k candidates
sorted by descending confidence.

Future: ASR confidence multiplies the match confidence; skeleton treats
typed input as confidence 1.0.
"""

from __future__ import annotations

from ..types import LexEntry


class FuzzyMatcher:
    """Hebrew phonetic fuzzy matcher over a lexicon.

    Public API:
      match(text) -> list[tuple[LexEntry, float]]   — top-k, descending

    Dependencies: `nlu.hebrew_phonetics.phonetic_distance`. Skeleton returns
    `[]` because the distance function is not yet implemented.
    """

    def __init__(self, lexicon: dict[str, LexEntry], top_k: int = 3) -> None:
        self._lexicon = lexicon
        self._top_k = top_k

    def match(self, text: str) -> list[tuple[LexEntry, float]]:
        """Tokenize `text` on whitespace and return candidate lex entries.

        Skeleton: always returns []. The real implementation will:
          1. Strip punctuation.
          2. For each token, compute phonetic_distance to every LexEntry.word.
          3. Convert distance → confidence (`1 - distance`) and return top_k.
        """
        _ = (text, self._lexicon, self._top_k)
        return []

"""Snippet index: fast lookup from Hebrew surface form → Snippet list.

Built once after `load_lexicon`. Queried on every turn by the response planner
to assemble an `Utterance`.
"""

from __future__ import annotations

from ..types import LexEntry, Snippet


def build_snippet_index(lex: dict[str, LexEntry]) -> dict[str, list[Snippet]]:
    """Invert the lexicon: surface form → list[Snippet], variants first.

    Multiple lex entries can share a surface form (homographs); in that case
    their snippets are concatenated.

    Skeleton: returns {} until the lexicon loader is implemented.
    """
    index: dict[str, list[Snippet]] = {}
    for entry in lex.values():
        if not entry.snippets:
            continue
        index.setdefault(entry.word, []).extend(entry.snippets)
    return index


def snippets_for_word(
    index: dict[str, list[Snippet]],
    word: str,
    variant: str | None = None,
) -> list[Snippet]:
    """Return snippets for `word`, filtered by `variant` when given.

    Returns `[]` when the word is not in the index. The caller decides whether
    to fall back to `06_pronunciation.syllable_breakdown` decomposition.
    """
    candidates = index.get(word, [])
    if variant is None:
        return list(candidates)
    return [s for s in candidates if s.variant == variant]

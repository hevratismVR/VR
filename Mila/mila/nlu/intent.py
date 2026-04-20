"""Rule-based intent classification.

Consumes: raw text + fuzzy match results + the previous Mila turn (for
context: we compare child's response to the expected answer).
Produces: (Intent, confidence).

Intent is coarse on purpose — fine distinctions belong in the policy.
"""

from __future__ import annotations

from ..types import DialogueTurn, Intent, LexEntry

# Canonical greeting lexemes that always map to GREET.
_GREETINGS = frozenset({"שלום", "היי", "הי", "בוקר טוב", "ערב טוב"})

# Lexemes that request help / repetition.
_REPEAT = frozenset({"שוב", "תחזור", "לא שמעתי"})
_HELP = frozenset({"עזרה", "לא הבנתי", "מה זה"})


def classify_intent(
    text: str,
    matches: list[tuple[LexEntry, float]],
    last_mila_turn: DialogueTurn | None,
) -> tuple[Intent, float]:
    """Classify the child's turn.

    Skeleton heuristic (kept simple, fully wired so the REPL path works):
      - Empty text                            → UNKNOWN, 0.0
      - Exact greeting lexeme                 → GREET, 1.0
      - Repeat/help lexeme                    → REQUEST_REPEAT / REQUEST_HELP
      - Ends with "?"                         → QUESTION
      - No matches meeting threshold          → UNKNOWN, 0.0
      - Matches + there was a Mila question   → ANSWER_* (cannot tell right
                                                from wrong without
                                                DialogueState; policy decides)
      - Otherwise                             → SMALL_TALK

    The TODO below is the real upgrade: compare `matches` against
    `last_mila_turn.matched_lex` (expected answer word_ids) to decide
    ANSWER_CORRECT vs ANSWER_INCORRECT. That requires DialogueState, which
    this layer intentionally does not receive — the DST makes the final call.
    """
    stripped = text.strip()
    if not stripped:
        return Intent.UNKNOWN, 0.0

    if stripped in _GREETINGS:
        return Intent.GREET, 1.0
    if stripped in _REPEAT:
        return Intent.REQUEST_REPEAT, 1.0
    if stripped in _HELP:
        return Intent.REQUEST_HELP, 1.0
    if stripped.endswith("?"):
        return Intent.QUESTION, 0.8

    if not matches:
        return Intent.UNKNOWN, 0.0

    if last_mila_turn is not None and last_mila_turn.matched_lex:
        # The DST refines correct vs incorrect using DialogueState.
        return Intent.ANSWER_CORRECT, matches[0][1]

    return Intent.SMALL_TALK, matches[0][1]

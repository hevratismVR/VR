"""Response policy: (Intent × DialogueState × MilaCharacter) → template key.

The template key is a string of the form `"<category_file>.<field>"`, e.g.
`"04_correct_responses.celebrations"`. The `TemplateEngine` resolves it to
one concrete item from the TalkSphere JSON for the current word.

Rule-based and small on purpose; a future RL policy would slot in here.
"""

from __future__ import annotations

from ..character import MilaCharacter
from ..types import DialogueState, Intent


def choose_template(intent: Intent, state: DialogueState, character: MilaCharacter) -> str:
    """Return a `"<category>.<field>"` template key.

    Core mapping (documented inline so a new maintainer can scan it):

        GREET              → 01_basic.tuki_introductions
        ANSWER_CORRECT     → 04_correct_responses.celebrations
                             (or .specific_praise when intensity == "high")
        ANSWER_INCORRECT   → 05_incorrect_responses.gentle_corrections
        QUESTION           → 03_questions.open_questions_easy
        REQUEST_REPEAT     → 22_fallbacks.rephrasing_options
        REQUEST_HELP       → 22_fallbacks.clarification_offers
        SMALL_TALK         → 01_basic.tuki_introductions
        UNKNOWN (1st)      → 22_fallbacks.simplification
        UNKNOWN (Nth)      → 22_fallbacks.misunderstanding_responses
                             (and .pause_options once N > character.patience_level)
    """
    if intent == Intent.GREET:
        return "01_basic.tuki_introductions"
    if intent == Intent.ANSWER_CORRECT:
        if character.praise_intensity == "high":
            return "04_correct_responses.specific_praise"
        return "04_correct_responses.celebrations"
    if intent == Intent.ANSWER_INCORRECT:
        return "05_incorrect_responses.gentle_corrections"
    if intent == Intent.QUESTION:
        return "03_questions.open_questions_easy"
    if intent == Intent.REQUEST_REPEAT:
        return "22_fallbacks.rephrasing_options"
    if intent == Intent.REQUEST_HELP:
        return "22_fallbacks.clarification_offers"
    if intent == Intent.SMALL_TALK:
        return "01_basic.tuki_introductions"

    # UNKNOWN — escalate based on consecutive_failures vs patience_level.
    if state.consecutive_failures <= 1:
        return "22_fallbacks.simplification"
    if state.consecutive_failures > character.patience_level:
        return "22_fallbacks.pause_options"
    return "22_fallbacks.misunderstanding_responses"

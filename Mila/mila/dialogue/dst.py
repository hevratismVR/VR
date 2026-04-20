"""Dialogue State Tracker (rule-based).

Tracks where the conversation is: current activity, the word under discussion,
the expected answer, child's emotion signals, consecutive failures, turn count.

Swap-point: a future `LLMDialogueStateTracker` can replace this behind the same
`update()` / `state` interface. Not in the skeleton — rule-based is safer for
a therapeutic tool and easier to inspect.
"""

from __future__ import annotations

from ..types import DialogueState, DialogueTurn, Intent, MilaResponse
from .memory import ShortTermMemory


class DialogueStateTracker:
    """Holds a `DialogueState` and a `ShortTermMemory`; updates them per turn.

    Consumers:
      - `runtime.session` calls `update()` then `record_mila_turn()`.
      - `dialogue.policy.choose_template` reads `state`.
      - `generation.response_planner` reads `state`.
    """

    def __init__(self, memory: ShortTermMemory) -> None:
        self._memory = memory
        self._state = DialogueState()

    @property
    def state(self) -> DialogueState:
        return self._state

    @property
    def memory(self) -> ShortTermMemory:
        return self._memory

    def update(self, child_turn: DialogueTurn) -> DialogueState:
        """Fold a child turn into `self._state` and return it.

        Skeleton behavior:
          - Increments turn_count.
          - Tracks consecutive_failures (UNKNOWN → +1; anything else resets).
          - Transitions greeting → lesson after the first non-GREET turn.
          - Leaves child_emotion at "neutral" (no sensor exists).

        The real implementation will also:
          - Refine ANSWER_CORRECT vs ANSWER_INCORRECT using
            state.expected_answer_word_ids.
          - Update child_emotion from `10_emotions` priors.
        """
        self._state.turn_count += 1
        self._memory.remember(child_turn)

        if child_turn.intent == Intent.UNKNOWN:
            self._state.consecutive_failures += 1
        else:
            self._state.consecutive_failures = 0

        if self._state.current_activity == "greeting" and child_turn.intent != Intent.GREET:
            self._state.current_activity = "lesson"

        return self._state

    def record_mila_turn(self, response: MilaResponse) -> None:
        """Persist Mila's own turn into memory and expose expected-answer hints.

        The `matched_lex` of a Mila turn indicates which word_ids she expects
        the child to say next (for questions). The planner populates this
        through the response's `utterance`; skeleton does not yet wire it.
        """
        from datetime import datetime

        mila_turn = DialogueTurn(
            speaker="mila",
            text=response.transcript,
            timestamp=datetime.now(),
            confidence=1.0,
        )
        self._memory.remember(mila_turn)

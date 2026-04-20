"""Short-term memory: a ring buffer of recent DialogueTurns.

Session-scoped only. Not persistent — episodic memory (same-child-next-day
preferences) is a separate future concern.
"""

from __future__ import annotations

from collections import deque

from ..types import DialogueTurn


class ShortTermMemory:
    """Fixed-size ring buffer of recent turns + derived views.

    Consumers:
      - `dst` queries recent() for activity tracking.
      - `response_planner` queries practiced_words() for streak messages.
      - `policy` queries preferred_topics() for free-chat topic selection
        (skeleton always returns []).
    """

    def __init__(self, window: int) -> None:
        if window < 1:
            raise ValueError("memory window must be >= 1")
        self._turns: deque[DialogueTurn] = deque(maxlen=window)

    def remember(self, turn: DialogueTurn) -> None:
        """Append a turn; oldest is evicted when full."""
        self._turns.append(turn)

    def recent(self, n: int | None = None) -> list[DialogueTurn]:
        """Return the last `n` turns (all of them if `n is None`)."""
        turns = list(self._turns)
        return turns if n is None else turns[-n:]

    def practiced_words(self, confidence_threshold: float = 0.5) -> set[str]:
        """`word_id`s the child produced above `confidence_threshold` this session."""
        out: set[str] = set()
        for t in self._turns:
            if t.speaker != "child":
                continue
            if t.confidence < confidence_threshold:
                continue
            out.update(t.matched_lex)
        return out

    def preferred_topics(self) -> list[str]:
        """Heuristic topic list.

        Skeleton returns []. The real implementation aggregates the `category`
        field of matched LexEntries over `self._turns` and ranks by frequency.
        """
        return []

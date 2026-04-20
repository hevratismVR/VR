"""Orchestrate intent → policy → template → Utterance.

Does NOT render audio — that is `audio.audio_weaver.AudioWeaver.render`.
"""

from __future__ import annotations

from ..character import MilaCharacter
from ..types import DialogueState, Intent, Snippet, Utterance
from ..dialogue.policy import choose_template
from .template_engine import TemplateEngine


class ResponsePlanner:
    """Plan one Mila utterance.

    Constructor wires:
      - `engine`     TemplateEngine (reads TalkSphere JSONs)
      - `snippets`   dict[str, list[Snippet]] (surface form → snippets)
      - `character`  MilaCharacter (pace, praise_intensity)
    """

    def __init__(
        self,
        engine: TemplateEngine,
        snippets: dict[str, list[Snippet]],
        character: MilaCharacter,
    ) -> None:
        self._engine = engine
        self._snippets = snippets
        self._character = character

    def plan(self, intent: Intent, state: DialogueState) -> tuple[Utterance, str]:
        """Return `(Utterance, template_key)` for logging.

        Steps:
          1. policy.choose_template(intent, state, character) → key
          2. engine.pick(key, state.current_word_id) → item dict
          3. Tokenize item["text"] on whitespace → words
          4. Resolve each word to a Snippet (skip when missing)
          5. Pauses: character.pace → default pause; emphasis from item hints

        Skeleton: produces an Utterance with empty snippets but a meaningful
        transcript, so the CLI prints something human-readable.
        """
        key = choose_template(intent, state, self._character)
        word_id = state.current_word_id or "ani_001"
        item = self._engine.pick(key, word_id)

        text = str(item.get("text") or f"[{key}]")
        words = text.split()

        snippets: list[Snippet] = []
        for w in words:
            found = self._snippets.get(w)
            if found:
                snippets.append(found[0])

        pause = 120 if self._character.pace == "slow" else 80
        pauses = tuple(pause for _ in range(max(0, len(snippets) - 1)))
        emphasis_value = 0.8 if self._character.praise_intensity == "high" else 0.4
        emphasis = tuple(emphasis_value for _ in snippets)

        utterance = Utterance(
            snippets=tuple(snippets),
            pauses_ms=pauses,
            emphasis=emphasis,
            text_plain=text,
        )
        return utterance, key

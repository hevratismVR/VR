"""MilaSession: the top-level facade that wires everything together.

One instance per child session. Thread-unsafe: one turn at a time.

Wiring (constructor):
    config
      → load_lexicon
      → build_snippet_index
      → FuzzyMatcher
      → MilaCharacter
      → ShortTermMemory
      → DialogueStateTracker
      → TemplateEngine
      → ResponsePlanner
      → AudioWeaver
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..audio.audio_weaver import AudioWeaver
from ..character import load_character
from ..config import MilaConfig, default_config
from ..dialogue.dst import DialogueStateTracker
from ..dialogue.memory import ShortTermMemory
from ..generation.response_planner import ResponsePlanner
from ..generation.template_engine import TemplateEngine
from ..lexicon.loader import load_lexicon
from ..lexicon.snippet_index import build_snippet_index
from ..nlu.fuzzy_matcher import FuzzyMatcher
from ..nlu.intent import classify_intent
from ..types import DialogueTurn, MilaResponse


class MilaSession:
    """One conversation with one child."""

    def __init__(self, config: MilaConfig | None = None) -> None:
        self._config = config or default_config()
        self._character = load_character(self._config.character_file)

        self._lexicon = load_lexicon(
            self._config.lexicon_csv,
            self._config.talksphere_words_dir,
            self._config.snippets_dir,
        )
        self._snippet_index = build_snippet_index(self._lexicon)
        self._matcher = FuzzyMatcher(self._lexicon, top_k=self._config.fuzzy_match_top_k)

        self._memory = ShortTermMemory(self._config.memory_window)
        self._dst = DialogueStateTracker(self._memory)

        self._engine = TemplateEngine(self._config.talksphere_words_dir)
        self._planner = ResponsePlanner(self._engine, self._snippet_index, self._character)
        self._weaver = AudioWeaver(self._config)

        self._closed = False

    def turn(self, child_text: str) -> MilaResponse:
        """Run one full dialogue turn.

        Skeleton behavior:
          1. `matcher.match(text)`                           → may be []
          2. `classify_intent(text, matches, last_mila)`     → Intent
          3. Wrap into `DialogueTurn` and `dst.update(...)`  → DialogueState
          4. `planner.plan(intent, state)`                   → Utterance, key
          5. Call `weaver.render(...)` only if snippets exist (raises otherwise)
          6. `dst.record_mila_turn(response)`
        Returns a `MilaResponse`. Never raises for empty/unknown input.
        """
        last_mila = self._last_mila_turn()
        matches = self._matcher.match(child_text)
        intent, confidence = classify_intent(child_text, matches, last_mila)

        child_turn = DialogueTurn(
            speaker="child",
            text=child_text,
            timestamp=datetime.now(),
            intent=intent,
            confidence=confidence,
            matched_lex=tuple(m[0].word_id for m in matches),
        )
        state = self._dst.update(child_turn)

        utterance, template_key = self._planner.plan(intent, state)

        rendered_path: Path | None = None
        if utterance.snippets:
            candidate = self._config.out_dir / f"utt_{int(datetime.now().timestamp())}.wav"
            # The real weaver writes; skeleton raises, so guard.
            try:
                rendered_path = self._weaver.render(utterance, candidate)
            except NotImplementedError:
                rendered_path = None

        response = MilaResponse(
            utterance=utterance,
            transcript=utterance.text_plain,
            chosen_template_key=template_key,
            dst_snapshot=self._state_snapshot(state),
            rendered_wav_path=rendered_path,
        )
        self._dst.record_mila_turn(response)
        return response

    def close(self) -> None:
        """Idempotent teardown. No-op in the skeleton (no open handles)."""
        self._closed = True

    # -- internals -----------------------------------------------------------

    def _last_mila_turn(self) -> DialogueTurn | None:
        for turn in reversed(self._memory.recent()):
            if turn.speaker == "mila":
                return turn
        return None

    @staticmethod
    def _state_snapshot(state) -> dict:
        return {
            "activity": state.current_activity,
            "word_id": state.current_word_id,
            "emotion": state.child_emotion,
            "consecutive_failures": state.consecutive_failures,
            "turn_count": state.turn_count,
        }

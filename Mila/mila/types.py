"""Shared data contracts for Mila.

Every type here is defined exactly once and reused across modules. The producer
and consumer of each type is documented inline so the data flow is greppable:

    child text
        │
        ▼  (nlu.fuzzy_matcher)
    list[tuple[LexEntry, float]]
        │
        ▼  (nlu.intent)
    (Intent, confidence) ───────────┐
        │                           │
        ▼  (runtime.session)        │
    DialogueTurn ──▶ dialogue.dst ──┴──▶ DialogueState
                                              │
                                              ▼  (dialogue.policy + generation)
                                          Utterance
                                              │
                                              ▼  (audio.audio_weaver)
                                          rendered WAV
                                              │
                                              ▼
                                        MilaResponse

Frozen dataclasses are used where immutability is useful (snippets, entries,
turns, utterances). DialogueState is mutable because the tracker updates it in
place; MilaResponse is mutable so the session can fill rendered_wav_path after
construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Literal


class Intent(str, Enum):
    """Coarse child-turn intent classification.

    Produced by `nlu.intent.classify_intent`. Consumed by `dialogue.dst` and
    `dialogue.policy`. The list intentionally stays small; fine-grained
    branching belongs in the policy, not the intent enum.
    """

    GREET = "greet"
    ANSWER_CORRECT = "answer_correct"
    ANSWER_INCORRECT = "answer_incorrect"
    QUESTION = "question"
    REQUEST_REPEAT = "request_repeat"
    REQUEST_HELP = "request_help"
    SMALL_TALK = "small_talk"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Snippet:
    """A single pre-recorded WAV chunk — typically one Hebrew word.

    Invariants (enforced when the actual WAV is loaded, not at construction):
      - 24 kHz / mono / int16 PCM
      - duration_ms == round(len(samples) * 1000 / sample_rate)

    Produced by `lexicon.snippet_index`. Consumed by `generation.response_planner`
    (to assemble an Utterance) and `audio.audio_weaver` (to render).
    """

    word: str                   # Hebrew surface form, e.g. "שלום"
    word_id: str                # Stable ID, e.g. "shalom_042"
    path: Path                  # Absolute path to the WAV file
    duration_ms: int = 0        # 0 == unknown; filled lazily
    variant: str = "default"    # "default" | "slow" | "excited" | "soft" | …


@dataclass(frozen=True)
class LexEntry:
    """One Hebrew word plus all metadata Mila needs at runtime.

    Produced by `lexicon.loader.load_lexicon`. Consumed by
    `nlu.fuzzy_matcher` (matching), `generation.template_engine` (picking
    responses), and `dialogue.memory` (tracking practiced words).

    `talksphere_dir` is None when TalkSphere has not yet generated JSONs for
    this word — downstream consumers must handle that case gracefully.
    """

    word: str                               # "שלום"
    word_nikud: str                         # "שָׁלוֹם"
    word_id: str                            # "shalom_042"
    category: str                           # e.g., "ברכות"
    difficulty: int                         # 1..5
    translation_en: str
    tags: tuple[str, ...] = ()
    snippets: tuple[Snippet, ...] = ()      # primary first, variants after
    talksphere_dir: Path | None = None      # …/output/words/042_shalom/


@dataclass(frozen=True)
class Utterance:
    """What Mila has decided to say — a sequence of snippets with prosody.

    The `audio_weaver` consumes this to produce a single WAV file. Lengths:
      - len(pauses_ms) == max(0, len(snippets) - 1)
      - len(emphasis) == len(snippets)

    Produced by `generation.response_planner.plan`. Consumed by
    `audio.audio_weaver.render`.
    """

    snippets: tuple[Snippet, ...]
    pauses_ms: tuple[int, ...]
    emphasis: tuple[float, ...]
    text_plain: str                 # for logging / subtitles
    text_nikud: str | None = None


@dataclass(frozen=True)
class DialogueTurn:
    """One speaker's contribution to the dialogue.

    Mila-authored turns set `confidence=1.0` and `intent=None`.
    Produced by `runtime.session` (both sides). Consumed by `dialogue.dst`
    and `dialogue.memory`.
    """

    speaker: Literal["child", "mila"]
    text: str
    timestamp: datetime
    intent: Intent | None = None
    confidence: float = 1.0
    matched_lex: tuple[str, ...] = ()   # word_ids likely said by the child


@dataclass
class DialogueState:
    """Mutable snapshot of where the conversation is.

    Updated in place by `dialogue.dst.DialogueStateTracker.update`.
    Consumed by `dialogue.policy.choose_template` and
    `generation.response_planner`.

    `child_emotion` is always "neutral" in the skeleton — no sensor exists
    yet. The field is present so downstream code can already branch on it.
    """

    current_activity: Literal["greeting", "lesson", "free_chat", "closing"] = "greeting"
    current_word_id: str | None = None
    expected_answer_word_ids: tuple[str, ...] = ()
    child_emotion: Literal["neutral", "engaged", "frustrated", "excited"] = "neutral"
    consecutive_failures: int = 0
    turn_count: int = 0


@dataclass
class MilaResponse:
    """The full result of a single `MilaSession.turn()` call.

    `rendered_wav_path` is None when the audio_weaver is still a stub.
    The CLI prints `transcript` + the list of snippet paths it *would* have
    played.

    Produced by `runtime.session.MilaSession.turn`. Consumed by CLI and tests.
    """

    utterance: Utterance
    transcript: str
    chosen_template_key: str
    dst_snapshot: dict = field(default_factory=dict)
    rendered_wav_path: Path | None = None

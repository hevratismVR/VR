"""Mila — Hebrew VR chatbot for children with autism.

Runtime counterpart to TalkSphere (the offline content generator).
Speaks by stitching pre-recorded 24 kHz mono int16 WAV snippets.

Public surface:
    MilaSession       — top-level facade; one per child session
    MilaConfig        — runtime configuration
    Intent, Snippet, LexEntry, Utterance, DialogueTurn,
    DialogueState, MilaResponse — data contracts flowing between components

This module is a walking-skeleton: most functions raise NotImplementedError.
"""

__version__ = "0.0.1"

from .config import MilaConfig, default_config, load_config
from .runtime.session import MilaSession
from .types import (
    DialogueState,
    DialogueTurn,
    Intent,
    LexEntry,
    MilaResponse,
    Snippet,
    Utterance,
)

__all__ = [
    "__version__",
    "MilaSession",
    "MilaConfig",
    "default_config",
    "load_config",
    "Intent",
    "Snippet",
    "LexEntry",
    "Utterance",
    "DialogueTurn",
    "DialogueState",
    "MilaResponse",
]

"""Stitch Snippet WAVs into one rendered Utterance WAV.

Contract (enforced by audio.io.read_wav):
  - All input WAVs MUST be 24 kHz mono int16 PCM.

Render pipeline:
  1. Read each snippet.
  2. Apply per-snippet emphasis → gain_db.
  3. Crossfade adjacent snippets by `config.crossfade_ms` (capped at
     `duration_ms // 4` for very short snippets).
  4. Insert inter-word silence from `Utterance.pauses_ms`.
  5. Write the result to `out_path`.

The skeleton does not execute this — `render` raises NotImplementedError so
that tests can construct a weaver but a real render call fails loudly until
the implementation lands.
"""

from __future__ import annotations

from pathlib import Path

from ..config import MilaConfig
from ..types import Utterance


class AudioWeaver:
    """Utterance → rendered WAV.

    Consumers: `runtime.session.MilaSession.turn` (and thus the CLI).
    Depends on: `audio.io.read_wav/write_wav`, `audio.prosody.*`, numpy,
    soundfile.
    """

    def __init__(self, config: MilaConfig) -> None:
        self._config = config

    def render(self, utterance: Utterance, out_path: Path) -> Path:
        """Render `utterance` to `out_path` and return the written path.

        Skeleton: if the utterance is empty, returns `out_path` untouched
        (no file written). Otherwise raises NotImplementedError, so a call
        to render a *real* utterance fails fast until we implement it.
        """
        if not utterance.snippets:
            return out_path
        raise NotImplementedError(
            "audio_weaver.render not implemented — snippet crossfade + prosody pending"
        )

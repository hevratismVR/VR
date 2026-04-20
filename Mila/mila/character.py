"""Mila's personality profile.

Analogue of `TUKI_CONFIG` in `TalkSphere/scripts/config.py`, but loaded from
YAML. Affects:
  - Template selection (which phrasing to pick when multiple fit an intent)
  - Prosody (speaking pace → inter-word pause)
  - Fallback escalation (patience_level → how quickly to offer pause_options)

Does NOT affect snippet audio itself — snippets are pre-recorded.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import yaml


@dataclass(frozen=True)
class MilaCharacter:
    """Immutable personality profile.

    Consumers:
      - `dialogue.policy.choose_template` — patience_level, praise_intensity
      - `generation.response_planner`     — pace, catchphrases, greeting_style
    """

    name: str = "מילה"
    greeting_style: Literal["warm", "playful", "quiet"] = "warm"
    pace: Literal["slow", "normal"] = "slow"
    patience_level: int = 4                 # 1..5 (higher = more retries before fallback escalation)
    praise_intensity: Literal["low", "medium", "high"] = "medium"
    catchphrases: tuple[str, ...] = field(default_factory=tuple)


def load_character(path: Path) -> MilaCharacter:
    """Load `MilaCharacter` from YAML.

    Missing file → returns defaults (does not raise). Malformed YAML raises
    `yaml.YAMLError`. Unknown fields are ignored so that the YAML format can
    evolve without breaking existing config files.
    """
    path = Path(path)
    if not path.exists():
        return MilaCharacter()

    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    catchphrases = tuple(data.get("catchphrases") or ())
    return MilaCharacter(
        name=data.get("name", "מילה"),
        greeting_style=data.get("greeting_style", "warm"),
        pace=data.get("pace", "slow"),
        patience_level=int(data.get("patience_level", 4)),
        praise_intensity=data.get("praise_intensity", "medium"),
        catchphrases=catchphrases,
    )

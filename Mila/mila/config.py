"""Runtime configuration for Mila.

Mirrors the `TalkSphere/scripts/config.py` pattern, but loads from YAML so
non-developers (therapists tuning thresholds) can edit it without touching
Python. Programmatic overrides are still possible via `MilaConfig(...)`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from . import paths


@dataclass
class MilaConfig:
    """Central runtime configuration.

    Consumers:
      - `audio.*`           — sample_rate, crossfade_ms, emphasis_gain_db
      - `dialogue.memory`   — memory_window
      - `nlu.fuzzy_matcher` — fuzzy_match_top_k, asr_confidence_threshold
      - `runtime.session`   — all path fields
      - `character.load_character` — character_file

    All paths are absolute after construction. The loader resolves them
    relative to the Mila project root.
    """

    # Audio
    sample_rate: int = 24000
    channels: int = 1
    bit_depth: int = 16
    crossfade_ms: int = 20
    default_inter_word_pause_ms: int = 80
    emphasis_gain_db: float = 3.0

    # Paths (absolute)
    talksphere_root: Path = field(default_factory=lambda: paths.project_root().parent / "TalkSphere")
    talksphere_words_dir: Path = field(default_factory=lambda: paths.project_root().parent / "TalkSphere" / "output" / "words")
    snippets_dir: Path = field(default_factory=lambda: paths.project_root() / "audio" / "snippets")
    out_dir: Path = field(default_factory=lambda: paths.project_root() / "audio" / "out")
    lexicon_csv: Path = field(default_factory=lambda: paths.project_root() / "input" / "lexicon.csv")

    # Dialogue
    memory_window: int = 8
    asr_confidence_threshold: float = 0.55
    fuzzy_match_top_k: int = 3

    # Character
    character_file: Path = field(default_factory=lambda: paths.project_root() / "config" / "mila_character.yaml")


def default_config() -> MilaConfig:
    """Return a MilaConfig with all defaults, paths resolved absolutely.

    Used by tests and by `python -m mila info` when no config file is given.
    Does NOT touch the filesystem.
    """
    return MilaConfig()


def load_config(path: Path | None = None) -> MilaConfig:
    """Load config from YAML; fall back to defaults for missing sections.

    `path` defaults to `<project_root>/config/default.yaml`. If the file does
    not exist, returns `default_config()` unchanged.
    """
    if path is None:
        path = paths.project_root() / "config" / "default.yaml"
    path = Path(path)
    if not path.exists():
        return default_config()

    with path.open("r", encoding="utf-8") as fh:
        data: dict[str, Any] = yaml.safe_load(fh) or {}

    cfg = default_config()
    audio = data.get("audio", {}) or {}
    cfg.sample_rate = int(audio.get("sample_rate", cfg.sample_rate))
    cfg.channels = int(audio.get("channels", cfg.channels))
    cfg.bit_depth = int(audio.get("bit_depth", cfg.bit_depth))
    cfg.crossfade_ms = int(audio.get("crossfade_ms", cfg.crossfade_ms))
    cfg.default_inter_word_pause_ms = int(
        audio.get("default_inter_word_pause_ms", cfg.default_inter_word_pause_ms)
    )
    cfg.emphasis_gain_db = float(audio.get("emphasis_gain_db", cfg.emphasis_gain_db))

    p = data.get("paths", {}) or {}
    root = paths.project_root()
    cfg.talksphere_root = _resolve(p.get("talksphere_root"), root, cfg.talksphere_root)
    cfg.talksphere_words_dir = _resolve(p.get("talksphere_words_dir"), root, cfg.talksphere_words_dir)
    cfg.snippets_dir = _resolve(p.get("snippets_dir"), root, cfg.snippets_dir)
    cfg.out_dir = _resolve(p.get("out_dir"), root, cfg.out_dir)
    cfg.lexicon_csv = _resolve(p.get("lexicon_csv"), root, cfg.lexicon_csv)

    d = data.get("dialogue", {}) or {}
    cfg.memory_window = int(d.get("memory_window", cfg.memory_window))
    cfg.asr_confidence_threshold = float(
        d.get("asr_confidence_threshold", cfg.asr_confidence_threshold)
    )
    cfg.fuzzy_match_top_k = int(d.get("fuzzy_match_top_k", cfg.fuzzy_match_top_k))

    ch = data.get("character", {}) or {}
    cfg.character_file = _resolve(ch.get("file"), root, cfg.character_file)

    return cfg


def _resolve(value: str | None, root: Path, default: Path) -> Path:
    """Resolve a YAML string path relative to `root`. None → `default`."""
    if value is None:
        return default
    p = Path(value)
    return p if p.is_absolute() else (root / p).resolve()

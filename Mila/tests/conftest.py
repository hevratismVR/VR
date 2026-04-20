"""Shared test fixtures. Minimal in the skeleton — expand as real logic lands."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


@pytest.fixture
def empty_snippets_dir(tmp_path: Path) -> Path:
    d = tmp_path / "snippets"
    d.mkdir()
    return d


@pytest.fixture
def fake_lexicon_csv(tmp_path: Path) -> Path:
    """A 2-row CSV matching TalkSphere's words_list.csv schema."""
    path = tmp_path / "lexicon.csv"
    path.write_text(
        "word_id,word,word_nikud,category,difficulty,translation_en,audio_file\n"
        "ani_001,אני,אֲנִי,כינויי גוף,1,I,pronoun_ani.wav\n"
        "shalom_042,שלום,שָׁלוֹם,ברכות,1,hello,greeting_shalom.wav\n",
        encoding="utf-8",
    )
    return path

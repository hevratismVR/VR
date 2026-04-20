"""Smoke tests: the skeleton is wired.

These tests verify that the package imports, the session constructs, and a
full turn returns a well-shaped `MilaResponse`. They do NOT exercise real
algorithms — those raise NotImplementedError by design.
"""

from __future__ import annotations

import mila
from mila import MilaResponse, MilaSession


def test_package_imports() -> None:
    assert mila.__version__
    assert hasattr(mila, "MilaSession")
    assert hasattr(mila, "Utterance")


def test_default_config_resolves() -> None:
    cfg = mila.default_config()
    assert cfg.sample_rate == 24000
    assert cfg.channels == 1
    assert cfg.bit_depth == 16


def test_session_builds() -> None:
    session = MilaSession()
    assert session is not None
    session.close()


def test_turn_returns_mila_response() -> None:
    session = MilaSession()
    try:
        response = session.turn("שלום")
    finally:
        session.close()

    assert isinstance(response, MilaResponse)
    assert response.transcript
    # Intent GREET → 01_basic.tuki_introductions
    assert response.chosen_template_key.startswith("01_basic")


def test_turn_on_unknown_input_does_not_raise() -> None:
    session = MilaSession()
    try:
        response = session.turn("xxxxxx")
    finally:
        session.close()
    # UNKNOWN first occurrence → 22_fallbacks.simplification
    assert response.chosen_template_key.startswith("22_fallbacks")


def test_no_forbidden_imports_after_use() -> None:
    import sys

    MilaSession().turn("שלום")
    loaded = set(sys.modules)
    assert not any("librosa" in m for m in loaded)
    assert not any("pydub" in m for m in loaded)

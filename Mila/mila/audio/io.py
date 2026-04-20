"""Strict WAV I/O: 24 kHz mono int16 only.

Every WAV that enters the pipeline must match the spec; mismatches fail loud
with `AudioFormatError`. The spec is enforced here so downstream code
(`prosody`, `audio_weaver`) can assume invariants without re-checking.
"""

from __future__ import annotations

from pathlib import Path
from typing import Tuple

import numpy as np
import soundfile as sf


class AudioFormatError(ValueError):
    """Raised when a WAV does not match the Mila format spec."""


def read_wav(path: Path, expected_sample_rate: int = 24000) -> Tuple[np.ndarray, int]:
    """Return `(samples_int16, sample_rate)`.

    Asserts: mono, int16 PCM, and `sample_rate == expected_sample_rate`.
    Raises `AudioFormatError` on any mismatch.
    """
    samples, sr = sf.read(str(path), dtype="int16", always_2d=False)
    if sr != expected_sample_rate:
        raise AudioFormatError(
            f"{path}: sample rate {sr} Hz; Mila requires {expected_sample_rate} Hz"
        )
    if samples.ndim != 1:
        raise AudioFormatError(f"{path}: expected mono; got shape {samples.shape}")
    if samples.dtype != np.int16:
        raise AudioFormatError(f"{path}: expected int16; got {samples.dtype}")
    return samples, sr


def write_wav(path: Path, samples: np.ndarray, sample_rate: int = 24000) -> None:
    """Write `samples` (int16, 1-D) as a WAV at `sample_rate`.

    The caller is responsible for ensuring the dtype and dimensionality.
    Raises `AudioFormatError` rather than silently re-encoding.
    """
    if samples.ndim != 1:
        raise AudioFormatError(f"expected mono 1-D; got shape {samples.shape}")
    if samples.dtype != np.int16:
        raise AudioFormatError(f"expected int16; got {samples.dtype}")
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), samples, sample_rate, subtype="PCM_16")

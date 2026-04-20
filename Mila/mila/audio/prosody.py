"""Pure-numpy prosody helpers for the audio_weaver.

Each function assumes int16 mono arrays at the pipeline's sample rate.
"""

from __future__ import annotations

import numpy as np


def silence_samples(duration_ms: int, sample_rate: int = 24000) -> np.ndarray:
    """Return a 1-D int16 silence buffer of `duration_ms` milliseconds."""
    n = int(round(sample_rate * duration_ms / 1000))
    return np.zeros(n, dtype=np.int16)


def linear_crossfade(a: np.ndarray, b: np.ndarray, fade_samples: int) -> np.ndarray:
    """Return `a` followed by `b` with a linear crossfade of `fade_samples`.

    Safe when either buffer is shorter than `fade_samples` — the fade shrinks
    to `min(fade_samples, len(a), len(b))`. Output dtype matches inputs.
    """
    fade = int(max(0, min(fade_samples, len(a), len(b))))
    if fade == 0:
        return np.concatenate([a, b])

    ramp = np.linspace(1.0, 0.0, fade, dtype=np.float32)
    a_tail = a[-fade:].astype(np.float32) * ramp
    b_head = b[:fade].astype(np.float32) * (1.0 - ramp)
    mixed = np.clip(a_tail + b_head, -32768, 32767).astype(np.int16)
    return np.concatenate([a[:-fade], mixed, b[fade:]])


def apply_gain_db(samples: np.ndarray, gain_db: float) -> np.ndarray:
    """Return `samples` scaled by `gain_db`, clipped to int16 range."""
    if gain_db == 0.0:
        return samples
    factor = float(10.0 ** (gain_db / 20.0))
    scaled = samples.astype(np.float32) * factor
    return np.clip(scaled, -32768, 32767).astype(np.int16)


def emphasis_to_gain_db(emphasis: float, max_db: float) -> float:
    """Map emphasis ∈ [0, 1] to a gain in dB, capped at `max_db`."""
    return float(max(0.0, min(1.0, emphasis)) * max_db)

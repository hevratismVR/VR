"""Audio layer: strict 24 kHz mono int16 WAV IO, prosody helpers, weaver.

All audio operations assume the format spec — enforced at IO time so that
corrupt or mismatched snippets never reach the weaver.
"""

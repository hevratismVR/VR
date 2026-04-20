"""Parse the Mila lexicon CSV and attach TalkSphere metadata + snippet paths.

The CSV is the authoritative word list. TalkSphere JSONs enrich each entry
when present (some entries may not yet have generated JSONs — handled
gracefully). WAV files under `snippets_dir` attach as `Snippet` objects.
"""

from __future__ import annotations

from pathlib import Path

from .. import paths
from ..types import LexEntry


def load_lexicon(
    csv_path: Path,
    talksphere_words: Path,
    snippets_dir: Path,
) -> dict[str, LexEntry]:
    """Return a mapping from `word_id` to `LexEntry`.

    Inputs:
      csv_path         — Mila lexicon CSV (symlink to TalkSphere `words_list.csv`
                         in the skeleton). UTF-8 encoded.
      talksphere_words — TalkSphere `output/words/` directory; may contain only
                         a subset of the CSV rows.
      snippets_dir     — Where WAV files live. Matched by the CSV's
                         `audio_file` column when present.

    Behavior:
      - Missing CSV → empty dict (logged, does not raise).
      - Missing TalkSphere word folder → LexEntry with `talksphere_dir=None`.
      - Missing WAV → LexEntry with empty `snippets`.
      - Malformed rows → skipped with a warning.

    Skeleton: returns an empty dict. The real implementation will use
    `csv.DictReader` and `paths.word_dir_for`.
    """
    # Referenced to keep the imports honest; the real implementation resolves
    # word_dirs and category files here.
    _ = (csv_path, talksphere_words, snippets_dir, paths)
    return {}


def load_default_lexicon() -> dict[str, LexEntry]:
    """Convenience wrapper using `default_config()` paths. Returns `{}` in the
    skeleton. Used by tests and by the CLI when no explicit paths are given.
    """
    from ..config import default_config

    cfg = default_config()
    return load_lexicon(cfg.lexicon_csv, cfg.talksphere_words_dir, cfg.snippets_dir)

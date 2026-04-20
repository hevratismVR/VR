"""Filesystem path resolution for Mila.

Keeps all repo-layout assumptions in one place so individual modules do not
hard-code "../TalkSphere" / "output/words". If the layout changes, only this
module is updated.
"""

from __future__ import annotations

from pathlib import Path


def package_root() -> Path:
    """Absolute path to the `mila/` Python package directory."""
    return Path(__file__).resolve().parent


def project_root() -> Path:
    """Absolute path to the `Mila/` project directory (parent of the package)."""
    return package_root().parent


def talksphere_root(config_hint: Path | None = None) -> Path:
    """Resolve the TalkSphere checkout.

    Order of resolution:
      1. `config_hint` if provided (may be relative to project_root()).
      2. `../TalkSphere` relative to project_root().

    Raises `FileNotFoundError` with a remediation message if neither exists.
    The skeleton returns the path even when the directory is partially
    populated — downstream consumers must handle missing categories.
    """
    candidates: list[Path] = []
    if config_hint is not None:
        hint = Path(config_hint)
        if not hint.is_absolute():
            hint = (project_root() / hint).resolve()
        candidates.append(hint)
    candidates.append((project_root().parent / "TalkSphere").resolve())

    for c in candidates:
        if c.exists():
            return c

    raise FileNotFoundError(
        "TalkSphere checkout not found. Expected a sibling directory at "
        f"{candidates[-1]}. Clone TalkSphere next to Mila/ or set "
        "paths.talksphere_root in config/default.yaml."
    )


def word_dir_for(talksphere_words: Path, word_id: str) -> Path | None:
    """Map a `word_id` like "ani_001" to the matching TalkSphere word folder.

    TalkSphere uses `NNN_<translit>/` folder names (e.g., `001_ani/`). This
    helper does best-effort matching: splits `word_id` on "_" and treats the
    trailing integer (or the full tail) as the numeric prefix.

    Returns `None` if no folder matches.
    """
    if not talksphere_words.exists():
        return None

    # word_id convention is "<translit>_<NNN>"; e.g., "ani_001".
    parts = word_id.rsplit("_", 1)
    if len(parts) != 2 or not parts[1].isdigit():
        return None
    translit, num = parts[0], parts[1]
    folder = talksphere_words / f"{num}_{translit}"
    return folder if folder.exists() else None


def category_file(word_dir: Path, category_id: str) -> Path | None:
    """Return the path to a category JSON inside a word directory.

    Example: (`…/001_ani/`, `06_pronunciation`) → `…/001_ani/06_pronunciation.json`.
    Returns None when the file does not exist.
    """
    candidate = word_dir / f"{category_id}.json"
    return candidate if candidate.exists() else None

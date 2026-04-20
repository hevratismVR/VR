"""Load TalkSphere category JSONs lazily and pick items by template key.

Template key format: `"<category_file>.<field>"`, e.g.
`"04_correct_responses.celebrations"`. Caches loaded JSON in memory.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from .. import paths


class TemplateEngine:
    """Serve one template item per request, drawn from TalkSphere JSON.

    Consumers: `generation.response_planner.plan`.

    The skeleton returns a deterministic placeholder dict when the requested
    file doesn't exist. That's what keeps the REPL working before any JSONs
    are generated for a word.
    """

    def __init__(self, talksphere_words: Path) -> None:
        self._words_root = Path(talksphere_words)
        self._cache: dict[Path, dict] = {}

    def pick(
        self,
        template_key: str,
        word_id: str,
        rng_seed: int | None = None,
    ) -> dict:
        """Return one item from the named JSON array.

        Resolution:
          1. Locate the word folder via `paths.word_dir_for`.
          2. Locate `<category_file>.json` within it.
          3. Parse JSON; navigate to `<field>` (dot path).
          4. Pick one element (random unless `rng_seed` given).

        Returns a placeholder dict when any step fails. Never raises — the
        runtime must keep speaking even when data is incomplete.
        """
        category_file_id, _, field = template_key.partition(".")
        word_dir = paths.word_dir_for(self._words_root, word_id)
        placeholder = {
            "text": f"[{template_key}]",
            "_key": template_key,
            "_source": "placeholder",
        }
        if word_dir is None:
            return placeholder

        json_path = paths.category_file(word_dir, category_file_id)
        if json_path is None:
            return placeholder

        data = self._load(json_path)
        items = data.get(field) if isinstance(data, dict) else None
        if not items or not isinstance(items, list):
            return placeholder

        rng = random.Random(rng_seed)
        chosen = rng.choice(items)
        if isinstance(chosen, dict):
            chosen = dict(chosen)
            chosen.setdefault("_key", template_key)
            chosen.setdefault("_source", str(json_path))
            return chosen
        return {"text": str(chosen), "_key": template_key, "_source": str(json_path)}

    def available_keys(self, word_id: str) -> list[str]:
        """Introspection helper: every `<file>.<field>` with an array value
        for this word. Useful for `python -m mila info --word …`.
        """
        word_dir = paths.word_dir_for(self._words_root, word_id)
        if word_dir is None:
            return []
        keys: list[str] = []
        for json_path in sorted(word_dir.glob("*.json")):
            data = self._load(json_path)
            if not isinstance(data, dict):
                continue
            file_id = json_path.stem
            for field, value in data.items():
                if isinstance(value, list):
                    keys.append(f"{file_id}.{field}")
        return keys

    def _load(self, path: Path) -> dict:
        cached = self._cache.get(path)
        if cached is not None:
            return cached
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            data = {}
        self._cache[path] = data
        return data

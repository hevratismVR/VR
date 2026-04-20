# Mila — מילה

Hebrew VR chatbot for children with autism (ages 3–12). Runs on Quest 3 / PICO 4.
Speaks by stitching pre-recorded 24 kHz WAV snippets (no TTS).

> **Status: walking skeleton.** Every module has a docstring and a stub.
> No audio files yet. No real algorithms. Goal of this layout is that a new
> developer can open any file and understand where it fits.

## Relationship to TalkSphere

```
┌──────────────────────────┐       ┌───────────────────────┐
│ TalkSphere (offline)     │       │ Mila (runtime)        │
│ Claude → 24 category     │  JSON │ DST + AudioWeaver +   │
│ JSONs per Hebrew word    │──────▶│ Template Engine →     │
│ (01_basic…24_metadata)   │       │ rendered WAV          │
└──────────────────────────┘       └───────────────────────┘
```

Mila expects a sibling checkout at `../TalkSphere/`.

## Quickstart

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

python -m mila info            # prints resolved paths + active config
python -m mila say "שלום"       # prints would-be rendered utterance
python -m mila repl            # interactive loop
pytest -q                      # smoke tests
```

> `soundfile` needs the system `libsndfile`. On Debian/Ubuntu:
> `sudo apt-get install libsndfile1`.

## Audio spec (non-negotiable)

- **Sample rate**: 24000 Hz
- **Channels**: mono
- **Bit depth**: 16-bit PCM
- **Container**: WAV

The whole pipeline assumes these. `audio.io` enforces them at load time.

## Architecture at a glance

```
child text ─┐
            ▼
 FuzzyMatcher ─▶ Intent ─▶ DST ─▶ Policy ─▶ TemplateEngine ─▶ ResponsePlanner ─▶ AudioWeaver ─▶ WAV
                                   │                                                   ▲
                                   └── ShortTermMemory ◀── DialogueTurn ──────────────┘
```

See `docstring` at the top of each module for its contract.

## Directory tour

```
Mila/
├── mila/                # Python package
│   ├── types.py         # Shared dataclasses (Utterance, LexEntry, …)
│   ├── config.py        # MilaConfig + YAML loader
│   ├── character.py     # Mila personality profile
│   ├── cli.py           # `python -m mila` entry point
│   ├── paths.py         # TalkSphere path resolution
│   ├── lexicon/         # CSV + JSON → LexEntry; snippet index
│   ├── nlu/             # Hebrew phonetics, fuzzy match, intent
│   ├── dialogue/        # DST, short-term memory, policy
│   ├── generation/      # Template engine, response planner
│   ├── audio/           # WAV IO, prosody, audio_weaver
│   └── runtime/         # MilaSession facade
├── config/              # default.yaml, mila_character.yaml
├── input/               # lexicon CSV (symlink to TalkSphere)
├── audio/               # snippets/ (empty), out/ (render target)
└── tests/               # smoke test only
```

## TalkSphere → Mila mapping (short)

| TalkSphere field | Mila consumer |
|------------------|---------------|
| `words_list.csv` | `lexicon.loader` — base LexEntry |
| `01_basic.tuki_introductions` | TemplateEngine on GREET |
| `04_correct_responses.celebrations` | on ANSWER_CORRECT |
| `05_incorrect_responses.gentle_corrections` | on ANSWER_INCORRECT |
| `06_pronunciation.syllable_breakdown` | snippet fallback decomposition |
| `22_fallbacks.*` | policy on UNKNOWN / REQUEST_REPEAT / REQUEST_HELP |

Full mapping is in the plan doc and in module docstrings.

## Configuration

Runtime config lives in `config/default.yaml` and loads into `MilaConfig`.
Override with `--config path/to/file.yaml` on the CLI.

Mila's personality lives in `config/mila_character.yaml` — editable by
therapists without touching Python.

## Testing

```bash
pytest -q
```

The single smoke test verifies: package imports, session constructs, `turn()`
returns a `MilaResponse` — it does not exercise real logic (there isn't any yet).

## Roadmap (post-skeleton)

1. Hebrew phonetic distance algorithm (needs speech-pathology input).
2. Record snippet corpus at 24 kHz mono int16.
3. Wire `audio_weaver.render` (crossfade + prosody).
4. ASR integration (faster-whisper).
5. Unity / Quest bridge.
6. Episodic memory across sessions.

## Open design questions

See the "שאלות פתוחות" section in the plan doc
(`/root/.claude/plans/recursive-questing-kurzweil.md`).

"""Command-line interface for Mila.

Subcommands:
  info        Print resolved paths + active config (sanity check).
  say TEXT    One-shot: feed TEXT to a session and print the response.
  repl        Read Hebrew text line-by-line from stdin; print responses.

In the skeleton, `say` and `repl` print `would play: [<snippet paths>]`
instead of actually playing audio (audio_weaver is a stub).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .config import load_config
from .runtime.session import MilaSession


def build_parser() -> argparse.ArgumentParser:
    """Construct the argparse tree."""
    p = argparse.ArgumentParser(prog="mila", description="Mila Hebrew VR chatbot (skeleton)")
    p.add_argument("--version", action="version", version=f"mila {__version__}")
    p.add_argument("--config", type=Path, default=None, help="Path to config YAML (default: config/default.yaml)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("info", help="Print resolved paths + active config")

    p_say = sub.add_parser("say", help="Feed one Hebrew utterance and print response")
    p_say.add_argument("text", help="Hebrew text, e.g. שלום")

    sub.add_parser("repl", help="Interactive loop reading stdin")

    return p


def cmd_info(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    print(f"mila {__version__}")
    print(f"  sample_rate         : {cfg.sample_rate} Hz")
    print(f"  channels            : {cfg.channels}")
    print(f"  bit_depth           : {cfg.bit_depth}")
    print(f"  crossfade_ms        : {cfg.crossfade_ms}")
    print(f"  talksphere_root     : {cfg.talksphere_root} (exists={cfg.talksphere_root.exists()})")
    print(f"  talksphere_words    : {cfg.talksphere_words_dir} (exists={cfg.talksphere_words_dir.exists()})")
    print(f"  snippets_dir        : {cfg.snippets_dir} (exists={cfg.snippets_dir.exists()})")
    print(f"  out_dir             : {cfg.out_dir} (exists={cfg.out_dir.exists()})")
    print(f"  lexicon_csv         : {cfg.lexicon_csv} (exists={cfg.lexicon_csv.exists()})")
    print(f"  character_file      : {cfg.character_file} (exists={cfg.character_file.exists()})")
    print(f"  memory_window       : {cfg.memory_window}")
    print(f"  fuzzy_match_top_k   : {cfg.fuzzy_match_top_k}")
    return 0


def cmd_say(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    session = MilaSession(cfg)
    response = session.turn(args.text)
    _print_response(response)
    session.close()
    return 0


def cmd_repl(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    session = MilaSession(cfg)
    try:
        print("mila repl — type Hebrew text, Ctrl-D to exit")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            _print_response(session.turn(line))
    finally:
        session.close()
    return 0


def _print_response(response) -> None:
    paths = [str(s.path) for s in response.utterance.snippets]
    print(f"mila: {response.transcript}")
    print(f"  template: {response.chosen_template_key}")
    print(f"  would play: {paths}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handlers = {"info": cmd_info, "say": cmd_say, "repl": cmd_repl}
    return handlers[args.cmd](args)

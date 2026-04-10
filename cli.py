#!/usr/bin/env python3
"""EpiChat command-line interface."""

import argparse
import io
import sys
from pathlib import Path

# Force UTF-8 output on Windows so Claude's narration text prints cleanly
if sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from epichat.epichat import EpiChat


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="epichat",
        description="EpiChat: natural language → Starsim epidemiological simulation",
    )
    parser.add_argument(
        "query",
        nargs="?",
        help="Natural language simulation query (omit for interactive mode)",
    )
    parser.add_argument(
        "--output-dir",
        default="results",
        help="Directory to save plot outputs (default: results/)",
    )
    args = parser.parse_args()

    chat = EpiChat(output_dir=args.output_dir)

    if args.query:
        result = chat.run(args.query)
        print(result.format_cli())
    else:
        # Interactive mode
        print("EpiChat v0.1 — Interactive Mode  (type 'quit' to exit)")
        print("=" * 55)
        while True:
            try:
                query = input("\nYour query: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nGoodbye.")
                break
            if query.lower() in {"quit", "exit", "q"}:
                print("Goodbye.")
                break
            if not query:
                continue
            result = chat.run(query)
            print(result.format_cli())


if __name__ == "__main__":
    main()

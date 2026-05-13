#!/usr/bin/env python3
"""Read JSON config from stdin, print generate() JSON on stdout. Seeds random for reproducible parity tests."""
import json
import os
import random
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

random.seed(42)

from school.timetable_generator import generate  # noqa: E402


def main() -> None:
    cfg = json.load(sys.stdin)
    out = generate(cfg)
    json.dump(out, sys.stdout, default=str)


if __name__ == "__main__":
    main()

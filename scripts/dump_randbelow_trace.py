#!/usr/bin/env python3
"""Emit randbelow trace during generate (random.seed(42) before import)."""
import json
import os
import random
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

random.seed(42)
inst = random._inst
_calls: list[list[int]] = []
_orig = inst._randbelow


def wrap(n: int) -> int:
    j = _orig(n)
    _calls.append([n, j])
    return j


inst._randbelow = wrap  # type: ignore[method-assign]

from school.timetable_generator import generate  # noqa: E402

cfg = json.load(sys.stdin)
generate(cfg)
json.dump(_calls, sys.stdout)

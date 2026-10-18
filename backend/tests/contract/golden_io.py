"""계약 골든 입출력 (SDD-211 C2).

골든 쓰기는 `UPDATE_CONTRACT_GOLDEN=1` 일 때만 허용하고, `CI=true` 이면 항상 거부한다
(CI 가 골든을 조용히 덮어쓰는 사고 방지). 쓰기 후에는 사람이 `git diff` 를 보고 커밋한다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE_ENV = "UPDATE_CONTRACT_GOLDEN"


class GoldenWriteRefused(RuntimeError):
    """골든 쓰기가 허용되지 않는 환경."""


def update_requested() -> bool:
    return os.environ.get(UPDATE_ENV) == "1"


def _in_ci() -> bool:
    return os.environ.get("CI", "").strip().lower() in ("1", "true")


def assert_write_allowed() -> None:
    if _in_ci():
        raise GoldenWriteRefused("CI 환경에서는 계약 골든을 쓸 수 없다")
    if not update_requested():
        raise GoldenWriteRefused(f"{UPDATE_ENV}=1 일 때만 계약 골든을 쓸 수 있다")


def load_golden(name: str, directory: Path = GOLDEN_DIR) -> Any:
    return json.loads((directory / name).read_text(encoding="utf-8"))


def write_golden(name: str, data: Any, directory: Path = GOLDEN_DIR) -> Path:
    assert_write_allowed()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(data, sort_keys=True, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path

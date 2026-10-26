"""SDD-246 T05 — 서버 wire 검증이 contracts/session-live-v2 fixture 와 일치하는지 대조(순수, DB 불필요)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.schemas import session_live_v2 as w

FIX = Path(__file__).parents[4] / "contracts" / "session-live-v2" / "fixtures"
SCHEMA = Path(__file__).parents[4] / "contracts" / "session-live-v2" / "schema" / "command.schema.json"


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))["message"]


VALID = sorted((FIX / "valid").glob("command-*.json"))
INVALID = sorted((FIX / "invalid").glob("cmd-*.json"))


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_유효_command_fixture는_서버가_받아들인다(path):
    cmd = w.parse_command(_load(path))
    assert cmd.kind in w.KIND_PAYLOAD


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_무효_command_fixture는_서버가_거절한다(path):
    msg = _load(path)
    why = json.loads(path.read_text(encoding="utf-8"))["$fixture"]
    with pytest.raises(w.WireError):
        cmd = w.parse_command(msg)
        # 개인정보 값 같은 의미 검증은 payload 허용 키 밖이므로 파서에서 걸러져야 한다
        raise AssertionError(f"{path.stem}: 거절돼야 하는데 통과 ({why})")


def test_KIND_PAYLOAD가_계약_schema와_동일하다():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    from_schema = {}
    for branch in schema["oneOf"]:
        pl = branch["properties"]["payload"]
        from_schema[branch["properties"]["kind"]["const"]] = (frozenset(pl.get("required", [])), frozenset(pl["properties"]))
    assert from_schema == w.KIND_PAYLOAD


def test_u64는_십진_문자열만_받는다():
    for bad in ("01", "-1", "1.5", 5, None, "18446744073709551616"):
        with pytest.raises(w.WireError):
            w.parse_u64(bad, "x")
    assert w.parse_u64("18446744073709551615", "x") == (1 << 64) - 1

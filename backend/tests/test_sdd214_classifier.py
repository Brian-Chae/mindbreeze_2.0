"""SDD-214 C1: 세션 분류 함수 단위 테스트 (plan §4.1, verify CL-1~CL-7)."""
import dataclasses
import re
from pathlib import Path

import pytest

from app.services import session_classifier
from app.services.session_classifier import (
    Classification,
    SessionFacts,
    classify_session,
)

MODULE_PATH = Path(session_classifier.__file__)


def _facts(type_: str, mode: str, is_template: bool = False) -> SessionFacts:
    return SessionFacts(is_template=is_template, type=type_, participant_mode=mode)


# CL-1: T0
@pytest.mark.parametrize("type_", ["clinical", "hypnosis", "meditation", "custom", "bogus"])
def test_template_has_no_parent(type_: str) -> None:
    result = classify_session(_facts(type_, "group", is_template=True))
    assert result == Classification(parent_kind="none", rule="T0")


def test_template_wins_even_with_unknown_mode() -> None:
    assert classify_session(_facts("meditation", "???", is_template=True)).rule == "T0"


# CL-2: C1
@pytest.mark.parametrize("mode", ["group", "one_on_one"])
def test_meditation_is_class_regardless_of_mode(mode: str) -> None:
    result = classify_session(_facts("meditation", mode))
    assert result == Classification(parent_kind="meditation_class", rule="C1")


# CL-3: C2
@pytest.mark.parametrize("type_", ["clinical", "hypnosis", "custom"])
def test_group_non_meditation_is_class(type_: str) -> None:
    result = classify_session(_facts(type_, "group"))
    assert result == Classification(parent_kind="meditation_class", rule="C2")


# CL-4: R3 (정원은 입력에 없다)
@pytest.mark.parametrize("type_", ["clinical", "hypnosis", "custom"])
def test_one_on_one_non_meditation_is_counseling(type_: str) -> None:
    result = classify_session(_facts(type_, "one_on_one"))
    assert result == Classification(parent_kind="counseling_relationship", rule="R3")


# CL-5: X0 — 예외 없이 결과로 반환
@pytest.mark.parametrize(
    "type_,mode",
    [
        ("bogus", "group"),
        ("bogus", "one_on_one"),
        ("clinical", "bogus"),
        ("hypnosis", ""),
        ("", "group"),
        ("Clinical", "group"),
        ("custom", "GROUP"),
    ],
)
def test_unknown_values_are_unclassifiable(type_: str, mode: str) -> None:
    result = classify_session(_facts(type_, mode))
    assert result == Classification(parent_kind="unclassifiable", rule="X0")


def test_meditation_with_unknown_mode_is_still_c1() -> None:
    # 명상은 참여 방식이 어느 쪽이든 C1 (plan §4.1 행 1)
    assert classify_session(_facts("meditation", "bogus")).rule == "C1"


def test_custom_type_name_boundary_is_not_an_input() -> None:
    # 경계: custom_type_name(NULL 포함)은 판정 입력이 아니다
    names = {f.name for f in dataclasses.fields(SessionFacts)}
    assert names == {"is_template", "type", "participant_mode"}
    assert classify_session(_facts("custom", "one_on_one")).rule == "R3"


# CL-6: 순수성
def test_same_input_same_output() -> None:
    facts = _facts("clinical", "group")
    assert classify_session(facts) == classify_session(facts)
    assert classify_session(facts) is not None


def test_input_and_output_are_immutable() -> None:
    facts = _facts("clinical", "group")
    with pytest.raises(dataclasses.FrozenInstanceError):
        facts.type = "meditation"  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        classify_session(facts).rule = "X0"  # type: ignore[misc]


def test_module_has_no_io_or_db_imports() -> None:
    source = MODULE_PATH.read_text(encoding="utf-8")
    imports = re.findall(r"^\s*(?:from|import)\s+([\w.]+)", source, flags=re.M)
    forbidden = (
        "sqlalchemy", "app.core", "app.models", "app.db", "datetime", "time",
        "random", "os", "uuid", "logging", "requests", "httpx", "boto3", "redis",
    )
    bad = [m for m in imports if m.split(".")[0] in forbidden or m.startswith(forbidden)]
    assert bad == []


# CL-7: 규칙표 전수
def test_all_rule_codes_are_covered() -> None:
    cases = [
        _facts("clinical", "group", is_template=True),
        _facts("meditation", "group"),
        _facts("clinical", "group"),
        _facts("clinical", "one_on_one"),
        _facts("bogus", "group"),
    ]
    assert {classify_session(c).rule for c in cases} == {"T0", "C1", "C2", "R3", "X0"}

"""구 계약(`/sessions/*` 61 라우트) OpenAPI 골든 계약 테스트 (SDD-211 C2).

골든은 Phase 0 시작 시점의 동작을 그대로 박제한 것이다(버그 포함, 정리 금지).
가산(새 응답 속성·새 선택 요청 속성·새 라우트)은 통과하고, 구 앱이 의존할 수 있는 삭제·변경은 실패한다.
변이 주입 테스트(CS-10)는 실제 골든/현재 계약의 복사본을 깨뜨려 비교기가 잡는지 확인한다.
의도적 파괴는 `golden/breaking_exemptions.json` 항목(SDD 번호·사유·expires_phase)으로만 통과한다.
"""

from __future__ import annotations

import warnings

import pytest

from tests.contract import compat, golden_io

BASELINE_OPERATIONS = 61
SESSION_RESPONSE = "SessionResponse"
SESSION_CREATE = "SessionCreateRequest"
SESSION_OP = "GET /api/v1/sessions/{session_id}"
CREATE_OP = "POST /api/v1/sessions"


def _violations(golden: dict, current: dict, exemptions: list) -> list[compat.Violation]:
    result = compat.compare_contract(golden, current)
    return compat.apply_exemptions(result.violations, exemptions)


def test_CS1_라우트_집합이_골든과_일치한다(golden_contract, current_contract):
    golden_ops = golden_contract["operations"]
    assert golden_contract["meta"]["baseline_operation_count"] == BASELINE_OPERATIONS
    assert len(golden_ops) >= BASELINE_OPERATIONS
    removed = sorted(set(golden_ops) - set(current_contract["operations"]))
    assert removed == [], f"삭제·이름변경된 라우트: {removed}"

    result = compat.compare_contract(golden_contract, current_contract)
    status_changes = [v for v in result.violations if v.change == "status_changed"]
    assert status_changes == []
    for message in result.warnings:
        if "신규 라우트" in message:
            warnings.warn(message, stacklevel=1)


def test_CS2_OpenAPI_가산_전용_호환(golden_contract, current_contract, exemptions):
    result = compat.compare_contract(golden_contract, current_contract)
    remaining = compat.apply_exemptions(result.violations, exemptions)
    assert remaining == [], "\n".join(str(v) for v in remaining)
    for message in result.warnings:
        warnings.warn(message, stacklevel=1)


def test_CS4_예외_파일은_기본이_빈_배열이고_형식이_유효하다(exemptions):
    assert exemptions == []
    assert compat.validate_exemptions(exemptions) == []


def test_CS4_응답_enum_값_추가와_삭제는_예외_없이는_실패한다(golden_contract, current_contract, exemptions):
    added = compat.mutated(current_contract)
    added["components"][SESSION_RESPONSE]["properties"]["status"]["enum"].append("archived")
    found = _violations(golden_contract, added, exemptions)
    assert [(v.op, v.change) for v in found if v.change == "enum_value_added"], found

    dropped = compat.mutated(current_contract)
    dropped["components"][SESSION_RESPONSE]["properties"]["status"]["enum"].remove("cancelled")
    found = _violations(golden_contract, dropped, exemptions)
    assert [v for v in found if v.change == "enum_value_removed"], found


def test_CS4_예외_항목이_있으면_통과하고_만료되면_실패한다(golden_contract, current_contract):
    added = compat.mutated(current_contract)
    added["components"][SESSION_RESPONSE]["properties"]["status"]["enum"].append("archived")
    raw = compat.compare_contract(golden_contract, added).violations
    target = next(v for v in raw if v.change == "enum_value_added")
    item = {
        "id": "EX-TEST", "op": target.op, "path": target.path, "change": target.change,
        "sdd": "SDD-999", "reason": "테스트용", "expires_phase": 1,
    }
    left = compat.apply_exemptions(raw, [item])
    assert target in raw and target not in left
    assert compat.validate_exemptions([item], current_phase=1) == []
    assert compat.validate_exemptions([item], current_phase=2) != []
    assert compat.validate_exemptions([{**item, "reason": ""}]) != []


def test_CS10_변이주입_응답_필드_삭제를_잡는다(golden_contract, current_contract, exemptions):
    broken = compat.mutated(current_contract)
    del broken["components"][SESSION_RESPONSE]["properties"]["waitlist_count"]
    found = _violations(golden_contract, broken, exemptions)
    assert any(v.change == "removed" and v.path.endswith("waitlist_count") for v in found), found


def test_CS10_변이주입_응답_타입_변경을_잡는다(golden_contract, current_contract, exemptions):
    broken = compat.mutated(current_contract)
    broken["components"][SESSION_RESPONSE]["properties"]["duration_min"] = {"type": "string"}
    found = _violations(golden_contract, broken, exemptions)
    assert any(v.change == "type_changed" and v.path.endswith("duration_min") for v in found), found


def test_CS10_변이주입_라우트_삭제를_잡는다(golden_contract, current_contract, exemptions):
    broken = compat.mutated(current_contract)
    del broken["operations"]["POST /api/v1/sessions/{session_id}/join"]
    found = _violations(golden_contract, broken, exemptions)
    assert [v.change for v in found] == ["route_removed"], found


def test_CS2_요청_새_필수_속성은_실패하고_새_선택_속성은_통과한다(golden_contract, current_contract, exemptions):
    required = compat.mutated(current_contract)
    request_schema = required["components"][SESSION_CREATE]
    request_schema["properties"]["brand_new"] = {"type": "string"}
    request_schema["required"] = [*request_schema["required"], "brand_new"]
    assert any(v.change == "request_new_required" for v in _violations(golden_contract, required, exemptions))

    optional = compat.mutated(current_contract)
    optional["components"][SESSION_CREATE]["properties"]["brand_new"] = {"type": "string"}
    assert _violations(golden_contract, optional, exemptions) == []


def test_CS2_응답_새_속성은_통과한다(golden_contract, current_contract, exemptions):
    extended = compat.mutated(current_contract)
    extended["components"][SESSION_RESPONSE]["properties"]["class_id"] = {"type": "string"}
    assert _violations(golden_contract, extended, exemptions) == []


def test_CS8_response_model_미지정_라우트_목록이_골든과_같다(golden_contract, current_contract):
    golden_set = golden_contract["unspecified_response_ops"]
    assert len(golden_set) == 8
    assert compat.unspecified_response_ops(current_contract) == golden_set


def test_CS8_신규_미지정_라우트가_생기면_실패한다(golden_contract, current_contract):
    leaked = compat.mutated(current_contract)
    leaked["operations"]["GET /api/v1/sessions/brand-new"] = {"responses": {"200": {"content": {}}}}
    assert compat.unspecified_response_ops(leaked) != golden_contract["unspecified_response_ops"]


def test_CS7_골든_쓰기는_갱신_스위치_없이는_거부된다(monkeypatch, tmp_path):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv(golden_io.UPDATE_ENV, raising=False)
    with pytest.raises(golden_io.GoldenWriteRefused):
        golden_io.write_golden("x.json", {"a": 1}, directory=tmp_path)
    assert not (tmp_path / "x.json").exists()


def test_CS7_CI_에서는_갱신_스위치가_있어도_거부된다(monkeypatch, tmp_path):
    monkeypatch.setenv(golden_io.UPDATE_ENV, "1")
    monkeypatch.setenv("CI", "true")
    with pytest.raises(golden_io.GoldenWriteRefused):
        golden_io.write_golden("x.json", {"a": 1}, directory=tmp_path)
    assert not (tmp_path / "x.json").exists()


def test_CS7_갱신_스위치가_있고_CI_가_아니면_정렬된_JSON_으로_쓴다(monkeypatch, tmp_path):
    monkeypatch.setenv(golden_io.UPDATE_ENV, "1")
    monkeypatch.delenv("CI", raising=False)
    path = golden_io.write_golden("x.json", {"b": 1, "a": [1]}, directory=tmp_path)
    assert path.read_text(encoding="utf-8").startswith('{\n "a": [')
    assert golden_io.load_golden("x.json", directory=tmp_path) == {"a": [1], "b": 1}

"""계약 테스트 전용 픽스처 (SDD-211 C2)."""

from __future__ import annotations

import copy

import pytest

from tests.contract import compat, golden_io


@pytest.fixture(scope="session")
def current_contract() -> dict:
    """현재 앱의 `/sessions/*` 계약 서브셋. 앱 import 는 루트 conftest 의 환경 설정 뒤에 일어난다."""
    from app.main import app

    spec = copy.deepcopy(app.openapi())
    return compat.extract_contract(spec)


@pytest.fixture(scope="session")
def golden_contract(current_contract: dict) -> dict:
    """OpenAPI 골든. 갱신 모드에서는 현재 계약으로 다시 쓴다."""
    if golden_io.update_requested():
        existing_meta = {}
        try:
            existing_meta = golden_io.load_golden("sessions_openapi.json").get("meta", {})
        except FileNotFoundError:
            pass
        data = {
            "meta": {
                "selection_rule": "경로에 '/sessions' 또는 '{session_id}' 를 포함한 모든 라우트",
                "baseline_operation_count": existing_meta.get("baseline_operation_count", len(current_contract["operations"])),
            },
            "operations": current_contract["operations"],
            "components": current_contract["components"],
            "unspecified_response_ops": compat.unspecified_response_ops(current_contract),
        }
        golden_io.write_golden("sessions_openapi.json", data)
    return golden_io.load_golden("sessions_openapi.json")


@pytest.fixture(scope="session")
def exemptions() -> list:
    return golden_io.load_golden("breaking_exemptions.json")

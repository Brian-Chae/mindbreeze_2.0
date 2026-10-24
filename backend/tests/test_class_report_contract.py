"""SDD-237 B8: FE 목 fixture ↔ BE Pydantic 계약 테스트.

`frontend/src/lib/class-report/fixtures/*.json` 이 계약의 단일 사본이다(FE 소유, 읽기 전용).
FE 트랙이 합쳐지기 전(파일 없음)에는 skip 하고, 통합 단계에서 자동으로 활성화된다.
다른 경로의 fixture 를 보려면 환경변수 CLASS_REPORT_FIXTURE_DIR 을 쓴다(읽기만 한다).
"""

import json
import os
from pathlib import Path

import pytest

from app.schemas.class_report import (
    ClassReportResponse, ClassSummaryResponse, NarrativeEditRequest, NarrativeEditResponse,
)

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "class-report" / "fixtures"
FIXTURE_DIR = Path(os.environ.get("CLASS_REPORT_FIXTURE_DIR", DEFAULT_DIR))
STATES = ("normal", "partial", "single", "poor", "lost", "unworn", "pending", "error", "zero")

pytestmark = pytest.mark.skipif(
    not FIXTURE_DIR.is_dir() or not any(FIXTURE_DIR.glob("*.json")),
    reason="FE fixture 가 아직 없다(통합 단계에서 활성화)",
)


def load(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("state", STATES)
def test_summary_fixture는_요약_계약을_만족한다(state):
    ClassSummaryResponse.model_validate(load(f"summary-{state}.json"))


@pytest.mark.parametrize("state", STATES)
def test_report_fixture는_리포트_계약을_만족한다(state):
    ClassReportResponse.model_validate(load(f"report-{state}.json"))


def test_편집본_fixture():
    res = ClassReportResponse.model_validate(load("report-edited.json"))
    sources = {f.source for f in res.block.narrative.fields.values()}
    assert "edited" in sources
    edited = next(f for f in res.block.narrative.fields.values() if f.source == "edited")
    assert edited.edited_text and edited.edited_by_name and edited.edited_at


def test_patch_fixture():
    NarrativeEditResponse.model_validate(load("patch-response.json"))
    assert NarrativeEditRequest.model_validate(load("patch-edit.json")).text
    assert NarrativeEditRequest.model_validate(load("patch-revert.json")).revert is True


@pytest.mark.parametrize("state", STATES)
def test_fixture에_금지_표현_점수_순위가_없다(state):
    from app.services.class_report_narrative import CLASS_FORBIDDEN_TERMS

    for name in (f"summary-{state}.json", f"report-{state}.json"):
        text = json.dumps(load(name), ensure_ascii=False)
        for term in CLASS_FORBIDDEN_TERMS:
            assert term not in text, (name, term)


@pytest.mark.parametrize("state", STATES)
def test_fixture_상태와_지표가_정합하다(state):
    res = ClassReportResponse.model_validate(load(f"report-{state}.json"))
    if res.block is None:
        assert res.report.state in ("processing", "error")
        return
    for metric in res.block.metrics.values():
        if metric.state != "ok":                 # 0 치환 금지: 값 없는 지표는 수치·시계열이 전부 비어 있다
            assert metric.mean is None and metric.series == []
        if metric.measured < 2 or metric.state == "single":
            assert metric.mean is None

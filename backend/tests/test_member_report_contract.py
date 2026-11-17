"""SDD-327 T0: member_report 계약 ↔ 골든 픽스처(시안 v11) 일치 테스트.

- BE 픽스처(`tests/fixtures/member_report/`)와 FE 사본(`frontend/src/lib/member-report/__fixtures__/`)이 바이트 동일
- 모든 픽스처가 Pydantic 계약을 통과
- 시안 수치(`v11-numeric`) 핵심값, 금지어 0, 결측 시 쪽수·목차 자동 축소
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.member_report import MemberReport, expected_book_pages

BE_DIR = Path(__file__).parent / "fixtures" / "member_report"
FE_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "member-report" / "__fixtures__"
NAMES = sorted(p.name for p in BE_DIR.glob("member-report-*.json"))
FORBIDDEN = ["B5", "건강 수준", "점수", "등급", "스트레스", "우울", "진단합니다", "위험"]


def load(name: str) -> dict:
    return json.loads((BE_DIR / name).read_text(encoding="utf-8"))


def test_픽스처가_존재한다():
    assert len(NAMES) >= 7


@pytest.mark.parametrize("name", NAMES)
def test_픽스처는_계약을_만족한다(name):
    MemberReport.model_validate(load(name))


@pytest.mark.parametrize("name", NAMES)
def test_FE_사본은_BE_픽스처와_동일하다(name):
    assert (FE_DIR / name).read_bytes() == (BE_DIR / name).read_bytes()


@pytest.mark.parametrize("name", NAMES)
def test_금지어가_없다(name):
    text = json.dumps(load(name), ensure_ascii=False)
    for w in FORBIDDEN:
        assert w not in text, w
    assert "stress_index" not in text


def test_샘플은_18쪽이고_시안_목차와_같다():
    m = expected_book_pages(MemberReport.model_validate(load("member-report-sample.json")))
    assert m.total == 18
    assert [p.title for p in m.pages][5:14] == ["몸의 움직임", "안정된 5분", "심박수", "RMSSD", "LF/HF 흐름",
                                               "마음의 변화 · 집중도", "이완도", "감정 균형도", "뇌파 1/f 기울기"]
    assert [(t.label, t.start, t.end) for t in m.toc][2:4] == [
        ("몸의 변화 · 수업 여정과 다섯 지표", 5, 10), ("마음의 변화 · 네 지표", 11, 14)]


def test_시안_핵심_수치():
    r = load("member-report-sample.json")
    pairs = {p["key"]: p for p in r["hero"]["pairs"]}
    assert (pairs["heart_rate"]["before"], pairs["heart_rate"]["after"]) == ("75.0", "58.0")
    assert pairs["relaxation"]["change_text"] == "↑ 14.3 상승"
    assert pairs["motion"]["after"] == "0.000" and pairs["focus"]["after"] == "38.2"
    ch = {k: s["body"]["change"] for k, s in r["metrics"].items() if k != "lf_hf"}
    assert ch["heart_rate"]["delta"] == -17.0
    assert ch["rmssd"]["delta"] == -4.5
    assert ch["emotional_balance"]["delta"] == -10.0
    assert ch["aperiodic"]["delta"] == pytest.approx(-0.71)
    assert r["metrics"]["rmssd"]["body"]["group"]["distribution"]["n_people"] == 29
    assert r["metrics"]["aperiodic"]["body"]["group"]["distribution"]["n_people"] == 18
    st = {s["key"]: s["value"] for s in r["stable5"]["scales"]}
    assert st == {"heart_rate": 57.9, "rmssd": 24.8, "sdnn": 47.0}
    assert r["meta"]["member_code"] == "B2-18"
    assert "담당 클래스 코치" in r["method"]["contact_body"]


@pytest.mark.parametrize("reason", ["no_raw", "insufficient_window", "poor_fit"])
def test_aperiodic_결측이면_14쪽이_빠지고_목차가_줄어든다(reason):
    r = MemberReport.model_validate(load(f"member-report-no-aperiodic-{reason}.json"))
    assert r.metrics["aperiodic"].missing_reason == reason
    m = expected_book_pages(r)
    assert m.total == 17
    assert "뇌파 1/f 기울기" not in [p.title for p in m.pages]
    assert [(t.label, t.start, t.end) for t in m.toc][3] == ("마음의 변화 · 세 지표", 11, 13)
    assert [(t.label, t.start) for t in m.toc][-4:] == [("다음 걸음", 14), ("손글씨 메모", 15),
                                                       ("방법 · 참고문헌 · 문의", 16), ("뒷표지", 17)]


def test_aperiodic_키_자체가_없어도_같은_쪽_구성():
    d = load("member-report-sample.json")
    d["metrics"].pop("aperiodic")
    assert expected_book_pages(MemberReport.model_validate(d)).total == 17


def test_일부_지표만_결측이면_그_쪽만_생략():
    r = MemberReport.model_validate(load("member-report-partial-missing-rmssd.json"))
    m = expected_book_pages(r)
    assert m.total == 17 and "RMSSD" not in [p.title for p in m.pages]
    assert all(p["key"] != "rmssd" for p in r.hero.model_dump()["pairs"])


def test_그룹_최소N_미만이면_그룹_숫자가_전혀_없다():
    r = load("member-report-group-hidden.json")
    for k, s in r["metrics"].items():
        b = s["body"]
        assert b["group"] is None and b["series"]["group_band"] is None
        if k != "lf_hf":
            assert b["group_hidden_reason"] == "min_n"
    MemberReport.model_validate(r)


def test_밴드_미착용은_축약판():
    r = MemberReport.model_validate(load("member-report-not-worn.json"))
    m = expected_book_pages(r)
    assert [p.key for p in m.pages] == ["cover", "toc", "summary", "opinion", "next_steps", "memo", "method", "back"]
    assert m.total == 8 and r.hero.pairs == []
    assert r.journey is None and r.stable5 is None


def test_미착용인데_지표가_ok이면_거부():
    d = load("member-report-sample.json")
    d["meta"]["band_status"] = "not_worn"
    with pytest.raises(ValidationError):
        MemberReport.model_validate(d)


def test_그룹_숨김인데_띠가_남아_있으면_거부():
    d = load("member-report-sample.json")
    d["metrics"]["heart_rate"]["body"]["group"] = None
    with pytest.raises(ValidationError):
        MemberReport.model_validate(d)


def test_알_수_없는_필드와_개인_식별_필드는_거부():
    d = load("member-report-sample.json")
    d["meta"]["real_name"] = "홍길동"
    with pytest.raises(ValidationError):
        MemberReport.model_validate(d)

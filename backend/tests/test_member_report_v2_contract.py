"""SDD-328 T0: member_report.v2 계약 ↔ 합성 골든 픽스처 일치 테스트.

- BE 픽스처(`tests/fixtures/member_report_v2/`)와 FE 사본(`frontend/src/lib/member-report/__fixtures__/v2/`)이 바이트 동일
- 픽스처가 pydantic(extra=forbid) 계약을 통과, FE JSON Schema 사본이 pydantic 과 일치(드리프트 0)
- 금지어 0 / 큰 글씨 전문용어 0(각주 필드만 허용) / 합성 값(실데이터·이메일 없음) / AI 미사용
- 그룹 평균·SD·n 독립 재계산 규칙(n<10 숨김), 쪽·목차 규칙
"""

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.member_report_v2 import (
    MIN_GROUP_N,
    MemberReportV2,
    expected_book_pages_v2,
)

ROOT = Path(__file__).resolve().parents[2]
BE_DIR = Path(__file__).parent / "fixtures" / "member_report_v2"
FE_DIR = ROOT / "frontend" / "src" / "lib" / "member-report" / "__fixtures__" / "v2"
NAMES = ["bodycare.json", "mindcare.json"]
FORBIDDEN = ["점수", "등급", "스트레스", "우울", "진단합니다", "위험", "불규칙", "덕분에", "때문에"]
JARGON = ["RMSSD", "SDNN", "HRV", "LF/HF", "PRV", "심박수"]
FOOTNOTE_FIELDS = {"footnote", "source_note"}


def load(name: str) -> dict:
    return json.loads((BE_DIR / name).read_text(encoding="utf-8"))


def walk_strings(node, path=()):
    """(경로, 문자열) 순회. 경로의 마지막 키로 각주 필드를 구분한다."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, path + (str(i),))
    elif isinstance(node, str):
        yield path, node


@pytest.mark.parametrize("name", NAMES)
def test_픽스처는_계약을_만족한다(name):
    r = MemberReportV2.model_validate(load(name))
    assert r.schema_version == "member_report.v2"
    assert r.opinion.narrative.source == "rule"


@pytest.mark.parametrize("name", NAMES)
def test_FE_사본은_BE_픽스처와_동일하다(name):
    assert (FE_DIR / name).read_bytes() == (BE_DIR / name).read_bytes()


def test_FE_JSON_Schema_사본이_pydantic과_일치한다():
    expected = MemberReportV2.model_json_schema()
    actual = json.loads((FE_DIR / "member-report-v2.schema.json").read_text(encoding="utf-8"))
    assert actual == expected


@pytest.mark.parametrize("name", NAMES)
def test_금지어가_없다(name):
    text = json.dumps(load(name), ensure_ascii=False)
    for w in FORBIDDEN:
        assert w not in text, w


@pytest.mark.parametrize("name", NAMES)
def test_큰_글씨에_전문용어가_없다(name):
    # 허용 위치: footnote·source_note 필드, 그리고 문의·참고 같은 고정 라벨이 아닌 방법 쪽 각주(method.footnote)
    for path, s in walk_strings(load(name)):
        if path[-1] in FOOTNOTE_FIELDS:
            continue
        for w in JARGON:
            assert w not in s, (path, w)


@pytest.mark.parametrize("name", NAMES)
def test_합성_값이다(name):
    text = json.dumps(load(name), ensure_ascii=False)
    assert "private-backups" not in text
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    assert load(name)["meta"]["member_code"].startswith("S-")


@pytest.mark.parametrize("name", NAMES)
def test_HRV_절대값_ms_표시가_없다(name):
    for path, s in walk_strings(load(name)):
        if path[-1] in FOOTNOTE_FIELDS:
            continue
        assert not re.search(r"\d+(\.\d+)?\s*ms", s), (path, s)


@pytest.mark.parametrize("name", NAMES)
def test_문의_문구가_방법과_뒷표지에_있다(name):
    r = load(name)
    assert "문의: 담당 클래스 코치" in r["method"]["contact_body"]
    assert "문의: 담당 클래스 코치" in r["back"]["contact"]


@pytest.mark.parametrize("name", NAMES)
def test_편안한_5분은_후보_문구이고_안착_이후다(name):
    q = load(name)["quiet5"]
    assert q["start_min"] > 2 and q["end_min"] - q["start_min"] == 4
    assert "찾았어요" in q["title"] and "확인해 주세요" in q["note"]


@pytest.mark.parametrize("name", NAMES)
def test_그룹_띠_n미만_분은_평균_SD가_없고_이상은_있다(name):
    r = load(name)
    seen_hidden = False
    for k, s in r["metrics"].items():
        if s["state"] != "ok":
            continue
        gb = s["body"]["series"]["group_band"]
        if k == "lf_hf":
            assert gb is None and s["body"]["group"] is None
            continue
        for m, sd, n in zip(gb["mean"], gb["sd"], gb["n"]):
            assert (n >= MIN_GROUP_N) == (m is not None) == (sd is not None)
            seen_hidden = seen_hidden or n < MIN_GROUP_N
        assert gb["mean"][0] is None and gb["mean"][1] is None  # 안착 2분
    assert seen_hidden  # 픽스처가 숨김 분 경계를 실제로 포함


def test_상대변화는_처음5분_0퍼센트_기준이다():
    r = load("bodycare.json")
    body = r["metrics"]["rmssd"]["body"]
    assert body["series"]["value_transform"] == "pct_vs_first5"
    assert body["change"]["kind"] == "pct" and body["first"] == 0.0
    mins = body["series"]["minutes"]
    vals = body["series"]["values"]
    import statistics

    first = [vals[mins.index(m)] for m in range(3, 8) if vals[mins.index(m)] is not None]
    assert abs(statistics.median(first)) < 1e-6  # 처음 5분 중앙값 = 0%


def test_쪽수_규칙():
    body = expected_book_pages_v2(MemberReportV2.model_validate(load("bodycare.json")))
    assert body.total == 18 and body.pages[6].key == "quiet5"
    assert [(t.label, t.start, t.end) for t in body.toc][2:4] == [
        ("몸의 변화 · 수업 여정과 다섯 지표", 5, 10), ("마음의 변화 · 네 지표", 11, 14)]
    # 마음돌봄 픽스처는 1/f 원자료 없음 → 쪽 생략(현행 규칙)
    mind = expected_book_pages_v2(MemberReportV2.model_validate(load("mindcare.json")))
    assert mind.total == 17 and "aperiodic" not in [p.key for p in mind.pages]
    assert [(t.label, t.start, t.end) for t in mind.toc][3] == ("마음의 변화 · 세 지표", 11, 13)


def test_알_수_없는_필드와_AI_출처는_거부():
    d = load("bodycare.json")
    d["meta"]["real_name"] = "홍길동"
    with pytest.raises(ValidationError):
        MemberReportV2.model_validate(d)
    d = load("bodycare.json")
    d["opinion"]["narrative"]["source"] = "ai"
    with pytest.raises(ValidationError):
        MemberReportV2.model_validate(d)


def test_n미만_분에_평균이_있으면_거부():
    d = load("bodycare.json")
    gb = d["metrics"]["heart_rate"]["body"]["series"]["group_band"]
    i = next(i for i, n in enumerate(gb["n"]) if n < MIN_GROUP_N)
    gb["mean"][i] = 1.0
    gb["sd"][i] = 1.0
    with pytest.raises(ValidationError):
        MemberReportV2.model_validate(d)


def test_미착용인데_지표가_ok이면_거부():
    d = load("bodycare.json")
    d["meta"]["band_status"] = "not_worn"
    with pytest.raises(ValidationError):
        MemberReportV2.model_validate(d)


def test_짧은_측정은_전후_구간이_없다():
    d = load("bodycare.json")
    d["meta"]["short_measure"] = True
    with pytest.raises(ValidationError):  # window 가 남아 있으면 거부
        MemberReportV2.model_validate(d)

"""SDD-328 B3·B6 — v2 빌더(합성 입력), 책 PDF, 정책(금지어·전문용어·AI 0·v1 불변) 테스트."""

import json
import random
import re
import statistics as st
import subprocess
from pathlib import Path

import pytest

from app.schemas.member_report_v2 import MemberReportV2, expected_book_pages_v2
from app.services import member_report_v2_book as book
from app.services import member_report_v2_core as core
from app.services.member_report_v2_builder import ReportInputs, assemble_member_report_v2, rebase

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ROOT / "backend" / "app" / "services"
KEYS = ["motion", "heart_rate", "rmssd", "sdnn", "lf_hf", "focus", "relaxation", "emotional_balance"]
JARGON = ["RMSSD", "SDNN", "HRV", "LF/HF", "PRV", "심박수"]
FOOTNOTE_FIELDS = {"footnote", "source_note"}


def person(n, seed, hr0=75.0, miss=(), base_rmssd=30.0):
    rnd = random.Random(seed)
    p = {k: {} for k in KEYS}
    for i in range(n):
        if i in miss:
            continue
        p["motion"][i] = 0.09 - 0.05 * i / n + rnd.random() * 0.01
        p["heart_rate"][i] = hr0 - 15 * i / n + rnd.random()
        p["rmssd"][i] = base_rmssd + rnd.random() * 5
        p["sdnn"][i] = 40 + rnd.random() * 5
        p["lf_hf"][i] = 1.2 + rnd.random() * 0.3
        p["focus"][i] = 40 + rnd.random() * 3
        p["relaxation"][i] = 48 + 14 * i / n + rnd.random()
        p["emotional_balance"][i] = 50 + rnd.random() * 3
    return p


def inputs(n=66, group=12, miss=(), worn=True, person_=None, others=None):
    return ReportInputs(
        program="몸돌봄", program_label="몸돌봄 2회차", member_code="S-TEST-01", session_date="2026-11-11",
        start_clock="19:00", issued_on="2026-11-17",
        person=person_ if person_ is not None else person(n, 1, miss=miss),
        others=others if others is not None else [person(n - (g % 4), 100 + g, 68 + g % 8) for g in range(group)],
        worn=worn)


def walk(node, path=()):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, path + (str(i),))
    elif isinstance(node, str):
        yield path, node


@pytest.fixture(scope="module")
def full():
    return assemble_member_report_v2(inputs(miss=(10, 11)))


def test_계약을_통과하고_구간_정보가_없다(full):
    MemberReportV2.model_validate(full)
    s = json.dumps(full, ensure_ascii=False)
    assert full["schema_version"] == "member_report.v2"
    assert "segments" not in s and "my_segments" not in s and "stable5" not in s
    assert full["meta"]["first_window"] == {"start": 3, "end": 7}
    assert full["meta"]["last_window"] == {"start": 62, "end": 66}
    assert full["opinion"]["narrative"]["source"] == "rule"


def test_독립검산_처음_마지막_상대변화(full):
    p = person(66, 1, miss=(10, 11))
    first = st.median(p["heart_rate"][i] for i in range(2, 7))
    last = st.median(p["heart_rate"][i] for i in range(61, 66))
    hr = full["metrics"]["heart_rate"]["body"]
    assert hr["first"] == pytest.approx(round(first, 1), abs=1e-6)
    assert hr["last"] == pytest.approx(round(last, 1), abs=1e-6)
    assert hr["change"]["delta"] == pytest.approx(round(round(last, 1) - round(first, 1), 1), abs=1e-6)
    base = st.median(p["rmssd"][i] for i in range(2, 7))
    rel_last = st.median((p["rmssd"][i] / base - 1) * 100 for i in range(61, 66))
    assert full["metrics"]["rmssd"]["body"]["change"]["pct"] == pytest.approx(round(rel_last, 2), abs=1e-6)
    assert full["metrics"]["rmssd"]["body"]["first"] == 0.0


def test_독립검산_그룹_평균_SD_n_본인제외():
    inp = inputs(group=12)
    r = assemble_member_report_v2(inp)
    series = r["metrics"]["heart_rate"]["body"]["series"]
    gb = series["group_band"]
    assert r["meta"]["group_n"] == 12  # 본인 제외
    for i in range(66):
        vals = [o["heart_rate"][i] for o in inp.others if i in o["heart_rate"]]
        if i < 2:
            assert gb["mean"][i] is None
            continue
        assert gb["n"][i] == len(vals)
        if len(vals) >= 10:
            assert gb["mean"][i] == pytest.approx(st.fmean(vals), abs=1e-3)
            assert gb["sd"][i] == pytest.approx(st.pstdev(vals), abs=1e-3)
        else:
            assert gb["mean"][i] is None and gb["sd"][i] is None


def test_그룹상대변환은_회원_처음5분_기준():
    inp = inputs(group=12)
    r = assemble_member_report_v2(inp)
    base = st.median(inp.person["rmssd"][i] for i in range(2, 7))
    gb = r["metrics"]["rmssd"]["body"]["series"]["group_band"]
    i = 30
    vals = [(o["rmssd"][i] / base - 1) * 100 for o in inp.others if i in o["rmssd"]]
    assert gb["mean"][i] == pytest.approx(st.fmean(vals), abs=1e-3)


def test_그룹_10명_미만이면_그룹_숨김():
    r = assemble_member_report_v2(inputs(group=9))
    for k in ("motion", "heart_rate", "rmssd", "focus"):
        b = r["metrics"][k]["body"]
        assert b["group"] is None and b["series"]["group_band"] is None and b["group_hidden_reason"] == "min_n"
    assert r["meta"]["group_n"] == 9


def test_상대변화_기준값_0이면_해당_지표_poor_signal_나머지는_정상():
    p = person(66, 1)
    for i in range(2, 7):
        p["rmssd"][i] = 0.0
    r = assemble_member_report_v2(inputs(person_=p))
    sec = r["metrics"]["rmssd"]
    assert sec["state"] == "missing" and sec["missing_reason"] == "poor_signal" and sec["body"] is None
    assert r["metrics"]["heart_rate"]["state"] == "ok"


def test_LFHF는_흐름만_절대값_그룹비교_없음(full):
    b = full["metrics"]["lf_hf"]["body"]
    assert b["group"] is None and b["series"]["group_band"] is None
    assert b["series"]["values"] is None and b["series"]["norm"] and b["series"]["value_transform"] == "log1p"
    assert b["change"]["kind"] == "flow"


def test_편안한5분과_시기문구(full):
    q = full["quiet5"]
    assert q is not None and q["start_min"] >= 3
    assert "찾았어요" in q["title"] and "확인해 주세요" in q["note"]
    assert q["when_label"] in ("수업 초반에", "수업 중간에", "수업이 끝나갈 무렵")


def test_결측을_0으로_채우지_않는다(full):
    vals = full["metrics"]["heart_rate"]["body"]["series"]["values"]
    assert vals[10] is None and vals[11] is None and vals[0] is None and vals[1] is None
    assert vals[12] is not None


def test_짧은_측정은_전후비교없이_평균만():
    r = assemble_member_report_v2(inputs(n=8, group=0, others=[], person_=person(8, 2)))
    assert r["meta"]["short_measure"] is True
    assert r["meta"]["first_window"] is None and r["hero"]["pairs"] == [] and r["quiet5"] is None
    b = r["metrics"]["heart_rate"]["body"]
    assert b["change"] is None and b["overall_mean"] is not None
    MemberReportV2.model_validate(r)


def test_미착용은_결측_8쪽_축약():
    r = assemble_member_report_v2(inputs(worn=False, person_={}, others=[]))
    assert r["meta"]["band_status"] == "not_worn"
    assert all(s["missing_reason"] == "band_not_worn" for s in r["metrics"].values())
    m = expected_book_pages_v2(MemberReportV2.model_validate(r))
    assert m.total == 8
    assert r["journey"] is None and r["quiet5"] is None


def test_늦게_입장해도_본인_시작_기준으로_재정렬():
    p = person(40, 5)
    shifted = {k: {i + 10: v for i, v in ms.items()} for k, ms in p.items()}
    assert rebase(shifted, 10) == p


def test_금지어_불규칙_큰글씨_전문용어_0(full):
    s = json.dumps(full, ensure_ascii=False)
    for w in ["점수", "등급", "스트레스", "우울", "진단합니다", "위험", "불규칙", "덕분에", "때문에"]:
        assert w not in s, w
    for path, text in walk(full):
        if path[-1] in FOOTNOTE_FIELDS:
            continue
        for w in JARGON:
            assert w not in text, (path, w)
    # 절대값(ms)·참고 범위 표시 없음(각주 제외)
    for path, text in walk(full):
        if path[-1] in FOOTNOTE_FIELDS:
            continue
        assert not re.search(r"\d+(\.\d+)?\s*ms", text), (path, text)


def test_종합점수_없고_문의문구_존재(full):
    s = json.dumps(full, ensure_ascii=False)
    assert "종합점수" not in s
    assert "문의: 담당 클래스 코치" in full["method"]["contact_body"] and full["back"]["contact"] == "문의: 담당 클래스 코치"


def test_같은_입력은_같은_출력_결정적():
    a = assemble_member_report_v2(inputs(miss=(10,)))
    b = assemble_member_report_v2(inputs(miss=(10,)))
    assert a == b


def test_v2_모듈은_AI를_부르지_않는다():
    pat = re.compile(r"gemini|openai|anthropic|\bllm\b|ai_text|build_ai_prompt|requests|httpx", re.I)
    for f in SERVICES.glob("member_report_v2_*.py"):
        text = f.read_text(encoding="utf-8")
        # 주석·문서 문자열의 '없음' 표기는 허용하고 import·호출만 본다.
        code = "\n".join(ln for ln in text.splitlines() if ln.strip().startswith(("import ", "from ")) or "(" in ln)
        hits = [m.group(0) for m in pat.finditer(code)]
        assert not hits, (f.name, hits)


def test_v1_모듈은_수정되지_않았다():
    v1 = ["member_report_builder", "member_report_metrics", "member_report_wording", "member_report_narrative",
          "member_report_svg", "member_report_group", "member_report_aperiodic"]
    out = subprocess.run(["git", "diff", "--stat", "1c1890e4", "--"] + [f"backend/app/services/{m}.py" for m in v1]
                         + ["backend/app/schemas/member_report.py", "backend/alembic"],
                         cwd=ROOT, capture_output=True, text=True).stdout
    assert out.strip() == "", out


# ── 책 PDF ───────────────────────────────────────────────────────
def _pages(pdf: bytes) -> list[str]:
    import io

    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover
        pytest.skip("pypdf 없음")
    rd = PdfReader(io.BytesIO(pdf))
    return [(pg.extract_text() or "") for pg in rd.pages]


def test_책_PDF_쪽수와_목차가_계약과_일치하고_빈쪽_없음(full):
    pdf = book.render_member_report_book_v2(full)
    assert pdf[:4] == b"%PDF"
    pages = _pages(pdf)
    exp = expected_book_pages_v2(MemberReportV2.model_validate(full))
    assert len(pages) == exp.total == 17  # 원시 뇌파가 없어 1/f 쪽 생략
    assert all(len(t.strip()) > 20 for t in pages)
    text = "\n".join(pages)
    for w in ["점수", "등급", "스트레스", "우울", "진단합니다", "위험", "불규칙"]:
        assert w not in text, w
    assert "문의: 담당 클래스 코치" in text


def test_책_분기_입구는_v2_dict를_v2_렌더러로_보낸다(full):
    from app.services.member_report_book import render_member_report_book

    pages = _pages(render_member_report_book(full))
    assert len(pages) == 17


def test_책_HTML에는_안착_회색과_평균점선_클래스가_있다(full):
    html = book.build_book_html_v2(full)
    assert 'data-settle="true"' in html and "stroke-dasharray" in html and "book_v2" not in html
    assert "report.invalid/fonts" in html and "http://" not in html.replace("http://www.w3.org/2000/svg", "")


def test_미착용_PDF_8쪽():
    r = assemble_member_report_v2(inputs(worn=False, person_={}, others=[]))
    assert len(_pages(book.render_member_report_book_v2(r))) == 8


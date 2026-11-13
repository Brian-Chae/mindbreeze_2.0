"""SDD-327 T6 — 명상 기록 책 PDF 렌더 테스트 (픽스처 7종)."""
import glob
import json
import os
import re
import time
from pathlib import Path

import pytest

os.environ.setdefault("DYLD_FALLBACK_LIBRARY_PATH", "/opt/homebrew/lib")
pymupdf = pytest.importorskip("pymupdf")
pytest.importorskip("weasyprint")

from app.schemas.member_report import MemberReport, expected_book_pages  # noqa: E402
from app.services.member_report_book import render_book_pdf, render_member_report_book  # noqa: E402

FIXTURES = sorted(glob.glob(str(Path(__file__).parent / "fixtures/member_report/*.json")))
FORBIDDEN = ["B5", "건강 수준", "점수", "등급", "스트레스", "우울", "진단합니다", "위험"]
_cache: dict[str, tuple[bytes, MemberReport]] = {}


def _load(path: str):
    if path not in _cache:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        _cache[path] = (render_member_report_book(data), MemberReport.model_validate(data))
    return _cache[path]


def _id(p: str) -> str:
    return Path(p).stem.replace("member-report-", "")


def test_fixture_count():
    assert len(FIXTURES) == 7


@pytest.mark.parametrize("path", FIXTURES, ids=_id)
def test_page_count_matches_contract(path):
    pdf, rep = _load(path)
    assert len(pymupdf.open(stream=pdf, filetype="pdf")) == expected_book_pages(rep).total


@pytest.mark.parametrize("path", FIXTURES, ids=_id)
def test_text_rules(path):
    pdf, rep = _load(path)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    for word in FORBIDDEN:
        assert word not in text, word
    assert "담당 클래스 코치" in text
    assert "의료 진단이 아닙니다" in text
    assert re.search(r"B\d+-\d+", text)  # 식별 코드만, 실명 없음
    assert "회원님" in text


@pytest.mark.parametrize("path", FIXTURES, ids=_id)
def test_only_two_font_families(path):
    pdf, _ = _load(path)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    names = {f[3].split("+")[-1] for p in doc for f in p.get_fonts()}
    assert names and all(n.startswith(("BookSans", "BookSerif")) for n in names), names


@pytest.mark.parametrize("path", FIXTURES, ids=_id)
def test_cover_back_have_no_header_footer_and_content_above_footer(path):
    pdf, rep = _load(path)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    n = len(doc)
    assert "의료 진단이 아닙니다" not in doc[0].get_text()
    assert "의료 진단이 아닙니다" not in doc[n - 1].get_text()
    for i in range(1, n - 1):
        page = doc[i]
        foot = [b for b in page.get_text("blocks") if "의료 진단이 아닙니다" in b[4]]
        assert foot, f"{i + 1}쪽 꼬리말 없음"
        top = foot[0][1]
        others = [b for b in page.get_text("blocks") if "의료 진단이 아닙니다" not in b[4] and "나의 명상 기록 ·" not in b[4]]
        assert max(b[3] for b in others) <= top + 1, f"{i + 1}쪽 본문이 꼬리말을 침범"


def test_back_title_centered():
    pdf, _ = _load(FIXTURES[-1])
    page = pymupdf.open(stream=pdf, filetype="pdf")[-1]
    b = [x for x in page.get_text("blocks") if "다음 시간에도" in x[4]][0]
    assert abs((b[0] + b[2]) / 2 - page.rect.width / 2) < 12


def test_not_worn_is_8_pages_and_lfhf_has_no_delta():
    path = [f for f in FIXTURES if "not-worn" in f][0]
    pdf, _ = _load(path)
    assert len(pymupdf.open(stream=pdf, filetype="pdf")) == 8
    sample = [f for f in FIXTURES if f.endswith("sample.json")][0]
    doc = pymupdf.open(stream=_load(sample)[0], filetype="pdf")
    lf = [p for p in doc if "LF/HF는 전후 구간의 흐름" in p.get_text()][0]
    assert "나의 시간 흐름" not in lf.get_text()


def test_render_book_pdf_entrypoint():
    data = json.loads(Path(FIXTURES[-1]).read_text(encoding="utf-8"))
    assert render_book_pdf({"member_report": data})[:4] == b"%PDF"
    with pytest.raises(Exception):
        render_book_pdf({})
    with pytest.raises(Exception):
        render_book_pdf({"member_report": {"schema_version": "x"}})


def test_sample_render_time_measured():
    sample = [f for f in FIXTURES if f.endswith("sample.json")][0]
    data = json.loads(Path(sample).read_text(encoding="utf-8"))
    t = time.perf_counter()
    render_member_report_book(data)
    sec = time.perf_counter() - t
    print(f"[T6] 샘플 18쪽 생성 {sec:.2f}s")
    assert sec < 30

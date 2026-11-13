"""SDD-327 T6 — 회원 명상 기록 책(A4 PDF) 렌더러.

입력 `MemberReport`(계약) → 출력 PDF 바이트. 쪽 구성·목차·쪽번호는 `expected_book_pages()` 가 정본이다.
- 표지·뒷표지는 머리말·꼬리말 없음, 뒷표지 제목은 가운데 정렬
- 지표는 정확히 1쪽, 결측 지표는 쪽 자체를 생략(미착용이면 8쪽 축약판)
- 그래프는 서버에서 SVG 로 만든다(JS 없음, `member_report_svg.py`)
- 글꼴은 번들 Pretendard + Noto Serif KR 2종만 임베드(네트워크·임의 파일 접근 금지)
- 기존 4쪽 PDF 경로(`report_pdf_service.py`)는 건드리지 않는다.
"""

from __future__ import annotations

import time
from html import escape
from pathlib import Path
from typing import Callable, Optional, Union

from weasyprint import HTML

from app.schemas.member_report import (
    BookPageMap,
    MemberReport,
    MetricBody,
    MetricKey,
    MetricSection,
    expected_book_pages,
)
from app.services.member_report_svg import (
    BAND_COLORS_JOURNEY,
    distribution_svg,
    reference_scale_svg,
    time_series_svg,
)

_ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = _ROOT / "assets/fonts"
TEMPLATE_DIR = _ROOT / "templates/member_report_book"
FONT_URL_PREFIX = "https://report.invalid/fonts/"
# PDF 에 임베드할 글꼴은 이 3개 파일(Pretendard 2굵기 + Noto Serif KR)로 고정한다.
ALLOWED_FONTS = {
    "Pretendard-Regular-ko.ttf": "font/ttf",
    "Pretendard-SemiBold-ko.ttf": "font/ttf",
    "NotoSerifKR-Regular-ko.ttf": "font/ttf",
}

_CHAPTER_NAME = {"body": "몸의 변화", "mind": "마음의 변화"}
_METRIC_CLASS = {"lf_hf": "lfhf"}
_SERIES_NAME = {
    "motion": "움직임", "heart_rate": "심박", "rmssd": "RMSSD", "lf_hf": "LF/HF",
    "focus": "집중도", "relaxation": "이완도", "emotional_balance": "감정 균형도", "aperiodic": "1/f 기울기",
}
_ARROW = {"up": "↑", "down": "↓", "stable": "→"}
_MEANING_LABELS = ("낮은 쪽", "참고 띠", "높은 쪽")


def _font_fetcher(url: str) -> dict:
    """번들 글꼴 3종만 제공한다. 그 밖의 모든 URL(원격·로컬)은 거부한다."""
    if not url.startswith(FONT_URL_PREFIX):
        raise ValueError("PDF 외부 리소스는 허용하지 않습니다")
    name = url[len(FONT_URL_PREFIX):]
    if name not in ALLOWED_FONTS:
        raise ValueError("허용되지 않은 글꼴입니다")
    return {"string": (FONT_DIR / name).read_bytes(), "mime_type": ALLOWED_FONTS[name]}


def _e(value: object) -> str:
    return escape("" if value is None else str(value))


def _br(value: str) -> str:
    """줄바꿈(\\n)만 <br> 로 바꾸고 나머지는 이스케이프한다."""
    return "<br>".join(escape(part) for part in value.split("\n"))


def _num(value: Optional[float], decimals: int, signed: bool = False) -> str:
    if value is None:
        return "–"
    text = f"{abs(value):.{decimals}f}"
    if value < 0 and float(text) != 0:
        return "−" + text
    return ("+" + text) if signed and float(text) != 0 else text


def _page_range(start: int, end: int) -> str:
    return f"{start:02d}" if start == end else f"{start:02d}–{end:02d}"


class _Ctx:
    """쪽 렌더링 공통 값(쪽번호·머리말·꼬리말)."""

    def __init__(self, report: MemberReport, page_map: BookPageMap) -> None:
        self.report = report
        self.map = page_map
        self.pos = {p.key: p.page for p in page_map.pages}
        self.total = page_map.total
        self.code = report.meta.member_code
        self.segment_label = {s.key: s.label for s in report.meta.segments}

    def head(self, left: str, right: str) -> str:
        return f'<div class="pagehead"><span>{_e(left)}</span><span>{_e(right)}</span></div>'

    def foot(self, key: str) -> str:
        n = self.pos[key]  # type: ignore[index]
        return (f'<footer><span>나의 명상 기록 · {_e(self.code)}</span>'
                f'<span>{n:02d} / {self.total} · 의료 진단이 아닙니다</span></footer>')

    def chapter_head(self, chapter: Optional[str]) -> str:
        label = self.report.meta.chapter_label
        if chapter in _CHAPTER_NAME:
            tail = label.split(" · ", 1)[1] if " · " in label else label
            label = f"{_CHAPTER_NAME[chapter]} · {tail}"
        return self.head(label, self.code)


# ── 쪽별 렌더 ──────────────────────────────────────────────────────
def _cover(ctx: _Ctx) -> str:
    c = ctx.report.cover
    rows = list(c.rows)
    title_row = rows[0] if rows else ("회원님", ctx.code)
    dl = "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in rows[1:])
    art = "<i></i>" * 6
    return (
        f'<section class="page cover" data-key="cover">'
        f'<div class="intro"><div class="eyebrow">{_e(c.kicker)}</div>'
        f'<h1 class="cover-title">{_br(c.title)}</h1>'
        f'<p class="coverline">{_br(c.tagline)}</p><div class="cover-art" aria-hidden="true">{art}</div></div>'
        f'<div class="identity"><h3>{_e(title_row[0])} <span>{_e(title_row[1])}</span></h3><dl>{dl}</dl></div>'
        f'<p class="publisher">{_e(c.brand)}</p>'
        f'<p class="note">{_e(c.issued_note)}<br>{_e(c.footer)}</p></section>'
    )


def _toc(ctx: _Ctx) -> str:
    r = ctx.report
    label = r.meta.chapter_label
    parts = label.split(" · ", 1)
    mark = parts[0]
    title = parts[1] if len(parts) > 1 else label
    date = r.meta.session_date.replace("-", ".")
    rows = "".join(
        f'<div class="toc-row"><span>{_e(t.label)}</span><b>{_page_range(t.start, t.end)}</b></div>'
        for t in ctx.map.toc
    )
    return (
        f'<section class="page book-toc" data-key="toc">{ctx.head("나의 명상 기록 / 차례", ctx.code)}'
        f'<div class="eyebrow">{_e(r.toc.heading)}</div><h2 class="chapter-title">{_e(r.toc.chapter_title)}</h2>'
        f'<p class="narrative">{_e(r.toc.chapter_subtitle)}</p>'
        f'<div class="toc-chapter"><small>{_e(mark)}</small><h3 class="chapter-sub">{_e(title)}</h3>'
        f'<p class="note">{_e(date)}</p></div>{rows}'
        f'<p class="future">{_e(r.toc.next_chapter_note)}</p><p class="note toc-note">{_e(r.toc.guide)}</p>'
        f'{ctx.foot("toc")}</section>'
    )


def _summary(ctx: _Ctx) -> str:
    r = ctx.report
    h = r.hero
    pairs = "".join(
        f'<div class="effect-pair {_e(p.tone)}" data-key="{_e(p.key)}">'
        f'<div class="pair-name">{_e(p.name)} <small>{_e(p.unit)}</small></div>'
        f'<div class="pair-values"><span>{_e(p.before)}</span><i>→</i><strong>{_e(p.after)}</strong></div>'
        f'<div class="pair-change">{_e(p.change_text)}</div></div>'
        for p in h.pairs
    )
    grid = ""
    if h.pairs:
        cap = ""
        if h.pair_caption_before or h.pair_caption_after:
            cap = (f'<div class="pair-caption"><span>{_e(h.pair_caption_before)}</span>'
                   f'<span>{_e(h.pair_caption_after)}</span></div>')
        grid = f'{cap}<div class="effect-grid">{pairs}</div>'
    caution = f'<p class="hero-caution">{_br(h.caution)}</p>' if h.caution else ""
    other = f'<div class="other-direction">{_br(h.other_directions)}</div>' if h.other_directions else ""
    stable = ""
    if h.stable_summary:
        s = h.stable_summary
        lines = "<br>".join(_e(x) for x in s.lines)
        stable = (f'<div class="state-secondary"><b>{_e(s.title)}</b><p>{lines}</p>'
                  f'<small>{_e(s.note)}</small></div>')
    return (
        f'<section class="page summary" data-key="summary">{ctx.head("MIND BREEZE / 나만의 명상 기록 책", r.meta.volume_label)}'
        f'<div class="summary-lead">나의 명상 기록 · {_e(r.meta.program_label)}</div>'
        f'<section class="effect-hero"><div class="hero-kicker">{_e(h.kicker)}</div>'
        f'<h1>{_br(h.headline)}</h1><p class="hero-lead">{_e(h.lead)}</p>{grid}{caution}{other}{stable}</section>'
        f'{ctx.foot("summary")}</section>'
    )


def _opinion(ctx: _Ctx) -> str:
    r = ctx.report
    o = r.opinion
    table = ""
    if r.stable5 is not None:
        rows = "".join(
            f'<tr><th>{_e(s.title.rsplit(" ", 1)[0])}<small>{_e(_num(s.value, s.decimals))} {_e(s.unit)}</small></th>'
            f'<td><i class="dot {"inside" if s.side == "within" else "outside"}"></i>{_e(s.overview_position)}</td>'
            f'<td>{_e(s.overview_line)}</td></tr>'
            for s in r.stable5.scales
        )
        table = (f'<table class="overview"><thead><tr><th>영역 / 안정 5분 값</th><th>결과 위치</th>'
                 f'<th>한 줄 소견</th></tr></thead><tbody>{rows}</tbody></table>')
    method_page = ctx.pos["method"]
    footnote = o.footnote.replace("14쪽", f"{method_page}쪽")
    return (
        f'<section class="page opinion" data-key="opinion">{ctx.chapter_head(None)}'
        f'<div class="intro"><div class="eyebrow">{_e(o.narrative.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_e(o.narrative.title)}</h2><p class="narrative">{_e(o.narrative.body)}</p></div>'
        f'<h3 class="sectiontitle">{_e(o.table_title)}</h3>{table}'
        f'<p class="note">{_br(o.legend_note)}</p>'
        f'<div class="interpret"><h3>{_e(o.interpret_title)}</h3><p>{_e(o.interpret_body)}</p></div>'
        f'<div class="reading">{_e(o.reading)}</div><p class="note">{_e(footnote)}</p>'
        f'{ctx.foot("opinion")}</section>'
    )


def _series_svg(ctx: _Ctx, sec: MetricSection, bands: Optional[tuple[str, ...]] = None, label: str = "") -> str:
    body = sec.body
    assert body is not None
    m = ctx.report.meta
    mine = {s.segment_key: s.value for s in body.my_segments}
    kwargs = {"band_colors": bands} if bands else {}
    return time_series_svg(
        body.series, m.segments, m.first_minute, m.last_minute, m.start_clock, body.change.decimals, mine,
        aria_label=label or "수업 네 구간의 그룹 중앙값과 나의 흐름", **kwargs,
    )


def _journey(ctx: _Ctx) -> str:
    r = ctx.report
    j = r.journey
    assert j is not None
    seg = "".join(
        f'<div><b>{_e(s.label)}</b><small>{s.start_min}–{s.end_min}분</small></div>' for s in r.meta.segments
    )
    plots = []
    for key in j.chart_keys:
        sec = r.metrics.get(key)
        if sec is None or sec.state != "ok":
            continue
        title = "몸의 움직임 · 구간을 읽는 기준" if key == "motion" else f"그룹 흐름 속 나의 {_SERIES_NAME[key]}"
        plots.append((key, f'<article class="plot"><h3>{_e(title)}</h3>'
                           f'{_series_svg(ctx, sec, BAND_COLORS_JOURNEY)}</article>'))
    main = "".join(p for k, p in plots if k == "motion")
    rest = "".join(p for k, p in plots if k != "motion")
    legend = ('<p class="legend">━ 나 · ┄ 그룹 중앙 / 진한 띠: 가운데 50% / 옅은 띠: 80%</p>')
    return (
        f'<section class="page journey" data-key="journey">{ctx.chapter_head("body")}'
        f'<div class="intro"><div class="chapter-mark">몸의 변화</div><div class="eyebrow">{_e(j.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_e(j.title)}</h2><p class="narrative">{_e(j.body)}</p></div>'
        f'<div class="timeline">{seg}</div><div class="plot-main">{main}</div>'
        f'<div class="charts-2">{rest}</div>{legend}'
        f'<div class="callout">{_e(j.stable_basis_note)}</div><p class="note">{_e(j.footer_note)}</p>'
        f'{ctx.foot("journey")}</section>'
    )


def _stable5(ctx: _Ctx) -> str:
    s = ctx.report.stable5
    assert s is not None
    blocks = []
    for sc in s.scales:
        name, _, unit = sc.title.rpartition(" ")
        meaning = []
        for idx, text in enumerate(sc.meaning):
            lab = _MEANING_LABELS[idx] if idx < len(_MEANING_LABELS) else ""
            rest = text[len(lab):].strip() if lab and text.startswith(lab) else text
            meaning.append(f'<div><strong>{_e(lab)}</strong>{_e(rest)}</div>')
        blocks.append(
            f'<article class="scale"><div class="scalehead"><h3>{_e(name)} <small>{_e(unit)}</small></h3>'
            f'<b>{_e(_num(sc.value, sc.decimals))}</b><span class="pill">{_e(sc.pill)}</span></div>'
            f'<p class="note">{_e(sc.range_note)}</p>'
            f'<div class="scale-row">{reference_scale_svg(sc)}<div class="meaning">{"".join(meaning)}</div></div>'
            f'<p class="explain">{_e(sc.explain)}</p><p class="note">{_e(sc.note)}</p></article>'
        )
    return (
        f'<section class="page stable-metric" data-key="stable5">{ctx.chapter_head("body")}'
        f'<div class="intro"><div class="eyebrow">{_e(s.eyebrow)}</div><h2 class="chapter-title">{_e(s.title)}</h2>'
        f'<p class="narrative">{_e(s.narrative)}</p></div>{"".join(blocks)}'
        f'<p class="reading">{_e(s.reading)}</p>'
        f'<div class="callout"><b>{_e(s.callout_title)}</b> {_e(s.callout_body)}</div>'
        f'{ctx.foot("stable5")}</section>'
    )


def _delta_text(b: MetricBody) -> str:
    c = b.change
    return (f"{_num(c.before, c.decimals)} → {_num(c.after, c.decimals)} · "
            f"{_ARROW[c.direction]}{_num(abs(c.delta), c.decimals)} {c.unit}")


def _metric(ctx: _Ctx, sec: MetricSection) -> str:
    b = sec.body
    assert b is not None
    key = sec.key
    is_lfhf = key == "lf_hf"
    # 장 표시는 각 장의 첫 지표 쪽(몸=수업 여정, 마음=첫 마음 지표)에만 붙인다.
    chapter_mark = ""
    if sec.chapter == "mind":
        first_mind = next((p.key for p in ctx.map.pages
                           if p.key in ("focus", "relaxation", "emotional_balance", "aperiodic")), None)
        if first_mind == key:
            chapter_mark = '<div class="chapter-mark">마음의 변화</div>'
    delta = "" if is_lfhf else f'<span class="delta-inline">{_e(_delta_text(b))}</span>'
    h3 = "시간으로 보기" if is_lfhf else "나의 시간 흐름"
    legend = _br(b.series_legend).replace("━", "<br>━", 1) if "┄" in b.series_legend else _br(b.series_legend)
    bridge = f'<p class="bridge">{_e(b.bridge)}</p>' if b.bridge else ""
    group = ""
    if b.group is not None:
        g = b.group
        d = g.distribution
        rows = "".join(
            f'<tr><th>{_e(ctx.segment_label.get(r.segment_key, r.segment_key))}</th>'
            f'<td>{_e(_num(r.mine, b.change.decimals))}</td><td>{_e(_num(r.group, b.change.decimals))}</td>'
            f'<td>{_e(_num(r.diff, b.change.decimals, signed=True))}</td><td>{r.compared_minutes}분</td></tr>'
            for r in g.rows
        )
        dist_legend = _br(g.legend).replace("막대", "<br>막대", 1)
        group = (
            f'<div class="group-support"><b>{_e(g.title)}</b><p class="original-explain">{_e(g.explain)}</p>'
            f'<div class="gs-row"><div class="gs-left"><article class="plot"><h3>통계로 보기</h3>'
            f'{distribution_svg(d, b.change.decimals, b.series.axis_unit)}<p class="legend">{dist_legend}</p></article></div>'
            f'<div class="gs-right"><table><thead><tr><th>구간</th><th>나의 중앙</th><th>그룹 중앙*</th><th>차이</th>'
            f'<th>비교한 분</th></tr></thead><tbody>{rows}</tbody></table>'
            f'<p class="note">{_br(g.table_note)}</p></div></div></div>'
        )
    elif b.group_hidden_reason == "min_n":
        group = '<p class="note">같은 수업 참여자가 적어 그룹 비교는 보여 드리지 않고, 나의 기록만 담았어요.</p>'
    reading = f'<p class="reading">{_e(b.reading)}</p>' if b.reading else ""
    result = f'<div class="callout">{_e(b.result_note)}</div>' if b.result_note else ""
    source = f'<p class="note">{_e(b.source_note)}</p>' if b.source_note else ""
    cls = _METRIC_CLASS.get(key, "")
    return (
        f'<section class="page metric {cls}" data-key="{key}">{ctx.chapter_head(sec.chapter)}'
        f'<div class="intro">{chapter_mark}<div class="eyebrow">{_e(b.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_e(b.conclusion)}</h2>{bridge}</div>'
        f'<article class="plot time-main"><h3>{h3}{delta}</h3>{_series_svg(ctx, sec)}'
        f'<p class="legend">{legend}</p></article>'
        f'<div class="interpret-new"><b>이게 무슨 뜻이에요</b>{_e(b.interpretation)}</div>'
        f'{group}{reading}{source}{result}{ctx.foot(key)}</section>'
    )


def _next_steps(ctx: _Ctx) -> str:
    n = ctx.report.next_steps
    items = "".join(f'<article class="next"><b>{_e(i.title)}</b><p>{_e(i.body)}</p></article>' for i in n.items)
    return (
        f'<section class="page" data-key="next_steps">{ctx.chapter_head(None)}'
        f'<div class="intro"><div class="eyebrow">{_e(n.eyebrow)}</div><h2 class="chapter-title">{_e(n.title)}</h2>'
        f'<p class="narrative">{_e(n.body)}</p></div>{items}{ctx.foot("next_steps")}</section>'
    )


def _memo(ctx: _Ctx) -> str:
    m = ctx.report.memo
    blocks = "".join(f'<div class="memo-label">{_e(lab)}</div><div class="writing-lines"></div>' for lab in m.labels)
    return (
        f'<section class="page memo" data-key="memo">{ctx.head(ctx.report.meta.chapter_label, "기록 메모")}'
        f'<div class="eyebrow">{_e(m.eyebrow)}</div><h2 class="chapter-title">{_e(m.title)}</h2>'
        f'<p class="narrative">{_e(m.prompt)}</p>{blocks}{ctx.foot("memo")}</section>'
    )


def _method(ctx: _Ctx) -> str:
    m = ctx.report.method
    paras = "".join(f"<p>{_e(p)}</p>" for p in m.paragraphs)
    refs = "<br>".join(f"[{i + 1}] {_e(r.text)}" for i, r in enumerate(m.references))
    contact = _e(m.contact_body).replace(" 문의:", "<br>문의:")
    return (
        f'<section class="page method" data-key="method">{ctx.chapter_head(None)}'
        f'<div class="intro"><div class="eyebrow">{_e(m.eyebrow)}</div><h2 class="chapter-title">{_e(m.title)}</h2>'
        f'<p class="narrative">{_e(m.body)}</p></div><h3>{_e(m.reading_title)}</h3>{paras}'
        f'<p class="note">{_e(m.footnote)}</p>'
        f'<div class="sources"><b>{_e(m.references_title)}</b><br>{refs}<br>{_e(m.references_checked)}</div>'
        f'<div class="interpret"><h3>{_e(m.contact_title)}</h3><p>{contact}</p></div>'
        f'{ctx.foot("method")}</section>'
    )


def _back(ctx: _Ctx) -> str:
    b = ctx.report.back
    return (
        f'<section class="page book-back" data-key="back"><div class="back-message">'
        f'<div class="eyebrow">{_e(b.kicker)}</div><h2>{_br(b.title)}</h2><p>{_e(b.subtitle)}</p>'
        f'<div class="back-rule"></div><p class="publisher">{_e(b.brand)}</p>'
        f'<p class="note">{_e(b.note)}<br>{_e(b.contact)}</p></div></section>'
    )


def build_book_html(report: Union[MemberReport, dict]) -> str:
    """HTML 문자열 생성(검증·미리보기용). 쪽 순서는 expected_book_pages 를 그대로 따른다."""
    rep = report if isinstance(report, MemberReport) else MemberReport.model_validate(report)
    page_map = expected_book_pages(rep)
    ctx = _Ctx(rep, page_map)
    renderers: dict[str, Callable[[], str]] = {
        "cover": lambda: _cover(ctx), "toc": lambda: _toc(ctx), "summary": lambda: _summary(ctx),
        "opinion": lambda: _opinion(ctx), "journey": lambda: _journey(ctx), "stable5": lambda: _stable5(ctx),
        "next_steps": lambda: _next_steps(ctx), "memo": lambda: _memo(ctx), "method": lambda: _method(ctx),
        "back": lambda: _back(ctx),
    }
    pages: list[str] = []
    for p in page_map.pages:
        if p.key in renderers:
            pages.append(renderers[p.key]())
        else:
            pages.append(_metric(ctx, rep.metrics[p.key]))  # type: ignore[index]
    css = (TEMPLATE_DIR / "book.css").read_text(encoding="utf-8")
    return (
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">'
        f'<title>나의 명상 기록 · {_e(rep.meta.member_code)}</title><style>{css}</style></head>'
        f'<body>{"".join(pages)}</body></html>'
    )


def render_member_report_book(report: Union[MemberReport, dict]) -> bytes:
    """회원 명상 기록 책 PDF 바이트."""
    return HTML(string=build_book_html(report), url_fetcher=_font_fetcher).write_pdf()


def render_book_pdf(content: dict) -> bytes:
    """공유 메일(T13) 진입점. content = 리포트 content dict, 그 안의 `member_report` 가 MemberReport.

    member_report 가 없거나 계약 검증에 실패하면 예외를 올린다(호출 쪽이 링크만 보낸다).
    """
    raw = content.get("member_report") if isinstance(content, dict) else None
    if not isinstance(raw, (dict, MemberReport)):
        raise ValueError("content.member_report 가 없습니다")
    return render_member_report_book(raw)


def render_with_timing(report: Union[MemberReport, dict]) -> tuple[bytes, float]:
    """(PDF, 소요 초) — 생성 시간 실측용."""
    start = time.perf_counter()
    pdf = render_member_report_book(report)
    return pdf, time.perf_counter() - start


__all__ = ["build_book_html", "render_book_pdf", "render_member_report_book", "render_with_timing", "MetricKey"]

"""SDD-328 B4 — 회원 명상 기록 책(A4 PDF) v2 렌더러.

입력 `MemberReportV2`(계약) → HTML/PDF. 쪽 구성·목차·쪽번호는 `expected_book_pages_v2()` 가 정본이다.
v1 렌더러(`member_report_book.py`)의 글꼴 fetcher·헬퍼·공통 CSS(`book.css`)를 재사용하고 `book_v2.css` 를 덧붙인다.
"""

from __future__ import annotations

from typing import Callable, Optional, Union

from weasyprint import HTML

from app.schemas.member_report_v2 import (
    BookPageMap,
    MemberReportV2,
    MetricBodyV2,
    MetricSectionV2,
    expected_book_pages_v2,
)
from app.services.member_report_book import TEMPLATE_DIR, _br, _e, _font_fetcher, _page_range
from app.services.member_report_v2_svg import distribution_svg_v2, time_series_svg_v2

_METRIC_CLASS = {"lf_hf": "lfhf"}
_MIND = ("focus", "relaxation", "emotional_balance", "aperiodic")
_CHAPTER_NAME = {"body": "몸의 변화", "mind": "마음의 변화"}


class _Ctx:
    def __init__(self, report: MemberReportV2, page_map: BookPageMap) -> None:
        self.report = report
        self.map = page_map
        self.pos = {p.key: p.page for p in page_map.pages}
        self.total = page_map.total
        self.code = report.meta.member_code

    def head(self, left: str, right: str) -> str:
        return f'<div class="pagehead"><span>{_e(left)}</span><span>{_e(right)}</span></div>'

    def foot(self, key: str) -> str:
        n = self.pos[key]
        return (f'<footer><span>나의 명상 기록 · {_e(self.code)}</span>'
                f'<span>{n:02d} / {self.total} · 문의: 담당 클래스 코치</span></footer>')

    def chapter_head(self, chapter: Optional[str]) -> str:
        label = self.report.meta.chapter_label
        if chapter in _CHAPTER_NAME:
            tail = label.split(" · ", 1)[1] if " · " in label else label
            label = f"{_CHAPTER_NAME[chapter]} · {tail}"
        return self.head(label, self.code)


def _dec(b: MetricBodyV2) -> int:
    if b.change is not None:
        return b.change.decimals
    return b.decimals or 1


def _cover(ctx: _Ctx) -> str:
    c = ctx.report.cover
    dl = "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in c.rows)
    art = "<i></i>" * 6
    return (
        f'<section class="page cover" data-key="cover">'
        f'<div class="intro"><div class="eyebrow">{_e(c.kicker)}</div><h1 class="cover-title">{_br(c.title)}</h1>'
        f'<p class="coverline">{_br(c.tagline)}</p><div class="cover-art" aria-hidden="true">{art}</div></div>'
        f'<div class="identity"><h3>회원님의 기록 <span>{_e(ctx.code)}</span></h3><dl>{dl}</dl></div>'
        f'<p class="publisher">{_e(c.brand)}</p><p class="note">{_e(c.issued_note)}<br>{_e(c.footer)}<br>문의: 담당 클래스 코치</p>'
        f'</section>'
    )


def _toc(ctx: _Ctx) -> str:
    r = ctx.report
    parts = r.meta.chapter_label.split(" · ", 1)
    mark, title = parts[0], (parts[1] if len(parts) > 1 else r.meta.chapter_label)
    date = r.meta.session_date.replace("-", ".")
    rows = "".join(f'<div class="toc-row"><span>{_e(t.label)}</span><b>{_page_range(t.start, t.end)}</b></div>'
                   for t in ctx.map.toc)
    return (
        f'<section class="page book-toc" data-key="toc">{ctx.head("나의 명상 기록 / 차례", ctx.code)}'
        f'<div class="eyebrow">{_e(r.toc.heading)}</div><h2 class="chapter-title">{_e(r.toc.chapter_title)}</h2>'
        f'<p class="narrative">{_e(r.toc.chapter_subtitle)}</p>'
        f'<div class="toc-chapter"><small>{_e(mark)}</small><h3 class="chapter-sub">{_e(title)}</h3>'
        f'<p class="note">{_e(date)}</p></div>{rows}{ctx.foot("toc")}</section>'
    )


def _summary(ctx: _Ctx) -> str:
    r = ctx.report
    h = r.hero
    pairs = "".join(
        f'<div class="effect-pair {_e(p.tone)}" data-key="{_e(p.key)}"><div class="pair-name">{_e(p.name)} '
        f'<small>{_e(p.unit)}</small></div><div class="pair-values"><span>{_e(p.before)}</span><i>→</i>'
        f'<strong>{_e(p.after)}</strong></div><div class="pair-change">{_e(p.change_text)}</div></div>'
        for p in h.pairs)
    grid = ""
    if h.pairs:
        grid = (f'<div class="pair-caption"><span>{_e(h.pair_caption_before)}</span><span>{_e(h.pair_caption_after)}'
                f'</span></div><div class="effect-grid">{pairs}</div>')
    caution = f'<p class="hero-caution">{_br(h.caution)}</p>' if h.caution else ""
    quiet = (f'<div class="quiet-highlight"><strong>{_e(h.quiet_highlight.text)}</strong>{_e(h.quiet_highlight.note)}</div>'
             if h.quiet_highlight else "")
    note = f'<p class="hero-note">{_e(h.note)}</p>' if h.note else ""
    return (
        f'<section class="page summary" data-key="summary">{ctx.head("MIND BREEZE / 나만의 명상 기록 책", r.meta.volume_label)}'
        f'<div class="summary-lead">나의 명상 기록 · {_e(r.meta.program_label)}</div>'
        f'<section class="effect-hero"><div class="hero-kicker">{_e(h.kicker)}</div><h1>{_br(h.headline)}</h1>'
        f'<p class="hero-lead">{_e(h.lead)}</p>{grid}{caution}{quiet}{note}</section>{ctx.foot("summary")}</section>'
    )


def _series_svg(ctx: _Ctx, key: str, label: str = "") -> str:
    sec = ctx.report.metrics[key]
    b = sec.body
    assert b is not None
    return time_series_svg_v2(b.series, _dec(b), ctx.report.meta.start_clock, label or f"{sec.title} 시간 그래프")


def _opinion(ctx: _Ctx) -> str:
    r = ctx.report
    o = r.opinion
    obs = "".join(f'<div class="observation"><b>{_e(x.title)}</b><p>{_e(x.body)}</p></div>' for x in o.observations)
    charts = ""
    plots = "".join(f'<article class="plot"><h3>{_e(r.metrics[k].title)}</h3>{_series_svg(ctx, k)}</article>'
                    for k in o.chart_keys if k in r.metrics and r.metrics[k].state == "ok")
    if plots:
        charts = f'<div class="mini-charts">{plots}</div><p class="legend">{_e(o.legend_note)}</p>'
    foot = f'<p class="footnote">{_e(o.footnote)}</p>' if o.footnote else ""
    return (
        f'<section class="page opinion" data-key="opinion">{ctx.chapter_head(None)}'
        f'<div class="intro"><div class="eyebrow">{_e(o.narrative.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_e(o.narrative.title)}</h2><p class="narrative">{_e(o.narrative.body)}</p></div>'
        f'<div class="observations">{obs}</div>'
        f'<div class="interpret"><h3>{_e(o.interpret_title)}</h3><p>{_e(o.interpret_body)}</p></div>{charts}{foot}'
        f'{ctx.foot("opinion")}</section>'
    )


def _journey(ctx: _Ctx) -> str:
    r = ctx.report
    j = r.journey
    assert j is not None
    tl = "".join(f"<div><b>{_e(t.label)}</b><small>{_e(t.value)}</small></div>" for t in j.timeline)
    main = "".join(f'<article class="plot"><h3>{_e(r.metrics[k].title)} · 수업 전체</h3>{_series_svg(ctx, k)}</article>'
                   for k in j.chart_keys if k == "motion")
    rest = "".join(f'<article class="plot"><h3>{_e(r.metrics[k].title)}</h3>{_series_svg(ctx, k)}</article>'
                   for k in j.chart_keys if k != "motion")
    return (
        f'<section class="page journey" data-key="journey">{ctx.chapter_head("body")}'
        f'<div class="intro"><div class="chapter-mark">몸의 변화</div><div class="eyebrow">{_e(j.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_br(j.title)}</h2></div><div class="timeline">{tl}</div>'
        f'<div class="plot-main">{main}</div><div class="charts-2">{rest}</div><p class="legend">{_e(j.legend_note)}</p>'
        f'<div class="callout"><b>{_e(j.interpret_title)}</b><br>{_e(j.interpret_body)}</div>{ctx.foot("journey")}</section>'
    )


def _quiet5(ctx: _Ctx) -> str:
    q = ctx.report.quiet5
    assert q is not None
    items = "".join(
        f'<div class="quiet-item"><h3>{_e(i.title)}</h3><strong>{_e(i.value_text)}</strong><p>{_e(i.body)}</p>'
        + (f'<p class="footnote">{_e(i.footnote)}</p>' if i.footnote else "") + "</div>" for i in q.items)
    return (
        f'<section class="page quiet5" data-key="quiet5">{ctx.chapter_head("body")}'
        f'<div class="intro"><div class="eyebrow">{_e(q.eyebrow)}</div><h2 class="chapter-title">{_e(q.title)}</h2>'
        f'<p class="narrative">{_e(q.note)}</p></div>{items}'
        f'<div class="interpret"><h3>{_e(q.reading_title)}</h3><p>{_e(q.reading_body)}</p></div>{ctx.foot("quiet5")}</section>'
    )


def _metric(ctx: _Ctx, sec: MetricSectionV2) -> str:
    b = sec.body
    assert b is not None
    key = sec.key
    chapter_mark = ""
    if sec.chapter == "mind":
        first_mind = next((p.key for p in ctx.map.pages if p.key in _MIND), None)
        if first_mind == key:
            chapter_mark = '<div class="chapter-mark">마음의 변화</div>'
    head_extra = f'<span class="delta-inline">{_e(b.comparison_text)}</span>' if b.comparison_text else ""
    bridge = f'<p class="bridge">{_e(b.bridge)}</p>' if b.bridge else ""
    group = ""
    if b.group is not None:
        g = b.group
        paras = "".join(f"<p class=\"original-explain\">{_e(p)}</p>" for p in g.paragraphs)
        gfoot = f'<p class="footnote">{_e(g.footnote)}</p>' if g.footnote else ""
        group = (
            f'<div class="group-support"><b>{_e(g.title)}</b><div class="gs-row"><div class="gs-left">'
            f'<article class="plot"><h3>통계로 보기</h3>{distribution_svg_v2(g.distribution, _dec(b), b.series.axis_unit)}'
            f'<p class="legend">{_e(g.legend)}</p></article></div><div class="gs-right">{paras}{gfoot}</div></div></div>')
    elif b.group_hidden_reason == "min_n":
        group = '<p class="note">같은 수업 참여자가 적어 그룹 비교는 보여 드리지 않고, 나의 기록만 담았어요.</p>'
    companion = (f'<div class="callout"><b>{_e(b.companion.title)}</b><br>{_e(b.companion.body)}</div>'
                 if b.companion else "")
    reading = f'<p class="reading">이렇게 읽어요 · {_e(b.reading)}</p>' if b.reading else ""
    foot = f'<p class="footnote">{_e(b.footnote)}</p>' if b.footnote else ""
    return (
        f'<section class="page metric {_METRIC_CLASS.get(key, "")}" data-key="{key}">{ctx.chapter_head(sec.chapter)}'
        f'<div class="intro">{chapter_mark}<div class="eyebrow">{_e(b.eyebrow)}</div>'
        f'<h2 class="chapter-title">{_e(b.conclusion)}</h2>{bridge}</div>'
        f'<article class="plot time-main"><h3>나의 시간 흐름{head_extra}</h3>{_series_svg(ctx, key)}'
        f'<p class="legend">{_br(b.series_legend)}</p></article>'
        f'<div class="interpret-new"><b>이게 무슨 뜻이에요</b>{_e(b.interpret)}</div>{companion}{group}{reading}{foot}'
        f'{ctx.foot(key)}</section>'
    )


def _next_steps(ctx: _Ctx) -> str:
    n = ctx.report.next_steps
    items = "".join(f'<article class="next"><b>{_e(i.title)}</b><p>{_e(i.body)}</p></article>' for i in n.items)
    return (
        f'<section class="page" data-key="next_steps">{ctx.chapter_head(None)}'
        f'<div class="intro"><div class="eyebrow">{_e(n.eyebrow)}</div><h2 class="chapter-title">{_br(n.title)}</h2>'
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
        f'<div class="intro"><div class="eyebrow">{_e(m.eyebrow)}</div><h2 class="chapter-title">{_br(m.title)}</h2>'
        f'<p class="narrative">{_e(m.body)}</p></div><h3>{_e(m.reading_title)}</h3>{paras}'
        f'<p class="footnote">{_e(m.footnote)}</p>'
        f'<div class="sources"><b>{_e(m.references_title)}</b><br>{refs}<br>{_e(m.references_checked)}</div>'
        f'<div class="interpret"><h3>{_e(m.contact_title)}</h3><p>{contact}</p></div>{ctx.foot("method")}</section>'
    )


def _back(ctx: _Ctx) -> str:
    b = ctx.report.back
    return (
        f'<section class="page book-back" data-key="back"><div class="back-message">'
        f'<div class="eyebrow">{_e(b.kicker)}</div><h2>{_br(b.title)}</h2><p>{_e(b.subtitle)}</p>'
        f'<div class="back-rule"></div><p class="publisher">{_e(b.brand)}</p>'
        f'<p class="note">{_e(b.note)}<br>{_e(b.contact)}</p></div></section>'
    )


def build_book_html_v2(report: Union[MemberReportV2, dict]) -> str:
    rep = report if isinstance(report, MemberReportV2) else MemberReportV2.model_validate(report)
    page_map = expected_book_pages_v2(rep)
    ctx = _Ctx(rep, page_map)
    renderers: dict[str, Callable[[], str]] = {
        "cover": lambda: _cover(ctx), "toc": lambda: _toc(ctx), "summary": lambda: _summary(ctx),
        "opinion": lambda: _opinion(ctx), "journey": lambda: _journey(ctx), "quiet5": lambda: _quiet5(ctx),
        "next_steps": lambda: _next_steps(ctx), "memo": lambda: _memo(ctx), "method": lambda: _method(ctx),
        "back": lambda: _back(ctx),
    }
    pages = [renderers[p.key]() if p.key in renderers else _metric(ctx, rep.metrics[p.key])  # type: ignore[index]
             for p in page_map.pages]
    css = (TEMPLATE_DIR / "book.css").read_text(encoding="utf-8") + (TEMPLATE_DIR / "book_v2.css").read_text(encoding="utf-8")
    return (
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">'
        f'<title>나의 명상 기록 · {_e(rep.meta.member_code)}</title><style>{css}</style></head>'
        f'<body class="v2">{"".join(pages)}</body></html>'
    )


def render_member_report_book_v2(report: Union[MemberReportV2, dict]) -> bytes:
    return HTML(string=build_book_html_v2(report), url_fetcher=_font_fetcher).write_pdf()


__all__ = ["build_book_html_v2", "render_member_report_book_v2"]

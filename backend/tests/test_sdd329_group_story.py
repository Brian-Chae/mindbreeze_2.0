"""SDD-329 D — 미측정 회원 그룹 기반 리포트."""
from __future__ import annotations

import re

import pytest

from app.schemas.member_report import MemberReport
from app.services import member_report_builder as builder
from app.services import member_report_book as book
from app.services.member_report_wording import assert_report_clean
from tests.test_member_report_builder import _fill, _no_side_effects, db  # noqa: F401
from tests.sdd237_helpers import build_class_world

_ALL = lambda out: " ".join(_strings(out))  # noqa: E731


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


def _world(db, measured: int):
    world = build_class_world(db, members=measured + 1, duration_min=64)
    for i, p in enumerate(world["participants"][1:]):
        _fill(db, world, p, 60, seed=i)
    return world


def test_그룹_10명이면_그래프와_그룹기록_서사(db):
    world = _world(db, 10)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    MemberReport.model_validate(out)
    g = out["group_story"]
    assert out["meta"]["band_status"] == "not_worn" and g["label"] == "그룹 기록"
    assert g["charts"] and g["chart_hidden_reason"] is None and g["n_people"] >= 10
    assert "측정 기록이 아니라" in g["paragraphs"][0] and "이런 과정을 함께 경험했어요" in g["paragraphs"][0]
    assert_report_clean(out)
    text = _ALL(out)
    assert "불규칙" not in text and not re.search(r"\d\s*ms\b", text)
    # 개인 값·ID 없음 — 그래프는 분별 값 목록뿐
    assert set(g["charts"][0]) == {"key", "title", "unit_label", "minutes", "values", "axis_min", "axis_max"}


def test_그룹_10명_미만이면_서사만(db):
    world = _world(db, 4)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    g = out["group_story"]
    assert g["charts"] == [] and g["chart_hidden_reason"] == "min_n" and g["n_people"] is None
    assert not re.search(r"\d+\s*회", " ".join(g["paragraphs"]))
    assert_report_clean(out)


def test_측정자는_group_story_없음(db):
    world = _world(db, 3)
    out = builder.build_member_report(db, world["session"].id, world["participants"][1].id)
    assert out["meta"]["band_status"] == "worn" and out.get("group_story") is None


def test_AI_호출_없음(db, monkeypatch):
    import socket

    def _deny(*a, **k):
        raise AssertionError("네트워크/AI 호출 금지")

    monkeypatch.setattr(socket.socket, "connect", _deny)
    world = _world(db, 10)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    assert out["group_story"]["source" if False else "label"] == "그룹 기록"


def test_회원_책_PDF_HTML에_그룹기록_쪽(db):
    world = _world(db, 10)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    html = book.build_book_html(out)
    assert 'data-key="group_story"' in html and "<polyline" in html and "그룹 기록" in html
    rep = MemberReport.model_validate(out)
    from app.schemas.member_report import expected_book_pages

    keys = [p.key for p in expected_book_pages(rep).pages]
    assert keys.index("group_story") > keys.index("opinion")


def test_자동승인_제외_예외_그룹기록_리포트는_제외_안함():
    from types import SimpleNamespace
    from unittest import mock
    from app.services import report_service as rs

    s = SimpleNamespace(class_id="c")
    with mock.patch.object(rs, "report_domain", return_value="meditation"):
        base = {"eeg": {"status": "not_measured"}}
        assert rs._skip_auto_approve_no_data(s, SimpleNamespace(content=base)) is True
        withg = {**base, "member_report": {"group_story": {"label": "그룹 기록"}}}
        assert rs._skip_auto_approve_no_data(s, SimpleNamespace(content=withg)) is False

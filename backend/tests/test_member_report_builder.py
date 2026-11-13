"""SDD-327 T5 — 회원 리포트 조립기·저장 연결·조회 API 테스트(합성 데이터, 외부 호출 없음)."""

import random
import time
import uuid
from datetime import timedelta

import pytest

from app.models.record import Report
from app.models.session import SessionParticipant
from app.schemas.member_report import MIN_GROUP_N, MemberReport
from app.services import member_report_builder as builder
from app.tasks import report_task
from tests.sdd237_helpers import START, add_windows, auth_for, build_class_world, make_user


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _no_side_effects(monkeypatch):
    monkeypatch.setattr(report_task, "_maybe_enqueue_class_narrative", lambda *a, **k: None)
    # 원시 EEG(S3) 접근 금지 — 기본은 원시 없음
    monkeypatch.setattr(builder, "_raw_array", lambda *a, **k: None)


def _fill(db, world, participant, minutes, *, hr=lambda i: 75 - i / 60 * 0.3, seed=1):
    rnd = random.Random(seed)
    add_windows(
        db, world["session"], participant, minutes * 60,
        focus=lambda i: 2.0 + rnd.random(), relax=1.0, emo=lambda i: 0.5 + rnd.random() * 0.1,
        hr=hr, sdnn=lambda i: 40 + rnd.random() * 5, tna=lambda i: 2.0 + rnd.random())
    # rmssd·motion·lf_hf 는 헬퍼가 넣지 않으므로 직접 채운다
    from app.models.eeg_feature import EEGFeatureWindow as W

    for w in db.query(W).filter(W.participant_id == participant.id).all():
        w.rmssd, w.motion, w.lf_hf_ratio = 30 + rnd.random() * 5, 0.02 if w.window_index < 1500 else 0.0, 1.2
    db.commit()


# ── 구간 ──────────────────────────────────────────────────────────
def test_구간_64분이면_시안과_같고_길이에_비례한다():
    ref = builder.scale_segments(64)
    assert [(s.start_min, s.end_min) for s in ref] == [(2, 12), (13, 31), (33, 47), (48, 63)]
    short = builder.scale_segments(32)
    assert short[0].start_min <= short[0].end_min < short[1].start_min
    assert short[-1].end_min <= 31 and short[-1].end_min > short[2].end_min  # 고정 분 값이 아님
    long = builder.scale_segments(90)
    assert long[-1].end_min > 63


def test_구간_원천은_실제_길이_우선(db):
    world = build_class_world(db, members=1, duration_min=45)
    segs, source = builder.resolve_segments(db, world["session"], None)
    assert source == "proportional:actual_duration"
    assert segs[-1].end_min <= 44


# ── 조립 ──────────────────────────────────────────────────────────
def test_착용_회원_리포트가_계약을_통과하고_지표가_채워진다(db):
    world = build_class_world(db, members=MIN_GROUP_N + 1, duration_min=64)
    parts = world["participants"]
    for i, p in enumerate(parts):
        _fill(db, world, p, 60, seed=i)
    out = builder.build_member_report(db, world["session"].id, parts[0].id)
    MemberReport.model_validate(out)
    assert out["meta"]["band_status"] == "worn"
    assert out["meta"]["member_code"].startswith("B3-1")
    assert out["metrics"]["heart_rate"]["state"] == "ok"
    assert out["metrics"]["heart_rate"]["body"]["group"] is not None  # 11명 ≥ 10
    assert out["metrics"]["aperiodic"]["missing_reason"] == "no_raw"  # 원시 없음
    assert out["metrics"]["lf_hf"]["body"]["group"] is None
    assert out["stable5"] is not None and out["hero"]["pairs"]
    assert {p["key"] for p in out["hero"]["pairs"]} == {"heart_rate", "relaxation", "motion", "focus"}


def test_그룹_인원_부족이면_숫자도_보내지_않는다(db):
    world = build_class_world(db, members=4, duration_min=64)
    for i, p in enumerate(world["participants"]):
        _fill(db, world, p, 60, seed=i)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    body = out["metrics"]["heart_rate"]["body"]
    assert body["group"] is None and body["series"]["group_band"] is None
    assert body["group_hidden_reason"] == "min_n"
    assert out["metrics"]["heart_rate"]["body"]["change"]["before"] is not None


def test_밴드_미착용이면_모든_지표가_결측이고_0으로_채우지_않는다(db):
    world = build_class_world(db, members=2, duration_min=64)
    _fill(db, world, world["participants"][1], 60)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    MemberReport.model_validate(out)
    assert out["meta"]["band_status"] == "not_worn"
    assert all(s["state"] == "missing" and s["missing_reason"] == "band_not_worn" for s in out["metrics"].values())
    assert out["hero"]["pairs"] == [] and out["journey"] is None and out["stable5"] is None


def test_신호가_짧으면_poor_signal(db):
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 6)  # 유효 6분 < 10분
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    assert out["metrics"]["heart_rate"]["missing_reason"] == "poor_signal"


def test_다른_회원_값이_결과에_섞이지_않는다(db):
    world = build_class_world(db, members=MIN_GROUP_N + 1, duration_min=64)
    for i, p in enumerate(world["participants"]):
        _fill(db, world, p, 60, seed=i)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    text = str(out)
    for p in world["participants"][1:]:
        assert str(p.id) not in text


def test_1f_원시가_있으면_구간별_지수와_5분_타일을_만든다(db, monkeypatch):
    import numpy as np

    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    rng = np.random.default_rng(0)

    def fake_raw(_db, _sid, _pid, t_lo, t_hi, reader=None):
        n = int((t_hi - t_lo) / 1000 * 250) + 1
        white = rng.normal(0, 10, (2, n))
        return np.cumsum(white, axis=1) * 0.05 + white  # 1/f 비슷한 색 잡음

    monkeypatch.setattr(builder, "_raw_array", fake_raw)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    MemberReport.model_validate(out)
    ap = out["metrics"]["aperiodic"]
    assert ap["state"] in ("ok", "missing")
    if ap["state"] == "ok":
        assert ap["body"]["group"] is None
    else:
        assert ap["missing_reason"] in ("poor_fit", "insufficient_window")


def test_T4가_있으면_문장_규칙을_적용한다(db, monkeypatch):
    import sys
    import types

    mod = types.ModuleType("app.services.member_report_wording")
    mod.apply_wording = lambda r: {**r, "hero": {**r["hero"], "headline": "테스트 문장"}}
    monkeypatch.setitem(sys.modules, "app.services.member_report_wording", mod)
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    assert out["hero"]["headline"] == "테스트 문장"
    assert out["forbidden_words_checked"] is True


# ── 저장 연결 ──────────────────────────────────────────────────────
def test_리포트_생성이_member_report를_병행_저장한다(db):
    world = build_class_world(db, members=2, duration_min=64)
    for i, p in enumerate(world["participants"]):
        _fill(db, world, p, 60, seed=i)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert isinstance(report.content.get("member_report"), dict)
    assert "eeg" in report.content  # 기존 4쪽 서사형 경로 보존
    MemberReport.model_validate(report.content["member_report"])
    # 상담사 리포트에는 싣지 않는다
    report_task.generate_report_inline(str(world["counselor_report"].id), db)
    db.refresh(world["counselor_report"])
    assert "member_report" not in world["counselor_report"].content


def test_계산_실패해도_리포트는_저장되고_이전_member_report를_이월한다(db, monkeypatch):
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    first = report.content["member_report"]

    def boom(*a, **k):
        raise RuntimeError("실패")

    monkeypatch.setattr(builder, "build_member_report", boom)
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert report.status != "error" and report.content["member_report"] == first


# ── 조회 API ──────────────────────────────────────────────────────
def _auth(participant):
    from types import SimpleNamespace

    return auth_for(SimpleNamespace(id=participant.user_id))


def _approved_report(db, world, idx=0, with_member_report=True):
    report = world["client_reports"][idx]
    p = world["participants"][idx]
    _fill(db, world, p, 60, seed=idx)
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    report.status = "completed"
    db.commit()
    return report, p


def test_본인은_member_report_JSON을_받는다(db, client):
    world = build_class_world(db, members=2, duration_min=64)
    report, p = _approved_report(db, world)
    r = client.get(f"/api/v1/me/reports/{report.id}/member-report", headers=_auth(p))
    assert r.status_code == 200, r.text
    assert r.json()["schema_version"] == "member_report.v1"
    assert r.headers["cache-control"] == "no-store"


def test_남의_리포트는_403(db, client):
    world = build_class_world(db, members=2, duration_min=64)
    report, _p = _approved_report(db, world)
    other = world["participants"][1]
    r = client.get(f"/api/v1/me/reports/{report.id}/member-report", headers=_auth(other))
    assert r.status_code == 403
    r = client.get(f"/api/v1/me/reports/{report.id}/book.pdf", headers=_auth(other))
    assert r.status_code == 403


def test_없는_리포트_미승인_member_report_없음은_404(db, client):
    world = build_class_world(db, members=1, duration_min=64)
    p = world["participants"][0]
    h = _auth(p)
    assert client.get(f"/api/v1/me/reports/{uuid.uuid4()}/member-report", headers=h).status_code == 404
    assert client.get("/api/v1/me/reports/not-a-uuid/member-report", headers=h).status_code == 404
    report = world["client_reports"][0]  # pending_review, member_report 없음
    assert client.get(f"/api/v1/me/reports/{report.id}/member-report", headers=h).status_code == 404
    report.status = "completed"
    db.commit()
    assert client.get(f"/api/v1/me/reports/{report.id}/member-report", headers=h).status_code == 404  # content 에 없음


def test_book_pdf는_PDF_바이트를_돌려준다(db, client):
    pytest.importorskip("weasyprint")
    world = build_class_world(db, members=2, duration_min=64)
    report, p = _approved_report(db, world)
    r = client.get(f"/api/v1/me/reports/{report.id}/book.pdf", headers=_auth(p))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content[:5] == b"%PDF-"


def test_공유_토큰_열람_응답에도_member_report가_포함된다(db):
    from app.services import report_service

    world = build_class_world(db, members=1, duration_min=64)
    report, _p = _approved_report(db, world)
    out = report_service._serialize(report, world["session"])
    assert isinstance(out["content"].get("member_report"), dict)


# ── 생성 시간 실측 ─────────────────────────────────────────────────
def test_생성_시간_실측_참고(db, monkeypatch, capsys):
    """원시 EEG 64분(2ch 250Hz)을 가정한 1/f 포함 총 소요를 출력한다(통과 조건은 느슨한 상한)."""
    import numpy as np

    world = build_class_world(db, members=MIN_GROUP_N + 1, duration_min=64)
    for i, p in enumerate(world["participants"]):
        _fill(db, world, p, 62, seed=i)
    rng = np.random.default_rng(1)

    def fake_raw(_db, _sid, _pid, t_lo, t_hi, reader=None):
        n = int((t_hi - t_lo) / 1000 * 250) + 1
        w = rng.normal(0, 8, (2, n)).astype("float32")
        return np.cumsum(w, axis=1).astype("float64") * 0.02 + w

    monkeypatch.setattr(builder, "_raw_array", fake_raw)
    t0 = time.perf_counter()
    out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
    elapsed = time.perf_counter() - t0
    with capsys.disabled():
        print(f"\n[T5 실측] build_member_report(11명 그룹·1/f 포함·로컬 합성) = {elapsed:.1f}s, 1/f={out['metrics']['aperiodic']['state']}/{out['metrics']['aperiodic']['missing_reason']}")
    assert elapsed < 120

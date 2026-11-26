"""SDD-336 — 측정 미시작 원인 판정·재진입 푸시·소켓/리포트 무해화."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.class_membership import SessionPresenceLease
from app.models.device_token import DeviceToken
from app.models.eeg_feature import EEGFeatureWindow
from app.models.notification_outbox import NotificationOutbox
from app.models.research import ResearchConsentEvent
from app.models.session import SessionBandDevice, SessionReminderLog
from app.services import measure_cause_service as mcs
from app.services.session_service import get_live_metrics
from tests.sdd237_helpers import build_class_world
from tests.test_sdd027_rollup_raw_report import _db


# ── 순수 판정 ─────────────────────────────────────────────────
@pytest.mark.parametrize("raw,outdated", [
    (None, True), ("", True), ("abc", True), ("1.0.0", True), ("0.9.9", True),
    ("1.0.1", False), ("1.0.1-beta", False), ("v1.1", False), ("2", False),
])
def test_앱_버전_최소_1_0_1(raw, outdated):
    assert mcs.is_app_outdated(raw) is outdated


def test_원인_우선순위():
    f = mcs.classify_reason
    assert f(app_version="1.0.0", consent_declined=True, has_presence=False) == "app_update_required"
    assert f(app_version="1.0.1", consent_declined=True, has_presence=False) == "consent_declined"
    assert f(app_version="1.0.1", consent_declined=False, has_presence=False) == "app_not_in_class"
    assert f(app_version="1.0.1", consent_declined=False, has_presence=True) == "not_started"


# ── get_live_metrics 통합 ─────────────────────────────────────
@pytest.fixture
def live_world(client):
    with _db() as db:
        world = build_class_world(db, members=3, status="in_progress", ended=False)
        now = datetime.now(timezone.utc)
        world["session"].started_at = now - timedelta(minutes=10)
        world["session"].state_version = 1
        for p in world["participants"]:
            p.entered_at = now - timedelta(minutes=5)
        db.commit()
        yield {"world": world, "db": db}


def _rows(db, world):
    res = get_live_metrics(str(world["session"].id), str(world["host"].id), db)
    return {m["participant_id"]: m for m in res["metrics"]}


def _band(db, world, p, ver):
    db.add(SessionBandDevice(session_id=world["session"].id, participant_id=p.id, serial=f"S{uuid.uuid4().hex[:6]}", app_version=ver))


def test_원인_라벨_3종과_기본(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, p2 = world["participants"]
    _band(db, world, p0, "1.0.0")                      # 업데이트 필요
    _band(db, world, p1, "1.0.1")                      # 최신 + 화면 없음
    _band(db, world, p2, "1.0.1")
    db.add(SessionPresenceLease(id=f"sid-{uuid.uuid4().hex[:6]}", session_id=world["session"].id, participant_id=p2.id,
                                expires_at=datetime.now(timezone.utc) + timedelta(seconds=60)))
    db.commit()
    rows = _rows(db, world)
    assert rows[str(p0.id)]["measure_issue_reason"] == "app_update_required"
    assert rows[str(p1.id)]["measure_issue_reason"] == "app_not_in_class"
    assert rows[str(p2.id)]["measure_issue_reason"] == "not_started"


def test_앱_버전은_기기토큰_폴백_웹은_제외(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, _ = world["participants"]
    db.add(DeviceToken(user_id=p0.user_id, token="t-ios", platform="ios", app_version="1.0.1"))
    db.add(DeviceToken(user_id=p1.user_id, token="t-web", platform="web", app_version="9.9.9"))
    db.commit()
    rows = _rows(db, world)
    assert rows[str(p0.id)]["measure_issue_reason"] == "app_not_in_class"      # 1.0.1 → 업데이트 불필요
    assert rows[str(p1.id)]["measure_issue_reason"] == "app_update_required"   # 웹 토큰은 근거 아님 → 기록 없음


def test_거절은_라벨만_이상집계_제외(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, p2 = world["participants"]
    for p in (p0, p1, p2):
        _band(db, world, p, "1.0.1")
    p0.eeg_collection_consented = False
    # 연구 동의: 거절 후 재동의 → 거절 아님 / p2 는 거절 이벤트가 마지막
    t = datetime.now(timezone.utc)
    db.add(ResearchConsentEvent(session_id=world["session"].id, participant_id=p1.id, event_type="declined",
                                previous_consented=True, new_consented=False, created_at=t - timedelta(minutes=3)))
    db.add(ResearchConsentEvent(session_id=world["session"].id, participant_id=p1.id, event_type="consented",
                                previous_consented=False, new_consented=True, created_at=t - timedelta(minutes=2)))
    db.add(ResearchConsentEvent(session_id=world["session"].id, participant_id=p2.id, event_type="declined",
                                previous_consented=True, new_consented=False, created_at=t - timedelta(minutes=2)))
    db.commit()
    rows = _rows(db, world)
    assert rows[str(p0.id)]["measure_issue_reason"] == "consent_declined"
    assert rows[str(p0.id)]["measure_not_started"] is False       # 밴드 미사용은 이상 제외(기존 규칙)
    assert rows[str(p1.id)]["measure_issue_reason"] == "app_not_in_class"
    assert rows[str(p2.id)]["measure_issue_reason"] == "consent_declined"


def test_데이터가_들어오면_원인_없음(live_world):
    db, world = live_world["db"], live_world["world"]
    p0 = world["participants"][0]
    assert _rows(db, world)[str(p0.id)]["measure_issue_reason"] is not None
    db.add(EEGFeatureWindow(session_id=world["session"].id, participant_id=p0.id, window_index=0, relaxation_index=50.0))
    db.commit()
    assert _rows(db, world)[str(p0.id)]["measure_issue_reason"] is None


# ── 재진입 푸시 ───────────────────────────────────────────────
def _push_rows(db):
    return db.query(NotificationOutbox).filter(NotificationOutbox.channel == "push").all()


def _tokenize(db, world):
    for i, p in enumerate(world["participants"]):
        db.add(DeviceToken(user_id=p.user_id, token=f"tok-{i}-{uuid.uuid4().hex[:6]}", platform="ios", app_version="1.0.1"))
    db.commit()


def test_푸시_150초_경계(live_world):
    db, world = live_world["db"], live_world["world"]
    _tokenize(db, world)
    base = datetime.now(timezone.utc)
    s = world["session"]
    s.started_at = base - timedelta(seconds=150)
    for p in world["participants"]:
        p.entered_at = base - timedelta(seconds=300)
    db.commit()
    assert mcs.enqueue_measure_nudges(db, base)["queued"] == 0              # 정확히 150초는 아직
    assert mcs.enqueue_measure_nudges(db, base + timedelta(seconds=2))["queued"] == 3
    assert len(_push_rows(db)) == 3 and "앱을 열어" in _push_rows(db)[0].payload["body"]


def test_푸시_회원당_최대_2회_5분_간격(live_world):
    db, world = live_world["db"], live_world["world"]
    _tokenize(db, world)
    now = datetime.now(timezone.utc)
    assert mcs.enqueue_measure_nudges(db, now)["queued"] == 3
    assert mcs.enqueue_measure_nudges(db, now + timedelta(seconds=60))["queued"] == 0     # 간격 미충족
    # 로그 시각을 과거로 돌려 5분 경과 재현
    for log in db.query(SessionReminderLog).all():
        log.sent_at = now - timedelta(seconds=301)
    db.commit()
    assert mcs.enqueue_measure_nudges(db, now)["queued"] == 3                              # 2번째
    for log in db.query(SessionReminderLog).all():
        log.sent_at = now - timedelta(seconds=301)
    db.commit()
    assert mcs.enqueue_measure_nudges(db, now)["queued"] == 0                              # 3번째 없음
    assert len(_push_rows(db)) == 6


def test_푸시_측정_시작_거절_토큰없음_알림끔은_제외(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, p2 = world["participants"]
    for p in (p0, p1):
        db.add(DeviceToken(user_id=p.user_id, token=f"t-{p.id}", platform="android", app_version="1.0.1"))
    db.add(EEGFeatureWindow(session_id=world["session"].id, participant_id=p0.id, window_index=0, relaxation_index=50.0))
    p1.eeg_collection_consented = False
    db.commit()                                    # p0 측정 중, p1 거절, p2 토큰 없음
    assert mcs.enqueue_measure_nudges(db)["queued"] == 0
    assert _push_rows(db) == []


def test_푸시_알림_끈_회원은_제외(live_world):
    db, world = live_world["db"], live_world["world"]
    _tokenize(db, world)
    from app.models.user import User
    u = db.get(User, world["participants"][0].user_id)
    u.notification_preferences = {"push": {"session_started": False}}
    db.commit()
    assert mcs.enqueue_measure_nudges(db)["queued"] == 2


# ── 리포트 partial ────────────────────────────────────────────
def test_제외_참가자로_공통기록을_뺀_상담사_리포트는_ready():
    from app.services import report_progress_service as rps
    content = {"ai_record": {"status": "not_available", "reason": "excluded"}}
    assert rps.generation_status_for_content(content, None) == rps.GENERATION_READY
    stub = {"ai_record": {"status": "not_available", "reason": "excluded"}, "report_scope": {"excluded": True}}
    assert rps.generation_status_for_content(stub, None) == rps.GENERATION_PARTIAL
    for reason in ("mic_off", "low_confidence", "no_transcript"):
        c = {"ai_record": {"status": "not_available", "reason": reason}}
        assert rps.generation_status_for_content(c, None) == rps.GENERATION_PARTIAL


# ── 소켓 무해화 ───────────────────────────────────────────────
def test_publish_timeout_은_트레이스없이_경고(caplog):
    import logging
    from app.services.live_ingest_service import make_sinks
    from app.services.live_ingest_service import ingest_metrics  # noqa: F401  (import 가능 확인)

    class Out:
        projected = True
        response = {"ok": True}

    import app.services.live_ingest_service as li
    orig = li.ingest_metrics
    li.ingest_metrics = lambda db, actor, sid, data: Out()
    try:
        class _DB:
            def close(self): pass
        def boom(_sid): raise TimeoutError()
        metric, _ = make_sinks(lambda: _DB(), boom)
        with caplog.at_level(logging.WARNING):
            assert metric(None, uuid.uuid4(), {}) == {"ok": True}
        rec = [r for r in caplog.records if "방송 대기 초과" in r.getMessage()]
        assert len(rec) == 1 and rec[0].exc_info is None
    finally:
        li.ingest_metrics = orig

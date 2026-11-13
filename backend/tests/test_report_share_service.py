"""SDD-327 T12 — 리포트 공유 서비스 단위 테스트 (권한 외 상한·토큰·메시지·표시 이름)."""
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import fakeredis
import pytest
from fastapi import HTTPException
from jose import jwt

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.report_share_event import ReportShareEvent
from app.models.session import Session, SessionParticipant
from app.services import report_email_service
from app.services import report_share_service as svc


@pytest.fixture
def env(client, monkeypatch):
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    session = Session(host_id=uuid.uuid4(), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(report_included=True, session_id=session.id, guest_name="회원")
    db.add(participant)
    db.flush()
    report = Report(session_id=session.id, participant_id=participant.id, type="client",
                    status="completed", content={})
    db.add(report)
    db.commit()
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    enq = Mock()
    monkeypatch.setattr(svc, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(svc, "_enqueue", enq)
    yield db, report, fake, enq
    provider.close()


def _member(n="m1"):
    return svc.ShareActor(user_id=str(uuid.uuid4()), kind="member", display_name="별이")


def test_share_queues_event_and_masks_address(env):
    db, report, _, enq = env
    out = svc.share_report(db, str(report.id), _member(), ["Friend@Example.com"])
    assert out["accepted_count"] == 1
    ev = db.query(ReportShareEvent).one()
    assert ev.status == "queued" and ev.recipient_masked == "f***@e***.com"
    assert "friend@example.com" not in (ev.recipient_masked + ev.recipient_hash)
    assert len(ev.recipient_hash) == 64
    enq.assert_called_once()
    assert enq.call_args.args[1] == "friend@example.com"


def test_recipient_hash_is_hmac_of_lowercase():
    import hashlib, hmac
    exp = hmac.new(settings.jwt_secret_key.encode(), b"a@b.com", hashlib.sha256).hexdigest()
    assert svc.hash_recipient("A@B.com") == exp


def test_token_is_per_recipient_with_jti_and_7days(env):
    db, report, _, enq = env
    svc.share_report(db, str(report.id), _member(), ["a@x.com", "b@x.com"])
    links = [c.args[2] for c in enq.call_args_list]
    tokens = [l.split("token=")[1] for l in links]
    assert len(set(tokens)) == 2
    claims = [jwt.decode(t, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]) for t in tokens]
    assert claims[0]["type"] == "report_share" and claims[0]["jti"] != claims[1]["jti"]
    assert claims[0]["rcpt"] == svc.hash_recipient("a@x.com")[:32]
    ttl = datetime.fromtimestamp(claims[0]["exp"], timezone.utc) - datetime.now(timezone.utc)
    assert timedelta(days=6, hours=23) < ttl <= timedelta(days=7)
    jtis = {e.jti for e in db.query(ReportShareEvent).all()}
    assert jtis == {c["jti"] for c in claims}


def test_more_than_three_or_invalid_rejected(env):
    db, report, _, _ = env
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), _member(), ["a@x.com", "b@x.com", "c@x.com", "d@x.com"])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), _member(), ["nope"])
    assert e.value.status_code == 422


def test_member_daily_limit_boundary(env):
    db, report, fake, _ = env
    actor = _member()
    for i in range(10):
        svc.share_report(db, str(report.id), actor, [f"u{i}@x.com"])
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), actor, ["u10@x.com"])
    assert e.value.status_code == 429
    # 거절된 건은 카운트·간격 키를 되돌려 상한을 넘기지 않는다
    assert int(fake.get(svc._day_key(actor.user_id))) == 10


def test_staff_limit_300_and_301st_is_429(env):
    db, report, fake, _ = env
    actor = svc.ShareActor(user_id=str(uuid.uuid4()), kind="counselor")
    fake.set(svc._day_key(actor.user_id), 299)
    ok = svc.share_report(db, str(report.id), actor, ["last@x.com"])
    assert ok["daily_remaining"] == 0
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), actor, ["over@x.com"])
    assert e.value.status_code == 429


def test_org_admin_also_300(env):
    assert svc.ShareActor("u", "org_admin").daily_limit == 300
    assert svc.ShareActor("u", "member").daily_limit == 10


def test_same_address_within_one_minute_is_too_soon(env):
    db, report, fake, enq = env
    actor = _member()
    svc.share_report(db, str(report.id), actor, ["same@x.com"])
    out = svc.share_report(db, str(report.id), actor, ["SAME@x.com"])
    assert out["accepted_count"] == 0
    assert out["rejected"][0]["reason"] == "too_soon"
    assert enq.call_count == 1
    assert db.query(ReportShareEvent).count() == 1
    assert 0 < fake.ttl(svc._rcpt_key(svc.hash_recipient("same@x.com"))) <= 60


def test_redis_failure_rejects_without_sending(env, monkeypatch):
    db, report, _, enq = env
    broken = Mock()
    broken.set.side_effect = ConnectionError("down")
    monkeypatch.setattr(svc, "get_sync_redis", lambda: broken)
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), _member(), ["a@x.com"])
    assert e.value.status_code == 503
    enq.assert_not_called()
    assert db.query(ReportShareEvent).count() == 0


def test_day_key_uses_kst_date():
    key = svc._day_key("U")
    assert key.startswith("rl:share:day:U:") and len(key.rsplit(":", 1)[1]) == 8


def test_message_strips_links_tags_and_escapes():
    out = svc.sanitize_message('<b>안녕</b> https://evil.com/x 보세요 www.a.com & foo.kr/path <3')
    assert "http" not in out and "evil" not in out and "www" not in out and "foo.kr" not in out
    assert "<b>" not in out and "&amp;" in out and "안녕" in out
    assert svc.sanitize_message("   ") is None and svc.sanitize_message(None) is None
    assert svc.sanitize_message("https://only.link") is None


def test_sender_name_fallback_and_no_real_name():
    assert svc.ShareActor("u", "member", None).sender_name == "MIND BREEZE 회원"
    assert svc.ShareActor("u", "member", "  ").sender_name == "MIND BREEZE 회원"
    assert svc.ShareActor("u", "member", "별이").sender_name == "별이"

    class U:  # 실명·이메일만 있는 사용자
        name = "홍길동"
        email = "real@x.com"
    assert svc.resolve_display_name(U()) is None


def test_enqueue_receives_sanitized_message_and_sender(env):
    db, report, _, enq = env
    svc.share_report(db, str(report.id), _member(), ["a@x.com"], message="hi http://x.io <i>y</i>")
    args = enq.call_args.args
    assert args[4] == "hi y" and args[5] == "별이"


def test_view_accepts_issued_token_and_rejects_others(env):
    db, report, _, enq = env
    svc.share_report(db, str(report.id), _member(), ["a@x.com"])
    token = enq.call_args.args[2].split("token=")[1]
    body = svc.get_report_share_view_content(token, db)
    assert body["id"] == str(report.id)
    # 발급되지 않은 jti
    forged = report_email_service._token("report_share", str(report.id), str(report.session_id),
                                         rcpt="x" * 32, jti="deadbeef")
    with pytest.raises(HTTPException) as e:
        svc.get_report_share_view_content(forged, db)
    assert e.value.status_code == 403
    # 다른 종류 토큰
    other = report_email_service._token("report_view", str(report.id), str(report.session_id), email="a@x.com")
    with pytest.raises(HTTPException) as e:
        svc.get_report_share_view_content(other, db)
    assert e.value.status_code == 401


def test_view_rejects_wrong_rcpt_revoked_and_expired(env):
    db, report, _, enq = env
    svc.share_report(db, str(report.id), _member(), ["a@x.com"])
    ev = db.query(ReportShareEvent).one()
    wrong = report_email_service._token("report_share", str(report.id), str(report.session_id),
                                        rcpt="0" * 32, jti=ev.jti)
    with pytest.raises(HTTPException) as e:
        svc.get_report_share_view_content(wrong, db)
    assert e.value.status_code == 403
    token = enq.call_args.args[2].split("token=")[1]
    ev.revoked_at = datetime.now(timezone.utc)
    db.commit()
    with pytest.raises(HTTPException) as e:
        svc.get_report_share_view_content(token, db)
    assert e.value.status_code == 403
    expired = jwt.encode({"type": "report_share", "sub": str(report.id), "session_id": str(report.session_id),
                          "rcpt": ev.recipient_hash[:32], "jti": ev.jti,
                          "exp": datetime.now(timezone.utc) - timedelta(seconds=5)},
                         settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    ev.revoked_at = None
    db.commit()
    with pytest.raises(HTTPException) as e:
        svc.get_report_share_view_content(expired, db)
    assert e.value.status_code == 401


def test_ineligible_reports_blocked(env):
    db, report, _, _ = env
    report.status = "pending_review"
    db.commit()
    with pytest.raises(HTTPException) as e:
        svc.share_report(db, str(report.id), _member(), ["a@x.com"])
    assert e.value.status_code == 409

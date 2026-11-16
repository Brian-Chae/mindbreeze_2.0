"""A1: 수업 종료 lock timeout 500 — 퇴장 light 잠금·재시도·종료 후처리 순서."""
import inspect
import uuid
from unittest.mock import MagicMock

import pytest

from app.services import class_participation_service as cps
from app.ws import session_live_namespace as ns


def _fake_db_for_light(session_row):
    db = MagicMock()
    db.get.return_value = session_row
    return db


def test_lock_context_light_skips_class_and_user_locks(monkeypatch):
    """light 잠금은 users·classes·class_members 를 잠그지 않고 회차+참가행만 잠근다."""
    row = MagicMock(id=uuid.uuid4(), class_id=uuid.uuid4())
    db = _fake_db_for_light(row)
    called = {"class_lock": 0, "participants": 0}

    import app.services.class_write_service as cws

    monkeypatch.setattr(cws, "lock_class_session", lambda *a, **k: called.__setitem__("class_lock", 1) or (None, row))
    monkeypatch.setattr(cps, "lock_participants", lambda d, r: called.__setitem__("participants", 1) or [])
    q = db.query.return_value.filter_by.return_value.populate_existing.return_value.with_for_update.return_value
    q.one.return_value = row

    cps.lock_context(db, row.id, light=True)
    assert called == {"class_lock": 0, "participants": 1}
    db.query.return_value.filter_by.return_value.populate_existing.return_value.with_for_update.assert_called_once()


def test_lock_context_default_uses_class_lock(monkeypatch):
    row = MagicMock(id=uuid.uuid4(), class_id=uuid.uuid4())
    db = _fake_db_for_light(row)
    import app.services.class_write_service as cws

    seen = []
    monkeypatch.setattr(cws, "lock_class_session", lambda d, r, a: seen.append(1) or (None, r))
    monkeypatch.setattr(cps, "lock_participants", lambda d, r: [])
    cps.lock_context(db, row.id)
    assert seen == [1]


def test_leave_and_expire_use_light_lock(monkeypatch):
    calls = []
    monkeypatch.setattr(cps, "lock_context", lambda db, sid, actor=None, light=False: calls.append(light) or (MagicMock(participation_version=0), []))
    monkeypatch.setattr(cps, "_expire", lambda *a, **k: None)
    monkeypatch.setattr(cps, "build_snapshot", lambda *a, **k: {"session_id": "x", "participants": []})
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None
    cps.socket_update(db, "sid1", {"session_id": str(uuid.uuid4()), "role": "participant"}, "leave")
    assert calls == [True]
    db.query.return_value.filter.return_value.distinct.return_value.all.return_value = [(uuid.uuid4(),)]
    cps.expire_due(db)
    assert calls == [True, True]


def test_participation_socket_leave_retries_then_succeeds(monkeypatch):
    attempts = []

    def flaky(db, sid, context, action):
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError("lock_timeout")
        return {"participants": []}

    monkeypatch.setattr("app.services.class_participation_service.socket_update", flaky)
    monkeypatch.setattr(ns, "_open_db", lambda: MagicMock())
    monkeypatch.setattr(ns, "_LEAVE_RETRY_BACKOFF_SEC", 0)
    monkeypatch.setattr("app.services.session_service._notify_participant_changed", lambda *a, **k: None)
    sid = str(uuid.uuid4())
    out = ns._participation_socket("s1", {"session_id": sid, "role": "host"}, "leave")
    assert len(attempts) == 3 and out == {"participants": []}


def test_participation_socket_leave_gives_up_without_raising(monkeypatch):
    monkeypatch.setattr("app.services.class_participation_service.socket_update", MagicMock(side_effect=RuntimeError("lock_timeout")))
    monkeypatch.setattr(ns, "_open_db", lambda: MagicMock())
    monkeypatch.setattr(ns, "_LEAVE_RETRY_BACKOFF_SEC", 0)
    assert ns._participation_socket("s1", {"session_id": str(uuid.uuid4()), "role": "host"}, "leave") is None


def test_participation_socket_heartbeat_does_not_retry(monkeypatch):
    m = MagicMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr("app.services.class_participation_service.socket_update", m)
    monkeypatch.setattr(ns, "_open_db", lambda: MagicMock())
    with pytest.raises(RuntimeError):
        ns._participation_socket("s1", {"session_id": str(uuid.uuid4()), "role": "host"}, "heartbeat")
    assert m.call_count == 1


def test_after_commit_end_notify_light_and_audio_retry(monkeypatch):
    """종료 후처리: 알림은 light 잠금, audio finalize 는 실패 시 rollback 후 1회 재시도."""
    from app.services import session_service as ss, audio_service, video_service, research_export_service

    order = []
    notify_kwargs = []
    monkeypatch.setattr(ss, "_notify_participant_changed", lambda s, db=None, **k: notify_kwargs.append(k))
    monkeypatch.setattr(ss, "_notify_session_state", lambda s: None)
    monkeypatch.setattr(ss, "_notify_participants_event", lambda *a, **k: None)
    monkeypatch.setattr(ss, "_with_chat_room", lambda d, sid, db: d)
    monkeypatch.setattr(ss, "_serialize", lambda *a, **k: {})
    monkeypatch.setattr(video_service, "finalize_on_session_end", lambda *a: order.append("video"))
    monkeypatch.setattr(research_export_service, "on_session_completed", lambda *a: order.append("research"))
    n = {"c": 0}

    def audio(sid, db):
        n["c"] += 1
        order.append(f"audio{n['c']}")
        if n["c"] == 1:
            raise RuntimeError("lock timeout")

    monkeypatch.setattr(audio_service, "finalize_on_session_end", audio)
    db = MagicMock()
    s = MagicMock(id=uuid.uuid4(), title="t")
    ss.transition_after_commit(s, object(), "end", db)
    assert notify_kwargs and notify_kwargs[0] == {"light": True}
    assert order == ["video", "audio1", "audio2", "research"]
    db.rollback.assert_called()


def test_notify_participant_changed_passes_light(monkeypatch):
    from app.services import session_service as ss

    seen = []
    monkeypatch.setattr(cps, "lock_context", lambda db, sid, actor=None, light=False: seen.append(light) or (_ for _ in ()).throw(RuntimeError("stop")))
    ss._notify_participant_changed(MagicMock(id=uuid.uuid4()), MagicMock(), light=True)
    assert seen == [True]

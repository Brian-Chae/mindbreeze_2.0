"""11/17 입장 몰림: light 잠금(NO KEY UPDATE)·join 재시도·band_connected 자가복구."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services import class_participation_service as cps
from app.services import session_service as ss
from app.ws import session_live_namespace as ns


def test_light_lock_uses_key_share_for_sessions_and_participants(monkeypatch):
    row = MagicMock(id=uuid.uuid4(), class_id=uuid.uuid4())
    db = MagicMock()
    db.get.return_value = row
    q = db.query.return_value.filter_by.return_value.populate_existing.return_value
    q.with_for_update.return_value.one.return_value = row
    seen = {}
    monkeypatch.setattr(cps, "lock_participants", lambda d, r, key_share=False: seen.setdefault("ks", key_share) or [])
    cps.lock_context(db, row.id, light=True)
    q.with_for_update.assert_called_once_with(key_share=True)
    assert seen["ks"] is True


def test_full_lock_keeps_plain_for_update(monkeypatch):
    row = MagicMock(id=uuid.uuid4(), class_id=None)
    db = MagicMock()
    db.get.return_value = row
    q = db.query.return_value.filter_by.return_value.populate_existing.return_value
    q.with_for_update.return_value.one.return_value = row
    seen = {}
    monkeypatch.setattr(cps, "lock_participants", lambda d, r, key_share=False: seen.setdefault("ks", key_share) or [])
    cps.lock_context(db, row.id)
    q.with_for_update.assert_called_once_with()
    assert seen["ks"] is False


def test_join_uses_light_lock(monkeypatch):
    calls = []
    monkeypatch.setattr(cps, "lock_context", lambda db, sid, actor=None, light=False: calls.append(light) or (MagicMock(participation_version=0), []))
    monkeypatch.setattr(cps, "_expire", lambda *a, **k: None)
    monkeypatch.setattr(cps, "build_snapshot", lambda *a, **k: {})
    cps.socket_update(MagicMock(), "s", {"session_id": str(uuid.uuid4()), "role": "observer"}, "join")
    assert calls == [True]


class Deadlock(Exception):
    pass


Deadlock.__name__ = "DeadlockDetected"


def _setup_socket(monkeypatch, side_effects):
    monkeypatch.setattr(ns.time, "sleep", lambda s: None)
    monkeypatch.setattr(ns, "_open_db", lambda: MagicMock())
    it = iter(side_effects)

    def fake(db, sid, ctx, action):
        e = next(it)
        if isinstance(e, Exception):
            raise e
        return e
    monkeypatch.setattr(cps, "socket_update", fake)
    import app.services.session_service as sess
    monkeypatch.setattr(sess, "_notify_participant_changed", lambda *a, **k: None)
    return {"session_id": str(uuid.uuid4()), "role": "host"}


def test_join_retries_on_deadlock(monkeypatch):
    ctx = _setup_socket(monkeypatch, [Deadlock(), Deadlock(), {"participants": []}])
    assert ns._participation_socket("s", ctx, "join") == {"participants": []}


def test_join_gives_up_after_three_deadlocks(monkeypatch):
    ctx = _setup_socket(monkeypatch, [Deadlock(), Deadlock(), Deadlock()])
    with pytest.raises(Exception):
        ns._participation_socket("s", ctx, "join")


def test_join_does_not_retry_other_errors(monkeypatch):
    ctx = _setup_socket(monkeypatch, [ValueError("x"), {"participants": []}])
    with pytest.raises(ValueError):
        ns._participation_socket("s", ctx, "join")


def test_effective_band_connected_projection():
    pid = uuid.uuid4()
    p = MagicMock(id=pid, band_connected=False)
    assert ss._effective_band_connected(p, {pid}) is True
    assert ss._effective_band_connected(p, set()) is False
    assert ss._effective_band_connected(MagicMock(id=pid, band_connected=True), set()) is True


def test_recent_feature_query_failure_keeps_stored_value():
    db = MagicMock()
    db.query.side_effect = RuntimeError("boom")
    assert ss._recent_feature_participants(db, uuid.uuid4(), [uuid.uuid4()]) == set()
    assert ss._recent_feature_participants(db, uuid.uuid4(), []) == set()

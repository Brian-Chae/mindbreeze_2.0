"""SDD-209 B6 — 대기 취소·승격 정합 (verify BT31~BT37, AZ14·AZ17, RV5-1~5, ST20·ST21).

취소는 행 삭제가 아니라 ``waitlist_cancelled_at`` 기록(보존). 취소자는 모든 ORM 조회에서 빠지므로 정원·순번·승격·
토큰·상태 접근에서 자동 제외된다. 재대기는 같은 행을 되살려 대기열 끝에 둔다.
"""

import uuid

import pytest

from tests.entry_helpers import enter_member, guest_body
from tests.test_sdd015_class_code import _create_class, _open_class, _register


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _group(client, host, cap=1, **kw):
    kw.setdefault("participant_mode", "group")
    cls = _create_class(client, host["h"], max_participants=cap, **kw)
    _open_class(client, cls, host["h"])
    return cls


def _guest(client, cls, name, headers=None):
    res = client.post(
        "/api/v1/sessions/enter", json=guest_body(cls["access_code"], name), headers=headers or {}
    )
    assert res.status_code == 200, res.text
    return res.json()


def _cred(j):
    return {"X-Entry-Credential": j["entry_credential"]}


def _cancel(client, cls, headers):
    return client.post(f"/api/v1/sessions/{cls['id']}/waitlist/cancel", headers=headers)


def _rows(session_id):
    """취소·제거 행까지 포함한 참여자 행."""
    from app.models.session import SessionParticipant

    db = _db()
    try:
        rows = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == uuid.UUID(session_id))
            .execution_options(include_removed=True)
            .all()
        )
        return {
            str(r.id): {
                "wait": r.is_waitlisted,
                "pos": r.waitlist_position,
                "cancelled": r.waitlist_cancelled_at,
                "removed": r.removed_at,
                "name": r.guest_name,
            }
            for r in rows
        }
    finally:
        db.close()


@pytest.fixture
def promoted_events(monkeypatch):
    from app.ws import session_live_namespace as live

    events = []
    monkeypatch.setattr(
        live, "notify_participant_promoted", lambda sid, pid, payload=None: events.append((sid, pid, payload))
    )
    return events


# ── BT31 / RV5-4: 본인만·멱등·행 보존·활성 참가자 요청은 취소 아님 ──────────


def test_BT31_본인_대기_취소는_행을_지우지_않고_멱등(client):
    host = _register(client, "b6h1@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    waiting = _guest(client, cls, "둘째")
    assert waiting["is_waitlisted"] is True

    r = _cancel(client, cls, _cred(waiting))
    assert r.status_code == 200, r.text
    assert r.json() == {"participant_id": waiting["participant_id"], "cancelled": True, "changed": True}
    row = _rows(cls["id"])[waiting["participant_id"]]
    assert row["cancelled"] is not None and row["name"] == "둘째", "행·이름 보존"

    again = _cancel(client, cls, _cred(waiting))
    assert again.status_code == 200 and again.json()["changed"] is False and again.json()["cancelled"] is True


def test_BT31_활성_참가자의_취소_요청은_대기_취소로_처리하지_않는다(client):
    host = _register(client, "b6h2@test.com")
    cls = _group(client, host, cap=2)
    active = _guest(client, cls, "활성")
    assert active["is_waitlisted"] is False
    r = _cancel(client, cls, _cred(active))
    assert r.status_code == 409
    row = _rows(cls["id"])[active["participant_id"]]
    assert row["cancelled"] is None and row["wait"] is False


def test_AZ17_자격_없음_401_호스트_403_타인_자격은_본인에게만_작용(client):
    host = _register(client, "b6h3@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    c = _guest(client, cls, "셋째")
    assert client.post(f"/api/v1/sessions/{cls['id']}/waitlist/cancel", headers={"X-Entry-Credential": ""}).status_code == 401
    assert _cancel(client, cls, host["h"]).status_code == 403
    # C 의 자격으로 요청해도 C 본인만 취소된다(B 불변)
    assert _cancel(client, cls, _cred(c)).status_code == 200
    rows = _rows(cls["id"])
    assert rows[c["participant_id"]]["cancelled"] is not None
    assert rows[b["participant_id"]]["cancelled"] is None and rows[b["participant_id"]]["wait"] is True


def test_종료_취소_클래스에서는_대기_취소_409(client):
    host = _register(client, "b6h4@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    assert client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"]).status_code == 200
    assert _cancel(client, cls, _cred(b)).status_code == 409


# ── BT32 / BT37 / AZ14: 승격 제외·접근 거부 ─────────────────────────────


def test_BT32_취소자는_자동_승격에서_제외되고_다음_순번이_승격(client, promoted_events):
    host = _register(client, "b6h5@test.com")
    m = _register(client, "b6m5@test.com", role="client")
    cls = _group(client, host, cap=1)
    assert enter_member(client, cls["access_code"], m["h"]).json()["is_waitlisted"] is False
    b = _guest(client, cls, "B")
    c = _guest(client, cls, "C")
    assert _cancel(client, cls, _cred(b)).status_code == 200

    # 활성 회원을 호스트가 제거 → 정원 여유 → 순번 순 승격(B 는 취소했으므로 C)
    assert client.delete(f"/api/v1/sessions/{cls['id']}/participants/{m['id']}", headers=host["h"]).status_code == 200
    rows = _rows(cls["id"])
    assert rows[c["participant_id"]]["wait"] is False, "C 승격"
    assert rows[b["participant_id"]]["wait"] is True and rows[b["participant_id"]]["cancelled"] is not None, "B 재승격 없음"
    assert [e[1] for e in promoted_events] == [c["participant_id"]]


def test_BT37_취소_후_상태_조회_토큰은_403(client):
    host = _register(client, "b6h6@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    assert _cancel(client, cls, _cred(b)).status_code == 200
    assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(b)).status_code == 403
    assert client.post(f"/api/v1/sessions/{cls['id']}/entry/livekit-token", headers=_cred(b)).status_code == 403
    # 취소 행은 조회에서 제외돼 존재 여부도 드러내지 않는다(404) — 선택 변경은 어느 쪽이든 거부
    assert client.put(
        f"/api/v1/sessions/{cls['id']}/report-choice",
        json={"participant_id": b["participant_id"], "report_included": True},
        headers=_cred(b),
    ).status_code in (403, 404)


def test_취소자는_대기_인원_집계와_호스트_참여자_목록에서_빠진다(client):
    host = _register(client, "b6h7@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    _guest(client, cls, "셋째")
    assert client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()["waitlist_count"] == 2
    assert _cancel(client, cls, _cred(b)).status_code == 200
    got = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    assert got["waitlist_count"] == 1
    assert b["participant_id"] not in [p["participant_id"] for p in got["participants"]]


# ── BT33: 경합 — 세션 잠금 후 처리 ──────────────────────────────────────


def test_BT33_취소는_세션_잠금_후_순번을_재정렬하고_승격과_같은_잠금_순서(client, monkeypatch):
    from app.services import session_service

    calls = []
    real = session_service._lock_session_for_capacity
    monkeypatch.setattr(
        session_service, "_lock_session_for_capacity", lambda sid, db: (calls.append(str(sid)), real(sid, db))[1]
    )
    host = _register(client, "b6h8@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    c = _guest(client, cls, "셋째")
    calls.clear()
    assert _cancel(client, cls, _cred(b)).status_code == 200
    assert calls == [cls["id"]], "취소도 정원 변경 경로와 같은 세션 잠금을 먼저 잡는다"
    assert _rows(cls["id"])[c["participant_id"]]["pos"] == 1, "순번 재정렬(2→1)"


def test_BT33_취소_직후_승격이_일어나도_취소자는_복귀하지_않는다(client):
    host = _register(client, "b6h9@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    assert _cancel(client, cls, _cred(b)).status_code == 200
    # 정원을 늘려 승격 작업이 돌아도 취소자는 대상이 아니다
    assert client.put(f"/api/v1/sessions/{cls['id']}", json={"max_participants": 5}, headers=host["h"]).status_code == 200
    row = _rows(cls["id"])[b["participant_id"]]
    assert row["wait"] is True and row["cancelled"] is not None


# ── BT34: 재대기 ────────────────────────────────────────────────────────


def test_BT34_재대기는_같은_행을_되살려_대기열_끝_순번(client):
    host = _register(client, "b6h10@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    c = _guest(client, cls, "셋째")
    assert _cancel(client, cls, _cred(b)).status_code == 200

    again = _guest(client, cls, "둘째", headers=_cred(b))  # 같은 자격으로 다시 입장
    assert again["participant_id"] == b["participant_id"], "행 유지(새 행 아님)"
    assert again["is_waitlisted"] is True
    rows = _rows(cls["id"])
    assert rows[b["participant_id"]]["cancelled"] is None
    assert rows[c["participant_id"]]["pos"] == 1 and rows[b["participant_id"]]["pos"] == 2, "끝 순번"
    assert len([r for r in rows.values() if r["name"] == "둘째"]) == 1


def test_BT34_회원_재대기도_같은_행_끝_순번(client):
    host = _register(client, "b6h11@test.com")
    m1 = _register(client, "b6m11a@test.com", role="client")
    m2 = _register(client, "b6m11b@test.com", role="client")
    cls = _group(client, host, cap=1)
    enter_member(client, cls["access_code"], m1["h"])
    j2 = enter_member(client, cls["access_code"], m2["h"]).json()
    assert j2["is_waitlisted"] is True
    assert _cancel(client, cls, m2["h"]).status_code == 200
    guest = _guest(client, cls, "게스트")
    again = enter_member(client, cls["access_code"], m2["h"]).json()
    assert again["participant_id"] == j2["participant_id"]
    rows = _rows(cls["id"])
    assert rows[guest["participant_id"]]["pos"] == 1 and rows[j2["participant_id"]]["pos"] == 2


# ── BT35: 이벤트 ────────────────────────────────────────────────────────


def test_BT35_승격_이벤트는_대상에게만_participant_changed는_호스트_룸(client, monkeypatch, promoted_events):
    from app.ws import session_live_namespace as live

    changed = []
    monkeypatch.setattr(live, "notify_participant_changed", lambda sid, payload: changed.append((sid, payload)))
    host = _register(client, "b6h12@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "첫째")
    b = _guest(client, cls, "둘째")
    c = _guest(client, cls, "셋째")
    changed.clear()
    assert _cancel(client, cls, _cred(b)).status_code == 200
    assert changed and changed[-1][1]["waitlist_count"] == 1
    assert promoted_events == [], "취소만으로는 승격 이벤트 없음"

    client.put(f"/api/v1/sessions/{cls['id']}", json={"max_participants": 2}, headers=host["h"])
    assert [(e[0], e[1]) for e in promoted_events] == [(cls["id"], c["participant_id"])]


# ── BT36: 정원 증가 순번 승격·새치기 방지 ───────────────────────────────


def test_BT36_정원_증가는_순번_순으로_승격하고_재입장이_새치기하지_못한다(client, promoted_events):
    host = _register(client, "b6h13@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "A")
    b = _guest(client, cls, "B")
    c = _guest(client, cls, "C")
    d = _guest(client, cls, "D")
    client.put(f"/api/v1/sessions/{cls['id']}", json={"max_participants": 3}, headers=host["h"])
    rows = _rows(cls["id"])
    assert rows[b["participant_id"]]["wait"] is False and rows[c["participant_id"]]["wait"] is False
    assert rows[d["participant_id"]]["wait"] is True and rows[d["participant_id"]]["pos"] == 1
    assert [e[1] for e in promoted_events] == [b["participant_id"], c["participant_id"]], "순번 순"

    # D 가 같은 자격으로 재입장해도 정원이 없으므로 대기 유지(새치기 없음)
    again = _guest(client, cls, "D", headers=_cred(d))
    assert again["is_waitlisted"] is True


def test_BT36_대기자가_있으면_빈자리가_있어도_신규_입장은_뒤로(client):
    """정원을 줄였다 늘리는 등 대기자가 남은 상태에서 신규 입장이 앞지르지 않는다."""
    from app.models.session import Session

    host = _register(client, "b6h14@test.com")
    cls = _group(client, host, cap=1)
    _guest(client, cls, "A")
    b = _guest(client, cls, "B")
    # 승격 작업 없이 DB 에서 정원만 늘려 '빈자리 + 대기자' 상태를 만든다
    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).first()
        s.max_participants = 2
        db.commit()
    finally:
        db.close()
    newcomer = _guest(client, cls, "신규")
    rows = _rows(cls["id"])
    assert rows[b["participant_id"]]["wait"] is False, "대기 1순위가 먼저 승격"
    assert newcomer["is_waitlisted"] is True

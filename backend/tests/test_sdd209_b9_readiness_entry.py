"""SDD-209 B9 — 전극·준비 중계(BE-10)·입장 시각(BE-11)·익명 집계(BE-12) (verify BT49, RV6, AD2·AD3·AD5·AD9).

- BE-10: WS 대기실 readiness 에 건너뛰기·밴드 상태(lead_off/battery)를 허용(구 3-boolean 도 통과), 서버 저장 없음.
- BE-11: session_participants.entered_at — 최초 입장 시각, 재입장으로 덮어쓰지 않음, 호스트 뷰에서만 노출.
- BE-12: 대기실 {ready,total} 익명 집계 방송, 리포트 제외 인원 수 익명 집계(호스트 전용).
- B7 이월: 이미 입장한 참여자는 재발송 대상에서 제외(skipped_entered).
"""

import asyncio
import uuid

import pytest

import app.ws.session_live_namespace as ns
from tests.entry_helpers import enter_guest, enter_member
from tests.test_sdd015_class_code import _create_class, _open_class, _register
from tests.test_class_waiting_room_presence import FakeSio, _participant_session, _wire


@pytest.fixture(autouse=True)
def _reset_presence():
    ns.reset_waiting_room_presence()
    yield
    ns.reset_waiting_room_presence()


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


# ── BE-10: readiness 중계 ──────────────────────────────────────────────────────────

LEGACY = {"surveyDone": True, "bandDone": False, "deviceDone": True}


def test_BT49_구_3_boolean_페이로드도_그대로_통과():
    assert ns._sanitize_readiness(LEGACY) == LEGACY


def test_BE10_건너뛰기와_밴드_상태_중계():
    payload = {
        **LEGACY, "bandSkipped": True, "surveySkipped": False, "deviceSkipped": False,
        "band": {"state": "contact_poor", "lead_off": {"ch1": True, "ch2": False}, "battery": 72},
    }
    got = ns._sanitize_readiness(payload)
    assert got["bandSkipped"] is True and got["surveySkipped"] is False
    assert got["band"] == {"state": "contact_poor", "lead_off": {"ch1": True, "ch2": False}, "battery": 72}


def test_BE10_잘못된_필드는_개별로_버린다_완료_boolean_이_틀리면_전체_None():
    got = ns._sanitize_readiness({
        **LEGACY, "bandSkipped": "yes", "unknownKey": "x",
        "band": {"state": "<script>", "lead_off": {"ch1": "true", "ch2": None, "ch3": True}, "battery": 101},
    })
    assert "bandSkipped" not in got and "unknownKey" not in got
    # state 가 잘못되고 battery 범위 밖이어도 lead_off 가 구조상 남으면 그 부분만 중계 — 값은 bool/None 으로 강제
    assert got["band"]["state"] is None and got["band"]["battery"] is None
    assert got["band"]["lead_off"] == {"ch1": None, "ch2": None}
    assert ns._sanitize_readiness({**LEGACY, "bandDone": "true"}) is None
    assert ns._sanitize_readiness({**LEGACY, "band": {"battery": True}})  .get("band") is None
    assert ns._sanitize_readiness(None) is None


def test_BE10_waiting_room_이벤트가_밴드_상태를_호스트룸으로_중계(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call("waiting_room", "sid-1", {
        "session_id": "sess-1", "action": "join",
        "readiness": {**LEGACY, "band": {"state": "connected", "lead_off": {"ch1": False, "ch2": False}, "battery": 90}},
    })
    e = fake.events("waiting_room_changed")[-1]
    assert e["room"] == "session:sess-1"
    assert e["data"]["readiness"]["band"]["battery"] == 90


# ── BE-12: 익명 집계 방송 ───────────────────────────────────────────────────────────

def _join(fake, sid, ready=False):
    readiness = {"surveyDone": ready, "bandDone": ready, "deviceDone": ready}
    fake.call("waiting_room", sid, {"session_id": "sess-1", "action": "join", "nickname": "닉네임", "readiness": readiness})


def test_BE12_준비_인원_ready_total_만_세션_공용_룸으로_방송(monkeypatch):
    fake = _wire(monkeypatch, {
        "s1": _participant_session("sess-1", "p-1"),
        "s2": _participant_session("sess-1", "p-2"),
        "s3": _participant_session("sess-1", "p-3"),
    })
    _join(fake, "s1", ready=True)
    _join(fake, "s2", ready=False)
    _join(fake, "s3", ready=True)
    events = fake.events("waiting_room_summary")
    assert events[-1]["data"] == {"session_id": "sess-1", "ready": 2, "total": 3}
    assert events[-1]["room"] == "session:sess-1:all", "회원도 받는 공용 룸"
    for e in events:
        assert set(e["data"]) == {"session_id", "ready", "total"}, "개인 식별 정보 없음"
        assert "p-1" not in str(e["data"]) and "닉네임" not in str(e["data"])


def test_BE12_건너뛴_단계는_준비로_센다_leave_는_줄어든다(monkeypatch):
    fake = _wire(monkeypatch, {"s1": _participant_session("sess-1", "p-1"), "s2": _participant_session("sess-1", "p-2")})
    fake.call("waiting_room", "s1", {"session_id": "sess-1", "action": "join", "readiness": {
        "surveyDone": False, "bandDone": False, "deviceDone": True,
        "surveySkipped": True, "bandSkipped": True,
    }})
    assert fake.events("waiting_room_summary")[-1]["data"]["ready"] == 1
    _join(fake, "s2", ready=False)
    assert fake.events("waiting_room_summary")[-1]["data"] == {"session_id": "sess-1", "ready": 1, "total": 2}
    fake.call("waiting_room", "s1", {"session_id": "sess-1", "action": "leave"})
    assert fake.events("waiting_room_summary")[-1]["data"] == {"session_id": "sess-1", "ready": 0, "total": 1}


def test_BE12_heartbeat_이_끊긴_참가자는_TTL_뒤_집계에서_빠진다():
    ns.update_waiting_room_presence("sess-ttl", "p-1", "join", LEGACY | {"bandDone": True, "surveyDone": True}, now=1000.0)
    ns.update_waiting_room_presence("sess-ttl", "p-2", "join", None, now=1050.0)
    assert ns.waiting_room_summary("sess-ttl", now=1060.0) == {"session_id": "sess-ttl", "ready": 1, "total": 2}
    after = ns.waiting_room_summary("sess-ttl", now=1000.0 + ns.WAITING_ROOM_PRESENCE_TTL_SEC + 1)
    assert after == {"session_id": "sess-ttl", "ready": 0, "total": 1}, "p-1 은 TTL 만료, p-2 는 아직 유효"


def test_BE12_세션별로_분리된다():
    ns.update_waiting_room_presence("A", "p-1", "join", None, now=1.0)
    ns.update_waiting_room_presence("B", "p-9", "join", None, now=1.0)
    assert ns.waiting_room_summary("A", now=2.0)["total"] == 1
    assert ns.waiting_room_summary("B", now=2.0)["total"] == 1


# ── BE-11: 입장 시각 ────────────────────────────────────────────────────────────────

def _class(client, host):
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=10)
    _open_class(client, cls, host["h"])
    return cls


def _entered(pid):
    from app.models.session import SessionParticipant

    db = _db()
    try:
        return db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).one().entered_at
    finally:
        db.close()


def test_BE11_비회원_입장_시_기록되고_재입장으로_덮어쓰지_않는다(client):
    host = _register(client, "b9host1@test.com")
    cls = _class(client, host)
    res = enter_guest(client, cls["access_code"], "입장자", email="in@example.com")
    assert res.status_code == 200
    pid = res.json()["participant_id"]
    first = _entered(pid)
    assert first is not None
    # 같은 자격으로 복귀(재입장) — 값 불변
    again = client.post(
        "/api/v1/sessions/enter",
        json={"code": cls["access_code"], "name": "입장자", "email": "in@example.com", "gender": "female",
              "birth_date": "1990-01-01"},
        headers={"X-Entry-Credential": res.json()["entry_credential"]},
    )
    assert again.status_code == 200 and again.json()["participant_id"] == pid
    assert _entered(pid) == first


def test_BE11_회원_코드_입장과_초대_편의_경로에서_기록(client):
    host = _register(client, "b9host2@test.com")
    member = _register(client, "b9m1@test.com", role="client")
    invited = _register(client, "b9m2@test.com", role="client")
    cls = _class(client, host)
    assert client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": invited["id"]}, headers=host["h"]).status_code == 200

    res = enter_member(client, cls["access_code"], member["h"])
    assert res.status_code == 200
    assert _entered(res.json()["participant_id"]) is not None

    res2 = client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=invited["h"])
    assert res2.status_code == 200, res2.text
    assert _entered(res2.json()["participant_id"]) is not None


def test_BE11_초대만_받은_참여자는_입장_시각이_null(client):
    host = _register(client, "b9host3@test.com")
    invited = _register(client, "b9m3@test.com", role="client")
    cls = _class(client, host)
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": invited["id"]}, headers=host["h"])
    detail = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    row = [p for p in detail["participants"] if p["user_id"] == invited["id"]][0]
    assert row["entered_at"] is None


def test_BE11_입장_시각은_호스트_뷰에서만_노출(client):
    host = _register(client, "b9host4@test.com")
    member = _register(client, "b9m4@test.com", role="client")
    other = _register(client, "b9m5@test.com", role="client")
    cls = _class(client, host)
    enter_member(client, cls["access_code"], member["h"])
    enter_member(client, cls["access_code"], other["h"])
    host_view = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    assert all(p["entered_at"] for p in host_view["participants"])
    member_view = client.get(f"/api/v1/sessions/{cls['id']}", headers=member["h"]).json()
    assert all(p["entered_at"] is None for p in member_view["participants"])


# ── B7 이월: 이미 입장한 참여자 재발송 제외 ──────────────────────────────────────────────

def test_B7이월_이미_입장한_참여자는_재발송_대상에서_제외(client):
    host = _register(client, "b9host5@test.com")
    in_member = _register(client, "b9in@test.com", role="client")
    not_in = _register(client, "b9out@test.com", role="client")
    cls = _class(client, host)
    for m in (in_member, not_in):
        assert client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m["id"]}, headers=host["h"]).status_code == 200
    assert client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=in_member["h"]).status_code == 200

    res = client.post(f"/api/v1/sessions/{cls['id']}/invite/remind", json={}, headers=host["h"])
    assert res.status_code == 200, res.text
    by_user = {r["user_id"]: r["status"] for r in res.json()["results"]}
    assert by_user[in_member["id"]] == "skipped_entered"
    assert by_user[not_in["id"]] == "queued"
    # 대상을 명시해도 입장한 참여자는 건너뜀
    explicit = client.post(
        f"/api/v1/sessions/{cls['id']}/invite/remind", json={"participant_ids": [
            [p["participant_id"] for p in client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()["participants"]
             if p["user_id"] == in_member["id"]][0]]}, headers=host["h"],
    )
    assert explicit.json()["results"][0]["status"] == "skipped_entered"


# ── BE-12: 리포트 제외 인원 수(익명) ──────────────────────────────────────────────────

def test_BE12_리포트_제외_인원_수만_호스트에게(client):
    host = _register(client, "b9host6@test.com")
    other = _register(client, "b9other6@test.com")
    cls = _class(client, host)
    a = enter_guest(client, cls["access_code"], "참가A", email="a@example.com").json()
    b = enter_guest(client, cls["access_code"], "참가B", email="b@example.com").json()
    enter_guest(client, cls["access_code"], "참가C", email="c@example.com")
    ok = client.put(
        f"/api/v1/sessions/{cls['id']}/report-choice",
        json={"participant_id": a["participant_id"], "report_included": True},
        headers={"X-Entry-Credential": a["entry_credential"]},
    )
    assert ok.status_code == 200
    url = f"/api/v1/sessions/{cls['id']}/report-choice/summary"
    res = client.get(url, headers=host["h"])
    assert res.status_code == 200
    assert res.json() == {"included": 1, "excluded": 2, "total": 3}, "개별 선택·이름 없이 인원 수만"
    assert client.get(url, headers=other["h"]).status_code == 403
    assert client.get(url, headers={"X-Entry-Credential": b["entry_credential"]}).status_code in (401, 403)


# ── B3 이월: 미입장 참여자는 리포트 범위에서 제외 ─────────────────────────────────────────

def test_B3이월_입장_기록이_있는_클래스에서_미입장자는_리포트_범위에서_빠진다(client):
    from app.models.session import SessionParticipant
    from app.services import report_scope

    host = _register(client, "b9host7@test.com")
    invited = _register(client, "b9noshow@test.com", role="client")
    cls = _class(client, host)
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": invited["id"]}, headers=host["h"])
    g = enter_guest(client, cls["access_code"], "참석자", email="p@example.com").json()
    db = _db()
    try:
        db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(g["participant_id"])).update(
            {"report_included": True}
        )
        db.commit()
        scope = report_scope.scope_for_session(uuid.UUID(cls["id"]), db)
        assert len(scope.included_ids) == 1 and len(scope.excluded_ids) == 0, "초대만 받고 입장하지 않은 회원은 불참 — 제외로 세지 않는다"
    finally:
        db.close()


def test_B3이월_입장_기록_전_클래스는_기존_규칙_유지(client):
    """전원 entered_at 이 NULL(기록 도입 전)이면 예전처럼 모두 범위에 포함해 센다."""
    from app.core.database import SessionLocal
    from app.models.session import Session, SessionParticipant
    from app.models.user import User
    from app.services import report_scope

    db = SessionLocal()
    try:
        host = User(email=f"b9legacy-{uuid.uuid4().hex[:6]}@test.com", name="h", role="counselor", password_hash="x")
        db.add(host)
        db.flush()
        s = Session(host_id=host.id, type="meditation", status="completed", duration_min=10)
        db.add(s)
        db.flush()
        db.add_all([
            SessionParticipant(session_id=s.id, guest_name="a", report_included=True),
            SessionParticipant(session_id=s.id, guest_name="b", report_included=False),
        ])
        db.commit()
        scope = report_scope.scope_for_session(s.id, db)
        assert len(scope.included_ids) == 1 and len(scope.excluded_ids) == 1
    finally:
        db.close()


# ── 마이그레이션 ──────────────────────────────────────────────────────────────────

def test_마이그레이션_entered_at_추가형_체인():
    from pathlib import Path

    base = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    text = (base / "e036a0000051_sdd_209_b9_entered_at.py").read_text()
    assert 'down_revision: Union[str, Sequence[str], None] = "e036a0000050"' in text
    assert "add_column" in text and "entered_at" in text and "nullable=True" in text
    assert "UPDATE" not in text.upper().replace("DOWNGRADE", ""), "백필하지 않는다"

"""MIND BREEZE 2.0 — 테스트 품질(중) 8건 보강 회귀 테스트.

테스트 품질 이슈(TQ)별 검증:

- TQ-04  `app_client` 가 전역으로 Celery `task_always_eager`/`task_eager_propagates` 를 켜
         ETA(예약) 태스크가 테스트 안에서 즉시 실행되던 문제 → 기본 non-eager + 개별 테스트
         opt-in(`celery_eager`)으로 격리하고, 테스트 경계를 넘어 누수되지 않음을 검증한다.
- TQ-06  WS 네임스페이스 테스트가 자작 FakeSio 로 AsyncServer 를 흉내내 실제 Socket.IO 계약을
         검증하지 못하던 문제 → 진짜 `socketio.AsyncServer` 에 네임스페이스를 등록하고
         핸들러 레지스트리/세션/룸/emit 계약을 실제 매니저 경로로 검증한다.
- TQ-07  `_build_client_manager` 가 pytest 실행 중이면 무조건 None 을 반환해 운영 Redis
         manager(AsyncRedisManager) 경로가 검증되지 않던 문제 → 실제 AsyncServer 에 부착해
         운영 계약까지 검증한다.
- TQ-09  내담자 포털 홈(`GET /client/home`)·조직 가입요청 조회(`GET /org/requests` 등)
         커버리지 부재 → 추가한다.
- TQ-10  리포트 PDF 렌더링 테스트가 WeasyPrint 시스템 라이브러리 미설치로 skip 되는데
         사유/CI 의존성이 코드에 명시·검증되지 않던 문제 → skip 사유와 CI 설치 의존성을 검증한다.
- TQ-11  리마인더 테스트가 `apply_async` 를 통째로 patch 해 실제 ETA/태스크 계약을 검증하지
         못하던 문제 → ETA·task_id·retry 등 실제 예약 인자를 검증한다.
- TQ-12  상담사 가입 API 가 SDD-073 으로 차단돼 테스트가 DB 직접 삽입으로 대체되던 문제 →
         실제 가입 경로(기관 초대 → 비밀번호 설정)로 상담사가 생성됨을 검증한다.
- TQ-14  `status_code` 만 단언하는 테스트가 다수 → 핵심 모듈의 단언을 보강하고,
         status_code-only 회귀를 막는 가드를 추가한다.
"""

import ast
import asyncio
import re
import socketio
import types
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services import email_verify_service
from tests.conftest import create_test_counselor, create_test_org, post_register

VALID_PASSWORD = "Passw0rd!"
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_ROOT.parent


def _db():
    """client fixture 와 같은 인메모리 DB 세션을 연다."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, email: str, role: str = "client") -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"회원-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "token": token, "h": {"Authorization": f"Bearer {token}"}}


def _counselor(email: str, *, org_code: str | None = None) -> dict:
    created = create_test_counselor(
        email,
        name=f"상담사-{email.split('@')[0]}",
        org_code=org_code if org_code is not None else create_test_org(),
    )
    return {
        "id": created["id"],
        "token": created["access_token"],
        "h": {"Authorization": f"Bearer {created['access_token']}"},
    }


def _orgless_counselor(email: str) -> dict:
    """소속 없는 상담사 — 기관 가입 신청(무소속 전제) 검증용."""
    created = create_test_counselor(email, name=f"무소속-{email.split('@')[0]}")
    return {
        "id": created["id"],
        "token": created["access_token"],
        "h": {"Authorization": f"Bearer {created['access_token']}"},
    }


def _create_open_group_class(client, headers: dict, **overrides) -> dict:
    payload = {
        "type": "meditation",
        "duration_min": 30,
        "title": "TQ 그룹 명상",
        "participant_mode": "group",
        "max_participants": 10,
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    cls = res.json()
    opened = client.post(f"/api/v1/sessions/{cls['id']}/open", headers=headers)
    assert opened.status_code == 200, opened.text
    return opened.json()


# ═══════════════════════════════════════════════════════════════════════════
# [1] TQ-04 — Celery eager 전역 격리 → 개별 테스트/모듈 제어
# ═══════════════════════════════════════════════════════════════════════════


def test_tq04_기본은_non_eager(client):
    """TQ-04: client fixture 는 더 이상 전역 eager 를 켜지 않는다(태스크 격리)."""
    from app.core.celery_app import celery_app

    assert celery_app.conf.task_always_eager is False
    assert celery_app.conf.task_eager_propagates is False


def test_tq04_eager_opt_in은_명시한_테스트에서만(celery_eager):
    """TQ-04: 파이프라인 인라인 실행이 필요한 테스트만 celery_eager 로 opt-in 한다."""
    from app.core.celery_app import celery_app

    assert celery_app.conf.task_always_eager is True
    assert celery_app.conf.task_eager_propagates is True


def test_tq04_eager_설정이_다음_테스트로_새지_않는다(client):
    """TQ-04: 앞선 테스트가 eager 를 켰더라도 테스트 경계를 넘으면 원복된다(설정 누수 방지)."""
    from app.core.celery_app import celery_app

    assert celery_app.conf.task_always_eager is False


def test_tq04_예약_리마인더는_생성시_즉시_발송되지_않는다(client, monkeypatch):
    """TQ-04: non-eager 에서는 ETA 예약만 적재되고 태스크가 인라인 실행되지 않는다."""
    from app.models.session import SessionReminderLog
    from app.services import reminder_service

    host = _counselor("tq04-host@test.com")
    scheduled = datetime.now(timezone.utc) + timedelta(hours=5)
    scheduled_calls: list[dict] = []
    monkeypatch.setattr(
        "app.tasks.reminder_task.send_session_reminder_task.apply_async",
        lambda *a, **k: scheduled_calls.append(k),
    )
    monkeypatch.setattr(
        "app.tasks.report_email_task.notification_email_task.apply_async", lambda *a, **k: None
    )

    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "meditation",
            "duration_min": 30,
            "title": "TQ-04 예약 클래스",
            "scheduled_at": scheduled.isoformat(),
            "reminder_offsets": [60],
        },
        headers=host["h"],
    )
    assert res.status_code == 201, res.text

    # ETA 예약은 적재됐지만(=비동기 경로), 태스크 본문이 즉시 실행되어 로그를 남기지는 않았다.
    assert len(scheduled_calls) == 1
    assert scheduled_calls[0]["eta"] > datetime.now(timezone.utc)
    sid = uuid.UUID(res.json()["id"])
    db = _db()
    try:
        logs = db.query(SessionReminderLog).filter(SessionReminderLog.session_id == sid).all()
        assert logs == []
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════
# [2] TQ-06 — 자작 FakeSio 대신 실제 socketio.AsyncServer 계약 검증
# ═══════════════════════════════════════════════════════════════════════════

_EXPECTED_WS_EVENTS = (
    "connect",
    "disconnect",
    "join",
    "leave",
    "feature",
    "class:signal",
    "waiting_room",
    "waiting_room_remind",
    "class:audio_sync",
)


class _RecordingAsyncManager(socketio.AsyncManager):
    """실제 AsyncServer 의 client manager — emit 을 기록하고 실제 전달도 그대로 수행한다.

    TQ-06: 자작 FakeSio 는 emit 인자를 저장만 할 뿐 실제 서버의 매니저 경로(룸 매칭/네임스페이스
    전달)를 타지 않는다. 이 매니저는 AsyncServer 가 실제로 사용하는 계약(super().emit)을 유지한
    채 관찰만 덧붙인다.
    """

    def __init__(self):
        super().__init__()
        self.emits: list[dict] = []

    async def emit(self, event, data, namespace, room=None, skip_sid=None, callback=None, to=None, **kwargs):
        self.emits.append(
            {"event": event, "data": data, "namespace": namespace, "room": room, "to": to}
        )
        return await super().emit(
            event, data, namespace, room=room, skip_sid=skip_sid, callback=callback, to=to, **kwargs
        )


class _FakeEioSocket:
    """engineio 소켓 자리에 들어가는 최소 스텁 — 세션 저장/emit 전달에만 필요."""

    def __init__(self):
        self.session: dict = {}
        self.closed = False

    async def send(self, packet):  # noqa: ARG002 — emit 전달 시 호출됨
        return None


def _real_sio_with_namespace():
    """진짜 AsyncServer 에 `/session-live` 를 등록하고 (server, manager) 를 돌려준다."""
    from app.ws import session_live_namespace as ns

    manager = _RecordingAsyncManager()
    server = socketio.AsyncServer(async_mode="asgi", client_manager=manager)
    ns.register_session_live_namespace(server)
    return server, manager


def _attach_client(server, sid: str, eio_sid: str) -> None:
    """연결된 것처럼 engineio 소켓 + 매니저 룸 등록을 세팅한다(실제 세션 저장 경로 활성화)."""
    server.eio.sockets[eio_sid] = _FakeEioSocket()
    server.manager.basic_enter_room(sid, "/session-live", None, eio_sid=eio_sid)
    server.manager.basic_enter_room(sid, "/session-live", sid, eio_sid=eio_sid)


def _wire_real_ws(monkeypatch):
    """실제 AsyncServer 를 WS 브로드캐스트/DB 대상으로 배선한다."""
    from app.core.database import get_db
    from app.main import app as fastapi_app
    from app.ws import session_live_namespace as ns

    server, manager = _real_sio_with_namespace()
    monkeypatch.setattr(ns, "_get_sio", lambda: server)
    override = fastapi_app.dependency_overrides[get_db]
    monkeypatch.setattr(ns, "_open_db", lambda: next(override()))
    return server, manager


def test_tq06_실제_AsyncServer_네임스페이스_등록계약():
    """TQ-06: 핸들러 레지스트리 자체가 실제 AsyncServer 계약이다(FakeSio 로는 검증 불가)."""
    server, _ = _real_sio_with_namespace()

    assert set(server.handlers) == {"/session-live"}  # 기본 네임스페이스 오염 없음
    handlers = server.handlers["/session-live"]
    assert set(handlers) == set(_EXPECTED_WS_EVENTS)
    for event in _EXPECTED_WS_EVENTS:
        assert callable(handlers[event]), event


def test_tq06_실제_AsyncServer_connect_join_룸_emit_계약(client, monkeypatch):
    """실제 AsyncServer 로 connect→join 을 구동해 세션/룸/emit 을 모두 검증한다."""
    server, manager = _wire_real_ws(monkeypatch)
    counselor = _counselor("tq06-host@test.com")
    cls = _create_open_group_class(client, counselor["h"])

    sid, eio = "sid-real-c", "eio-real-c"
    _attach_client(server, sid, eio)
    handlers = server.handlers["/session-live"]

    async def _scenario():
        await handlers["connect"](sid, {}, {"token": counselor["token"]})
        await handlers["join"](sid, {"session_id": cls["id"]})

    asyncio.run(_scenario())

    # 실제 세션 저장소(engineio)에 join 컨텍스트가 반영됐다
    session = asyncio.run(server.get_session(sid, namespace="/session-live"))
    assert session["session_id"] == cls["id"]

    # 실제 매니저 룸 상태 — 호스트는 전체 수신 룸 + 공용 룸에 들어간다
    rooms = server.rooms(sid, namespace="/session-live")
    assert f"session:{cls['id']}" in rooms
    assert f"session:{cls['id']}:all" in rooms

    # emit 이 실제 매니저 경로(namespace/room/to)로 나갔다
    joined = [e for e in manager.emits if e["event"] == "joined"]
    assert joined, manager.emits
    # 실제 AsyncServer 는 `to=` 를 해당 소켓 전용 room 으로 변환해 매니저에 전달한다.
    assert joined[0]["room"] == sid
    assert joined[0]["namespace"] == "/session-live"
    assert joined[0]["data"]["session_id"] == cls["id"]
    assert joined[0]["data"]["role"] == "host"
    assert joined[0]["data"]["snapshot"]


def test_tq06_실제_AsyncServer_leave는_룸에서_퇴장한다(client, monkeypatch):
    server, _ = _wire_real_ws(monkeypatch)
    counselor = _counselor("tq06-leave@test.com")
    cls = _create_open_group_class(client, counselor["h"])

    sid, eio = "sid-real-l", "eio-real-l"
    _attach_client(server, sid, eio)
    handlers = server.handlers["/session-live"]
    asyncio.run(handlers["connect"](sid, {}, {"token": counselor["token"]}))
    asyncio.run(handlers["join"](sid, {"session_id": cls["id"]}))
    asyncio.run(handlers["leave"](sid, {"session_id": cls["id"]}))

    rooms = server.rooms(sid, namespace="/session-live")
    assert f"session:{cls['id']}" not in rooms
    assert f"session:{cls['id']}:all" not in rooms


def test_tq06_실제_AsyncServer_게스트는_호스트룸에_들어가지_않는다(client, monkeypatch):
    """룸 격리(게스트 비노출)를 실제 매니저 룸 상태로 확인한다 — FakeSio 의 핵심 갭."""
    server, _ = _wire_real_ws(monkeypatch)
    counselor = _counselor("tq06-guest-host@test.com")
    cls = _create_open_group_class(client, counselor["h"])
    joined_guest = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "TQ게스트"}
    )
    assert joined_guest.status_code == 200, joined_guest.text
    pid = joined_guest.json()["participant_id"]

    sid, eio = "sid-real-g", "eio-real-g"
    _attach_client(server, sid, eio)
    handlers = server.handlers["/session-live"]
    asyncio.run(handlers["connect"](sid, {}, {}))  # 게스트: 무토큰
    asyncio.run(handlers["join"](sid, {"session_id": cls["id"], "participant_id": pid}))

    rooms = server.rooms(sid, namespace="/session-live")
    assert f"session:{cls['id']}:all" in rooms
    assert f"session:{cls['id']}:self:{pid}" in rooms
    assert f"session:{cls['id']}" not in rooms  # 호스트 전체 수신 룸에는 없다


# ═══════════════════════════════════════════════════════════════════════════
# [3] TQ-07 — _build_client_manager 운영(Redis manager) 경로 실검증
# ═══════════════════════════════════════════════════════════════════════════


def test_tq07_pytest_격리는_실제_실행중에도_적용된다():
    """TQ-07: monkeypatch 없이도 pytest 실행 중에는 Redis manager 를 부착하지 않는다."""
    from app import ws

    assert ws._running_under_pytest() is True
    assert ws._build_client_manager() is None


def test_tq07_운영경로_AsyncRedisManager가_실제_AsyncServer에_부착된다(monkeypatch):
    """TQ-07: pytest 격리를 개별 테스트에서 해제하면 운영 manager 경로가 실제로 구성된다."""
    from app import ws
    from app.config import settings

    monkeypatch.setattr(ws, "_running_under_pytest", lambda: False)
    monkeypatch.setattr(ws, "_redis_reachable", lambda url, timeout=0.5: True)
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")

    manager = ws._build_client_manager()
    assert isinstance(manager, socketio.AsyncRedisManager)
    # 운영에서 쓰는 것과 동일한 채널(다중 프로세스 broadcast 계약)
    assert manager.channel == ws.REDIS_CHANNEL == "mindbreeze"

    # 실제 AsyncServer 에 부착해 계약까지 확인한다(이전에는 검증되지 않던 경로).
    server = socketio.AsyncServer(async_mode="asgi", client_manager=manager)
    assert server.manager is manager


def test_tq07_redis_url_미설정이면_부착하지_않는다(monkeypatch):
    from app import ws
    from app.config import settings

    monkeypatch.setattr(settings, "redis_url", "")
    assert ws._build_client_manager() is None


# ═══════════════════════════════════════════════════════════════════════════
# [4] TQ-09 — 내담자 포털 홈 · 조직 가입요청 조회 커버리지
# ═══════════════════════════════════════════════════════════════════════════


def _seed_client_home(client):
    """내담자 홈 집계용 DB 상태를 만든다(세션·참가자·리포트)."""
    from app.models.record import Report
    from app.models.session import Session as SessionModel, SessionParticipant

    member = _register(client, "tq09-member@test.com")
    host = _counselor("tq09-host@test.com")

    db = _db()
    try:
        session = SessionModel(
            host_id=uuid.UUID(host["id"]),
            type="meditation",
            status="scheduled",
            duration_min=30,
            title="홈 명상 클래스",
            scheduled_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            access_code="TQ0901",
        )
        db.add(session)
        db.flush()
        db.add(
            SessionParticipant(
                session_id=session.id, user_id=uuid.UUID(member["id"]), is_waitlisted=False
            )
        )
        report = Report(
            session_id=session.id,
            user_id=uuid.UUID(member["id"]),
            type="client",
            content={"summary": "요약"},
            status="completed",
        )
        db.add(report)
        db.commit()
        ids = {"session_id": str(session.id), "report_id": str(report.id)}
    finally:
        db.close()
    return member, host, ids


def test_tq09_내담자_홈_집계_반환(client):
    member, host, ids = _seed_client_home(client)

    res = client.get("/api/v1/client/home", headers=member["h"])
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["next_session"]["id"] == ids["session_id"]
    assert body["next_session"]["title"] == "홈 명상 클래스"
    assert body["next_session"]["counselor_name"] == "상담사-tq09-host"
    assert body["next_session"]["status"] == "scheduled"
    assert body["recent_report"]["id"] == ids["report_id"]
    assert body["recent_report"]["title"].endswith("리포트")
    assert body["unread_messages"] == 0
    assert body["today_sessions"] == 1


def test_tq09_내담자_홈_안읽은메시지_집계(client):
    from app.models.chat import ChatMessage, ChatRoomParticipant
    from app.services.chat_service import get_or_create_direct_room

    member, host, _ = _seed_client_home(client)

    db = _db()
    try:
        room = get_or_create_direct_room(uuid.UUID(host["id"]), uuid.UUID(member["id"]), db)
        # 홈의 안읽음 집계는 ChatRoomParticipant 기준이므로 내담자를 방 참여자로 등록해야 한다.
        db.add(ChatRoomParticipant(room_id=room.id, user_id=uuid.UUID(member["id"])))
        db.add(
            ChatMessage(
                room_id=room.id, sender_id=uuid.UUID(host["id"]), type="text", content="안녕하세요"
            )
        )
        db.commit()
    finally:
        db.close()

    body = client.get("/api/v1/client/home", headers=member["h"]).json()
    assert body["unread_messages"] == 1


def test_tq09_내담자_홈_데이터없으면_빈값(client):
    member = _register(client, "tq09-empty@test.com")

    res = client.get("/api/v1/client/home", headers=member["h"])
    assert res.status_code == 200, res.text
    assert res.json() == {
        "next_session": None,
        "recent_report": None,
        "unread_messages": 0,
        "today_sessions": 0,
    }


def test_tq09_내담자_홈_비로그인_401(client):
    res = client.get("/api/v1/client/home")
    assert res.status_code == 401
    assert res.json()["detail"] == "인증이 필요합니다"


def _make_org() -> dict:
    """기관을 만들고 (org_id, org_code) 를 돌려준다."""
    from app.services import org_service

    db = _db()
    try:
        org = org_service.admin_create_organization("TQ09센터", db)
        return {"id": str(org.id), "code": org.org_code}
    finally:
        db.close()


def test_tq09_조직_가입요청_신청후_내_목록에_조회된다(client):
    org = _make_org()
    # MB2-ORG-04: 소속 신청은 상담사·기관 관리자 역할만 가능하고, 무소속이어야 한다.
    applicant = _orgless_counselor("tq09-join@test.com")

    joined = client.post(f"/api/v1/org/{org['id']}/join", headers=applicant["h"])
    assert joined.status_code == 201, joined.text
    assert joined.json()["status"] == "pending"
    assert joined.json()["org_name"] == "TQ09센터"

    res = client.get("/api/v1/org/requests", headers=applicant["h"])
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["org_id"] == org["id"]
    assert rows[0]["org_name"] == "TQ09센터"
    assert rows[0]["status"] == "pending"
    assert rows[0]["id"] == joined.json()["id"]


def test_tq09_조직_가입요청_중복신청은_409(client):
    org = _make_org()
    applicant = _orgless_counselor("tq09-dup@test.com")
    first = client.post(f"/api/v1/org/{org['id']}/join", headers=applicant["h"])
    assert first.status_code == 201, first.text
    second = client.post(f"/api/v1/org/{org['id']}/join", headers=applicant["h"])
    assert second.status_code == 409, second.text
    assert "진행 중" in second.json()["detail"]


def test_tq09_조직관리자는_가입요청_목록과_신청자정보를_본다(client):
    from app.models.user import User
    from app.services import membership_service

    org = _make_org()
    applicant = _orgless_counselor("tq09-applicant@test.com")
    admin = _counselor("tq09-admin@test.com")  # 소속 없이 생성 후 org_admin membership 부여

    db = _db()
    try:
        admin_user = db.query(User).filter(User.id == uuid.UUID(admin["id"])).first()
        membership_service.add_membership(
            db, admin_user, uuid.UUID(org["id"]), role="org_admin", status_="active"
        )
        db.commit()
    finally:
        db.close()

    client.post(f"/api/v1/org/{org['id']}/join", headers=applicant["h"])
    res = client.get(f"/api/v1/org/{org['id']}/requests", headers=admin["h"])
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["user_id"] == applicant["id"]
    assert rows[0]["user_email"] == "tq09-applicant@test.com"
    assert rows[0]["status"] == "pending"


def test_tq09_조직_가입요청_조회는_인증필요(client):
    org = _make_org()
    assert client.get("/api/v1/org/requests").status_code == 401
    assert client.get(f"/api/v1/org/{org['id']}/requests").status_code == 401


# ═══════════════════════════════════════════════════════════════════════════
# [5] TQ-10 — PDF 렌더링 skip 사유 / CI 의존성 명시 검증
# ═══════════════════════════════════════════════════════════════════════════


def test_tq10_pdf_테스트는_사유를_명시해_skip한다():
    """TQ-10: WeasyPrint 미설치 환경의 skip 은 '사유 없는 조용한 skip'이 아니어야 한다."""
    module_path = Path(__file__).parent / "test_sdd070_report_pdf.py"
    source = module_path.read_text(encoding="utf-8")

    import tests.test_sdd070_report_pdf as pdf_tests

    marks = pdf_tests.pytestmark
    if not isinstance(marks, (list, tuple)):
        marks = [marks]
    mark = marks[0]
    assert mark.name == "skipif"
    reason = mark.kwargs.get("reason") or ""
    assert "WeasyPrint" in reason and "미설치" in reason, reason

    # 조건은 실제 가용성 판정과 일치한다(가용 → skip 안 함 / 미가용 → skip).
    assert mark.args[0] is (not pdf_tests._pdf_available())
    # 사유는 소스에 문자열 상수로도 남아 있어야 한다(리뷰/검색 가능성).
    assert re.search(r'reason="[^"]*WeasyPrint[^"]*"', source)


def test_tq10_CI가_pdf_시스템의존성을_설치하고_백엔드_테스트를_실행한다():
    """TQ-10: CI 게이트가 WeasyPrint 시스템 라이브러리를 설치해야 PDF 테스트가 실제로 돈다."""
    workflow = _REPO_ROOT / ".github" / "workflows" / "ci-feature.yml"
    assert workflow.exists(), workflow
    text = workflow.read_text(encoding="utf-8")

    for package in ("libcairo2", "libpango-1.0-0", "libharfbuzz-subset0", "fonts-noto-cjk"):
        assert package in text, package
    assert "pytest -q" in text
    assert "Install PDF system deps" in text


# ═══════════════════════════════════════════════════════════════════════════
# [6] TQ-11 — 리마인더 ETA/태스크 계약 실검증 (blanket patch 대체)
# ═══════════════════════════════════════════════════════════════════════════


def _scheduled_session_row(*, offsets, minutes_from_now=200):
    from app.models.session import Session as SessionModel

    db = _db()
    try:
        session = SessionModel(
            host_id=uuid.uuid4(),
            type="meditation",
            status="scheduled",
            duration_min=30,
            title="TQ-11 예약",
            scheduled_at=datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now),
            reminder_offsets=offsets,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session.id
    finally:
        db.close()


def test_tq11_예약시_실제_ETA와_결정적_task_id로_적재된다(client, monkeypatch):
    """TQ-11: apply_async 를 통째로 삼키지 않고 실제 예약 인자(eta/task_id/retry)를 검증한다."""
    from app.services import reminder_service
    from app.models.session import Session as SessionModel

    sid = _scheduled_session_row(offsets=[1440], minutes_from_now=2000)

    calls: list[dict] = []
    monkeypatch.setattr(
        "app.tasks.reminder_task.send_session_reminder_task.apply_async",
        lambda *a, **k: calls.append(k),
    )

    db = _db()
    try:
        session = db.get(SessionModel, sid)
        scheduled_at = session.scheduled_at
        jobs = reminder_service.schedule_session_reminders(session, db)
    finally:
        db.close()

    assert len(jobs) == 1 and jobs[0]["offset_min"] == 1440
    assert len(calls) == 1
    kwargs = calls[0]
    # 실제 예약 계약: args=[session_id, offset], eta, 결정적 task_id, retry=False
    assert kwargs["args"] == [str(sid), 1440]
    # DB(SQLite)는 naive 로 돌려주므로 서비스와 동일하게 UTC aware 로 정규화해 비교한다.
    expected_eta = reminder_service._ensure_aware(scheduled_at) - timedelta(minutes=1440)
    assert kwargs["eta"] == expected_eta
    assert kwargs["retry"] is False
    assert kwargs["task_id"] == reminder_service._reminder_task_id(sid, 1440, scheduled_at)


def test_tq11_지난_시점은_ETA로_적재하지_않는다(client, monkeypatch):
    from app.services import reminder_service

    sid = _scheduled_session_row(offsets=[1440], minutes_from_now=30)  # 발송 시각 이미 경과
    calls: list = []
    monkeypatch.setattr(
        "app.tasks.reminder_task.send_session_reminder_task.apply_async",
        lambda *a, **k: calls.append(k),
    )

    db = _db()
    try:
        from app.models.session import Session as SessionModel

        jobs = reminder_service.schedule_session_reminders(db.get(SessionModel, sid), db)
    finally:
        db.close()

    assert jobs == []
    assert calls == []  # 지난 시점은 스윕 대상 — 큐 적재하지 않는다


def test_tq11_task_id는_일정에_결정적이고_일정변경시_달라진다():
    """TQ-11: task_id 가 (세션·시점·일정) 의 결정적 값이어야 revoke 로 옛 ETA 를 취소할 수 있다."""
    from app.services import reminder_service

    base = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    changed = base + timedelta(minutes=1)

    same_a = reminder_service._reminder_task_id("sess-1", 60, base)
    same_b = reminder_service._reminder_task_id("sess-1", 60, base)
    other = reminder_service._reminder_task_id("sess-1", 60, changed)

    assert same_a == same_b
    assert same_a != other
    assert same_a == f"session-reminder:sess-1:60:{int(base.timestamp())}"


def test_tq11_revoke는_결정적_task_id로_브로커에_취소를_보낸다(monkeypatch):
    from app.core.celery_app import celery_app
    from app.services import reminder_service

    scheduled_at = datetime.now(timezone.utc) + timedelta(hours=3)
    revoked: list[str] = []
    monkeypatch.setattr(celery_app.control, "revoke", lambda task_id, **kw: revoked.append(task_id))

    count = reminder_service.revoke_session_reminders("sess-r", [1440, 60], scheduled_at)
    assert count == 2
    assert revoked == [
        reminder_service._reminder_task_id("sess-r", 1440, scheduled_at),
        reminder_service._reminder_task_id("sess-r", 60, scheduled_at),
    ]

    # eager 환경(워커 없음)에서는 브로커 취소를 시도하지 않는다.
    revoked.clear()
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    assert reminder_service.revoke_session_reminders("sess-r", [60], scheduled_at) == 0
    assert revoked == []


# ═══════════════════════════════════════════════════════════════════════════
# [7] TQ-12 — 상담사 실제 가입 경로(기관 초대 → 비밀번호 설정) 검증
# ═══════════════════════════════════════════════════════════════════════════


def _platform_admin(client, email: str) -> dict:
    """client 가입 후 platform_admin 으로 승격한 헤더를 돌려준다."""
    from app.models.user import User

    user = _register(client, email)
    db = _db()
    try:
        row = db.query(User).filter(User.id == uuid.UUID(user["id"])).first()
        row.role = "platform_admin"
        db.commit()
    finally:
        db.close()
    return user


def test_tq12_상담사는_초대경로로_실제_가입한다(client, monkeypatch):
    """TQ-12: DB 직접 삽입이 아니라 실제 초대→비밀번호설정 경로로 상담사가 활성화된다."""
    from app.models.counselor_profile import CounselorProfile
    from app.models.user import User

    invite_links: dict[str, list[str]] = {"org": [], "counselor": []}
    monkeypatch.setattr(
        "app.services.org_invite_service.send_org_invite_email",
        lambda to_email, invite_link, **kw: invite_links["org"].append(invite_link) or True,
    )
    monkeypatch.setattr(
        "app.services.org_invite_service.send_counselor_invite_email",
        lambda to_email, invite_link, **kw: invite_links["counselor"].append(invite_link) or True,
    )

    admin = _platform_admin(client, "tq12-sys@test.com")
    created = client.post(
        "/api/v1/admin/orgs",
        json={
            "name": "TQ12상담센터",
            "phone": "02-1234-5678",
            "address": "서울시 강남구",
            "admin_name": "박담당",
            "admin_email": "tq12-orgadmin@test.com",
            "admin_phone": "010-1111-2222",
        },
        headers=admin["h"],
    )
    assert created.status_code == 201, created.text
    org_id = created.json()["org"]["id"]

    org_token = invite_links["org"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": org_token, "new_password": "NewPassw0rd!"}
    )
    assert activated.status_code == 200, activated.text
    org_admin_h = {"Authorization": f"Bearer {activated.json()['access_token']}"}

    invited = client.post(
        f"/api/v1/org/{org_id}/counselors/invite",
        json={"name": "TQ12상담사", "email": "tq12-counselor@test.com"},
        headers=org_admin_h,
    )
    assert invited.status_code == 201, invited.text
    # 실제 가입 전에는 pending — DB 직접 생성이 아니라 초대 대기 상태다.
    assert invited.json()["counselor"]["status"] == "pending"

    counselor_token = invite_links["counselor"][0].split("token=", 1)[1]
    done = client.post(
        "/api/v1/auth/set-password",
        json={"token": counselor_token, "new_password": "NewPassw0rd!"},
    )
    assert done.status_code == 200, done.text
    assert done.json()["user"]["role"] == "counselor"

    # 실제 로그인까지 성공해야 한다(활성화 완료 증거).
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "tq12-counselor@test.com", "password": "NewPassw0rd!"},
    )
    assert login.status_code == 200, login.text

    db = _db()
    try:
        user = db.query(User).filter(User.email == "tq12-counselor@test.com").first()
        assert user.status == "active" and user.role == "counselor"
        assert str(user.org_id) == org_id
        profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
        assert profile is not None and len(profile.counselor_code) == 6
    finally:
        db.close()


def test_tq12_상담사_직접가입_경로는_여전히_차단된다(client):
    """TQ-12: 실제 경로가 초대/승인이라는 대체 사실을 고정한다(SDD-073)."""
    res = client.post(
        "/api/v1/auth/register/counselor",
        json={
            "org_code": create_test_org("TQ12차단센터"),
            "email": "tq12-blocked@test.com",
            "password": VALID_PASSWORD,
            "name": "차단상담사",
            "email_verify_token": email_verify_service.generate_email_verify_token("tq12-blocked@test.com"),
            "consents": _consents(),
        },
    )
    assert res.status_code == 403, res.text
    assert "초대" in res.json()["detail"]


# ═══════════════════════════════════════════════════════════════════════════
# [8] TQ-14 — 핵심 테스트 단언 보강 / status_code-only 회귀 가드
# ═══════════════════════════════════════════════════════════════════════════

# 단언이 status_code 뿐인 테스트를 금지하는 '핵심 모듈' 목록.
_CRITICAL_ASSERT_MODULES = (
    "test_auth_login.py",
    "test_auth_register.py",
    "test_report.py",
)


def _assertions_of(node: ast.AST) -> list[ast.Assert]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Assert)]


def _is_status_only(assert_node: ast.Assert) -> bool:
    """단언 표현식이 status_code 비교 단 하나뿐인지 판정한다."""
    text = ast.unparse(assert_node.test)
    normalized = text.replace("and", " ").replace("or", " ")
    if "status_code" not in text:
        return False
    # bool 연산/여러 조건/부가 검증이 섞이면 status-only 가 아니다.
    if " and " in text or " or " in text:
        return False
    return text.count("==") + text.count("!=") + text.count(" in ") <= 1


def test_tq14_핵심_모듈은_status_code만_단언하지_않는다():
    """TQ-14: 핵심 모듈의 테스트는 상태코드 외 실제 결과를 단언해야 한다(회귀 가드)."""
    weak: list[str] = []
    for module_name in _CRITICAL_ASSERT_MODULES:
        path = Path(__file__).parent / module_name
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not node.name.startswith("test"):
                continue
            asserts = _assertions_of(node)
            if asserts and all(_is_status_only(a) for a in asserts):
                weak.append(f"{module_name}::{node.name}")

    assert weak == [], f"status_code 만 단언하는 핵심 테스트: {weak}"


def test_tq14_로그인_응답은_토큰과_사용자정보를_담는다(client):
    """TQ-14: 로그인 성공이 상태코드뿐 아니라 실제 토큰/사용자/쿠키까지 검증한다."""
    member = _register(client, "tq14-login@test.com")

    res = client.post(
        "/api/v1/auth/login",
        json={"email": "tq14-login@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["id"] == member["id"]
    assert body["user"]["email"] == "tq14-login@test.com"
    assert body["user"]["role"] == "client"
    assert client.cookies.get("mb_refresh_token")


def test_tq14_세션_생성은_참여코드와_DB행을_만든다(client):
    """TQ-14: 세션 생성이 상태코드뿐 아니라 참여코드(6자)와 DB 반영까지 검증한다."""
    from app.models.session import Session as SessionModel

    host = _counselor("tq14-session-host@test.com")

    res = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "title": "TQ14 세션"},
        headers=host["h"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "ready"
    assert len(body["access_code"]) == 6
    assert body["participant_mode"] == "one_on_one"

    db = _db()
    try:
        row = db.get(SessionModel, uuid.UUID(body["id"]))
        assert row is not None
        assert row.access_code == body["access_code"]
        assert row.title == "TQ14 세션"
        assert str(row.host_id) == host["id"]
    finally:
        db.close()


def test_tq14_리포트_목록은_항목필드를_반환한다(client):
    """TQ-14: 목록 조회가 상태코드뿐 아니라 실제 항목 필드까지 검증한다."""
    from app.models.record import Report
    from app.models.session import Session as SessionModel

    host = _counselor("tq14-report-host@test.com")
    db = _db()
    try:
        session = SessionModel(
            host_id=uuid.UUID(host["id"]),
            type="clinical",
            status="completed",
            duration_min=50,
            title="TQ14 리포트 세션",
        )
        db.add(session)
        db.flush()
        report = Report(
            session_id=session.id, type="counselor", content={"k": "v"}, status="pending_review"
        )
        db.add(report)
        db.commit()
        session_id, report_id = str(session.id), str(report.id)
    finally:
        db.close()

    res = client.get("/api/v1/reports", headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert len(body["reports"]) == 1
    item = body["reports"][0]
    assert item["id"] == report_id
    assert item["session_id"] == session_id
    assert item["type"] == "counselor"
    assert item["status"] == "pending_review"

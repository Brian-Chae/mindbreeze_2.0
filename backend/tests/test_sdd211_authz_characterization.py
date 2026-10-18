"""SDD-211 A0 — 호스트 판정(authorize_session) 특성화 테스트 (verify AZ-1~AZ-8, AZ-10).

목적
- Phase 0 은 "동작 동일 리팩터"다. 호스트 판정 복제 헬퍼 9곳(33개 호출 지점)을 `session_authz` 로
  통합하기 전에, **현행 응답(상태코드 + detail 문자열 + 에러 우선순위)** 을 그대로 박제한다.
- 이 파일은 현행 코드에서 GREEN 이어야 하고 **이후 구현 커밋에서 수정하지 않는다**(verify G7).
  현행 응답이 이상해 보이는 곳(버그 포함)도 그대로 고정한다 — 고치는 것은 별도 작업이다.

범위 밖 / 방침
- 인라인 호스트 판정(TD3 대상: `_can_access_report`, `set_speaking`, `resolve_audio_sync_host`,
  `video.py` platform_admin 우회, `export_service.authorize`)은 통합 대상이 아니므로 "특성화만" 한다.
- AZ-10(WS `/record` 구독)은 Socket.IO 서버를 띄우지 않고, `register_record_namespace` 가 등록하는
  실제 `connect`/`subscribe` 핸들러를 최소 모사 sio(기존 test_mb2_ws_mid_fixes 와 같은 방식)에 붙여
  직접 호출한다. 구독 권한 판정은 실제 핸들러 → `_authorize_subscribe` → 호스트 판정 헬퍼 경로 그대로다.
- 사용자는 bcrypt 를 피하려고 DB 에 직접 만든다(권한 판정은 비밀번호와 무관). 이메일은 `@test.com` 만 쓴다.
"""

from __future__ import annotations

import asyncio
import io
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import pytest
from fastapi import HTTPException

from tests.conftest import create_test_org

# ── 현행 응답 문구 (바이트 보존 대상) ─────────────────────────────────────
DETAIL_HOST_ONLY = "host 상담사만 가능합니다"
DETAIL_EMAIL_INVITE = "호스트만 초대할 수 있습니다"
DETAIL_NO_ACCESS = "접근 권한이 없습니다"
DETAIL_NOT_FOUND = "세션을 찾을 수 없습니다"
DETAIL_BAD_ID = "잘못된 ID 형식입니다"
DETAIL_ORG_INACTIVE = "비활성화된 기관에서는 이 작업을 수행할 수 없습니다"
DETAIL_APPROVE_HOST_ONLY = "host 상담사만 승인 가능합니다"

NO_SUCH_ID = "00000000-0000-4000-8000-000000000000"
BAD_ID = "not-a-uuid"


# ── 헬퍼: DB 직접 조작 ────────────────────────────────────────────────────
def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _make_org(name: str) -> uuid.UUID:
    """기관을 만들고 id 를 돌려준다."""
    from app.models.organization import Organization

    code = create_test_org(name)
    db = _db()
    try:
        return db.query(Organization).filter(Organization.org_code == code).one().id
    finally:
        db.close()


def _make_user(email: str, role: str, org_id: uuid.UUID | None = None) -> dict:
    """active 사용자를 DB 에 직접 만들고 {id, h(Authorization 헤더)} 를 돌려준다."""
    from app.core.security import create_access_token
    from app.models.user import User

    db = _db()
    try:
        user = User(
            email=email,
            password_hash="!",
            name=f"{role}-{email.split('@')[0]}",
            role=role,
            status="active",
            verified_tier="email",
            org_id=org_id,
        )
        db.add(user)
        db.flush()
        if org_id is not None and role in ("counselor", "org_admin"):
            from app.services import membership_service

            membership_service.add_membership(db, user, org_id, status_="active")
        db.commit()
        db.refresh(user)
        uid = str(user.id)
    finally:
        db.close()
    return {"id": uid, "h": {"Authorization": f"Bearer {create_access_token(subject=uid)}"}}


def _add_participant(sid: str, user_id: str) -> str:
    """세션에 회원 참여자 행을 직접 추가한다(입장 플로우와 무관한 권한 판정 검증용)."""
    from app.models.session import SessionParticipant

    db = _db()
    try:
        p = SessionParticipant(session_id=uuid.UUID(sid), user_id=uuid.UUID(user_id))
        db.add(p)
        db.commit()
        return str(p.id)
    finally:
        db.close()


def _set_session_fields(sid: str, **fields) -> None:
    from app.models.session import Session

    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(sid)).one()
        for k, v in fields.items():
            setattr(s, k, v)
        db.commit()
    finally:
        db.close()


def _deactivate_org(org_id: uuid.UUID) -> None:
    """기관 비활성화 — 운영 API(영향도 선검사·감사 기록) 대신 DB 에서 deactivated_at 만 직접 설정한다."""
    from app.models.organization import Organization

    db = _db()
    try:
        org = db.query(Organization).filter(Organization.id == org_id).one()
        org.deactivated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


@dataclass(frozen=True)
class World:
    """한 테스트가 쓰는 주체와 세션.

    - host: 세션 호스트 상담사(기관 A 소속)
    - other: 다른 상담사(기관 B, 세션 비참여)
    - org_admin: 호스트와 **같은 기관 A** 의 기관 관리자(타인 세션 → 호스트 아님)
    - platform_admin: 플랫폼 관리자
    - member: 회원(client) 참여자(participant 행 있음)
    - outsider: 회원(client) 비참여자
    """

    sid: str
    org_id: uuid.UUID
    host: dict
    other: dict
    org_admin: dict
    platform_admin: dict
    member: dict
    member_pid: str
    outsider: dict


def _build_world(client, *, started: bool = True) -> World:
    org_id = _make_org("특성화 기관 A")
    other_org_id = _make_org("특성화 기관 B")
    host = _make_user("az-host@test.com", "counselor", org_id)
    other = _make_user("az-other@test.com", "counselor", other_org_id)
    org_admin = _make_user("az-orgadmin@test.com", "org_admin", org_id)
    platform_admin = _make_user("az-platform@test.com", "platform_admin")
    member = _make_user("az-member@test.com", "client")
    outsider = _make_user("az-outsider@test.com", "client")

    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "meditation",
            "duration_min": 30,
            "title": "특성화 클래스",
            "participant_mode": "group",
            "max_participants": 10,
        },
        headers=host["h"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    opened = client.post(f"/api/v1/sessions/{sid}/open", headers=host["h"])
    assert opened.status_code == 200, opened.text
    if started:
        # 녹음·영상·리포트 생성은 진행 중(in_progress) 세션에서만 통과하므로 기본 세계는 시작 상태다.
        begun = client.post(f"/api/v1/sessions/{sid}/start", headers=host["h"])
        assert begun.status_code == 200, begun.text
    pid = _add_participant(sid, member["id"])
    return World(sid, org_id, host, other, org_admin, platform_admin, member, pid, outsider)


@pytest.fixture
def world(client) -> World:
    """진행 중(in_progress) 그룹 클래스 + 주체 일체."""
    return _build_world(client)


@pytest.fixture
def open_world(client) -> World:
    """오픈(open) 상태 클래스 — 스위프(open 방치 취소) 경로용."""
    return _build_world(client, started=False)


# ── 요청 케이스 표 ────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Case:
    """액션 하나를 HTTP 로 호출하는 방법. kwargs 는 매 호출마다 새로 만든다(업로드 스트림 재사용 방지)."""

    action: str
    method: str
    path: str  # {sid} {member_id} {pid} 치환
    kwargs: Callable[[World], dict]
    detail: str


def _none(_w: World) -> dict:
    return {}


def _chunk(content_type: str) -> Callable[[World], dict]:
    def make(_w: World) -> dict:
        return {
            "data": {"chunk_index": "0"},
            "files": {"file": ("c0.webm", io.BytesIO(b"x" * 16), content_type)},
        }

    return make


def _json(body: dict) -> Callable[[World], dict]:
    return lambda _w: {"json": body}


def _as_member_json(_w: World) -> dict:
    return {"json": {"user_id": _w.member["id"]}}


S = "/api/v1/sessions/{sid}"

# 호스트 전용 액션 — 비호스트(다른 상담사) 요청의 현행 거부 응답.
# 계열: B(기관 활성 검사 포함) / A(검사 없음) / C(문구 상이). plan.md 정책표 25 액션 + 공백 7 포함.
HOST_ONLY_CASES: list[Case] = [
    # ── 계열 B (session_service._get_session_as_host) ──
    Case("SESSION_UPDATE", "PUT", S, _json({"title": "수정"}), DETAIL_HOST_ONLY),
    Case("SESSION_DELETE", "DELETE", S, _none, DETAIL_HOST_ONLY),
    Case("SESSION_TRANSITION:open", "POST", S + "/open", _none, DETAIL_HOST_ONLY),
    Case("SESSION_TRANSITION:start", "POST", S + "/start", _none, DETAIL_HOST_ONLY),
    Case("SESSION_TRANSITION:end", "POST", S + "/end", _none, DETAIL_HOST_ONLY),
    Case("SESSION_TRANSITION:cancel", "POST", S + "/cancel", _none, DETAIL_HOST_ONLY),
    Case("SESSION_NEW_RUN", "POST", S + "/new-run", _none, DETAIL_HOST_ONLY),
    Case("SESSION_DUPLICATE", "POST", S + "/duplicate", _none, DETAIL_HOST_ONLY),
    Case("SESSION_SAVE_TEMPLATE", "POST", S + "/save-as-template", _none, DETAIL_HOST_ONLY),
    Case("SESSION_CHAT_TOGGLE", "POST", S + "/chat-enabled", _json({"enabled": True}), DETAIL_HOST_ONLY),
    Case("PARTICIPANT_INVITE", "POST", S + "/invite", _as_member_json, DETAIL_HOST_ONLY),
    Case("PARTICIPANT_REMOVE", "DELETE", S + "/participants/{member_id}", _none, DETAIL_HOST_ONLY),
    Case("PARTICIPANT_REMIND", "POST", S + "/invite/remind", _none, DETAIL_HOST_ONLY),
    Case("MARKER_ADD", "POST", S + "/markers", _json({"timestamp_sec": 1, "note": "표식"}), DETAIL_HOST_ONLY),
    Case("LIVE_METRICS_READ", "GET", S + "/live-metrics", _none, DETAIL_HOST_ONLY),
    Case("EEG_ROLLUP_READ", "GET", S + "/eeg-rollup", _none, DETAIL_HOST_ONLY),
    Case("LIVEKIT_TOKEN_ISSUE", "POST", S + "/livekit-token", _none, DETAIL_HOST_ONLY),
    Case("REPORT_CHOICE_SUMMARY_READ", "GET", S + "/report-choice/summary", _none, DETAIL_HOST_ONLY),
    Case("RESEARCH_CONSENT_SUMMARY_READ", "GET", S + "/research-consent/summary", _none, DETAIL_HOST_ONLY),
    # ── 계열 A (기관 검사 없음) ──
    Case("RECORD_UPDATE", "PUT", S + "/record", _json({"counselor_notes": "메모"}), DETAIL_HOST_ONLY),
    Case("AUDIO_RECORD:start", "POST", S + "/audio/start", _json({"consent_audio": True}), DETAIL_HOST_ONLY),
    Case("AUDIO_RECORD:chunk", "POST", S + "/audio/chunk", _chunk("audio/webm"), DETAIL_HOST_ONLY),
    Case("AUDIO_RECORD:stop", "POST", S + "/audio/stop", _none, DETAIL_HOST_ONLY),
    Case("VIDEO_RECORD:start", "POST", S + "/video/start", _json({"consent_video": True}), DETAIL_HOST_ONLY),
    Case("VIDEO_RECORD:chunk", "POST", S + "/video/chunk", _chunk("video/webm"), DETAIL_HOST_ONLY),
    Case("VIDEO_RECORD:stop", "POST", S + "/video/stop", _none, DETAIL_HOST_ONLY),
    Case("REPORT_GENERATE", "POST", "/api/v1/reports/generate/{sid}", _json({"type": "counselor"}), DETAIL_HOST_ONLY),
    # ── 계열 C (이메일 초대 — 문구 상이) ──
    Case("EMAIL_INVITE_MANAGE:invite", "POST", S + "/invite/email", _json({"emails": ["a@example.com"]}), DETAIL_EMAIL_INVITE),
    Case("EMAIL_INVITE_MANAGE:list", "GET", S + "/invite/email", _none, DETAIL_EMAIL_INVITE),
]

# 계열 D — 호스트 또는 참여자. 비참여자는 403 `접근 권한이 없습니다`.
PARTICIPANT_CASES: list[Case] = [
    Case("SESSION_VIEW", "GET", S, _none, DETAIL_NO_ACCESS),
    Case("SESSION_CHAT_ROOM_VIEW", "GET", S + "/chat-room", _none, DETAIL_NO_ACCESS),
    Case("SESSION_JOIN", "POST", S + "/join", _none, DETAIL_NO_ACCESS),
    Case("RECORD_VIEW", "GET", S + "/record", _none, DETAIL_NO_ACCESS),
    Case("TRANSCRIPT_VIEW", "GET", S + "/transcript", _none, DETAIL_NO_ACCESS),
    Case("REPORT_STATUS_VIEW", "GET", S + "/report-status", _none, DETAIL_NO_ACCESS),
]

# 계열 A/C — 기관 비활성이어도 호스트 판정을 통과하는 액션(현행 D1). 통과 이후의 실제 상태코드는
# 비즈니스 규칙에 따르므로 케이스별로 현행 값을 박제한다(409 가 아니라는 점이 핵심).
ORG_INACTIVE_PASS_CASES: list[tuple[str, int]] = [
    ("RECORD_UPDATE", 200),
    ("AUDIO_RECORD:start", 200),
    ("AUDIO_RECORD:chunk", 400),
    ("AUDIO_RECORD:stop", 200),
    ("VIDEO_RECORD:start", 200),
    ("VIDEO_RECORD:chunk", 400),
    ("VIDEO_RECORD:stop", 200),
    ("REPORT_GENERATE", 200),
    ("EMAIL_INVITE_MANAGE:invite", 200),
    ("EMAIL_INVITE_MANAGE:list", 200),
]

_BY_ACTION = {c.action: c for c in HOST_ONLY_CASES + PARTICIPANT_CASES}
# 계열 B(기관 비활성이면 409) = 정책표에서 기관 검사 "예" 인 액션
ORG_CHECK_ACTIONS = [
    c.action
    for c in HOST_ONLY_CASES
    if c.action.startswith(
        (
            "SESSION_",
            "PARTICIPANT_",
            "MARKER_",
            "LIVE_METRICS_",
            "EEG_ROLLUP_",
            "LIVEKIT_",
            "REPORT_CHOICE_",
            "RESEARCH_CONSENT_",
        )
    )
]


def _send(client, w: World, case: Case, headers: dict, sid: str | None = None):
    path = case.path.format(
        sid=sid if sid is not None else w.sid, member_id=w.member["id"], pid=w.member_pid
    )
    return client.request(case.method, path, headers=headers, **case.kwargs(w))


def _ids(cases) -> list[str]:
    return [c.action if isinstance(c, Case) else c for c in cases]


# ═════════════════════════════════════════════════════════════════════════
# AZ-1 — 비호스트 거부 매트릭스(상태코드 + detail)
# ═════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("case", HOST_ONLY_CASES, ids=_ids(HOST_ONLY_CASES))
def test_AZ1_비호스트_상담사는_호스트전용_액션에서_403_문구_고정(client, world, case):
    res = _send(client, world, case, world.other["h"])
    assert res.status_code == 403, (case.action, res.status_code, res.text)
    assert res.json()["detail"] == case.detail


@pytest.mark.parametrize("case", PARTICIPANT_CASES, ids=_ids(PARTICIPANT_CASES))
def test_AZ1_계열D_비참여자는_403_접근권한없음(client, world, case):
    res = _send(client, world, case, world.outsider["h"])
    assert res.status_code == 403, (case.action, res.status_code, res.text)
    assert res.json()["detail"] == case.detail


# ═════════════════════════════════════════════════════════════════════════
# AZ-2 — 기관 비활성(D1 보존): 계열 B 만 409, 계열 A/C 는 통과
# ═════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("action", ORG_CHECK_ACTIONS)
def test_AZ2_호스트_기관_비활성이면_계열B는_409(client, world, action):
    _deactivate_org(world.org_id)
    res = _send(client, world, _BY_ACTION[action], world.host["h"])
    assert res.status_code == 409, (action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_ORG_INACTIVE


@pytest.mark.parametrize("action,expected", ORG_INACTIVE_PASS_CASES, ids=[a for a, _ in ORG_INACTIVE_PASS_CASES])
def test_AZ2_호스트_기관_비활성이어도_계열A_C는_통과(client, world, action, expected):
    _deactivate_org(world.org_id)
    res = _send(client, world, _BY_ACTION[action], world.host["h"])
    assert res.status_code != 409, (action, res.text)
    assert res.status_code == expected, (action, res.status_code, res.text)


@pytest.mark.parametrize("action,expected", ORG_INACTIVE_PASS_CASES, ids=[a for a, _ in ORG_INACTIVE_PASS_CASES])
def test_AZ2_대조군_기관_활성이면_계열A_C_응답이_비활성과_동일(client, world, action, expected):
    """비활성 여부가 계열 A/C 응답을 바꾸지 않음을 보이는 대조군 — 통과 후 상태코드는 비즈니스 규칙 몫이다."""
    res = _send(client, world, _BY_ACTION[action], world.host["h"])
    assert res.status_code == expected, (action, res.status_code, res.text)


# ═════════════════════════════════════════════════════════════════════════
# AZ-3 — role 우회 없음: org_admin·platform_admin 도 타인 세션에서는 호스트가 아니다
# ═════════════════════════════════════════════════════════════════════════
_ADMIN_ACTORS = ["org_admin", "platform_admin"]


@pytest.mark.parametrize("actor", _ADMIN_ACTORS)
@pytest.mark.parametrize("case", HOST_ONLY_CASES, ids=_ids(HOST_ONLY_CASES))
def test_AZ3_관리자_role도_호스트전용_액션은_403(client, world, case, actor):
    """권한 확대 방지 — 같은 기관 org_admin, platform_admin 모두 호스트가 아니면 403 + 동일 문구."""
    res = _send(client, world, case, getattr(world, actor)["h"])
    assert res.status_code == 403, (case.action, actor, res.status_code, res.text)
    assert res.json()["detail"] == case.detail


@pytest.mark.parametrize("actor", _ADMIN_ACTORS)
@pytest.mark.parametrize("case", PARTICIPANT_CASES, ids=_ids(PARTICIPANT_CASES))
def test_AZ3_관리자_role도_계열D_비참여자는_403(client, world, case, actor):
    res = _send(client, world, case, getattr(world, actor)["h"])
    assert res.status_code == 403, (case.action, actor, res.status_code, res.text)
    assert res.json()["detail"] == case.detail


# ═════════════════════════════════════════════════════════════════════════
# AZ-4 — 숨김 세션 404, 제거된 참여자 403 (ORM 전역 필터 의존 고정, D3)
# ═════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("case", HOST_ONLY_CASES + PARTICIPANT_CASES, ids=_ids(HOST_ONLY_CASES + PARTICIPANT_CASES))
def test_AZ4_숨김_세션은_호스트도_404(client, world, case):
    _set_session_fields(world.sid, hidden_at=datetime.now(timezone.utc))
    res = _send(client, world, case, world.host["h"])
    assert res.status_code == 404, (case.action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_NOT_FOUND


def _mark_participant(pid: str, **fields) -> None:
    from app.models.session import SessionParticipant

    db = _db()
    try:
        # 전역 필터가 removed 행을 감추므로 해제 옵션으로 읽어 수정한다.
        row = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.id == uuid.UUID(pid))
            .execution_options(include_removed=True)
            .one()
        )
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()
    finally:
        db.close()


@pytest.mark.parametrize("field", ["removed_at", "waitlist_cancelled_at"])
@pytest.mark.parametrize("case", PARTICIPANT_CASES, ids=_ids(PARTICIPANT_CASES))
def test_AZ4_제거_또는_대기취소된_참여자는_계열D_403(client, world, case, field):
    _mark_participant(world.member_pid, **{field: datetime.now(timezone.utc)})
    res = _send(client, world, case, world.member["h"])
    assert res.status_code == 403, (case.action, field, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_NO_ACCESS


# ═════════════════════════════════════════════════════════════════════════
# AZ-5 — 스위프 경로: 호스트 id 로 transition_status(restrict_from={"open"}) 통과 (D5)
# ═════════════════════════════════════════════════════════════════════════
def _status_of(sid: str) -> str:
    from app.models.session import Session

    db = _db()
    try:
        return db.query(Session).filter(Session.id == uuid.UUID(sid)).one().status
    finally:
        db.close()


def test_AZ5_호스트_id로_cancel_restrict_open_전이가_통과한다(client, open_world):
    from app.services import session_service

    w = open_world
    db = _db()
    try:
        out = session_service.transition_status(w.sid, w.host["id"], "cancel", db, restrict_from={"open"})
    finally:
        db.close()
    assert out["status"] == "cancelled"
    assert _status_of(w.sid) == "cancelled"


def test_AZ5_비호스트_id로는_같은_호출이_403(client, open_world):
    from app.services import session_service

    w = open_world
    db = _db()
    try:
        with pytest.raises(HTTPException) as err:
            session_service.transition_status(w.sid, w.other["id"], "cancel", db, restrict_from={"open"})
    finally:
        db.close()
    assert err.value.status_code == 403
    assert err.value.detail == DETAIL_HOST_ONLY
    assert _status_of(w.sid) == "open"


def test_AZ5_restrict_from_open_이면_진행중_세션은_400(client, world):
    """호스트 판정 통과 뒤 출발 상태 검사에서 막힌다 — 판정(403)이 아니라 상태 전이 규칙(400)."""
    from app.services import session_service

    db = _db()
    try:
        with pytest.raises(HTTPException) as err:
            session_service.transition_status(world.sid, world.host["id"], "cancel", db, restrict_from={"open"})
    finally:
        db.close()
    assert err.value.status_code == 400
    assert err.value.detail == "잘못된 상태 전이입니다"
    assert _status_of(world.sid) == "in_progress"


def test_AZ5_스위프는_24h_경과_open_세션을_호스트_신분으로_취소한다(client, open_world):
    from app.services import session_service

    w = open_world
    _set_session_fields(w.sid, opened_at=datetime.now(timezone.utc) - timedelta(hours=25))
    db = _db()
    try:
        cancelled = session_service.sweep_stale_open_sessions(db)
    finally:
        db.close()
    assert cancelled == [w.sid]
    assert _status_of(w.sid) == "cancelled"


def test_AZ5_호스트_기관이_비활성이면_스위프는_409를_삼키고_건너뛴다(client, open_world):
    """스위프는 호스트 판정(계열 B)을 그대로 통과해야 하므로 기관 비활성이면 취소하지 못한다 — 현행 박제."""
    from app.services import session_service

    w = open_world
    _set_session_fields(w.sid, opened_at=datetime.now(timezone.utc) - timedelta(hours=25))
    _deactivate_org(w.org_id)
    db = _db()
    try:
        cancelled = session_service.sweep_stale_open_sessions(db)
    finally:
        db.close()
    assert cancelled == []
    assert _status_of(w.sid) == "open"


# ═════════════════════════════════════════════════════════════════════════
# AZ-6 — 계열 D: 비참여자 403, 참여자·호스트 200
# ═════════════════════════════════════════════════════════════════════════
_AZ6_CASES = [c for c in PARTICIPANT_CASES if c.action in ("SESSION_VIEW", "RECORD_VIEW", "TRANSCRIPT_VIEW", "REPORT_STATUS_VIEW")]


@pytest.mark.parametrize("case", _AZ6_CASES, ids=_ids(_AZ6_CASES))
def test_AZ6_비참여자_403_접근권한없음(client, world, case):
    res = _send(client, world, case, world.outsider["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == DETAIL_NO_ACCESS


@pytest.mark.parametrize("actor", ["member", "host"])
@pytest.mark.parametrize("case", _AZ6_CASES, ids=_ids(_AZ6_CASES))
def test_AZ6_참여자와_호스트는_200(client, world, case, actor):
    res = _send(client, world, case, getattr(world, actor)["h"])
    assert res.status_code == 200, (case.action, actor, res.status_code, res.text)


def test_AZ6_참여자는_호스트_전용_내용을_받지_못한다_현행(client, world):
    """계열 D 통과 후의 마스킹(호스트 판정과는 별개)이 현행에서 어떻게 보이는지 고정한다."""
    transcript = client.get(f"/api/v1/sessions/{world.sid}/transcript", headers=world.member["h"]).json()
    assert transcript["raw_text"] is None and transcript["segments"] == []


# ═════════════════════════════════════════════════════════════════════════
# AZ-7 — 에러 우선순위: 400(ID 형식) → 404 → 403 → 409(기관)
# ═════════════════════════════════════════════════════════════════════════
@pytest.fixture
def lone(client) -> dict:
    """세션 없이 인증 가능한 상담사 1명(존재하지 않는 id / 잘못된 id 검증용)."""
    return _make_user("az-lone@test.com", "counselor", _make_org("특성화 기관 L"))


def _send_raw(client, case: Case, sid: str, headers: dict):
    w = World(sid, uuid.uuid4(), {}, {}, {}, {}, {"id": str(uuid.uuid4())}, str(uuid.uuid4()), {})
    path = case.path.format(sid=sid, member_id=w.member["id"], pid=w.member_pid)
    return client.request(case.method, path, headers=headers, **case.kwargs(w))


@pytest.mark.parametrize("case", HOST_ONLY_CASES + PARTICIPANT_CASES, ids=_ids(HOST_ONLY_CASES + PARTICIPANT_CASES))
def test_AZ7_존재하지_않는_id는_비호스트여도_404(client, lone, case):
    res = _send_raw(client, case, NO_SUCH_ID, lone["h"])
    assert res.status_code == 404, (case.action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_NOT_FOUND


@pytest.mark.parametrize("case", HOST_ONLY_CASES + PARTICIPANT_CASES, ids=_ids(HOST_ONLY_CASES + PARTICIPANT_CASES))
def test_AZ7_잘못된_UUID는_400(client, lone, case):
    res = _send_raw(client, case, BAD_ID, lone["h"])
    assert res.status_code == 400, (case.action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_BAD_ID


@pytest.mark.parametrize("action", ORG_CHECK_ACTIONS)
def test_AZ7_기관_비활성이어도_비호스트는_403이고_409가_아니다(client, world, action):
    _deactivate_org(world.org_id)
    res = _send(client, world, _BY_ACTION[action], world.other["h"])
    assert res.status_code == 403, (action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_HOST_ONLY


# ═════════════════════════════════════════════════════════════════════════
# AZ-8 — 기존 테스트 공백 7곳 (+ approve_report)
# ═════════════════════════════════════════════════════════════════════════
_AZ8_ACTIONS = [
    "SESSION_TRANSITION:end",
    "SESSION_SAVE_TEMPLATE",
    "MARKER_ADD",
    "RECORD_UPDATE",
    "AUDIO_RECORD:chunk",
    "AUDIO_RECORD:stop",
    "VIDEO_RECORD:stop",
]


@pytest.mark.parametrize("action", _AZ8_ACTIONS)
def test_AZ8_공백_액션_비호스트_403_문구(client, world, action):
    case = _BY_ACTION[action]
    res = _send(client, world, case, world.other["h"])
    assert res.status_code == 403, (action, res.status_code, res.text)
    assert res.json()["detail"] == DETAIL_HOST_ONLY


def _make_report(sid: str, host_id: str) -> str:
    from app.models.record import Report

    db = _db()
    try:
        r = Report(
            session_id=uuid.UUID(sid),
            user_id=uuid.UUID(host_id),
            type="counselor",
            content={},
            status="pending_review",
        )
        db.add(r)
        db.commit()
        return str(r.id)
    finally:
        db.close()


def test_AZ8_approve_report_비호스트_403_승인_전용_문구(client, world):
    rid = _make_report(world.sid, world.host["id"])
    res = client.post(f"/api/v1/reports/{rid}/approve", headers=world.other["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == DETAIL_APPROVE_HOST_ONLY


@pytest.mark.parametrize("actor", _ADMIN_ACTORS)
def test_AZ8_approve_report_관리자_role도_403(client, world, actor):
    rid = _make_report(world.sid, world.host["id"])
    res = client.post(f"/api/v1/reports/{rid}/approve", headers=getattr(world, actor)["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == DETAIL_APPROVE_HOST_ONLY


def test_AZ8_approve_report_존재하지_않는_리포트는_404(client, lone):
    res = client.post(f"/api/v1/reports/{NO_SUCH_ID}/approve", headers=lone["h"])
    assert res.status_code == 404
    assert res.json()["detail"] == "리포트를 찾을 수 없습니다"


# ═════════════════════════════════════════════════════════════════════════
# AZ-10 — WS `/record` 구독: 호스트·참여자 허용, 비참여자 거부 (계열 D, shim 대상)
# ═════════════════════════════════════════════════════════════════════════
class _RecordFakeSio:
    """register_record_namespace 등록용 최소 모사 — 핸들러 캡처 + room/emit 기록(test_mb2_ws_mid_fixes 와 동일 방식)."""

    def __init__(self) -> None:
        self.handlers: dict = {}
        self.sessions: dict = {}
        self.rooms: dict = {}
        self.emits: list = []

    def event(self, namespace=None):
        def deco(fn):
            self.handlers[(namespace, fn.__name__)] = fn
            return fn

        return deco

    def on(self, name, namespace=None):
        def deco(fn):
            self.handlers[(namespace, name)] = fn
            return fn

        return deco

    async def save_session(self, sid, data, namespace=None):
        self.sessions[sid] = data

    async def get_session(self, sid, namespace=None):
        return self.sessions.get(sid, {})

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get(sid, set()).discard(room)

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append({"event": event, "data": data, "room": room, "to": to})


def _token_of(user: dict) -> str:
    return user["h"]["Authorization"].split(" ", 1)[1]


def _ws_subscribe(user: dict, session_id: str) -> tuple[bool, list[str]]:
    """실제 /record connect → subscribe 핸들러를 거쳐 방 입장 여부와 emit 된 이벤트명을 돌려준다."""
    from app.ws import record_namespace

    fake = _RecordFakeSio()
    record_namespace.register_record_namespace(fake)
    sid = f"sid-{user['id']}"
    assert asyncio.run(fake.handlers[("/record", "connect")](sid, {}, {"token": _token_of(user)})) is True
    asyncio.run(fake.handlers[("/record", "subscribe")](sid, {"session_id": session_id}))
    joined = f"session:{session_id}" in fake.rooms.get(sid, set())
    return joined, [e["event"] for e in fake.emits]


@pytest.mark.parametrize("actor", ["host", "member"])
def test_AZ10_호스트와_참여자는_구독_허용(client, world, actor):
    joined, events = _ws_subscribe(getattr(world, actor), world.sid)
    assert joined is True
    assert events == ["subscribed"]


@pytest.mark.parametrize("actor", ["outsider", "other", "org_admin", "platform_admin"])
def test_AZ10_비참여자는_구독_거부(client, world, actor):
    """role(org_admin·platform_admin 포함)과 무관하게 호스트도 참여자도 아니면 거부."""
    joined, events = _ws_subscribe(getattr(world, actor), world.sid)
    assert joined is False
    assert events == []


def test_AZ10_존재하지_않는_세션은_거부(client, world):
    joined, events = _ws_subscribe(world.host, NO_SUCH_ID)
    assert (joined, events) == (False, [])


def test_AZ10_숨김_세션은_호스트도_거부(client, world):
    _set_session_fields(world.sid, hidden_at=datetime.now(timezone.utc))
    joined, events = _ws_subscribe(world.host, world.sid)
    assert (joined, events) == (False, [])


def test_AZ10_제거된_참여자는_거부(client, world):
    _mark_participant(world.member_pid, removed_at=datetime.now(timezone.utc))
    joined, events = _ws_subscribe(world.member, world.sid)
    assert (joined, events) == (False, [])


def test_AZ10_authorize_subscribe_직접_호출_예외_계약(client, world):
    """`_authorize_subscribe` 는 판정 실패를 HTTPException 으로 올린다(핸들러가 삼켜 거부 처리)."""
    from app.ws import record_namespace

    record_namespace._authorize_subscribe(world.sid, world.host["id"])
    record_namespace._authorize_subscribe(world.sid, world.member["id"])
    with pytest.raises(HTTPException) as denied:
        record_namespace._authorize_subscribe(world.sid, world.outsider["id"])
    assert (denied.value.status_code, denied.value.detail) == (403, DETAIL_NO_ACCESS)
    with pytest.raises(HTTPException) as missing:
        record_namespace._authorize_subscribe(NO_SUCH_ID, world.host["id"])
    assert (missing.value.status_code, missing.value.detail) == (404, DETAIL_NOT_FOUND)


# ═════════════════════════════════════════════════════════════════════════
# TD3 인라인 호스트 판정 — 통합 대상 아님, 현행 응답만 박제한다
# ═════════════════════════════════════════════════════════════════════════

# ── set_speaking: 404 → 종료 상태 400 → 호스트 403 (순서가 9곳과 다르다) ──
def _speaking(client, w: World, headers: dict, sid: str | None = None, granted: bool = True):
    return client.post(
        f"/api/v1/sessions/{sid or w.sid}/participants/{w.member_pid}/speaking",
        json={"granted": granted},
        headers=headers,
    )


def test_TD3_set_speaking_비호스트는_403_전용_문구(client, world):
    res = _speaking(client, world, world.other["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == "발언권은 상담사만 부여/해제할 수 있습니다"


def test_TD3_set_speaking_종료_세션이면_비호스트도_403이_아니라_400(client, world):
    """9곳 헬퍼와 순서가 다른 지점 — 종료 상태 검사(400)가 호스트 검사(403)보다 먼저다."""
    _set_session_fields(world.sid, status="completed")
    res = _speaking(client, world, world.other["h"])
    assert res.status_code == 400
    assert res.json()["detail"] == "종료된 세션입니다"


def test_TD3_set_speaking_호스트도_종료_세션이면_400(client, world):
    _set_session_fields(world.sid, status="cancelled")
    res = _speaking(client, world, world.host["h"])
    assert res.status_code == 400
    assert res.json()["detail"] == "종료된 세션입니다"


def test_TD3_set_speaking_호스트는_통과(client, world):
    res = _speaking(client, world, world.host["h"])
    assert res.status_code == 200, res.text


@pytest.mark.parametrize("actor", _ADMIN_ACTORS)
def test_TD3_set_speaking_관리자_role_우회_없음(client, world, actor):
    res = _speaking(client, world, getattr(world, actor)["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == "발언권은 상담사만 부여/해제할 수 있습니다"


def test_TD3_set_speaking_없는_세션_404_잘못된_id_400(client, world):
    missing = _speaking(client, world, world.other["h"], sid=NO_SUCH_ID)
    assert (missing.status_code, missing.json()["detail"]) == (404, DETAIL_NOT_FOUND)
    bad = _speaking(client, world, world.other["h"], sid=BAD_ID)
    assert (bad.status_code, bad.json()["detail"]) == (400, DETAIL_BAD_ID)


# ── resolve_audio_sync_host: WS 호출용 서비스 함수(HTTP 아님) ──
DETAIL_AUDIO_SYNC = "상담사만 재생을 제어할 수 있습니다"


def test_TD3_resolve_audio_sync_host_호스트만_통과(client, world):
    from app.services import session_service

    db = _db()
    try:
        out = session_service.resolve_audio_sync_host(world.sid, world.host["id"], db)
    finally:
        db.close()
    assert out == {"session_id": world.sid, "status": "in_progress"}


@pytest.mark.parametrize("actor", ["other", "member", "org_admin", "platform_admin"])
def test_TD3_resolve_audio_sync_host_비호스트는_403(client, world, actor):
    from app.services import session_service

    db = _db()
    try:
        with pytest.raises(HTTPException) as err:
            session_service.resolve_audio_sync_host(world.sid, getattr(world, actor)["id"], db)
    finally:
        db.close()
    assert (err.value.status_code, err.value.detail) == (403, DETAIL_AUDIO_SYNC)


def test_TD3_resolve_audio_sync_host_미인증은_403_없는_세션은_404(client, world):
    from app.services import session_service

    db = _db()
    try:
        with pytest.raises(HTTPException) as anon:
            session_service.resolve_audio_sync_host(world.sid, None, db)
        with pytest.raises(HTTPException) as missing:
            session_service.resolve_audio_sync_host(NO_SUCH_ID, world.host["id"], db)
        with pytest.raises(HTTPException) as bad:
            session_service.resolve_audio_sync_host(BAD_ID, world.host["id"], db)
    finally:
        db.close()
    assert (anon.value.status_code, anon.value.detail) == (403, DETAIL_AUDIO_SYNC)
    assert (missing.value.status_code, missing.value.detail) == (404, DETAIL_NOT_FOUND)
    assert (bad.value.status_code, bad.value.detail) == (400, DETAIL_BAD_ID)


# ── video.py: platform_admin 우회가 있는 유일한 지점(라우트 인라인) ──
DETAIL_VIDEO_VIEW = "호스트 상담사만 영상을 조회할 수 있습니다"


@pytest.mark.parametrize("path", ["video/url", "video/stream"])
@pytest.mark.parametrize("actor", ["other", "org_admin", "member"])
def test_TD3_video_조회_비호스트는_403(client, world, path, actor):
    res = client.get(f"/api/v1/sessions/{world.sid}/{path}", headers=getattr(world, actor)["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == DETAIL_VIDEO_VIEW


def test_TD3_video_url_호스트와_platform_admin은_통과(client, world):
    for actor in ("host", "platform_admin"):
        res = client.get(f"/api/v1/sessions/{world.sid}/video/url", headers=getattr(world, actor)["h"])
        assert res.status_code == 200, (actor, res.text)
        assert res.json() == {"url": None}


def test_TD3_video_stream_platform_admin은_판정_통과_후_파일없음_404(client, world):
    res = client.get(f"/api/v1/sessions/{world.sid}/video/stream", headers=world.platform_admin["h"])
    assert res.status_code == 404
    assert res.json()["detail"] == "영상 파일이 없습니다"


@pytest.mark.parametrize("path", ["video/url", "video/stream"])
def test_TD3_video_조회_없는_세션_404_잘못된_id_400(client, world, path):
    missing = client.get(f"/api/v1/sessions/{NO_SUCH_ID}/{path}", headers=world.other["h"])
    assert (missing.status_code, missing.json()["detail"]) == (404, DETAIL_NOT_FOUND)
    bad = client.get(f"/api/v1/sessions/{BAD_ID}/{path}", headers=world.other["h"])
    assert (bad.status_code, bad.json()["detail"]) == (400, DETAIL_BAD_ID)


def test_TD3_video_조회_숨김_세션은_platform_admin도_404(client, world):
    _set_session_fields(world.sid, hidden_at=datetime.now(timezone.utc))
    res = client.get(f"/api/v1/sessions/{world.sid}/video/url", headers=world.platform_admin["h"])
    assert (res.status_code, res.json()["detail"]) == (404, DETAIL_NOT_FOUND)


# ── export_service.authorize: 비호스트 상담사에게 404(존재 은닉), role 별 별도 거부 ──
def _export_authorize(w: World, user_id: str, session_id: str | None = None):
    from app.services import export_service

    db = _db()
    try:
        return export_service.authorize(
            db, uuid.UUID(user_id), uuid.UUID(session_id or w.sid), uuid.UUID(w.member_pid)
        )
    finally:
        db.close()


def test_TD3_export_authorize_비호스트_상담사는_404_존재은닉(client, world):
    with pytest.raises(HTTPException) as err:
        _export_authorize(world, world.other["id"])
    assert (err.value.status_code, err.value.detail) == (404, "대상을 찾을 수 없습니다")


def test_TD3_export_authorize_없는_세션도_404(client, world):
    with pytest.raises(HTTPException) as err:
        _export_authorize(world, world.host["id"], NO_SUCH_ID)
    assert (err.value.status_code, err.value.detail) == (404, "대상을 찾을 수 없습니다")


def test_TD3_export_authorize_org_admin은_별도_403(client, world):
    with pytest.raises(HTTPException) as err:
        _export_authorize(world, world.org_admin["id"])
    assert err.value.status_code == 403
    assert err.value.detail == "기관 귀속 정책 미확정으로 기관 관리자의 데이터 다운로드는 지원하지 않습니다"


def test_TD3_export_authorize_client_role은_403(client, world):
    with pytest.raises(HTTPException) as err:
        _export_authorize(world, world.member["id"])
    assert (err.value.status_code, err.value.detail) == (403, "데이터 다운로드 권한이 없습니다")


@pytest.mark.parametrize("actor", ["host", "platform_admin"])
def test_TD3_export_authorize_호스트와_platform_admin은_판정_통과_후_진행중이면_409(client, world, actor):
    """platform_admin 은 호스트가 아니어도 세션 판정을 통과한다 — 이후 '종료된 세션만' 규칙에서 막힘."""
    with pytest.raises(HTTPException) as err:
        _export_authorize(world, getattr(world, actor)["id"])
    assert (err.value.status_code, err.value.detail) == (409, "종료된 세션만 다운로드할 수 있습니다")


# ── _can_access_report: 호스트 OR 같은 기관 org_admin OR 세션 참여자 (9곳과 다른 의미) ──
@pytest.fixture
def report_world(client, world) -> tuple[World, str]:
    return world, _make_report(world.sid, world.host["id"])


def test_TD3_report_get_호스트와_같은_기관_org_admin은_통과(client, report_world):
    w, rid = report_world
    for actor in ("host", "org_admin"):
        res = client.get(f"/api/v1/reports/{rid}", headers=getattr(w, actor)["h"])
        assert res.status_code == 200, (actor, res.text)


@pytest.mark.parametrize("actor", ["other", "platform_admin"])
def test_TD3_report_get_무관한_상담사와_platform_admin은_403(client, report_world, actor):
    w, rid = report_world
    res = client.get(f"/api/v1/reports/{rid}", headers=getattr(w, actor)["h"])
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_NO_ACCESS)


def test_TD3_report_get_다른_기관_org_admin은_403(client, report_world):
    w, rid = report_world
    foreign = _make_user("az-foreign-admin@test.com", "org_admin", _make_org("특성화 기관 F"))
    res = client.get(f"/api/v1/reports/{rid}", headers=foreign["h"])
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_NO_ACCESS)


def test_TD3_report_get_참여자_client는_접근판정은_통과하나_상담사_리포트는_막힌다(client, report_world):
    """_can_access_report 는 참여자를 통과시키지만, counselor 리포트는 뒤의 type 검사에서 같은 문구로 403."""
    w, rid = report_world
    res = client.get(f"/api/v1/reports/{rid}", headers=w.member["h"])
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_NO_ACCESS)


def test_TD3_report_update_호스트와_같은_기관_org_admin은_통과(client, report_world):
    w, rid = report_world
    for actor in ("host", "org_admin"):
        res = client.put(f"/api/v1/reports/{rid}", json={"content": {"k": actor}}, headers=getattr(w, actor)["h"])
        assert res.status_code == 200, (actor, res.text)


def test_TD3_report_update_무관한_상담사는_403_수정_문구(client, report_world):
    w, rid = report_world
    res = client.put(f"/api/v1/reports/{rid}", json={"content": {}}, headers=w.other["h"])
    assert (res.status_code, res.json()["detail"]) == (403, "host 상담사만 수정 가능합니다")


def test_TD3_report_update_platform_admin은_라우트_role_가드에서_403(client, report_world):
    w, rid = report_world
    res = client.put(f"/api/v1/reports/{rid}", json={"content": {}}, headers=w.platform_admin["h"])
    assert (res.status_code, res.json()["detail"]) == (403, "이 작업을 수행할 권한이 없습니다")


def test_TD3_report_update_다른_상담사의_세션에_참여자로_들어간_상담사는_서비스_판정을_통과한다(client, report_world):
    """현행 관찰 박제(이상 동작 후보): 참여자 분기 때문에 호스트가 아닌 참여 상담사도 리포트를 수정할 수 있다."""
    w, rid = report_world
    _add_participant(w.sid, w.other["id"])
    res = client.put(f"/api/v1/reports/{rid}", json={"content": {"by": "participant-counselor"}}, headers=w.other["h"])
    assert res.status_code == 200, res.text


def test_TD3_report_pdf_require_report_host_비호스트는_403_계열A_문구(client, report_world):
    w, rid = report_world
    res = client.get(f"/api/v1/reports/{rid}/pdf", headers=w.other["h"])
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_HOST_ONLY)


def test_TD3_report_pdf_호스트는_판정_통과_후_미승인이면_409(client, report_world):
    w, rid = report_world
    res = client.get(f"/api/v1/reports/{rid}/pdf", headers=w.host["h"])
    assert res.status_code == 409

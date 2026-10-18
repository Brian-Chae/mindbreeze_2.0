"""SDD-211 A1 — session_authz 단위 테스트 (verify AZ-9).

액션 × {호스트, 비호스트, 참여자, 비참여자} 매트릭스에서 정책(rule·deny_detail·require_active_org)과
실제 동작이 일치하는지 확인한다. HTTP 계층 동작은 `test_sdd211_authz_characterization.py` 가 박제한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.services.session_authz import (
    DENY_EMAIL_INVITE,
    DENY_HOST_ONLY,
    DENY_NO_ACCESS,
    POLICIES,
    Rule,
    SessionAction,
    authorize_session,
    get_session_authorized,
)

HOST_ORG_ACTIONS = {
    SessionAction.SESSION_UPDATE,
    SessionAction.SESSION_DELETE,
    SessionAction.SESSION_TRANSITION,
    SessionAction.SESSION_NEW_RUN,
    SessionAction.SESSION_DUPLICATE,
    SessionAction.SESSION_SAVE_TEMPLATE,
    SessionAction.SESSION_CHAT_TOGGLE,
    SessionAction.PARTICIPANT_INVITE,
    SessionAction.PARTICIPANT_REMOVE,
    SessionAction.PARTICIPANT_REMIND,
    SessionAction.MARKER_ADD,
    SessionAction.LIVE_METRICS_READ,
    SessionAction.EEG_ROLLUP_READ,
    SessionAction.LIVEKIT_TOKEN_ISSUE,
    SessionAction.REPORT_CHOICE_SUMMARY_READ,
    SessionAction.RESEARCH_CONSENT_SUMMARY_READ,
}
HOST_PLAIN_ACTIONS = {
    SessionAction.RECORD_UPDATE,
    SessionAction.AUDIO_RECORD,
    SessionAction.VIDEO_RECORD,
    SessionAction.REPORT_GENERATE,
}
MEMBER_ACTIONS = {
    SessionAction.SESSION_VIEW,
    SessionAction.SESSION_CHAT_ROOM_VIEW,
    SessionAction.SESSION_JOIN,
    SessionAction.RECORD_VIEW,
    SessionAction.TRANSCRIPT_VIEW,
    SessionAction.REPORT_STATUS_VIEW,
    SessionAction.RECORD_SUBSCRIBE,
}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


@pytest.fixture
def world(client):
    """호스트·비호스트·참여자·비참여자와 세션 1개. `client` 는 인메모리 DB 를 열기 위해 요청한다."""
    from app.models.organization import Organization
    from app.models.session import Session, SessionParticipant
    from app.models.user import User

    db = _db()
    try:
        org = Organization(name="authz 단위 기관", org_code="AZU1")
        db.add(org)
        db.flush()

        def _user(email: str, role: str, org_id=None) -> User:
            u = User(
                email=email, password_hash="!", name=email.split("@")[0], role=role,
                status="active", verified_tier="email", org_id=org_id,
            )
            db.add(u)
            db.flush()
            return u

        host = _user("azu-host@test.com", "counselor", org.id)
        other = _user("azu-other@test.com", "counselor")
        member = _user("azu-member@test.com", "client")
        outsider = _user("azu-outsider@test.com", "client")
        s = Session(
            type="meditation", status="scheduled", host_id=host.id, organization_id=org.id,
            duration_min=30, title="단위", participant_mode="group", max_participants=5,
        )
        db.add(s)
        db.flush()
        db.add(SessionParticipant(session_id=s.id, user_id=member.id))
        db.commit()
        return {
            "sid": str(s.id), "org_id": org.id, "host": str(host.id), "other": str(other.id),
            "member": str(member.id), "outsider": str(outsider.id),
        }
    finally:
        db.close()


def _deactivate(org_id) -> None:
    from app.models.organization import Organization

    db = _db()
    try:
        db.query(Organization).filter(Organization.id == org_id).one().deactivated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def test_AZ9_정책표는_모든_액션을_빠짐없이_정의한다():
    assert set(POLICIES) == set(SessionAction)
    assert HOST_ORG_ACTIONS | HOST_PLAIN_ACTIONS | {SessionAction.EMAIL_INVITE_MANAGE} | MEMBER_ACTIONS == set(SessionAction)


@pytest.mark.parametrize("action", sorted(HOST_ORG_ACTIONS, key=lambda a: a.value))
def test_AZ9_정책표_계열B_호스트전용_기관검사(action):
    p = POLICIES[action]
    assert (p.rule, p.deny_detail, p.require_active_org) == (Rule.HOST, DENY_HOST_ONLY, True)


@pytest.mark.parametrize("action", sorted(HOST_PLAIN_ACTIONS, key=lambda a: a.value))
def test_AZ9_정책표_계열A_호스트전용_기관검사없음(action):
    p = POLICIES[action]
    assert (p.rule, p.deny_detail, p.require_active_org) == (Rule.HOST, DENY_HOST_ONLY, False)


def test_AZ9_정책표_계열C_이메일_초대_문구_상이():
    p = POLICIES[SessionAction.EMAIL_INVITE_MANAGE]
    assert (p.rule, p.deny_detail, p.require_active_org) == (Rule.HOST, DENY_EMAIL_INVITE, False)
    assert p.validate_actor_before_lookup is True


@pytest.mark.parametrize("action", sorted(MEMBER_ACTIONS, key=lambda a: a.value))
def test_AZ9_정책표_계열D_호스트_또는_참여자(action):
    p = POLICIES[action]
    assert (p.rule, p.deny_detail, p.require_active_org) == (Rule.HOST_OR_PARTICIPANT, DENY_NO_ACCESS, False)


@pytest.mark.parametrize("action", sorted(SessionAction, key=lambda a: a.value))
def test_AZ9_매트릭스_호스트_비호스트_참여자_비참여자(world, action):
    policy = POLICIES[action]
    db = _db()
    try:
        # 호스트: 항상 통과(기관 활성)
        assert get_session_authorized(db, world["sid"], world["host"], action).id == uuid.UUID(world["sid"])

        # 비호스트·비참여자: 항상 403, 정책의 deny_detail
        for who in ("other", "outsider"):
            with pytest.raises(HTTPException) as e:
                get_session_authorized(db, world["sid"], world[who], action)
            assert (e.value.status_code, e.value.detail) == (403, policy.deny_detail)

        # 참여자: 계열 D 만 통과, 호스트 전용은 403
        if policy.rule is Rule.HOST_OR_PARTICIPANT:
            assert get_session_authorized(db, world["sid"], world["member"], action).id == uuid.UUID(world["sid"])
        else:
            with pytest.raises(HTTPException) as e:
                get_session_authorized(db, world["sid"], world["member"], action)
            assert (e.value.status_code, e.value.detail) == (403, policy.deny_detail)
    finally:
        db.close()


@pytest.mark.parametrize("action", sorted(SessionAction, key=lambda a: a.value))
def test_AZ9_에러_우선순위_400_404_그리고_409는_호스트에게만(world, action):
    policy = POLICIES[action]
    db = _db()
    try:
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, "not-a-uuid", world["host"], action)
        assert (e.value.status_code, e.value.detail) == (400, "잘못된 ID 형식입니다")
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, str(uuid.uuid4()), world["outsider"], action)
        assert (e.value.status_code, e.value.detail) == (404, "세션을 찾을 수 없습니다")
    finally:
        db.close()

    _deactivate(world["org_id"])
    db = _db()
    try:
        # 기관 비활성: 비호스트는 409 가 아니라 403(권한이 기관 검사보다 먼저)
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, world["sid"], world["outsider"], action)
        assert e.value.status_code == 403
        # 호스트: 계열 B 만 409, 나머지는 통과
        if policy.require_active_org:
            with pytest.raises(HTTPException) as e:
                get_session_authorized(db, world["sid"], world["host"], action)
            assert (e.value.status_code, e.value.detail) == (409, "비활성화된 기관에서는 이 작업을 수행할 수 없습니다")
        else:
            assert get_session_authorized(db, world["sid"], world["host"], action).id == uuid.UUID(world["sid"])
    finally:
        db.close()


def test_AZ9_이메일_초대는_요청자_id_형식_오류도_세션_조회_전에_400(world):
    db = _db()
    try:
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, str(uuid.uuid4()), "not-a-uuid", SessionAction.EMAIL_INVITE_MANAGE)
        assert (e.value.status_code, e.value.detail) == (400, "잘못된 ID 형식입니다")
    finally:
        db.close()


def test_AZ9_authorize_session은_로드한_세션에_판정만_한다(world):
    from app.models.session import Session

    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(world["sid"])).one()
        assert authorize_session(db, world["host"], s, SessionAction.REPORT_GENERATE) is s
        with pytest.raises(HTTPException) as e:
            authorize_session(db, world["other"], s, SessionAction.REPORT_GENERATE)
        assert (e.value.status_code, e.value.detail) == (403, DENY_HOST_ONLY)
    finally:
        db.close()


def test_AZ9_role_우회_없음_관리자도_호스트가_아니면_403(world):
    from app.models.user import User

    db = _db()
    try:
        for role in ("org_admin", "platform_admin"):
            u = User(
                email=f"azu-{role}@test.com", password_hash="!", name=role, role=role,
                status="active", verified_tier="email",
            )
            db.add(u)
            db.commit()
            with pytest.raises(HTTPException) as e:
                get_session_authorized(db, world["sid"], str(u.id), SessionAction.SESSION_UPDATE)
            assert (e.value.status_code, e.value.detail) == (403, DENY_HOST_ONLY)
    finally:
        db.close()


def test_AZ9_숨김_세션은_404_제거된_참여자는_403(world):
    from app.models.session import Session, SessionParticipant

    db = _db()
    try:
        p = db.query(SessionParticipant).filter(SessionParticipant.user_id == uuid.UUID(world["member"])).one()
        p.removed_at = datetime.now(timezone.utc)
        db.commit()
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, world["sid"], world["member"], SessionAction.SESSION_VIEW)
        assert (e.value.status_code, e.value.detail) == (403, DENY_NO_ACCESS)

        s = db.query(Session).filter(Session.id == uuid.UUID(world["sid"])).one()
        s.hidden_at = datetime.now(timezone.utc)
        db.commit()
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, world["sid"], world["host"], SessionAction.SESSION_UPDATE)
        assert (e.value.status_code, e.value.detail) == (404, "세션을 찾을 수 없습니다")
    finally:
        db.close()

"""부모 귀속·현재 소속·고지에 따른 명상 접근 판정."""

from uuid import UUID
from fastapi import HTTPException
from app.config import settings
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.organization import Organization
from app.models.session import SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership


def active_membership(db, user_id, org_id, role=None):
    query = (
        db.query(UserOrgMembership)
        .join(User, User.id == UserOrgMembership.user_id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.user_id == user_id,
            UserOrgMembership.org_id == org_id,
            UserOrgMembership.status == "active",
            User.status == "active",
            Organization.deactivated_at.is_(None),
        )
    )
    if role:
        query = query.filter(UserOrgMembership.role == role)
    return query.first()


def class_role(db, actor, cls):
    if actor is None or actor.status != "active":
        return None
    if active_membership(db, actor.id, cls.organization_id):
        if actor.role == "org_admin" and active_membership(
            db, actor.id, cls.organization_id, "org_admin"
        ):
            return "org_admin"
        instructor = (
            db.query(ClassInstructor)
            .filter(
                ClassInstructor.class_id == cls.id,
                ClassInstructor.user_id == actor.id,
                ClassInstructor.status == "active",
            )
            .first()
        )
        if (
            instructor
            and actor.role == "counselor"
            and active_membership(db, actor.id, cls.organization_id, "counselor")
        ):
            return instructor.role
    if (
        cls.status != "draft"
        and db.query(ClassMember)
        .filter(
            ClassMember.class_id == cls.id,
            ClassMember.user_id == actor.id,
            ClassMember.status == "active",
        )
        .first()
    ):
        return "member"
    return None


def authorize_class_action(db, actor, cls, action):
    role = class_role(db, actor, cls)
    if role is None or (
        role == "guest" and action not in ("host_request", "host_resolve")
    ):
        raise HTTPException(404, detail={"code": "class_not_found"})
    if action in ("host_request", "host_resolve"):
        if role not in ("lead", "assistant", "guest", "org_admin"):
            raise HTTPException(403, detail={"code": "class_action_forbidden"})
        return role
    allowed = (
        ("lead", "org_admin")
        if action == "manage"
        else (
            ("lead", "assistant", "org_admin")
            if action == "invite"
            else ("lead", "assistant", "org_admin", "member")
        )
    )
    if role not in allowed:
        raise HTTPException(403, detail={"code": "class_action_forbidden"})
    return role


def can_read_team_material(db, user_id, session):
    if not settings.class_team_read_enabled or not session.class_id:
        return False
    cls = db.query(Class).filter(Class.id == session.class_id).first()
    actor = db.query(User).filter(User.id == UUID(str(user_id))).first()
    if not cls or class_role(db, actor, cls) not in ("lead", "assistant"):
        return False
    from app.services.report_scope import scope_for_session

    scope = scope_for_session(session.id, db)
    included = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id.in_(scope.included_ids))
        .all()
    )
    return bool(included) and all(
        p.report_notice_version == "class-team-v1"
        and p.report_notice_ack_at is not None
        for p in included
    )


def admin_can_read_meditation_report(db, user, session):
    if (
        not session
        or session.type != "meditation"
        or not session.class_id
        or user.role != "org_admin"
    ):
        return False
    cls = db.query(Class).filter(Class.id == session.class_id).first()
    return bool(
        cls
        and cls.organization_attribution_known
        and active_membership(db, user.id, cls.organization_id, "org_admin")
    )


_RAW_FIELDS = frozenset(
    {
        "transcript",
        "transcript_segments",
        "raw_text",
        "segments",
        "audio",
        "video",
        "audio_s3_key",
        "video_s3_key",
        "s3_key",
        "url",
        "pdf_url",
        "download_url",
        "edit_history",
        "markers",
        "error",
        "generation_error",
    }
)


def without_raw_material(value):
    """팀/관리자 읽기의 원문·미디어·편집 이력 투영. 입력 스냅샷은 바꾸지 않는다."""
    if isinstance(value, dict):
        return {
            key: without_raw_material(item)
            for key, item in value.items()
            if key not in _RAW_FIELDS and not key.endswith(("_url", "_s3_key"))
        }
    if isinstance(value, list):
        return [without_raw_material(item) for item in value]
    return value


def project_report_for_viewer(result, viewer, session):
    if (
        viewer
        and session
        and (
            viewer.role == "org_admin"
            or (viewer.role == "counselor" and viewer.id != session.host_id)
        )
    ):
        projected = without_raw_material(result)
        projected["pdf_url"] = None
        projected["report_email"] = None
        projected["generation_error"] = None
        return projected
    return result


def can_observe(db, user_id, session):
    if (
        not settings.class_team_read_enabled
        or not session.class_id
        or session.status not in ("open", "in_progress")
    ):
        return False
    cls = (
        db.query(Class)
        .filter(Class.id == session.class_id, Class.status == "active")
        .first()
    )
    actor = db.query(User).filter(User.id == UUID(str(user_id))).first()
    if (
        not cls
        or class_role(db, actor, cls) not in ("lead", "assistant")
        or session.host_id == actor.id
    ):
        return False
    # 라이브는 보고서 포함 여부와 무관하게 실제 입장한 모든 회원의 고지를 확인한다.
    present = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == session.id,
            SessionParticipant.is_waitlisted.is_(False),
            SessionParticipant.entered_at.isnot(None),
        )
        .all()
    )
    return bool(present) and all(
        p.report_notice_version == "class-team-v1" and p.report_notice_ack_at
        for p in present
    )


def observer_snapshot(session):
    return {
        "session_id": str(session.id),
        "status": session.status,
        "state_version": session.state_version,
        "started_at": session.started_at,
        "role": "observer",
    }


def observe_session(db, user_id, class_id, session_id):
    from datetime import timedelta
    from app.models.session import Session
    from livekit import api

    session = (
        db.query(Session)
        .filter(
            Session.id == UUID(str(session_id)), Session.class_id == UUID(str(class_id))
        )
        .first()
    )
    if not session or not can_observe(db, user_id, session):
        raise HTTPException(403, detail={"code": "observation_forbidden"})
    if not session.webrtc_room_id:
        raise HTTPException(409, detail={"code": "room_not_ready"})
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(f"observer:{user_id}")
        .with_name("참관 지도사")
        .with_ttl(timedelta(seconds=60))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=str(session.webrtc_room_id),
                can_publish=False,
                can_publish_data=False,
                can_subscribe=True,
            )
        )
        .to_jwt()
    )
    return {
        "token": token,
        "room_name": str(session.webrtc_room_id),
        "snapshot": observer_snapshot(session),
    }


async def reconcile_observers(db, session, client=None):
    """연결된 참관자의 현재 권한을 확인해 LiveKit 서버에서 회수한다."""
    from livekit import api

    if not session.webrtc_room_id:
        return 0
    owned = client is None
    client = client or api.LiveKitAPI(
        settings.livekit_server_api_url, settings.livekit_api_key, settings.livekit_api_secret
    )
    count = 0
    try:
        room = str(session.webrtc_room_id)
        try:
            response = await client.room.list_participants(
                api.ListParticipantsRequest(room=room)
            )
        except api.TwirpError as exc:
            if exc.code == "not_found":
                return 0
            raise
        for participant in response.participants:
            identity = participant.identity
            try:
                if identity.startswith("observer:"):
                    allowed = can_observe(db, UUID(identity.split(":", 1)[1]), session)
                else:
                    from app.services.class_attendance_service import eligible_participant
                    ident = UUID(identity)
                    member = db.query(SessionParticipant).filter(SessionParticipant.session_id == session.id, (SessionParticipant.id == ident) | (SessionParticipant.user_id == ident)).first()
                    allowed = ident == session.host_id or (member is not None and not member.is_waitlisted and eligible_participant(db, member, allow_excused=False))
            except (ValueError, TypeError):
                if not identity.startswith("observer:"):
                    continue
                allowed = False
            if not allowed:
                try:
                    await client.room.remove_participant(
                        api.RoomParticipantIdentity(room=room, identity=identity)
                    )
                except api.TwirpError as exc:
                    if exc.code != "not_found":
                        raise
                count += 1
        return count
    finally:
        if owned:
            await client.aclose()


def queue_live_reconcile(db, class_id):
    """미디어 권한 회수도 도메인 커밋 이후 재시도할 수 있는 전달 의도로 남긴다."""
    from uuid import uuid4
    from app.models.class_scheduling import ClassEffect

    db.add(
        ClassEffect(
            class_id=class_id,
            kind="live_access_reconcile",
            effect_key=f"live:{class_id}:{uuid4()}",
            payload={},
        )
    )

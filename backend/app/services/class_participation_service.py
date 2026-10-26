"""수업 참여 스냅샷과 DB 기반 소켓 lease. 잠금 순서는 공통 편성 엔진과 같다."""
from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException
from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord
from app.models.class_program import ClassMember
from app.models.class_membership import SessionPresenceLease
from app.services.class_attendance_service import lock_participants

TTL_SECONDS = 90

def _now():
    return datetime.now(timezone.utc)

def lock_context(db, session_id, actor_id=None):
    row = db.get(Session, UUID(str(session_id)))
    if row is None:
        raise HTTPException(404, detail={'code':'session_not_found'})
    if row.class_id:
        from app.services.class_write_service import lock_class_session
        _, row = lock_class_session(db, row, actor_id)
    else:
        row = db.query(Session).filter_by(id=row.id).populate_existing().with_for_update().one()
    participants = lock_participants(db, row)
    return row, participants

def _expire(db, row, now):
    expired = db.query(SessionPresenceLease).filter(SessionPresenceLease.session_id == row.id, SessionPresenceLease.expires_at <= now).all()
    for lease in expired:
        db.delete(lease)
    if expired:
        row.participation_version = (row.participation_version or 0) + 1
    db.flush()

def build_snapshot(db, row, participants, now):
    """호출자가 회차·참가행 잠금을 가진 상태에서만 수집한다. 원문은 내보내지 않는다."""
    leases = db.query(SessionPresenceLease).filter(SessionPresenceLease.session_id == row.id, SessionPresenceLease.expires_at > now).all()
    record = db.query(SessionRecord).filter_by(session_id=row.id).first()
    state = record.subjective_state if record and isinstance(record.subjective_state, dict) else {}
    stored = state.get('participants') or {}
    result = []
    for p in participants:
        if p.is_waitlisted or p.superseded_by_participant_id or p.removed_at or p.waitlist_cancelled_at:
            continue
        member = db.get(ClassMember, p.member_id) if p.member_id else None
        before = (stored.get(str(p.id)) or {}).get('before')
        # 기존 NULL을 미작성으로 추정하지 않는다. 완료의 근거는 before 저장 내용이다.
        checkin = 'completed' if isinstance(before, dict) else ('not_completed' if p.checkin_state == 'not_completed' else 'unknown')
        expires = max((lease.expires_at for lease in leases if lease.participant_id == p.id), default=None)
        result.append({'participant_id':str(p.id), 'member_id':str(p.member_id) if p.member_id else None,
            'canonical_member_id':str(member.canonical_member_id or member.id) if member else None,
            'attendance_status':p.attendance_status, 'entered_at':p.entered_at.isoformat() if p.entered_at else None,
            'checkin_state':checkin, 'checkin_at':before.get('recorded_at') if isinstance(before, dict) else None,
            'presence_state':'connected' if expires else ('disconnected' if p.presence_seen_at else 'unknown'),
            'presence_expires_at':expires.isoformat() if expires else None})
    return {'session_id':str(row.id), 'participation_version':row.participation_version or 0,
        'generated_at':now.isoformat(), 'presence_ttl_seconds':TTL_SECONDS, 'participants':result}

def _authorize(db, row, user_id, credential=None, participant_id=None):
    if user_id:
        from app.models.user import User
        actor = db.get(User, UUID(str(user_id)))
        if actor is None or actor.status != 'active':
            raise HTTPException(403, detail={'code':'action_forbidden'})
    if user_id and str(row.host_id) == str(user_id):
        if row.class_id:
            from app.models.class_program import Class
            from app.services.class_instructor_service import validate_instructor
            validate_instructor(db, db.get(Class, row.class_id), UUID(str(user_id)), row.id)
        return None
    from app.services.session_service import resolve_participant_actor
    return resolve_participant_actor(row.id, db, current_user_id=user_id, entry_credential=credential, participant_id=participant_id)

def snapshot(db, class_id, session_id, user_id, *, entry_credential=None, member_credential=None, now=None):
    now = now or _now()
    try:
        row, participants = lock_context(db, session_id, user_id)
        if str(row.class_id) != str(class_id):
            raise HTTPException(404, detail={'code':'session_not_found'})
        if member_credential and not user_id:
            from app.services.class_guest_service import authenticate_guest, canonical_member_ids
            from app.services.class_attendance_service import require_eligible
            member, _ = authenticate_guest(db, class_id, member_credential, scope='activity', now=now)
            matches = [p for p in participants if p.member_id in canonical_member_ids(db, member) and not p.superseded_by_participant_id]
            if len(matches) != 1:
                raise HTTPException(403, detail={'code': 'action_forbidden'})
            own = matches[0]
            require_eligible(db, own, allow_excused=True)
        else:
            own = _authorize(db, row, user_id, entry_credential)
        _expire(db, row, now)
        result = build_snapshot(db, row, participants, now)
        if own is not None:
            result = {**result, 'participants':[p for p in result['participants'] if p['participant_id'] == str(own.id)]}
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise

def socket_update(db, socket_id, context, action, *, now=None):
    """sid와 인증된 서버 문맥만 사용한다. 클라이언트 heartbeat 본문은 사용하지 않는다."""
    now = now or _now()
    try:
        row, participants = lock_context(db, context['session_id'], context.get('user_id'))
        _expire(db, row, now)
        if action == 'leave':
            lease = db.query(SessionPresenceLease).filter_by(id=socket_id, session_id=row.id).first()
            if lease:
                db.delete(lease)
                row.participation_version = (row.participation_version or 0) + 1
        else:
            if context.get('role') == 'observer':
                return None
            own = _authorize(db, row, context.get('user_id'), context.get('entry_credential'), context.get('participant_id'))
            if own is not None:
                from app.services.class_attendance_service import require_eligible
                require_eligible(db, own, allow_excused=False)
                lease = db.get(SessionPresenceLease, socket_id)
                if lease and (lease.session_id != row.id or lease.participant_id != own.id):
                    raise HTTPException(403, detail={'code':'action_forbidden'})
                if lease is None:
                    lease = SessionPresenceLease(id=socket_id, session_id=row.id, participant_id=own.id)
                    db.add(lease)
                lease.last_seen_at, lease.expires_at = now, now + timedelta(seconds=TTL_SECONDS)
                own.presence_seen_at = now
                row.participation_version = (row.participation_version or 0) + 1
        db.flush()
        result = build_snapshot(db, row, participants, now)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise

def expire_due(db, *, now=None):
    """모든 워커가 같은 DB lease를 정리한다. 회차 잠금으로 버전을 직렬화한다."""
    now = now or _now()
    ids = [r[0] for r in db.query(SessionPresenceLease.session_id).filter(SessionPresenceLease.expires_at <= now).distinct().all()]
    results = []
    for sid in sorted(ids, key=str):
        try:
            row, participants = lock_context(db, sid)
            _expire(db, row, now)
            results.append(build_snapshot(db, row, participants, now))
            db.commit()
        except Exception:
            db.rollback()
            raise
    return results


# ===========================================================================
# SDD-246 T05 — v2 live command 업무 handler
#
# 모든 handler 는 T03 `apply_command` 가 쥔 회차 epoch 락·같은 트랜잭션 안에서 실행된다(commit/rollback 금지).
# 업무 전이는 기존 서비스 함수의 commit 없는 단계를 그대로 호출하고, 결과 상태는 outbox 로 emit 한다.
# commit 이후 부수효과(알림·LiveKit 권한 반영)는 `_after_commit` 에 모아 실행기가 commit 성공 뒤에만 돌린다.
# ===========================================================================
import logging as _logging
import uuid as _uuid
from typing import Any, Callable

from sqlalchemy import func as _func, select as _select

_live_log = _logging.getLogger(__name__)

_AFTER_COMMIT: dict[str, list[Callable[[], None]]] = {}


def pop_after_commit(command_id) -> list[Callable[[], None]]:
    return _AFTER_COMMIT.pop(str(command_id), [])


def _defer(ctx, fn: Callable[[], None]) -> None:
    _AFTER_COMMIT.setdefault(str(ctx.command.command_id), []).append(fn)


def live_actor_id(participant) -> _uuid.UUID:
    """ledger actor_id: 계정은 user_id, 게스트는 participant_id. REST/WS 가 같은 값을 써야 동일 command_id 가 중복으로 판정된다."""
    return participant.user_id or participant.id


def _reject_http(exc) -> "Any":
    from app.services.session_live_commands import CommandRejected

    detail = exc.detail
    if isinstance(detail, dict) and detail.get("code"):
        return CommandRejected(str(detail["code"]))
    return CommandRejected({400: "invalid_state", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict"}.get(exc.status_code, "rejected"))


def _handler(fn):
    """HTTPException(기존 서비스 규칙 위반)을 결정적 거절로 변환한다. 다른 예외는 그대로 올려 전체 롤백."""
    def wrapped(ctx):
        try:
            return fn(ctx)
        except HTTPException as exc:
            raise _reject_http(exc) from exc
    wrapped.__name__ = fn.__name__
    return wrapped


def next_entity_version(db, session_id, domain: str, entity_id: str) -> int:
    """outbox 에서 이 entity 의 마지막 버전 + 1. epoch 락 아래 호출되므로 경합이 없다."""
    from app.models.live_state import LiveOutbox

    cur = db.execute(_select(_func.max(LiveOutbox.entity_version)).where(
        LiveOutbox.session_id == session_id, LiveOutbox.domain == domain, LiveOutbox.entity_id == entity_id)).scalar_one()
    return int(cur or 0) + 1


def current_entity_version(db, session_id, domain: str, entity_id: str) -> int:
    return next_entity_version(db, session_id, domain, entity_id) - 1


def _aud(participant_id) -> list[str]:
    return ["host", f"member:{participant_id}"]


def _own(ctx):
    from app.models.session import SessionParticipant

    if ctx.actor.role != "member" or ctx.actor.participant_id is None:
        raise ctx_reject("forbidden")
    p = ctx.db.execute(_select(SessionParticipant).where(
        SessionParticipant.id == ctx.actor.participant_id, SessionParticipant.session_id == ctx.session.id)
        .with_for_update().execution_options(populate_existing=True)).scalar_one_or_none()
    if p is None or p.removed_at is not None or p.waitlist_cancelled_at is not None:
        raise ctx_reject("participant_not_found")
    return p


def ctx_reject(code: str, result: dict | None = None):
    from app.services.session_live_commands import CommandRejected

    return CommandRejected(code, result)


def _target(ctx):
    from app.models.session import SessionParticipant

    raw = ctx.command.target_id or ctx.command.payload.get("target_id")
    try:
        pid = _uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise ctx_reject("participant_not_found")
    p = ctx.db.execute(_select(SessionParticipant).where(
        SessionParticipant.id == pid, SessionParticipant.session_id == ctx.session.id)
        .with_for_update().execution_options(populate_existing=True)).scalar_one_or_none()
    if p is None or p.removed_at is not None:
        raise ctx_reject("participant_not_found")
    return p


def _require_host(ctx) -> None:
    """호스트 명령: 기존 규칙(세션 host + LIVE_METRICS_READ 인가)을 그대로 쓴다."""
    from app.services import session_service

    if ctx.actor.role == "system":
        return
    if not session_service._is_speaking_manager(ctx.session, str(ctx.actor.actor_id), ctx.db):
        raise ctx_reject("forbidden")


def _closed(session) -> bool:
    return session.status in ("completed", "cancelled")


def _speaking_event(ctx, p) -> None:
    from app.schemas.session_live_v2 import speaking_payload
    from app.services import session_service

    ver = next_entity_version(ctx.db, ctx.session.id, "speaking", str(p.id))
    ctx.emit(domain="speaking", event_type="speaking.changed", entity_id=str(p.id), entity_version=ver, audience=_aud(p.id),
             payload=speaking_payload(p.id, p.raise_hand, session_service._compute_can_publish(ctx.session, p), ver))
    ctx.entity_version = ver
    ctx.result = {"participant_id": str(p.id), "raise_hand": bool(p.raise_hand), "speaking": bool(p.speaking),
                  "can_publish": bool(session_service._compute_can_publish(ctx.session, p))}


def _attendance_of(session, p) -> str:
    if p.removed_at is not None:
        return "removed"
    if p.waitlist_cancelled_at is not None:
        return "left"
    if p.is_waitlisted or p.entered_at is None:
        return "waiting" if not p.is_waitlisted else "none"
    return "attending"


def _participation_event(ctx, p, *, connected: bool = False) -> None:
    from app.schemas.session_live_v2 import participation_payload

    ver = next_entity_version(ctx.db, ctx.session.id, "participation", str(p.id))
    ctx.emit(domain="participation", event_type="participant.changed", entity_id=str(p.id), entity_version=ver,
             audience=_aud(p.id), payload=participation_payload(p.id, _attendance_of(ctx.session, p), connected))


def _session_event(ctx) -> None:
    from app.schemas.session_live_v2 import session_state_payload

    s = ctx.session
    ver = int(s.state_version or 0) + 1_000 * 0
    ver = max(ver, next_entity_version(ctx.db, s.id, "session", str(s.id)))
    ctx.emit(domain="session", event_type="session.changed", entity_id=str(s.id), entity_version=ver, audience=["public"],
             payload=session_state_payload(s.status, s.started_at, s.ended_at))
    ctx.entity_version = ver


# ---- 입장·대기 ----

@_handler
def _h_entry_enter(ctx):
    from app.services.class_attendance_service import mark_entered

    p = _own(ctx)
    s = ctx.session
    if _closed(s):
        raise ctx_reject("session_ended")
    # 열리기 전(ready/scheduled) 사전 입장자는 대기만 한다 — 출석은 실제 라이브 입장에서 한 번만 기록(SDD-231).
    if not (s.class_id and s.status in ("ready", "scheduled")):
        mark_entered(ctx.db, s, p, ctx.now)
    _participation_event(ctx, p)
    ctx.entity_version = next_entity_version(ctx.db, s.id, "participation", str(p.id)) - 1
    ctx.result = {"participant_id": str(p.id), "attendance": _attendance_of(s, p)}


@_handler
def _h_entry_leave(ctx):
    from app.models.class_membership import SessionPresenceLease

    p = _target(ctx) if (ctx.command.target_id or ctx.command.payload.get("target_id")) else _own(ctx)
    if ctx.actor.role == "member" and p.id != ctx.actor.participant_id:
        raise ctx_reject("forbidden")
    if ctx.actor.role == "host":
        _require_host(ctx)
    leases = ctx.db.query(SessionPresenceLease).filter_by(session_id=ctx.session.id, participant_id=p.id).all()
    for lease in leases:
        ctx.db.delete(lease)
    if leases:
        ctx.session.participation_version = (ctx.session.participation_version or 0) + 1
    ctx.db.flush()
    _participation_event(ctx, p, connected=False)
    ctx.result = {"participant_id": str(p.id)}


@_handler
def _h_waiting_set_ready(ctx):
    from app.schemas.session_live_v2 import waiting_payload

    p = _own(ctx)
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    pl = ctx.command.payload
    if not isinstance(pl.get("ready"), bool):
        raise ctx_reject("invalid_payload")
    try:
        rev = int(pl.get("checkin_revision"))
    except (TypeError, ValueError):
        raise ctx_reject("invalid_payload")
    ver = next_entity_version(ctx.db, ctx.session.id, "waiting", str(p.id))
    last_rev = 0
    from app.models.live_state import LiveOutbox
    last = ctx.db.execute(_select(LiveOutbox).where(LiveOutbox.session_id == ctx.session.id, LiveOutbox.domain == "waiting",
                                                    LiveOutbox.entity_id == str(p.id)).order_by(LiveOutbox.revision.desc()).limit(1)).scalar_one_or_none()
    if last is not None:
        last_rev = int((last.payload or {}).get("checkin_revision") or 0)
    if rev < last_rev:  # 오래된 체크인 응답이 새 상태를 덮지 못한다
        raise ctx_reject("checkin_revision_stale", {"checkin_revision": str(last_rev)})
    ctx.emit(domain="waiting", event_type="waiting.changed", entity_id=str(p.id), entity_version=ver, audience=_aud(p.id),
             payload=waiting_payload(p.id, pl["ready"], rev, p.waitlist_position if p.is_waitlisted else None))
    ctx.entity_version = ver
    ctx.result = {"participant_id": str(p.id), "ready": pl["ready"], "checkin_revision": str(rev)}


@_handler
def _h_waiting_remind(ctx):
    from app.models.session import SessionParticipant
    from app.models.live_state import LiveOutbox

    _require_host(ctx)
    scope = ctx.command.payload.get("target_scope")
    if scope not in ("all_waiting", "not_ready"):
        raise ctx_reject("invalid_payload")
    rows = ctx.db.execute(_select(SessionParticipant).where(
        SessionParticipant.session_id == ctx.session.id, SessionParticipant.removed_at.is_(None),
        SessionParticipant.waitlist_cancelled_at.is_(None), SessionParticipant.is_waitlisted.is_(False))).scalars().all()
    targets = []
    for p in rows:
        if scope == "not_ready":
            last = ctx.db.execute(_select(LiveOutbox).where(LiveOutbox.session_id == ctx.session.id, LiveOutbox.domain == "waiting",
                                                            LiveOutbox.entity_id == str(p.id)).order_by(LiveOutbox.revision.desc()).limit(1)).scalar_one_or_none()
            if last is not None and (last.payload or {}).get("ready"):
                continue
        targets.append(str(p.id))
    # 알림은 상태가 아니다 — event 계약에 kind 가 없으므로 outbox 에 쓰지 않고 commit 후 대상 본인 room 에만 보낸다.
    ctx.result = {"targets": str(len(targets))}
    sid = str(ctx.session.id)
    _defer(ctx, lambda: _notify_remind(sid, targets))


def _notify_remind(session_id: str, targets: list[str]) -> None:
    from app.ws import session_live_namespace as ns

    for pid in targets:
        ns.emit_to_room("waiting_room_reminder", {
            "session_id": session_id,
            "message": "상담사가 준비 상태 확인을 부탁했어요. 설문·링크밴드·기기를 확인해 주세요. 건너뛰어도 괜찮아요."},
            ns.room_audience(session_id, f"member:{pid}"))


@_handler
def _h_waitlist_cancel(ctx):
    from app.services import session_service

    p = _own(ctx)
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    if p.waitlist_cancelled_at is not None:
        ctx.result = {"participant_id": str(p.id), "changed": False}
        return
    if not p.is_waitlisted:
        raise ctx_reject("not_waitlisted")
    session_service.apply_waitlist_cancel(ctx.session, p, ctx.db)
    _participation_event(ctx, p)
    ctx.result = {"participant_id": str(p.id), "changed": True}


@_handler
def _h_waitlist_promote(ctx):
    from app.services import session_service

    _require_host(ctx)
    p = _target(ctx)
    if p.is_waitlisted and session_service._has_capacity(ctx.session, ctx.db):
        p.is_waitlisted = False
        p.waitlist_position = None
        ctx.db.flush()
        session_service._renumber_waitlist(ctx.session, ctx.db)
    elif p.is_waitlisted:
        raise ctx_reject("session_capacity")
    _participation_event(ctx, p)
    ctx.result = {"participant_id": str(p.id), "changed": True}


# ---- 손들기·발언권 ----

@_handler
def _h_hand_set(ctx):
    p = _own(ctx)
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    raised = ctx.command.payload.get("raised")
    if not isinstance(raised, bool):
        raise ctx_reject("invalid_payload")
    if raised and p.is_waitlisted:
        raise ctx_reject("participant_waitlisted")
    if bool(p.raise_hand) == raised:  # 멱등: 이미 같은 상태면 새 event 를 만들지 않는다
        ctx.result = {"participant_id": str(p.id), "raise_hand": raised, "changed": False}
        return
    p.raise_hand = raised
    ctx.db.flush()
    _speaking_event(ctx, p)


@_handler
def _h_hand_lower(ctx):
    _require_host(ctx)
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    p = _target(ctx)
    if not p.raise_hand:
        ctx.result = {"participant_id": str(p.id), "raise_hand": False, "changed": False}
        return
    p.raise_hand = False
    ctx.db.flush()
    _speaking_event(ctx, p)


@_handler
def _h_speaking_set(ctx):
    from app.services import session_service

    _require_host(ctx)
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    p = _target(ctx)
    pl = ctx.command.payload
    if not isinstance(pl.get("can_publish"), bool):
        raise ctx_reject("invalid_payload")
    if p.is_waitlisted:
        raise ctx_reject("participant_waitlisted")
    expected = pl.get("expected_grant_version")  # v1 호환 호출은 없다 → 무조건부
    if expected is not None:
        cur = current_entity_version(ctx.db, ctx.session.id, "speaking", str(p.id))
        if int(expected) != cur:
            raise ctx_reject("entity_version_conflict", {"grant_version": str(cur)})
    granted = pl["can_publish"]
    p.speaking = granted
    if granted:
        p.raise_hand = False
    ctx.db.flush()
    _speaking_event(ctx, p)
    can_publish = bool(session_service._compute_can_publish(ctx.session, p))
    room, pid = str(ctx.session.webrtc_room_id or ""), str(p.id)
    if room:  # 실제 LiveKit 권한까지 commit 뒤에 반영(회수 포함). 실패는 재시도 가능하도록 로그 + 호출자 재호출.
        _defer(ctx, lambda: apply_livekit_publish_permission(room, pid, can_publish))


def apply_livekit_publish_permission(room: str, identity: str, can_publish: bool) -> bool:
    """LiveKit 서버에서 참가자의 송출 권한을 갱신한다(동기 래퍼). 실패하면 False — 호출자는 로그만 남긴다."""
    import asyncio
    from livekit import api
    from app.config import settings

    async def _run() -> None:
        client = api.LiveKitAPI(settings.livekit_host, settings.livekit_api_key, settings.livekit_api_secret)
        try:
            await client.room.update_participant(api.UpdateParticipantRequest(
                room=room, identity=identity,
                permission=api.ParticipantPermission(can_subscribe=True, can_publish=can_publish, can_publish_data=can_publish)))
        finally:
            await client.aclose()

    try:
        asyncio.run(_run())
        return True
    except Exception:  # noqa: BLE001 — 권한 회수 실패를 삼키지 않고 로그로 남긴다(상태는 DB 정본)
        _live_log.warning("[live-v2] LiveKit 권한 반영 실패 room=%s identity=%s", room, identity, exc_info=True)
        return False


# ---- 신호 ----

SIGNAL_DEFAULT_TTL_MS = 5_000
SIGNAL_MAX_TTL_MS = 30_000
SIGNAL_TYPES = ("following", "difficult", "resting")


@_handler
def _h_signal_send(ctx):
    from app.schemas.session_live_v2 import ms_of

    p = _own(ctx)
    pl = ctx.command.payload
    if pl.get("signal_type") not in SIGNAL_TYPES or pl.get("target_scope") != "host":
        raise ctx_reject("invalid_payload")
    ttl = pl.get("ttl_ms", SIGNAL_DEFAULT_TTL_MS)
    if not isinstance(ttl, int) or isinstance(ttl, bool) or not (1000 <= ttl <= SIGNAL_MAX_TTL_MS):
        raise ctx_reject("invalid_payload")
    if _closed(ctx.session):
        raise ctx_reject("session_ended")
    ver = next_entity_version(ctx.db, ctx.session.id, "signal", str(p.id))
    signal_id = str(_uuid.uuid4())
    expires = ms_of(ctx.now) + ttl
    ctx.emit(domain="signal", event_type="signal.changed", entity_id=str(p.id), entity_version=ver, audience=_aud(p.id),
             payload={"signal_id": signal_id, "participant_id": str(p.id), "signal_type": pl["signal_type"], "expires_at_ms": expires})
    ctx.entity_version = ver
    ctx.result = {"signal_id": signal_id, "expires_at_ms": str(expires)}


@_handler
def _h_signal_clear(ctx):
    from app.models.live_state import LiveOutbox
    from app.schemas.session_live_v2 import tombstone_payload

    p = _own(ctx)
    sid = ctx.command.payload.get("signal_id")
    last = ctx.db.execute(_select(LiveOutbox).where(LiveOutbox.session_id == ctx.session.id, LiveOutbox.domain == "signal",
                                                    LiveOutbox.entity_id == str(p.id)).order_by(LiveOutbox.revision.desc()).limit(1)).scalar_one_or_none()
    if last is None or last.event_type != "signal.changed" or (last.payload or {}).get("signal_id") != sid:
        raise ctx_reject("signal_not_found")
    ver = int(last.entity_version or 0) + 1
    ctx.emit(domain="signal", event_type="signal.expired", entity_id=str(p.id), entity_version=ver, audience=_aud(p.id),
             payload=tombstone_payload(p.id, ver))
    ctx.entity_version = ver
    ctx.result = {"signal_id": str(sid)}


# ---- 음원·채팅·세션 전이 ----

AUDIO_STATUSES = ("open", "in_progress")


@_handler
def _h_audio_set(ctx):
    from app.schemas.session_live_v2 import ms_of
    from app.services import class_audio_service

    _require_host(ctx)
    pl = ctx.command.payload
    action = pl.get("action")
    if action not in ("play", "pause", "seek", "stop"):
        raise ctx_reject("invalid_payload")
    if ctx.session.status not in AUDIO_STATUSES:
        raise ctx_reject("session_not_active")
    track = pl.get("track_id")
    if action == "play" and not class_audio_service.is_known_track(track):
        raise ctx_reject("unknown_track")
    pos = pl.get("position_ms")
    if not isinstance(pos, int) or isinstance(pos, bool) or not (0 <= pos <= 24 * 3600 * 1000):
        raise ctx_reject("invalid_payload")
    cur = current_entity_version(ctx.db, ctx.session.id, "audio", str(ctx.session.id))
    expected = pl.get("expected_revision")
    if expected is not None and int(expected) != cur:
        raise ctx_reject("entity_version_conflict", {"revision": str(cur)})
    ver = cur + 1
    ctx.emit(domain="audio", event_type="audio.changed", entity_id=str(ctx.session.id), entity_version=ver, audience=["public"],
             payload={"track_id": track, "action": action, "position_ms": pos, "server_anchor_ms": ms_of(ctx.now), "rate": 1.0,
                      "revision": str(ver)})
    ctx.entity_version = ver
    ctx.result = {"revision": str(ver)}


@_handler
def _h_chat_set_enabled(ctx):
    from app.schemas.session_live_v2 import policy_payload
    from app.services import session_service
    from app.services.session_authz import SessionAction, get_session_authorized

    enabled = ctx.command.payload.get("enabled")
    if not isinstance(enabled, bool):
        raise ctx_reject("invalid_payload")
    get_session_authorized(ctx.db, str(ctx.session.id), str(ctx.actor.actor_id), SessionAction.SESSION_CHAT_TOGGLE)
    ctx.session.chat_enabled = enabled
    ctx.db.flush()
    ver = next_entity_version(ctx.db, ctx.session.id, "policy", str(ctx.session.id))
    ctx.emit(domain="policy", event_type="policy.changed", entity_id=str(ctx.session.id), entity_version=ver, audience=["public"],
             payload=policy_payload(enabled))
    ctx.entity_version = ver
    ctx.result = {"chat_enabled": enabled}
    sid = ctx.session.id

    def _ensure_room() -> None:  # 방 개설은 자체 commit 이 있으므로 commit 뒤에 한다
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            session_service.ensure_session_chat_room(sid, db)
        except Exception:  # noqa: BLE001
            _live_log.warning("[live-v2] 채팅방 개설 실패 session=%s", sid, exc_info=True)
        finally:
            db.close()

    _defer(ctx, _ensure_room)


def _make_transition_handler(action: str):
    @_handler
    def handler(ctx):
        from app.services import session_service
        from app.services.session_live_commands import end_session_cutoff

        host_id = str(ctx.actor.actor_id)
        if ctx.actor.role == "system":
            host_id = str(ctx.session.host_id)
        pl = ctx.command.payload or {}
        s, parent, early = session_service.transition_tx(
            str(ctx.session.id), host_id, action, ctx.db, commit=False,
            force=bool(pl.get("force")), confirmed_conflict_fingerprint=pl.get("confirmed_conflict_fingerprint"))
        ctx.session = s
        if early:  # 이미 종료된 회차의 멱등 재요청: 새 event 없음
            ctx.entity_version = int(s.state_version or 0)
            ctx.result = {"status": s.status, "changed": False}
            return
        _session_event(ctx)
        if action in ("end", "cancel"):
            end_session_cutoff(ctx)  # 활성 capture stream 마감 + auth_revision 증가(종료 후 새 stream 금지)
            ver = next_entity_version(ctx.db, s.id, "audio", str(s.id))
            ctx.emit(domain="audio", event_type="audio.changed", entity_id=str(s.id), entity_version=ver, audience=["public"],
                     payload={"track_id": None, "action": "stop", "position_ms": 0, "server_anchor_ms": 0, "rate": 1.0, "revision": str(ver)})
        ctx.result = {"status": s.status, "changed": True}
        sid = s.id

        def _after() -> None:
            from app.core.database import SessionLocal

            db = SessionLocal()
            try:
                row = db.get(type(s), sid)
                session_service.transition_after_commit(row, parent_of(db, row), action, db)
            except Exception:  # noqa: BLE001 — 부수효과는 best-effort(전이는 이미 commit)
                _live_log.warning("[live-v2] 전이 후 부수효과 실패 session=%s action=%s", sid, action, exc_info=True)
            finally:
                db.close()

        _defer(ctx, _after)
    handler.__name__ = f"_h_session_{action}"
    return handler


def parent_of(db, session):
    if not session.class_id:
        return None
    from app.models.class_program import Class

    return db.get(Class, session.class_id)


# ---- 등록 / 시드 / 회수 ----

LIVE_HANDLERS = {
    "entry.enter": _h_entry_enter, "entry.leave": _h_entry_leave, "waiting.set_ready": _h_waiting_set_ready,
    "waiting.remind": _h_waiting_remind, "waitlist.cancel": _h_waitlist_cancel, "waitlist.promote": _h_waitlist_promote,
    "hand.set": _h_hand_set, "hand.lower": _h_hand_lower, "speaking.set": _h_speaking_set,
    "signal.send": _h_signal_send, "signal.clear": _h_signal_clear, "audio.set": _h_audio_set,
    "chat.set_enabled": _h_chat_set_enabled,
    **{f"session.{a}": _make_transition_handler(a) for a in ("open", "start", "end", "cancel")},
}


def register_live_handlers() -> None:
    from app.services.session_live_commands import register_handler

    for kind, fn in LIVE_HANDLERS.items():
        register_handler(kind, fn)


def seed_live_state(db, session_id) -> bool:
    """회차에 live 상태 event 가 하나도 없으면(첫 접촉) 현재 DB 상태를 outbox 에 한 번 기록한다. 같은 epoch 락 아래라 멱등.

    snapshot 은 session 상태가 없으면 불완전으로 거절되므로 첫 join 전에 필요하다. 반환 True=이번 호출이 기록함.
    """
    from app.models.live_state import LiveOutbox
    from app.models.session import Session as SessionModel, SessionParticipant
    from app.schemas.session_live_v2 import participation_payload, policy_payload, session_state_payload, speaking_payload
    from app.services import session_service
    from app.services.session_live_ledger import append_outbox, lock_epoch

    epoch_row = lock_epoch(db, session_id)
    exists = db.execute(_select(_func.count()).select_from(LiveOutbox).where(
        LiveOutbox.session_id == session_id, LiveOutbox.domain == "session")).scalar_one()
    if exists:
        db.rollback()
        return False
    s = db.execute(_select(SessionModel).where(SessionModel.id == session_id).execution_options(populate_existing=True)).scalar_one()
    append_outbox(db, epoch_row, domain="session", event_type="session.changed", entity_id=str(s.id), entity_version=1,
                  audience=["public"], payload=session_state_payload(s.status, s.started_at, s.ended_at), command_id=None)
    append_outbox(db, epoch_row, domain="policy", event_type="policy.changed", entity_id=str(s.id), entity_version=1,
                  audience=["public"], payload=policy_payload(s.chat_enabled), command_id=None)
    parts = db.execute(_select(SessionParticipant).where(
        SessionParticipant.session_id == session_id, SessionParticipant.removed_at.is_(None),
        SessionParticipant.waitlist_cancelled_at.is_(None))).scalars().all()
    for p in parts:
        aud = ["host", f"member:{p.id}"]
        append_outbox(db, epoch_row, domain="participation", event_type="participant.changed", entity_id=str(p.id), entity_version=1,
                      audience=aud, payload=participation_payload(p.id, _attendance_of(s, p)), command_id=None)
        append_outbox(db, epoch_row, domain="speaking", event_type="speaking.changed", entity_id=str(p.id), entity_version=1,
                      audience=aud, payload=speaking_payload(p.id, p.raise_hand, session_service._compute_can_publish(s, p), 1),
                      command_id=None)
    db.commit()
    return True


def emit_participant_removed(db, session, participant) -> None:
    """v2 회차에서 참가자 제거(추방): participant.removed 와 auth_revision 증가를 제거 트랜잭션과 같은 commit 에 남긴다.

    호출자는 commit 전에 부른다. v2 회차가 아니거나 epoch 행이 없으면 아무것도 하지 않는다.
    """
    from app.schemas.session_live_v2 import tombstone_payload
    from app.services.session_live_ledger import append_outbox, lock_epoch
    from app.services.session_live_legacy import PROTOCOL_V2, get_session_protocol

    pin = get_session_protocol(db, session.id)
    if pin is None or pin.protocol != PROTOCOL_V2:
        return
    epoch_row = lock_epoch(db, session.id)
    ver = next_entity_version(db, session.id, "participation", str(participant.id))
    aud = ["host", f"member:{participant.id}"]
    append_outbox(db, epoch_row, domain="participation", event_type="participant.removed", entity_id=str(participant.id),
                  entity_version=ver, audience=aud, payload=tombstone_payload(participant.id, ver), command_id=None)
    epoch_row.auth_revision = int(epoch_row.auth_revision) + 1
    from app.services.session_live_commands import CUTOFF_EXPELLED, HandlerContext, revoke_participant_capture  # noqa: F401
    from app.services.session_live_ledger import SYSTEM_ACTOR_ID  # noqa: F401
    revoke_participant_capture_direct(db, epoch_row, participant)


def revoke_participant_capture_direct(db, epoch_row, participant) -> None:
    """추방 시 해당 참가자 capture stream 을 expelled 로 차단(이전 구간 보관, live fresh 불가). T03 `_apply_cutoff` 재사용."""
    from datetime import datetime as _dt, timezone as _tz
    from app.models.live_state import CaptureStream
    from app.services import session_live_commands as slc

    now = _dt.now(_tz.utc)
    streams = db.execute(_select(CaptureStream).where(CaptureStream.participant_id == participant.id).with_for_update()
                         .execution_options(populate_existing=True)).scalars().all()
    slc._apply_cutoff(db, list(streams), cutoff_at=now, code=slc.CUTOFF_EXPELLED, now=now, emit=None)



# ===========================================================================
# SDD-246 T05 — 전송 중립 실행기: apply_command → commit → ob.drain → 이벤트 수집 (WS/REST 공용)
# ===========================================================================
import os as _os
from dataclasses import dataclass as _dataclass, field as _field

_LIVE_REDIS = None


def get_live_redis():
    """프로세스 공용 LiveRedis. LIVE_REDIS_URL(없으면 settings.redis_url)·LIVE_REDIS_PREFIX 로 구성. 시험은 set_live_redis 로 주입."""
    global _LIVE_REDIS
    if _LIVE_REDIS is None:
        from app.config import settings
        from app.services.live_redis import keys
        from app.services.live_redis.client import LiveRedis

        url = _os.environ.get("LIVE_REDIS_URL") or settings.redis_url
        _LIVE_REDIS = LiveRedis.from_url(url, prefix=_os.environ.get("LIVE_REDIS_PREFIX", keys.DEFAULT_PREFIX))
    return _LIVE_REDIS


def set_live_redis(live) -> None:
    global _LIVE_REDIS
    _LIVE_REDIS = live


PROBE_TTL_S = 120
PROBE_MAX_AGE_MS = 10_000  # probe 후 이 시간 안에 reanchor 해야 서버가 오차를 보증한다


def probe_key(live, probe_id) -> str:
    return f"{live.prefix}:probe:{probe_id}"


def store_clock_probe(live, probe_id, received_ms: int, actor_id) -> None:
    live.r.hset(probe_key(live, probe_id), mapping={"received_ms": int(received_ms), "actor": str(actor_id)})
    live.r.expire(probe_key(live, probe_id), PROBE_TTL_S)


def make_probe_resolver(live, actor_id, *, now_ms=None):
    """capture.reanchor 가 참조하는 clock_probe → 서버가 직접 잰 오차(ms).

    서버는 probe 수신 시각만 안다. reanchor 가 probe 이후 얼마 만에 도착했는지(age)가 클라이언트가 anchor 를 잡은 시각의
    서버 관점 상한 오차다. probe 가 없거나 다른 사용자 것이거나 너무 오래됐으면 None → clock_uncertain 유지.
    """
    import time as _time

    def resolve(probe_id) -> int | None:
        try:
            h = live.r.hgetall(probe_key(live, probe_id))
        except Exception:  # noqa: BLE001
            return None
        if not h or h.get("actor") != str(actor_id):
            return None
        age = (now_ms if now_ms is not None else int(_time.time() * 1000)) - int(h["received_ms"])
        if age < 0 or age > PROBE_MAX_AGE_MS:
            return None
        return age + 1
    return resolve


@_dataclass
class RunOutcome:
    ack: dict
    result: Any = None
    degraded: bool = False
    committed: bool = False
    auth_revision: int | None = None  # 명령이 올린 auth_revision(호스트 자기 명령 후 연결 상태 갱신용)


def _cursors_for(live, session_id, scope) -> list[dict]:
    from app.services.session_live_state import LiveStateService

    return LiveStateService(live).heartbeat(session_id, scope)["through"]


def scope_of(actor, auth_revision: int | None = None):
    from app.services.session_live_state import Scope

    if actor.role == "member":
        return Scope("member", actor.participant_id, auth_revision)
    return Scope("host", None, auth_revision)


def events_for_rows(live, session_id, rows) -> list[dict]:
    """outbox row 들에 대응하는 wire LiveEvent(seq 포함, audience 별)를 Redis stream 에서 읽어 revision 순으로 돌려준다."""
    from app.services.session_live_state import Cursor, LiveStateService, Scope

    want = {str(r.event_id): int(r.revision) for r in rows}
    pairs: dict[tuple[str, str], int] = {}
    for r in rows:
        for aud in dict.fromkeys(r.audience_policy or []):
            pairs[(aud, r.domain)] = pairs.get((aud, r.domain), 0) + 1
    svc, out = LiveStateService(live), []
    for (aud, dom), n_rows in pairs.items():
        scope = Scope("host") if aud in ("host", "public") else Scope("member", _uuid.UUID(aud.split(":", 1)[1]))
        seq = int(live.snapshot_raw(session_id, [aud], (dom,), False)[5][0][2])
        # 방송 대상 행은 projection 된 가장 최근 event 들이라 (aud,dom) 의 마지막 n_rows 개 seq 와 일치한다.
        # 고정 폭(512)으로 거슬러 가면 재구축 직후(복원된 seq 만 있고 stream 이력이 없을 때) log_truncated 가 난다.
        rep = svc.replay(session_id, scope, [Cursor(aud, dom, max(0, seq - n_rows))])
        out += [e for e in rep.events if e["event_id"] in want]
    out.sort(key=lambda e: (want[e["event_id"]], e["audience"]))
    return out


EMIT_LOCK_TTL_MS = 5_000


def _emitted_key(live, session_id) -> str:
    return f"{live.base(session_id)}:emitted"


def publish_pending(db, live, session_id, emit_fn: Callable[[dict], None], *, wait_s: float = 2.0) -> int:
    """projection 된 event 중 아직 방송하지 않은 것을 revision 순서로 emit_fn 에 넘긴다(클러스터 단일 발행자 락).

    watermark(`emitted`)는 emit_fn 이 모두 성공한 뒤에만 전진한다. 발행 도중 프로세스가 죽으면 다음 호출이 이어서 보낸다
    (중복 가능 — 클라이언트는 event_id/seq 로 폐기). REST·WS·heartbeat 루프·원격 프로세스 어디서 불러도 같은 결과다.
    """
    import time as _time

    from app.models.live_state import LiveOutbox
    from app.services import session_live_outbox as ob

    ob.drain(db, live, session_id, wait_s=wait_s)
    token = _uuid.uuid4().hex
    lock_key = f"{live.base(session_id)}:emit-lock"
    deadline = _time.monotonic() + wait_s
    while not live._wrap(live.r.set, lock_key, token, nx=True, px=EMIT_LOCK_TTL_MS):
        if _time.monotonic() > deadline:
            return 0
        _time.sleep(0.02)
    try:
        meta = live.read_meta(session_id)
        applied = int(meta.get("applied_revision", 0)) if meta else 0
        done = int(live._wrap(live.r.get, _emitted_key(live, session_id)) or 0)
        if applied <= done:
            return 0
        rows = db.execute(_select(LiveOutbox).where(LiveOutbox.session_id == session_id, LiveOutbox.revision > done,
                                                    LiveOutbox.revision <= applied).order_by(LiveOutbox.revision)).scalars().all()
        for ev in events_for_rows(live, session_id, rows):
            emit_fn(ev)
        live._wrap(live.r.set, _emitted_key(live, session_id), applied)
        db.rollback()
        return len(rows)
    finally:
        live._wrap(live._str_unlock, keys=[lock_key], args=[token])


def run_live_command(db, actor, command, *, live=None, auth_revision: int | None = None, drain_wait_s: float = 2.0) -> RunOutcome:
    """WS/REST 가 공유하는 단일 경로. 업무 부작용은 apply_command 한 번뿐이다.

    - Redis 장애: commit 이후면 `retryable, committed:true`(같은 ID 재시도 = ledger 결과 재생), commit 이전이면 retryable committed:false.
    - 일시 거절(epoch 불일치 등)은 ledger 에 없으므로 committed:false.
    """
    from app.schemas.session_live_v2 import ack_from_result, error_ack
    from app.services import session_live_outbox as ob
    from app.services.live_redis.client import LiveNotReady, LiveRedisUnavailable
    from app.services.session_live_commands import apply_command
    from app.services.session_live_state import ScopeStale
    from app.models.session import Session as SessionModel

    live = live or get_live_redis()
    sid = command.session_id
    if db.get(SessionModel, sid) is None:
        return RunOutcome(error_ack(str(command.command_id), "session_not_found"))
    seed_live_state(db, sid)
    try:
        result = apply_command(db, actor, command, clock_probe_resolver=make_probe_resolver(live, actor.actor_id))
    finally:
        callbacks = pop_after_commit(command.command_id)
    if result.transient or not result.committed:  # 일시 거절·충돌: 부작용 0
        return RunOutcome(ack_from_result(result), result)
    # commit 된 명령의 부수효과(종료 후 STT/리포트 등)는 projection/권한 상태와 무관하게 정확히 한 번 실행한다.
    def _run_callbacks() -> None:
        if result.status == "applied" and not result.duplicate:
            for cb in callbacks:
                try:
                    cb()
                except Exception:  # noqa: BLE001 — 부수효과는 best-effort(상태는 이미 commit)
                    _live_log.warning("[live-v2] commit 후 부수효과 실패", exc_info=True)

    new_auth_rev: int | None = None
    try:
        res = ob.drain(db, live, sid, wait_s=drain_wait_s)
        if res.busy or res.applied_revision < int(result.revision):
            raise LiveNotReady("projection_pending")
        cursors = _cursors_for(live, sid, scope_of(actor, auth_revision))
    except (LiveRedisUnavailable, LiveNotReady) as exc:
        _run_callbacks()
        ack = ack_from_result(result)
        ack.update(status="retryable", committed=True, code="live_unavailable" if isinstance(exc, LiveRedisUnavailable) else "projection_pending",
                   retry_after_ms=1000)
        return RunOutcome(ack, result, degraded=True, committed=True)
    except ScopeStale as stale:  # 권한이 회수/변경됐다: 업무는 commit 됐으므로 결과 조회 + 재인가(완전 snapshot)
        _run_callbacks()
        if result.status == "applied" and actor.role in ("host", "system"):
            # 호스트의 session.end/cancel 은 자기 명령이 auth_revision 을 올린다. 호스트 권한은 유지되므로
            # 현재 revision 으로 cursor 를 다시 읽어 committed ACK 를 즉시 돌려준다(retryable 로 늦추지 않는다).
            try:
                cursors = _cursors_for(live, sid, scope_of(actor, stale.current))
                return RunOutcome(ack_from_result(result, cursors), result, committed=True, auth_revision=stale.current)
            except (LiveRedisUnavailable, LiveNotReady, ScopeStale):
                pass
        ack = ack_from_result(result)
        ack.update(status="retryable", committed=True, code="scope_stale", retry_after_ms=0)
        return RunOutcome(ack, result, committed=True)
    _run_callbacks()
    return RunOutcome(ack_from_result(result, cursors), result, committed=True)


def resolve_live_actor(db, session_id, user_id, entry_credential=None):
    """인증 문맥(계정/입장 자격)에서 Actor 를 서버가 확정한다. payload 의 participant 주장은 쓰지 않는다. 실패하면 None."""
    from app.models.session import Session as SessionModel
    from app.services import session_service
    from app.services.class_attendance_service import eligible_participant
    from app.services.session_live_commands import Actor

    sid = _uuid.UUID(str(session_id))
    s = db.get(SessionModel, sid)
    if s is None:
        return None
    if user_id and s.host_id == _uuid.UUID(str(user_id)):
        return Actor(actor_id=s.host_id, role="host")
    try:
        p = session_service.resolve_participant_actor(sid, db, entry_credential=entry_credential,
                                                      current_user_id=str(user_id) if user_id else None)
    except HTTPException:
        return None
    if not eligible_participant(db, p, allow_excused=False):
        return None
    return Actor(actor_id=live_actor_id(p), role="member", participant_id=p.id)

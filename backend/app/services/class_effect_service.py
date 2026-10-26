"""클래스 전달 의도 소비. 실패는 DB에 남기고 다음 주기에 재처리한다."""

from datetime import datetime, timedelta, timezone
from uuid import UUID
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.class_scheduling import ClassEffect, ClassEmailInvite
from app.models.session import Session
from app.models.chat import ChatRoom
from app.models.user_org_membership import UserOrgMembership
from app.services.class_conflict_service import utc
from app.services.notification_service import notify_event, build_standard_extra


def _schedule_reminders(session, now):
    from app.services.reminder_service import (
        normalize_reminder_offsets,
        _reminder_task_id,
    )
    from app.tasks.reminder_task import send_session_reminder_task

    if (
        not session.scheduled_at
        or session.status not in ("ready", "scheduled")
        or session.host_state != "assigned"
    ):
        return
    for offset in normalize_reminder_offsets(session.reminder_offsets):
        eta = utc(session.scheduled_at) - timedelta(minutes=offset)
        if eta > now:
            send_session_reminder_task.apply_async(
                args=[str(session.id), offset],
                eta=eta,
                task_id=_reminder_task_id(session.id, offset, session.scheduled_at),
                retry=False,
            )


def _recipients(db, cls, session, intent, now):
    payload = intent.payload or {}
    if "recipient_ids" in payload:
        return {UUID(uid) for uid in payload["recipient_ids"]}
    if payload.get("recipient_id"):
        return {UUID(payload["recipient_id"])}
    if intent.kind == "session_host_changed":
        result = {
            UUID(payload[key])
            for key in ("previous_host_id", "new_host_id")
            if payload.get(key)
        }
        if (
            session
            and session.host_state == "assigned"
            and session.scheduled_at
            and timedelta(0) <= utc(session.scheduled_at) - now <= timedelta(days=7)
        ):
            result.update(
                m.user_id
                for m in db.query(ClassMember)
                .filter(ClassMember.class_id == cls.id, ClassMember.status == "active")
                .all()
                if m.user_id
            )
        return result
    if intent.kind in (
        "session_host_needed",
        "session_host_released",
        "session_host_transfer_requested",
        "session_host_change_resolved",
    ):
        leads = {
            i.user_id
            for i in db.query(ClassInstructor)
            .filter(
                ClassInstructor.class_id == cls.id,
                ClassInstructor.role == "lead",
                ClassInstructor.status == "active",
            )
            .all()
        }
        admins = {
            i.user_id
            for i in db.query(UserOrgMembership)
            .filter(
                UserOrgMembership.org_id == cls.organization_id,
                UserOrgMembership.role == "org_admin",
                UserOrgMembership.status == "active",
            )
            .all()
        }
        return (
            leads
            | admins
            | (
                {UUID(payload["requester_id"])}
                if payload.get("requester_id")
                else set()
            )
        )
    if (
        session
        and session.host_state != "assigned"
        and intent.kind not in ("session_cancelled",)
    ):
        return set()
    return {
        m.user_id
        for m in db.query(ClassMember)
        .filter(ClassMember.class_id == cls.id, ClassMember.status == "active")
        .all()
        if m.user_id
    }


# 알림 종류별 구체 문구. 모호한 "변경 내용을 확인해 주세요"는 쓰지 않는다.
_MESSAGES = {
    "class_invited": ("클래스 초대", "{title} 클래스에 초대되었어요."),
    "class_member_joined": ("새 회원 참여", "{title} 클래스에 새 회원이 참여했어요."),
    "class_session_added": ("회차 추가", "{title} 클래스에 새 회차가 추가되었어요."),
    "session_updated": ("회차 일시 변경", "{title} 클래스의 회차 일시가 변경되었어요."),
    "session_cancelled": ("회차 취소", "{title} 클래스의 회차가 취소되었어요."),
    "session_host_changed": ("진행자 변경", "{title} 클래스의 진행자가 변경되었어요."),
    "session_host_assigned": ("진행자 배정", "{title} 클래스의 진행자로 배정되었어요."),
    "session_host_needed": ("진행자 필요", "{title} 클래스에 진행자 지정이 필요해요."),
    "session_host_released": ("진행자 해제", "{title} 클래스의 진행자가 해제되었어요."),
    "session_host_transfer_requested": ("진행자 인계 요청", "{title} 클래스의 진행자 인계가 요청되었어요."),
    "session_host_change_resolved": ("진행자 변경 처리", "{title} 클래스의 진행자 변경 요청이 처리되었어요."),
    "class_waitlist_promoted": ("대기 순번 확정", "{title} 클래스에 참여할 수 있게 되었어요."),
    "class_completed": ("클래스 종료", "{title} 클래스가 종료되었어요."),
    "class_cancelled": ("클래스 취소", "{title} 클래스가 취소되었어요."),
}


def _message(kind, class_title):
    title, body = _MESSAGES.get(kind, ("명상 클래스 안내", "{title} 클래스에 새 소식이 있어요."))
    return title, body.format(title=class_title)


def _deliver(db, intent, now):
    cls = db.query(Class).filter(Class.id == intent.class_id).first()
    if cls is None:
        return
    session = (
        db.query(Session).filter(Session.id == intent.session_id).first()
        if intent.session_id
        else None
    )
    # 열린 회차가 있으면 start_now 여부와 무관하게 "지금 입장 가능" 안내를 붙인다(SDD-223).
    from app.services.class_membership_service import live_session

    instant_session = live_session(db, cls)
    if intent.kind == "live_access_reconcile":
        import asyncio
        from app.services.class_access_service import reconcile_observers
        from app.ws.session_live_namespace import _refresh_instructor_rooms

        for row in (
            db.query(Session)
            .filter(Session.class_id == cls.id)
            .all()
        ):
            # 멤버 제외 등 권한 회수는 throttle 없이 즉시 반영한다(SDD-224).
            asyncio.run(_refresh_instructor_rooms(str(row.id), force=True))
            asyncio.run(reconcile_observers(db, row))
        return
    if intent.kind == "session_updated" and intent.payload.get("session_ids"):
        confirmed = (
            db.query(Session)
            .filter(
                Session.id.in_([UUID(sid) for sid in intent.payload["session_ids"]]),
                Session.class_id == cls.id,
                Session.host_state == "assigned",
                Session.scheduled_at >= now,
                Session.scheduled_at <= now + timedelta(days=7),
            )
            .order_by(Session.scheduled_at, Session.id)
            .all()
        )
        if not confirmed:
            return
        session = confirmed[0]
    if intent.kind == "session_prepare":
        if not session:
            return
        if not db.query(ChatRoom).filter(ChatRoom.session_id == session.id).first():
            db.add(
                ChatRoom(
                    session_id=session.id,
                    host_id=session.host_id,
                    room_type="session",
                    name=cls.title,
                )
            )
        db.flush()
        _schedule_reminders(session, now)
        return
    if intent.kind == "email_invite":
        from app.tasks.email import _send_email

        invite = (
            db.query(ClassEmailInvite)
            .filter(ClassEmailInvite.id == UUID(intent.payload["invite_id"]))
            .first()
        )
        if not invite or invite.status == "sent":
            return
        if cls.status != "active" or not cls.access_code:
            invite.status = "failed"
            return
        from app.config import settings

        base = settings.frontend_base_url.rstrip("/")
        entry = f"{base}/class/{instant_session.id}/enter\n" if instant_session else ""
        body = (
            f"{cls.title}\n{entry}코드로 입장: {base}/join\n"
            f"참여 코드: {cls.access_code}\n"
            "로그인 또는 초대 자격이 없으면 코드로 입장해 주세요."
        )
        if not _send_email(
            invite.email_norm,
            "명상 클래스 초대",
            body,
        ):
            raise RuntimeError("클래스 초대 전달 실패")
        invite.status = "sent"
        invite.sent_at = now
        return
    if intent.kind in ("session_updated", "session_host_changed") and session:
        ids = [
            UUID(sid)
            for sid in (intent.payload or {}).get("session_ids", [str(session.id)])
        ]
        for changed in (
            db.query(Session)
            .filter(Session.id.in_(ids), Session.class_id == cls.id)
            .all()
        ):
            _schedule_reminders(changed, now)
    if intent.kind == "session_host_needed" and (
        not session or session.host_state != "needs_reassign"
    ):
        return
    target = "class" if intent.kind.startswith("class_") else "session"
    target_id = str(cls.id) if target == "class" else str(intent.session_id)
    instant_invite = intent.kind == "class_invited" and instant_session is not None
    msg_title, body = _message(intent.kind, cls.title)
    if instant_invite:
        from app.config import settings

        body = f"{cls.title}: 지금 입장할 수 있어요. {settings.frontend_base_url.rstrip('/')}/class/{instant_session.id}/enter"
    for recipient in sorted(_recipients(db, cls, session, intent, now)):
        notification = notify_event(
            intent.kind,
            recipient,
            {
                "title": msg_title,
                "body": body,
                "extra": build_standard_extra(
                    intent.kind,
                    target,
                    target_id,
                    params={
                        "area": "meditation",
                        "class_id": str(cls.id),
                        **(
                            {"start_now": True, "session_id": str(instant_session.id)}
                            if instant_invite else {}
                        ),
                        **(
                            {"request_id": intent.payload["request_id"]}
                            if (intent.payload or {}).get("request_id")
                            else {}
                        ),
                        **({"seq": session.seq} if session else {}),
                    },
                ),
            },
            db,
            commit=False,
        )

        if (
            session
            and session.scheduled_at
            and intent.kind
            in (
                "session_host_changed",
                "session_host_change_requested",
                "session_updated",
                "session_cancelled",
            )
            and timedelta(0) <= utc(session.scheduled_at) - now <= timedelta(minutes=60)
        ):
            from app.models.user import User
            from app.services.notification_service import (
                get_user_preferences,
                enqueue_outbox,
            )

            user = db.query(User).filter_by(id=recipient).first()
            if (
                user
                and user.status == "active"
                and get_user_preferences(user)["push"].get(intent.kind, False)
            ):
                path = (
                    f"/app/classes/{cls.id}?sessionId={session.id}"
                    if user.role == "client"
                    else f"/classes/{cls.id}/sessions/{session.id}"
                )
                enqueue_outbox(
                    db,
                    user_id=recipient,
                    channel="push",
                    notification_id=notification.id if notification else None,
                    payload={
                        "title": msg_title,
                        "body": f"곧 시작하는 회차예요. {body}",
                        "deeplink": path,
                        "message_id": str(intent.id),
                    },
                )


def process_effects(db, limit=100, now=None, *, class_id=None):
    now = now or datetime.now(timezone.utc)
    counts = {"done": 0, "failed": 0}
    for _ in range(limit):
        intent = (
            db.query(ClassEffect)
            .filter(
                ClassEffect.status == "pending", ClassEffect.available_at <= now,
                *([ClassEffect.class_id == UUID(str(class_id))] if class_id is not None else []),
            )
            .order_by(ClassEffect.available_at, ClassEffect.id)
            .with_for_update(skip_locked=True)
            .first()
        )
        if intent is None:
            db.commit()
            break
        effect_id = intent.id
        try:
            _deliver(db, intent, now)
            intent.status = "done"
            intent.attempts += 1
            db.commit()
            counts["done"] += 1
        except Exception:
            db.rollback()
            intent = (
                db.query(ClassEffect)
                .filter(ClassEffect.id == effect_id)
                .with_for_update()
                .one()
            )
            intent.attempts += 1
            intent.available_at = now + timedelta(
                seconds=min(3600, 30 * 2 ** min(intent.attempts, 6))
            )
            if intent.kind == "email_invite":
                invite = (
                    db.query(ClassEmailInvite)
                    .filter(ClassEmailInvite.id == UUID(intent.payload["invite_id"]))
                    .first()
                )
                if invite:
                    invite.status = "failed"
                # 메일은 사용자가 실패 항목만 재요청한다.
                intent.status = "failed"
            db.commit()
            counts["failed"] += 1
    return counts


def dispatch_class_effects(class_id):
    """요청 커밋 뒤 새 DB 세션으로 해당 클래스만 소비한다. cron 재시도는 유지한다."""
    import logging
    from app.core.database import SessionLocal

    try:
        with SessionLocal() as db:
            process_effects(db, class_id=class_id, limit=500)
    except Exception:
        logging.getLogger(__name__).exception("클래스 전달 의도 즉시 처리 실패")

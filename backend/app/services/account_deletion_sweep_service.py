"""SDD-220 — 탈퇴 후 30일 사용자 단위 영구 삭제 스위프.

기존 retention_sweep_service(세션 종료일 기준 90일)와 별개다 — 기준일은 users.purge_after(= 탈퇴 시각 + 30일).
관리자 삭제의 ``_purge_user_hard`` / ``media_cleanup_service.delete_user_media`` 는 호스트 세션 전체와 타 참여자
데이터까지 지우므로 쓰지 않는다. 여기서는 **탈퇴자 본인 소유 데이터만** 지운다.

처리 순서(외부 객체 삭제가 DB 트랜잭션과 원자적이지 않으므로):
  연구 철회 원장 → 삭제 대상 객체 원장 기록 → 객체 삭제(재시도 가능) → 모두 확인된 뒤에만 DB 행 정리 → 원장 purged.
실패하면 키와 행을 잃지 않고 ``failed`` 로 남겨 다음 실행에서 재시도한다(purge 완료로 표시하지 않음).

결정 M2(공유 녹음·영상 원본 보존)·M3(법정 보관 목록 비어 있음, 무기한 보관 금지)는 impl-common 을 따른다.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import sqlalchemy as sa
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.core.database import Base
from app.models.account_deletion import AccountDeletionLedger, AccountDeletionObject
from app.models.user import User

logger = logging.getLogger(__name__)

# M3 — 법정 보관 항목 훅. 법무 확정 전에는 비어 있고, 무기한 보관 항목을 만들지 않는다.
#   항목 형식(확정 후): (table, reason, expires_at) — 만료되면 이 스위프가 삭제한다.
LEGAL_HOLD_ITEMS: tuple = ()

REASON_SHARED_MEDIA = "shared_session_media_retained"
REASON_TOMBSTONE = "users_row_retained_as_tombstone"


# ── 삭제 대상 분류 (users / session_participants / class_members 를 참조하는 모든 FK 테이블이 여기에 있어야 한다) ──

# 본인 소유 행 삭제: table → 탈퇴자를 가리키는 열. 자식 행은 FK 를 따라 먼저 삭제한다.
USER_OWNED: dict[str, tuple[str, ...]] = {
    "agent_briefing_logs": ("user_id",),
    "agent_checkin_enablements": ("client_id", "counselor_id"),
    "agent_checkin_prefs": ("client_id",),
    "agent_checkins": ("client_id", "counselor_id"),
    "agent_conversations": ("user_id",),
    "agent_counselor_settings": ("user_id",),
    "agent_delivery_logs": ("user_id",),
    "agent_memory_items": ("client_id",),
    "agent_profile_items": ("client_id", "counselor_id"),
    "agent_relay_events": ("source_user_id", "target_user_id"),
    "agent_risk_signals": ("client_id", "counselor_id"),
    "careers": ("user_id",),
    # SDD-220 ⓓ: 신고·차단 행은 보관 근거가 없으므로 당사자 탈퇴 시 함께 삭제한다(본문 사본 포함).
    "chat_blocks": ("user_low_id", "user_high_id", "blocker_id"),
    "chat_reports": ("reporter_id", "reported_user_id"),
    "chat_message_reads": ("user_id",),
    "chat_room_participants": ("user_id",),
    "client_counselor_links": ("client_id", "counselor_id"),
    "client_invites": ("counselor_id",),
    "client_profiles": ("user_id",),
    "consents": ("user_id",),
    "counselor_profiles": ("user_id",),
    "credentials": ("user_id",),
    "data_export_jobs": ("user_id",),
    "data_export_previews": ("actor_id",),  # SDD-243 (targets 는 FK 자식으로 함께 삭제)
    "device_tokens": ("user_id",),
    "notification_outbox": ("user_id",),
    "notifications": ("user_id",),
    "onboarding_progress": ("user_id",),
    "org_join_requests": ("user_id",),
    "password_history": ("user_id",),
    "qualifications": ("user_id",),
    "refresh_tokens": ("user_id",),
    "session_reminder_logs": ("user_id",),
    "signup_applications": ("user_id",),
    "social_identities": ("user_id",),
    "user_org_memberships": ("user_id",),
}

# FK 없이 사용자 UUID 를 문자열/UUID 로 보관하는 테이블(전수 대조 대상).
USER_OWNED_NO_FK: dict[str, tuple[str, ...]] = {
    "data_export_audits": ("user_id",),
    "normalization_baselines": ("user_id",),
}

# 본인 참여자(session_participants.user_id)에 속한 개인 데이터: table → (참여자 열, 사용자 열).
PARTICIPANT_OWNED: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "eeg_records": (("participant_id",), ("user_id",)),
    "eeg_raw_chunks": (("participant_id",), ("user_id",)),
    "eeg_feature_windows": (("participant_id",), ("user_id",)),
    "reports": (("participant_id",), ("user_id",)),
    "session_presence_leases": (("participant_id",), ()),
    "class_makeup_assignments": (("source_participant_id", "target_participant_id"), ()),
    # SDD-244 M1: 생체신호 수집 원장(참여자 FK). raw 객체 키는 eeg_raw_chunks 의 object_key 로 이미 원장에 기록된다.
    "biosignal_streams": (("participant_id",), ()),
    "biosignal_gap_events": (("participant_id",), ()),
    "biosignal_close_intents": (("participant_id",), ()),
    "biosignal_manifest_revisions": (("participant_id",), ()),
    "biosignal_manifest_current": (("participant_id",), ()),
    # SDD-244 M2: 산출물 원장·화면 스냅샷(객체 키는 OBJECT_COLUMNS 에 등록)
    "biosignal_artifacts": (("participant_id",), ()),
    "biosignal_feature_aliases": (("participant_id",), ()),
    "display_snapshots": (("participant_id",), ()),
}

# 타인과 공유되는 행에서 탈퇴자 참조만 NULL 로 바꾼다(nullable FK).
NULLIFY: dict[str, tuple[str, ...]] = {
    "chat_messages": ("sender_id",),
    "chat_rooms": ("host_id",),
    "class_instructors": ("added_by",),
    "counseling_guests": ("claimed_user_id",),
    "counseling_relationships": ("closed_by", "client_user_id"),
    "class_members": ("user_id",),
    "organizations": ("deactivated_by", "primary_admin_id", "owner_user_id"),
    "reports": ("approved_by_user_id",),
    "session_participants": ("user_id",),
    "signup_applications": ("reviewed_by",),
    "verification_audits": ("admin_id",),
}

# 필수(NOT NULL) FK 로 다른 사람의 기록이 탈퇴자를 가리키는 곳 — 행을 지우면 타인 데이터가 사라지므로 보존하고,
# 이 경우 users 행은 식별 정보가 모두 제거된 자리표시(tombstone)로 남는다. FK dangling 은 0 이다.
RETAIN_REFERENCE: dict[str, tuple[str, ...]] = {
    "class_email_invites": ("invited_by",),
    "class_guest_recoveries": ("issued_by",),
    "class_instructors": ("user_id",),
    "class_operations": ("actor_id",),
    "class_report_jobs": ("actor_id",),
    "classes": ("created_by",),
    "counseling_relationship_counselors": ("counselor_id",),
    "counseling_relationships": ("counselor_id",),
    "session_host_notes": ("actor_id",),
    "session_host_requests": ("candidate_host_id", "requested_by"),
    "sessions": ("host_id",),
}

# 탈퇴자의 class_members 를 통해 지워지는 하위 테이블(자격·입장 작업 JSON).
MEMBER_OWNED = (
    "class_guest_credentials", "class_guest_join_operations", "class_member_operations",
)

# 참여자·멤버 행은 지우지 않고 식별 정보만 비운다(타인 출석·집계 보존).
PARTICIPANT_SCRUB = {
    "guest_name": None, "gender": None, "birth_date": None, "report_email": None,
    "webrtc_peer_id": None, "linkband_device_id": None,
}
MEMBER_SCRUB = {"guest_name": None, "gender": None, "birth_date": None, "report_email": None}

# 객체 키를 가진 열: (table, 열, 종류) — 삭제 전에 원장에 기록한다. "url" 은 서비스 소유 키로만 역변환한다.
OBJECT_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("eeg_records", "s3_key", "s3"),
    ("eeg_raw_chunks", "object_key", "s3"),
    ("biosignal_artifacts", "object_key", "s3"),
    ("reports", "pdf_url", "url"),
    ("credentials", "s3_key", "s3"),
    ("data_export_jobs", "object_key", "s3"),
)


def uncovered_user_references() -> list[str]:
    """users / session_participants / class_members 를 참조하는 FK 테이블 중 분류에 없는 것(누락 테스트용)."""
    known = set(USER_OWNED) | set(PARTICIPANT_OWNED) | set(NULLIFY) | set(RETAIN_REFERENCE) | set(MEMBER_OWNED)
    import app.models  # noqa: F401  (모델 전체 로드)
    from app.api.v1 import auth  # noqa: F401  (account_deletion 등 보조 모델 등록)

    targets = {"users", "session_participants", "class_members"}
    out: set[str] = set()
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name in targets and table.name not in known:
                out.add(table.name)
    # 회차 참여자·멤버가 같은 테이블 안에서 서로를 가리키는 자기 참조는 대상이 아니다.
    return sorted(out - {"session_participants", "class_members"})


# ── 객체 삭제 ──────────────────────────────────────────────────────────


def _local_roots() -> list[Path]:
    from app.services import audio_service, video_service

    roots = [Path(audio_service.CHUNK_STORAGE_DIR), Path(video_service.VIDEO_CHUNK_DIR)]
    extra = os.environ.get("ACCOUNT_DELETION_LOCAL_ROOTS", "")
    roots += [Path(p) for p in extra.split(os.pathsep) if p]
    return [r.resolve() for r in roots]


def _inside_allowed_root(path_text: str) -> bool:
    try:
        resolved = Path(path_text).resolve()
    except OSError:
        return False
    return any(root == resolved or root in resolved.parents for root in _local_roots())


def _s3_key_from_ref(ref: str) -> str | None:
    """URL/키 문자열에서 서비스 소유 S3 키만 돌려준다. 외부 URL 은 None(요청하지 않는다)."""
    bucket = settings.s3_bucket
    if ref.startswith(("http://", "https://")):
        marker = f"/{bucket}/"
        if bucket and marker in ref:
            return ref.split(marker, 1)[1].split("?", 1)[0]
        host = ref.split("/")[2]
        if bucket and host.startswith(f"{bucket}."):
            return "/".join(ref.split("/")[3:]).split("?", 1)[0]
        return None
    return None if ref.startswith("/") else ref


def _default_deleter(kind: str, key: str) -> None:
    from app.services import storage_service

    if kind == "s3":
        storage_service.delete_object_everywhere(key)
    elif kind == "local":
        if not _inside_allowed_root(key):
            raise PermissionError("outside_allowed_root")
        try:
            os.remove(key)
        except FileNotFoundError:
            pass
    else:
        raise ValueError("unknown_kind")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# ── 삭제 계획 수집 ─────────────────────────────────────────────────────


def _table(name: str) -> sa.Table:
    return Base.metadata.tables[name]


def _participant_ids(db: DBSession, uid: uuid.UUID) -> list[uuid.UUID]:
    t = _table("session_participants")
    return [r[0] for r in db.execute(sa.select(t.c.id).where(t.c.user_id == uid))]


def _member_ids(db: DBSession, uid: uuid.UUID) -> list[uuid.UUID]:
    t = _table("class_members")
    return [r[0] for r in db.execute(sa.select(t.c.id).where(t.c.user_id == uid))]


def _owned_condition(table: sa.Table, uid: uuid.UUID, pids: list, cols_user: tuple[str, ...], cols_part: tuple[str, ...]):
    clauses = [table.c[c] == uid for c in cols_user]
    if pids:
        clauses += [table.c[c].in_(pids) for c in cols_part]
    return sa.or_(*clauses) if clauses else sa.false()


def collect_objects(db: DBSession, uid: uuid.UUID) -> list[tuple[str, str]]:
    """삭제 대상 (종류, 키) 목록. 외부 URL·타인 키는 포함하지 않는다."""
    pids = _participant_ids(db, uid)
    found: dict[tuple[str, str], None] = {}

    def add(ref: str | None) -> None:
        if not ref:
            return
        if ref.startswith("/"):  # 로컬 폴백 절대경로 — 삭제 시 허용 루트 안인지 다시 확인한다
            found[("local", ref)] = None
            return
        key = _s3_key_from_ref(ref)
        if key:
            found[("s3", key)] = None

    for table_name, column, _kind in OBJECT_COLUMNS:
        t = _table(table_name)
        if table_name in PARTICIPANT_OWNED:
            parts, users = PARTICIPANT_OWNED[table_name]
            cond = _owned_condition(t, uid, pids, users, parts)
        else:
            cond = sa.or_(*[t.c[c] == uid for c in USER_OWNED[table_name]])
        for (ref,) in db.execute(sa.select(t.c[column]).where(cond)):
            add(ref)
    chat = _table("chat_messages")
    for (ref,) in db.execute(sa.select(chat.c.file_url).where(chat.c.sender_id == uid)):
        add(ref)
    for (ref,) in db.execute(sa.select(_table("users").c.profile_image).where(_table("users").c.id == uid)):
        add(ref)
    prof = _table("client_profiles")
    for (ref,) in db.execute(sa.select(prof.c.profile_image_url).where(prof.c.user_id == uid)):
        add(ref)
    return list(found)


# ── DB 정리 ───────────────────────────────────────────────────────────


def _delete_with_children(db: DBSession, table: sa.Table, condition, visited: frozenset[str] = frozenset()) -> int:
    """condition 에 맞는 행과 그 행을 FK 로 참조하는 자식 행을 (자식부터) 삭제한다."""
    if table.name in visited:
        return 0
    visited = visited | {table.name}
    pk = list(table.primary_key.columns)[0]
    ids_sel = sa.select(pk).where(condition)
    for child in Base.metadata.sorted_tables:
        if child.name in visited or child.name in ("users", "session_participants", "class_members"):
            continue
        for fk in child.foreign_keys:
            if fk.column.table is table and fk.column.name == pk.name:
                _delete_with_children(db, child, child.c[fk.parent.name].in_(ids_sel), visited)
    return db.execute(sa.delete(table).where(condition)).rowcount or 0


def cleanup_database(db: DBSession, uid: uuid.UUID, now: datetime) -> dict[str, Any]:
    """탈퇴자 본인 소유 데이터를 지우고 공유 행에서는 식별 정보만 제거한다. 커밋은 호출자가 한다."""
    report: dict[str, Any] = {"deleted": {}, "scrubbed": {}, "retained": {}}
    pids = _participant_ids(db, uid)
    mids = _member_ids(db, uid)

    # 1) 참여자 소유 개인 데이터 (EEG·리포트·점유·보충 배정)
    for name, (part_cols, user_cols) in PARTICIPANT_OWNED.items():
        t = _table(name)
        n = _delete_with_children(db, t, _owned_condition(t, uid, pids, user_cols, part_cols))
        if n:
            report["deleted"][name] = n

    # 2) 멤버 하위(자격·입장 작업 JSON 등)
    if mids:
        for name in MEMBER_OWNED:
            t = _table(name)
            n = db.execute(sa.delete(t).where(t.c.member_id.in_(mids))).rowcount or 0
            if n:
                report["deleted"][name] = n

    # 3) 본인 소유 행
    for name, cols in USER_OWNED.items():
        t = _table(name)
        n = _delete_with_children(db, t, sa.or_(*[t.c[c] == uid for c in cols]))
        if n:
            report["deleted"][name] = report["deleted"].get(name, 0) + n
    for name, cols in USER_OWNED_NO_FK.items():
        t = _table(name)
        value = str(uid) if isinstance(t.c[cols[0]].type, sa.String) else uid
        n = db.execute(sa.delete(t).where(sa.or_(*[t.c[c] == value for c in cols]))).rowcount or 0
        if n:
            report["deleted"][name] = n

    # 4) 채팅: 본문·첨부를 비우고 발신자 연결 해제(방은 보존)
    chat = _table("chat_messages")
    n = db.execute(
        sa.update(chat).where(chat.c.sender_id == uid).values(content=None, file_url=None, sender_id=None)
    ).rowcount or 0
    if n:
        report["scrubbed"]["chat_messages"] = n

    # 5) 참여자·멤버 식별 정보 제거 (행·출석·집계 보존) + 연구 이력 가명화
    part = _table("session_participants")
    if pids:
        report["scrubbed"]["session_participants"] = db.execute(
            sa.update(part).where(part.c.id.in_(pids)).values(**PARTICIPANT_SCRUB, pii_scrubbed_at=now)
        ).rowcount or 0
    member_t = _table("class_members")
    if mids:
        report["scrubbed"]["class_members"] = db.execute(
            sa.update(member_t).where(member_t.c.id.in_(mids)).values(**MEMBER_SCRUB, pii_scrubbed_at=now)
        ).rowcount or 0
    events = _table("research_consent_events")
    n = db.execute(sa.update(events).where(events.c.actor_user_id == uid).values(actor_user_id=None)).rowcount or 0
    if n:
        report["scrubbed"]["research_consent_events"] = n  # append-only 이력은 지우지 않고 사용자 식별자만 가명화

    # 6) 나머지 nullable 참조 해제 (위에서 처리한 채팅 발신자는 이미 NULL)
    for name, cols in NULLIFY.items():
        t = _table(name)
        for col in cols:
            n = db.execute(sa.update(t).where(t.c[col] == uid).values({col: None})).rowcount or 0
            if n:
                report["scrubbed"][f"{name}.{col}"] = n

    # 7) 필수 FK 로 남아 있는 타인 기록 — 보존 사유 기록
    for name, cols in RETAIN_REFERENCE.items():
        t = _table(name)
        count = db.execute(
            sa.select(sa.func.count()).select_from(t).where(sa.or_(*[t.c[c] == uid for c in cols]))
        ).scalar() or 0
        if count:
            report["retained"][name] = count

    # 8) 혼합 미디어 원본(M2): 호스트로 진행한 회차의 병합 음성·영상은 세션 소유 데이터로 보존한다.
    sess = _table("sessions")
    shared = db.execute(sa.select(sa.func.count()).select_from(sess).where(sess.c.host_id == uid)).scalar() or 0
    if shared:
        report["retained"][REASON_SHARED_MEDIA] = shared
    return report


def _remaining_references(db: DBSession, uid: uuid.UUID) -> int:
    total = 0
    for table in Base.metadata.sorted_tables:
        if table.name == "users":
            continue
        for fk in table.foreign_keys:
            if fk.column.table.name == "users":
                total += db.execute(
                    sa.select(sa.func.count()).select_from(table).where(table.c[fk.parent.name] == uid)
                ).scalar() or 0
    return total


def _finalize_user_row(db: DBSession, user: User, report: dict[str, Any]) -> None:
    """남은 참조가 없으면 users 행을 지운다. 있으면 식별 정보가 없는 tombstone 으로 남긴다."""
    if _remaining_references(db, user.id) == 0:
        db.delete(user)
        return
    report["retained"][REASON_TOMBSTONE] = 1
    user.name = "탈퇴한 사용자"
    user.phone = user.profile_image = user.bio = None
    user.birth_date = None
    user.notification_preferences = None


# ── 스위프 본체 ────────────────────────────────────────────────────────


def due_users(db: DBSession, now: datetime, limit: int) -> list[User]:
    rows = (
        db.query(User)
        .filter(User.status == "deleted", User.purge_after.isnot(None))
        .order_by(User.purge_after)
        .all()
    )
    return [u for u in rows if _as_utc(u.purge_after) <= now][:limit]


def _ledger_for(db: DBSession, user: User) -> AccountDeletionLedger:
    from app.services.account_deletion_service import hash_email

    ledger = db.query(AccountDeletionLedger).filter_by(user_id=user.id).first()
    if ledger is None:  # 원장 이전 시점에 탈퇴 처리된 행(방어): 원장을 만들어 추적한다.
        ledger = AccountDeletionLedger(
            user_id=user.id, email_hash=hash_email(user.email), role=user.role,
            deleted_at=user.deleted_at or datetime.now(timezone.utc), purge_after=user.purge_after, status="requested",
        )
        db.add(ledger)
        db.flush()
    return ledger


def _dry_run_plan(db: DBSession, uid: uuid.UUID) -> dict[str, int]:
    plan: dict[str, int] = {}
    pids = _participant_ids(db, uid)
    for name, cols in USER_OWNED.items():
        t = _table(name)
        c = db.execute(sa.select(sa.func.count()).select_from(t).where(sa.or_(*[t.c[x] == uid for x in cols]))).scalar() or 0
        if c:
            plan[name] = c
    for name, (part_cols, user_cols) in PARTICIPANT_OWNED.items():
        t = _table(name)
        c = db.execute(
            sa.select(sa.func.count()).select_from(t).where(_owned_condition(t, uid, pids, user_cols, part_cols))
        ).scalar() or 0
        if c:
            plan[name] = c
    return plan


def run_account_deletion_sweep(
    db: DBSession,
    *,
    now: datetime | None = None,
    execute: bool = False,
    limit: int = 100,
    deleter: Callable[[str, str], None] | None = None,
) -> dict[str, Any]:
    """30일 경과 탈퇴 사용자를 영구 삭제한다. ``execute=False``(기본)는 보고만 — DB 쓰기·외부 호출 0."""
    moment = _as_utc(now) if now else datetime.now(timezone.utc)
    delete_object = deleter or _default_deleter
    report: dict[str, Any] = {
        "mode": "execute" if execute else "dry_run",
        "legal_hold_confirmed": bool(LEGAL_HOLD_ITEMS),  # M3: 법무 확정 전에는 False — 제출 판정에 쓰지 않는다
        "due": 0, "purged": 0, "failed": 0, "users": [],
    }
    users = due_users(db, moment, limit)
    # 이미 purged 로 끝난 원장의 사용자(tombstone)는 대상에서 제외한다.
    done = {
        uid for (uid,) in db.query(AccountDeletionLedger.user_id).filter(AccountDeletionLedger.status == "purged").all()
    }
    users = [u for u in users if u.id not in done]
    report["due"] = len(users)

    for user in users:
        uid = user.id
        entry: dict[str, Any] = {"user_id": str(uid)}
        objects = collect_objects(db, uid)
        # 탈퇴 처리 때 원장에 먼저 옮겨 둔 키(자격 증빙 등)와 이전 시도에서 남은 키도 함께 센다.
        queued = (
            db.query(AccountDeletionObject.kind, AccountDeletionObject.object_key)
            .join(AccountDeletionLedger, AccountDeletionLedger.id == AccountDeletionObject.ledger_id)
            .filter(AccountDeletionLedger.user_id == uid, AccountDeletionObject.status.in_(("pending", "failed")))
            .all()
        )
        entry["objects"] = len(set(objects) | {(k, key) for k, key in queued})
        if not execute:
            entry["would_delete"] = _dry_run_plan(db, uid)
            report["users"].append(entry)
            continue

        # 다른 워커가 같은 사용자를 처리 중이면 건너뛴다(행 잠금).
        locked = db.query(User).filter(User.id == uid).with_for_update(skip_locked=True).first()
        if locked is None:
            continue
        ledger = _ledger_for(db, locked)
        if ledger.status == "purged":
            continue
        ledger.status = "purging"
        ledger.attempts += 1
        ledger.last_error = None

        # 연구 철회 원장은 삭제보다 먼저 — Spark 확인 전 근거를 잃지 않는다(이미 있으면 중복 생성 없음).
        from app.services import privacy_consent_service

        privacy_consent_service._withdraw_research(db, uid, moment)

        existing = {o.object_key for o in db.query(AccountDeletionObject).filter_by(ledger_id=ledger.id).all()}
        for kind, key in objects:
            if key not in existing:
                db.add(AccountDeletionObject(ledger_id=ledger.id, object_key=key, kind=kind, status="pending"))
        db.commit()

        failed = 0
        for row in db.query(AccountDeletionObject).filter_by(ledger_id=ledger.id).all():
            if row.status in ("deleted", "skipped"):
                continue
            row.attempts += 1
            try:
                delete_object(row.kind, row.object_key)
                row.status, row.last_error, row.deleted_at = "deleted", None, moment
            except PermissionError:
                row.status, row.last_error = "skipped", "outside_allowed_root"
            except Exception as exc:  # noqa: BLE001 — 사유 종류만 기록(키·응답 본문 금지)
                row.status, row.last_error = "failed", type(exc).__name__[:100]
                failed += 1
        db.commit()
        if failed:
            ledger = db.query(AccountDeletionLedger).filter_by(user_id=uid).first()
            ledger.status, ledger.last_error = "failed", f"objects_failed:{failed}"
            db.commit()
            entry["status"] = "failed"
            report["failed"] += 1
            report["users"].append(entry)
            continue

        try:
            target = db.query(User).filter(User.id == uid).first()
            cleanup = cleanup_database(db, uid, moment)
            ledger = db.query(AccountDeletionLedger).filter_by(user_id=uid).first()
            _finalize_user_row(db, target, cleanup)
            ledger.status, ledger.purged_at, ledger.last_error = "purged", moment, None
            ledger.retained_reasons = cleanup["retained"] or None
            db.commit()
            entry.update(status="purged", **{k: cleanup[k] for k in ("deleted", "scrubbed", "retained")})
            report["purged"] += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            ledger = db.query(AccountDeletionLedger).filter_by(user_id=uid).first()
            if ledger is not None:
                ledger.status, ledger.last_error = "failed", f"db_cleanup:{type(exc).__name__}"[:200]
                db.commit()
            entry["status"] = "failed"
            report["failed"] += 1
            logger.exception("[account-deletion-sweep] DB 정리 실패 user=%s", uid)
        report["users"].append(entry)
    return report

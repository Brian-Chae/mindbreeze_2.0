"""SDD-237 클래스 회차 요약·리포트 조회 서비스.

조회(GET)는 읽기 전용이다 — 승인·메일·알림·AI·재생성을 호출하지 않는다(verify P9).
쓰기는 진행 기록 안내 상태(claim/dismiss)와 서사 문장 수정(class_report_narrative)뿐이다.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import class_report_narrative as narrative
from app.services import report_scope

logger = logging.getLogger(__name__)

NOTE_PROMPT_ROLES = ("counselor", "org_admin")


def _api_error(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code})


def _to_uuid(value) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


# ─────────────────────────── 진행 기록 1회 안내 ───────────────────────────

def load_note_prompt_user(db: DBSession, user_id) -> User:
    """안내 설정·claim 은 상담사/기관관리자 본인 계정만 쓴다."""
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if user is None or user.status != "active":
        raise _api_error(404, "user_not_found")
    if user.role not in NOTE_PROMPT_ROLES:
        raise _api_error(403, "note_prompt_forbidden")
    return user


def get_show_session_note_prompt(db: DBSession, user_id) -> bool:
    return bool(load_note_prompt_user(db, user_id).show_session_note_prompt)


def set_show_session_note_prompt(db: DBSession, user_id, enabled: bool) -> bool:
    user = load_note_prompt_user(db, user_id)
    user.show_session_note_prompt = bool(enabled)
    db.commit()
    return bool(user.show_session_note_prompt)


def _load_class_session(db: DBSession, session_id) -> Session:
    session = db.query(Session).filter(Session.id == _to_uuid(session_id)).first()
    if session is None:
        raise _api_error(404, "session_not_found")
    if session.class_id is None:
        raise _api_error(400, "not_class_session")
    return session


def has_session_note(db: DBSession, session_id) -> bool:
    """진행 기록(비공개 메모)이 이미 있는지. 빈 공백 메모는 기록으로 보지 않는다."""
    note = (
        db.query(SessionRecord.counselor_notes)
        .filter(SessionRecord.session_id == session_id)
        .scalar()
    )
    return isinstance(note, str) and bool(note.strip())


def claim_note_prompt(db: DBSession, session_id, user_id) -> bool:
    """안내를 보여줄지 원자적으로 결정한다. True 는 이 호출이 '처음이자 유일한' 노출권을 얻었다는 뜻.

    UPDATE ... WHERE seen IS NULL AND host_id=:me 의 rowcount 로 판정하므로 다중 탭·기기·동시 요청에서도
    정확히 한 번만 True 다. 기록이 이미 있거나 사용자가 안내를 껐으면 노출권을 소모하지 않고 False 를 돌려준다.
    """
    user = load_note_prompt_user(db, user_id)
    session = _load_class_session(db, session_id)
    if session.host_id != user.id or not user.show_session_note_prompt:
        return False
    if has_session_note(db, session.id):
        return False
    result = db.execute(
        update(Session)
        .where(
            Session.id == session.id,
            Session.host_id == user.id,
            Session.note_prompt_seen_at.is_(None),
        )
        .values(note_prompt_seen_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return result.rowcount == 1


def dismiss_note_prompt(db: DBSession, session_id, user_id) -> datetime:
    """[비워두기] — 멱등. 이미 있으면 기존 시각을 그대로 돌려준다."""
    user = load_note_prompt_user(db, user_id)
    session = _load_class_session(db, session_id)
    if session.host_id != user.id:
        raise _api_error(403, "note_prompt_forbidden")
    if session.note_prompt_dismissed_at is None:
        now = datetime.now(timezone.utc)
        db.execute(
            update(Session)
            .where(Session.id == session.id, Session.note_prompt_dismissed_at.is_(None))
            .values(note_prompt_dismissed_at=now)
            .execution_options(synchronize_session=False)
        )
        db.commit()
        db.refresh(session)
    return session.note_prompt_dismissed_at


# ─────────────────────────── 권한 ───────────────────────────

def _load_viewer(db: DBSession, viewer_id) -> User:
    viewer = db.query(User).filter(User.id == _to_uuid(viewer_id)).first()
    if viewer is None or viewer.status != "active":
        raise _api_error(403, "report_read_forbidden")
    return viewer


def can_view_class_report(db: DBSession, viewer: User, session: Session) -> bool:
    """열람 권한 — 기존 규칙을 넓히지 않는다: 진행 상담사 / 팀 열람 조건 충족 강사 / 같은 기관 org_admin.

    회차 참여자(회원)는 `_can_access_report` 와 달리 여기서 제외한다(상담사용 리포트는 회원에게 비노출, P6).
    """
    from app.services.class_access_service import admin_can_read_meditation_report, can_read_team_material

    if viewer.role == "org_admin":
        return admin_can_read_meditation_report(db, viewer, session)
    if viewer.role != "counselor":
        return False
    if session.host_id == viewer.id:
        return True
    return can_read_team_material(db, viewer.id, session)


def can_edit_narrative(db: DBSession, viewer: User, session: Session) -> bool:
    """서사 문장 수정 권한 — 해당 회차 진행 상담사 또는 클래스 lead 강사만. assistant·org_admin 은 읽기 전용."""
    from app.services.class_access_service import class_role

    if viewer.role != "counselor" or viewer.status != "active":
        return False
    if session.host_id == viewer.id:
        return True
    cls = db.query(Class).filter(Class.id == session.class_id).first() if session.class_id else None
    return bool(cls and class_role(db, viewer, cls) == "lead")


def load_completed_class_session(db: DBSession, session_id, viewer_id) -> tuple[Session, User]:
    """404 → 403 → 400 → 409 순으로 거른다(존재 노출보다 권한을 먼저 본다)."""
    session = db.query(Session).filter(Session.id == _to_uuid(session_id)).first()
    if session is None:
        raise _api_error(404, "session_not_found")
    viewer = _load_viewer(db, viewer_id)
    if not can_view_class_report(db, viewer, session):
        raise _api_error(403, "report_read_forbidden")
    from app.services.report_service import report_domain

    if report_domain(session) != "meditation":
        raise _api_error(400, "not_class_session")
    if session.status != "completed":
        raise _api_error(409, "not_completed")
    return session, viewer


# ─────────────────────────── 조회 조각 ───────────────────────────

_GENERATING = ("pending", "processing")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _counselor_report(db: DBSession, session_id) -> Report | None:
    return (
        db.query(Report)
        .filter(Report.session_id == session_id, Report.type == "counselor")
        .order_by(Report.created_at.asc(), Report.id.asc())
        .first()
    )


def _report_info(report: Report | None, block: dict | None) -> dict:
    gen = (report.generation_status if report else None) or "pending"
    if report is None or gen in _GENERATING:
        state = "processing"
    elif report.status == "error" and block is None:
        state = "error"
    else:
        state = "ready"
    return {
        "id": str(report.id) if report else None,
        "generation_status": gen if report else "pending",
        "state": state,
        "narrative_pending": narrative_pending(block) if state == "ready" else False,
    }


def narrative_pending(block: dict | None) -> bool:
    """AI 서사가 곧 채워질 예정인지 — AI 태스크(B7) 연결 전에는 항상 False."""
    return False


def _block_of(report: Report | None) -> dict | None:
    if report is None or (report.generation_status or "pending") in _GENERATING:
        return None
    content = report.content if isinstance(report.content, dict) else {}
    block = content.get("class_report")
    return block if isinstance(block, dict) else None


def _editor_names(db: DBSession, block: dict | None) -> dict[str, str]:
    ids = set()
    for field in ((block or {}).get("narrative") or {}).get("fields", {}).values():
        if field.get("edited_by"):
            ids.add(field["edited_by"])
    if not ids:
        return {}
    uids = []
    for raw in ids:
        try:
            uids.append(uuid.UUID(str(raw)))
        except ValueError:
            continue
    return {str(u.id): u.name for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}


def _present_narrative(block: dict, names: dict[str, str]) -> dict:
    narr = block.get("narrative") or {}
    input_hash = narr.get("input_hash") or narrative.compute_input_hash(block)
    return {
        "prompt_version": narr.get("prompt_version") or narrative.PROMPT_VERSION,
        "model": narr.get("model"),
        "input_hash": input_hash,
        "generated_at": narr.get("generated_at"),
        "ai_attempt": narr.get("ai_attempt"),
        "fields": {k: narrative.present_field(k, f, input_hash, names)
                   for k, f in (narr.get("fields") or {}).items()},
        "fallback_fields": list(narr.get("fallback_fields") or []),
    }


_CHIP_STATE = {"ok": "ok", "single": "single", "poor_signal": "poor_signal"}


def _chips(block: dict) -> dict:
    from app.services.class_report_stats_service import METRIC_KEYS

    chips = {"body": [], "mind": []}
    for key in METRIC_KEYS:
        m = (block.get("metrics") or {}).get(key) or {}
        direction = m.get("direction") if m.get("state") == "ok" else None
        state = _CHIP_STATE.get(m.get("state"), "missing")
        if state == "ok" and direction is None:
            state = "missing"
        chips["body" if key in ("respiration", "bpm", "hrv") else "mind"].append(
            {"key": key, "direction": direction, "state": state})
    return chips


def _participants_in_scope(db: DBSession, session: Session):
    """리포트 행에 나올 참여자 — 대기열·제거된 사람은 뺀다. (참여 순서 고정, 정렬 없음)"""
    scope = report_scope.scope_for_session(session.id, db)
    ids = set(scope.included_ids) | set(scope.excluded_ids)
    rows = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id.in_(ids), SessionParticipant.is_waitlisted.is_(False))
        .all()
    ) if ids else []
    rows = [r for r in rows if r.removed_at is None]
    rows.sort(key=lambda r: (r.joined_at is None, r.joined_at, str(r.id)))
    return scope, rows


def _is_absent(p: SessionParticipant) -> bool:
    return p.attendance_status in ("excused", "withdrawn")


def _headcount(block: dict | None, scope, rows) -> dict:
    present = [p for p in rows if not _is_absent(p)]
    included = [p for p in present if p.id in scope.included_ids]
    measured = None
    if block is not None:
        measured = (block.get("scope") or {}).get("measured")
    return {"attended": len(present), "measured": measured,
            "report_targets": len(included), "excluded": len(present) - len(included)}


def _eeg_status(report: Report) -> str | None:
    eeg = report.content.get("eeg") if isinstance(report.content, dict) else None
    return eeg.get("status") if isinstance(eeg, dict) else None


def _approval(db: DBSession, session: Session, host: User | None, scope, rows) -> dict:
    """승인 현황 — type=client 리포트만 센다(상담사용 클래스 리포트는 승인 대상이 아니다, P8)."""
    from app.services.report_service import auto_approve_enabled

    enabled = auto_approve_enabled(host, session)
    target_ids = {p.id for p in rows if p.id in scope.included_ids and not _is_absent(p)}
    reports = [
        r for r in db.query(Report).filter(Report.session_id == session.id, Report.type == "client").all()
        if r.participant_id in target_ids
    ]
    counts = {"generating": 0, "pending_review": 0, "approved": 0, "error": 0, "no_data_manual": 0}
    for r in reports:
        if r.status == "error":
            counts["error"] += 1
        elif (r.generation_status or "pending") in _GENERATING or r.status == "pending_analysis":
            counts["generating"] += 1
        elif r.status == "completed":
            counts["approved"] += 1
        elif r.status == "pending_review":
            counts["pending_review"] += 1
            if enabled and _eeg_status(r) in (None, "not_measured"):
                counts["no_data_manual"] += 1
    return {"auto_approve": {"enabled": enabled, "grace_minutes": 0}, "counts": counts,
            "participants_total": len(target_ids)}


def _note_prompt(db: DBSession, session: Session, viewer: User) -> dict:
    has_note = has_session_note(db, session.id)
    is_host = session.host_id == viewer.id and viewer.role == "counselor"
    seen = session.note_prompt_seen_at is not None
    dismissed = session.note_prompt_dismissed_at is not None
    enabled = bool(viewer.show_session_note_prompt)
    return {"eligible": bool(is_host and enabled and not has_note and not seen and not dismissed),
            "has_note": has_note, "seen": seen, "dismissed": dismissed, "user_enabled": enabled}


def _next_session(db: DBSession, session: Session) -> dict | None:
    nxt = (
        db.query(Session)
        .filter(
            Session.class_id == session.class_id,
            Session.seq > (session.seq or 0),
            Session.status.notin_(("completed", "cancelled")),
        )
        .order_by(Session.seq.asc())
        .first()
    )
    if nxt is None:
        return None
    return {"id": str(nxt.id), "seq": nxt.seq, "scheduled_at": nxt.scheduled_at}


def _duration_min(session: Session) -> int | None:
    if session.started_at and session.ended_at:
        from app.tasks.report_task import _ensure_aware_dt

        return round((_ensure_aware_dt(session.ended_at) - _ensure_aware_dt(session.started_at)).total_seconds() / 60)
    return session.duration_min


# ─────────────────────────── 요약 / 리포트 ───────────────────────────

def build_summary(db: DBSession, session_id, viewer_id) -> dict:
    """회차 요약(S0·S1·S2·S6). 읽기 전용 — 승인·메일·알림·AI·재생성을 호출하지 않는다."""
    from app.services.report_service import can_approve_report

    session, viewer = load_completed_class_session(db, session_id, viewer_id)
    cls = db.query(Class).filter(Class.id == session.class_id).first()
    report = _counselor_report(db, session.id)
    block = _block_of(report)
    scope, rows = _participants_in_scope(db, session)
    host = db.query(User).filter(User.id == session.host_id).first()
    names = _editor_names(db, block)

    if block is None:
        class_report = {"available": False, "status": "pending", "flags": [], "scope": None,
                        "headline": None, "chips": {"body": [], "mind": []}}
    else:
        fields = narrative_fields = _present_narrative(block, names)["fields"]
        head = fields.get("headline")
        class_report = {
            "available": True, "status": block.get("status"), "flags": list(block.get("flags") or []),
            "scope": block.get("scope"),
            "headline": ({"text": head["text"], "source": head["source"],
                          "edited_by_name": head["edited_by_name"], "edited_at": head["edited_at"]}
                         if head else None),
            "chips": _chips(block),
        }
    return {
        "session": {
            "id": str(session.id), "class_id": str(session.class_id),
            "class_name": cls.title if cls else None, "seq": session.seq,
            "started_at": session.started_at, "ended_at": session.ended_at,
            "duration_min": _duration_min(session), "domain": "meditation",
        },
        "headcount": _headcount(block, scope, rows),
        "report": _report_info(report, block),
        "class_report": class_report,
        "approval": _approval(db, session, host, scope, rows),
        "note_prompt": _note_prompt(db, session, viewer),
        "next_session": _next_session(db, session),
        "capabilities": {
            "can_edit_narrative": can_edit_narrative(db, viewer, session),
            "can_write_note": bool(session.host_id == viewer.id and viewer.role == "counselor"),
            "can_approve": can_approve_report(db, viewer, session),
        },
        "fetched_at": _now(),
    }


_GENERATION = {"pending": "pending", "processing": "processing", "ready": "ready", "partial": "ready"}


def _delivery(db: DBSession, p: SessionParticipant, report: Report | None, user: User | None) -> str:
    """전달 상태는 participant.report_email_status 기반. sent_at 만으로 sent 라고 하지 않는다."""
    if report is None:
        return "not_requested"
    status = p.report_email_status
    if status == "sent":
        return "sent"
    if status == "failed":
        return "failed"
    if status == "cancelled":
        return "not_requested"
    if p.report_email_sent_at is not None:
        return "unknown"
    if not (p.report_email or (user is not None and user.email)):
        return "no_address"
    return "waiting" if report.status == "completed" else "not_requested"


def _participant_rows(db: DBSession, session: Session, block: dict | None, scope, rows) -> list[dict]:
    user_ids = [p.user_id for p in rows if p.user_id]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    reports = {r.participant_id: r for r in
               db.query(Report).filter(Report.session_id == session.id, Report.type == "client").all()}
    states = {r["participant_id"]: r["state"] for r in (block or {}).get("participants", [])}
    out = []
    for order, p in enumerate(rows, start=1):
        included = p.id in scope.included_ids
        exclusion = "not_included" if not included else ("absent" if _is_absent(p) else None)
        user = users.get(p.user_id) if p.user_id else None
        rep = reports.get(p.id) if exclusion is None else None
        if exclusion is not None:
            measurement = "excluded"
        else:
            measurement = states.get(str(p.id), "unworn")
        gen = _GENERATION.get(rep.generation_status or "pending", "pending") if rep else "none"
        if rep is not None and rep.status == "error":
            gen = "failed"
        out.append({
            "participant_id": str(p.id),
            "display_name": user.name if user is not None else p.guest_name,
            "kind": "member" if (p.user_id or p.member_id) else "guest",
            "order": order, "included": included, "exclusion": exclusion, "measurement": measurement,
            "report": {
                "id": str(rep.id) if rep else None, "generation": gen,
                "approval": rep.status if rep and rep.status in
                ("pending_analysis", "pending_review", "completed", "error") else "none",
                "delivery": _delivery(db, p, rep, user),
            },
            "narrative_field": f"participant.{p.id}",
        })
    return out


def build_class_report(db: DBSession, session_id, viewer_id) -> dict:
    """상담사 클래스 리포트(R1~R5). 참여자 이름은 이 응답에만 있고 블록(JSONB)에는 저장하지 않는다."""
    session, viewer = load_completed_class_session(db, session_id, viewer_id)
    cls = db.query(Class).filter(Class.id == session.class_id).first()
    report = _counselor_report(db, session.id)
    block = _block_of(report)
    scope, rows = _participants_in_scope(db, session)
    names = _editor_names(db, block)
    presented = None
    if block is not None:
        presented = {**block, "narrative": _present_narrative(block, names)}
    return {
        "session": {"id": str(session.id), "class_name": cls.title if cls else None, "seq": session.seq,
                    "ended_at": session.ended_at, "duration_min": _duration_min(session)},
        "report": _report_info(report, block),
        "block": presented,
        "participants": _participant_rows(db, session, block, scope, rows),
        "capabilities": {"can_edit_narrative": can_edit_narrative(db, viewer, session)},
        "fetched_at": _now(),
    }


# ─────────────────────────── 서사 문장 수정 ───────────────────────────

def _validate_text(text: str | None, key: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise _api_error(422, "empty_text")
    if any(ord(ch) < 32 and ch not in "\n\t" or ord(ch) == 127 for ch in cleaned):
        raise _api_error(422, "invalid_text")
    if len(cleaned) > narrative.max_len_for(key):
        raise _api_error(422, "text_too_long")
    return cleaned


def edit_narrative(db: DBSession, session_id, viewer_id, *, field: str, text: str | None, revert: bool,
                   base_edited_at: str | None, check_base: bool) -> dict:
    """서사 문장 1개 수정/되돌리기. 리포트 행을 잠가 동시 수정을 직렬화하고, 승인·메일·알림·AI 는 건드리지 않는다.

    '올리기' = 리포트에 저장(상담사·기관관리자 열람)일 뿐 회원 발송과 무관하다.
    """
    from app.services.report_service import report_domain

    session = db.query(Session).filter(Session.id == _to_uuid(session_id)).first()
    if session is None:
        raise _api_error(404, "session_not_found")
    viewer = db.query(User).filter(User.id == _to_uuid(viewer_id)).first()
    if viewer is None or not can_edit_narrative(db, viewer, session):
        raise _api_error(403, "narrative_edit_forbidden")
    if report_domain(session) != "meditation":
        raise _api_error(400, "not_class_session")
    if session.status != "completed":
        raise _api_error(409, "not_completed")
    if not narrative.is_editable_key(field):
        raise _api_error(422, "field_not_editable")

    report = _counselor_report(db, session.id)
    if report is None:
        raise _api_error(409, "report_not_ready")
    # 행 잠금 후 최신 내용을 다시 읽는다(SQLite 는 FOR UPDATE 를 무시하지만 단일 쓰기라 안전).
    report = (
        db.query(Report).filter(Report.id == report.id).with_for_update().populate_existing().one()
    )
    block = _block_of(report)
    if block is None:
        raise _api_error(409, "report_not_ready")
    narr = block.get("narrative") or {}
    fields = narr.get("fields") or {}
    if field not in fields:
        raise _api_error(422, "field_not_editable")
    input_hash = narr.get("input_hash") or narrative.compute_input_hash(block)
    names = {str(viewer.id): viewer.name}

    if check_base and fields[field].get("edited_at") != base_edited_at:
        detail = {"code": "edit_conflict",
                  "value": narrative.present_field(field, fields[field], input_hash,
                                                   {**names, **_editor_names(db, block)})}
        raise HTTPException(status_code=409, detail=detail)

    if revert:
        new_fields = narrative.revert_edit(fields, field, input_hash) if fields[field].get("edited_text") else fields
    else:
        cleaned = _validate_text(text, field)
        new_fields = narrative.apply_edit(
            fields, field, cleaned, str(viewer.id), input_hash,
            _now().strftime("%Y-%m-%dT%H:%M:%S.%fZ"))

    if new_fields is not fields:
        content = dict(report.content)
        content["class_report"] = {**block, "narrative": {**narr, "fields": new_fields}}
        report.content = content
        db.commit()
        # 감사 로그에는 키·사용자·시각만 남긴다 — 문장 원문과 이름은 남기지 않는다.
        logger.info("[class_report] narrative %s field=%s user_id=%s at=%s",
                    "revert" if revert else "edit", field, viewer.id, _now().isoformat())
    return {
        "field": field,
        "value": narrative.present_field(field, new_fields[field], input_hash,
                                         {**names, **_editor_names_from_fields(db, new_fields)}),
        "fetched_at": _now(),
    }


def _editor_names_from_fields(db: DBSession, fields: dict) -> dict[str, str]:
    return _editor_names(db, {"narrative": {"fields": fields}})

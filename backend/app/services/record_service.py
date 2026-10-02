"""AI 기록지 조회·편집 서비스 (+ SDD-096 셀프 체크인)"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord, VideoChunk
from app.schemas.record import SubjectiveSlot


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_session_for_user(session_id: str, user_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    uid = _to_uuid(user_id)
    if s.host_id == uid:
        return s
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == sid, SessionParticipant.user_id == uid)
        .first()
    )
    if participant:
        return s
    raise HTTPException(status_code=403, detail="접근 권한이 없습니다")


def _get_session_as_host(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


# ---------------------------------------------------------------------------
# SDD-096: 주관 상태(셀프 체크인) 직렬화 — 저장/조회/리포트가 공유하는 단일 계약
# ---------------------------------------------------------------------------


def _slot(raw) -> dict | None:
    """저장된 슬롯 하나를 검증·정규화한다. 값이 없으면 None(0 치환 금지)."""
    if not isinstance(raw, dict):
        return None
    try:
        slot = SubjectiveSlot(
            arousal=raw.get("arousal"),
            valence=raw.get("valence"),
            note=raw.get("note"),
            recorded_at=raw.get("recorded_at"),
        )
    except ValidationError:
        return None
    if slot.arousal is None and slot.valence is None and not slot.note:
        return None
    return slot.model_dump(mode="json")


def _entry(raw) -> dict | None:
    """참여자 항목 → {"before": slot|None, "after": slot|None}. 둘 다 없으면 None."""
    if not isinstance(raw, dict):
        return None
    result = {"before": _slot(raw.get("before")), "after": _slot(raw.get("after"))}
    if result["before"] is None and result["after"] is None:
        return None
    return result


def _participants_map(record: SessionRecord | None) -> dict:
    if record is None or not isinstance(record.subjective_state, dict):
        return {}
    participants = record.subjective_state.get("participants")
    return participants if isinstance(participants, dict) else {}


def participant_subjective_state(record: SessionRecord | None, participant_id) -> dict | None:
    """참여자 본인 슬롯 — 내담자 리포트/체크인 응답용. 없으면 None."""
    if participant_id is None:
        return None
    entry = _entry(_participants_map(record).get(str(participant_id)))
    if entry is None:
        return None
    return {"scope": "participant", **entry}


def session_subjective_state(record: SessionRecord | None) -> dict | None:
    """세션 전체(참여자별) 슬롯 — 상담사 기록지/상담사 리포트용. 없으면 None."""
    entries = {}
    for participant_id, raw in _participants_map(record).items():
        entry = _entry(raw)
        if entry is not None:
            entries[str(participant_id)] = entry
    if not entries:
        return None
    return {"scope": "session", "participants": entries}


def resolve_subjective_state(
    session_id, participant_id, db: DBSession
) -> dict | None:
    """리포트 직렬화용 — 참여자 스코프 우선. 참여자 슬롯이 없으면 None."""
    record = (
        db.query(SessionRecord).filter(SessionRecord.session_id == _to_uuid(session_id)).first()
    )
    return participant_subjective_state(record, participant_id)


def subjective_state_map(session_ids, db: DBSession) -> dict:
    """목록 직렬화용 배치 조회 — {session_id(UUID): SessionRecord}."""
    if not session_ids:
        return {}
    records = (
        db.query(SessionRecord).filter(SessionRecord.session_id.in_(list(session_ids))).all()
    )
    return {record.session_id: record for record in records}


def _serialize(
    record: SessionRecord | None,
    session_id: UUID,
    subjective_state: dict | None = None,
    video_actual_chunks: int | None = None,
) -> dict:
    if record is None:
        return {
            "session_id": str(session_id),
            "status": "idle",
            "transcript": None,
            "ai_summary": {},
            "counselor_notes": None,
            "markers": [],
            "is_edited": False,
            "edit_history": [],
            "subjective_state": subjective_state,
            # SDD-101 D1: 영상 저장 무결성 — merge_failed/누락 표시용
            "video_status": "idle",
            "video_expected_chunks": None,
            "video_actual_chunks": video_actual_chunks,
        }
    return {
        "session_id": str(session_id),
        "status": record.status or "idle",
        "transcript": record.transcript,
        "ai_summary": record.ai_summary or {},
        "counselor_notes": record.counselor_notes,
        "markers": list(record.markers or []),
        "is_edited": bool(record.is_edited),
        "edit_history": list(record.edit_history or []),
        "subjective_state": subjective_state,
        # SDD-101 D1: 영상 저장 무결성 — merge_failed/누락 표시용
        "video_status": record.video_status or "idle",
        "video_expected_chunks": record.video_expected_chunks,
        "video_actual_chunks": video_actual_chunks,
    }


def get_record(session_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_for_user(session_id, user_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    # SDD-101 D1: 영상 청크 실제 수신 수 — 누락 여부 판정용.
    video_actual = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
    # SDD-096: 호스트는 세션 전체, 참여자는 본인 슬롯만 본다(다른 참여자 소감 비노출).
    if s.host_id == _to_uuid(user_id):
        subjective = session_subjective_state(record)
    else:
        participant = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == s.id, SessionParticipant.user_id == _to_uuid(user_id))
            .first()
        )
        subjective = participant_subjective_state(record, participant.id if participant else None)
    return _serialize(record, s.id, subjective, video_actual_chunks=video_actual)


def get_transcript(session_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_for_user(session_id, user_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    summary = (record.ai_summary or {}) if record else {}
    segments = summary.get("segments", []) if isinstance(summary, dict) else []
    return {
        "session_id": str(s.id),
        "status": (record.status if record else "idle") or "idle",
        "segments": segments,
        "raw_text": record.transcript if record else None,
    }


def get_report_status(session_id: str, user_id: str, db: DBSession) -> dict:
    """SDD-095: 세션의 리포트 생성 진행 상태 — 접근 권한 검증 후 파생한다.

    접근 규칙은 기록지 조회와 동일(세션 호스트 또는 참여자)하다.
    """
    from app.services import report_progress_service

    s = _get_session_for_user(session_id, user_id, db)
    return report_progress_service.compute_report_progress(s.id, db)


def update_record(session_id: str, host_id: str, payload, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    if not record:
        record = SessionRecord(session_id=s.id, status="idle", markers=[], edit_history=[], ai_summary={})
        db.add(record)
        db.flush()

    changes: dict = {}
    if payload.counselor_notes is not None:
        changes["counselor_notes"] = {"before": record.counselor_notes, "after": payload.counselor_notes}
        record.counselor_notes = payload.counselor_notes
    if payload.ai_summary is not None:
        changes["ai_summary"] = {"before": record.ai_summary, "after": payload.ai_summary}
        record.ai_summary = payload.ai_summary

    if changes:
        history = list(record.edit_history or [])
        history.append({"edited_at": _now().isoformat(), "editor_id": str(host_id), "changes": changes})
        record.edit_history = history
        record.is_edited = True

    db.commit()
    db.refresh(record)
    return _serialize(record, s.id, session_subjective_state(record))


# ---------------------------------------------------------------------------
# SDD-096: POST /sessions/{id}/checkin — 세션 직후 1탭 셀프 체크인
# ---------------------------------------------------------------------------


def _get_session(session_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return s


def _resolve_checkin_participant(
    s: Session, payload, user_id: str | None, db: DBSession
) -> SessionParticipant:
    """체크인 주체를 확정한다 — 로그인 회원(본인 참여자) 또는 게스트(토큰 소유 증명)."""
    from app.services.session_service import _authorize_participant_access

    if payload.participant_id:
        try:
            pid = _to_uuid(payload.participant_id)
        except HTTPException:
            raise HTTPException(status_code=403, detail="참여자 확인 정보가 일치하지 않습니다")
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.id == pid,
                SessionParticipant.session_id == s.id,
                SessionParticipant.is_waitlisted.is_(False),
            )
            .first()
        )
        if not participant:
            raise HTTPException(status_code=403, detail="해당 세션의 참가자가 아닙니다")
        _authorize_participant_access(
            participant,
            participant_token=payload.participant_token,
            current_user_id=user_id,
        )
        return participant

    # participant_id 미지정 — 로그인 회원이면 본인 참여자로 한정한다.
    if user_id is None:
        raise HTTPException(status_code=403, detail="참여자 확인 정보가 필요합니다")
    participant = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.user_id == _to_uuid(user_id),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=403, detail="해당 세션의 참가자가 아닙니다")
    return participant


def submit_checkin(session_id: str, payload, user_id: str | None, db: DBSession) -> dict:
    """세션 직후 1탭 셀프 체크인 — 주관 상태를 SessionRecord.subjective_state 에 적재한다.

    - 밴드 미착용(세션 레코드 없음)이어도 레코드를 만들어 주관 기록을 남긴다.
    - phase 단위 저장: before(수업 전 예상)/after(수업 후)를 각각 덮어쓴다.
    - 취소된 세션은 409 (그 외 상태는 종료 화면 진입 타이밍 차이를 흡수해 허용).
    """
    s = _get_session(session_id, db)
    if s.status == "cancelled":
        raise HTTPException(status_code=409, detail="취소된 세션에는 체크인할 수 없습니다")

    participant = _resolve_checkin_participant(s, payload, user_id, db)

    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    if not record:
        record = SessionRecord(
            session_id=s.id, status="idle", markers=[], edit_history=[], ai_summary={}
        )
        db.add(record)
        db.flush()

    state = dict(record.subjective_state) if isinstance(record.subjective_state, dict) else {}
    participants_map = dict(state.get("participants") or {})
    entry = dict(participants_map.get(str(participant.id)) or {})
    entry[payload.phase] = {
        "arousal": payload.arousal,
        "valence": payload.valence,
        "note": payload.note,
        "recorded_at": _now().isoformat(),
    }
    entry["updated_at"] = _now().isoformat()
    participants_map[str(participant.id)] = entry

    # 불변성 — 새 dict 를 만들어 통째로 교체한다(기존 객체 직접 변경 금지).
    record.subjective_state = {
        "participants": participants_map,
        "updated_at": _now().isoformat(),
    }
    db.commit()
    db.refresh(record)

    return {
        "session_id": str(s.id),
        "participant_id": str(participant.id),
        "phase": payload.phase,
        "subjective_state": participant_subjective_state(record, participant.id)
        or {"scope": "participant", "before": None, "after": None},
    }

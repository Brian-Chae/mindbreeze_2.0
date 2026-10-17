"""기본 DB 삭제 스위프 (SDD-209 B12 / BE-R2 · MG-6).

하나의 실행 단위로 다음을 처리한다.

1. **원본 기간 삭제** — EEG raw · 음성 청크 · 영상 청크/병합본 · STT 원문(``transcript``/``ai_summary.segments``).
   기준일은 청크 시각이 아니라 **세션 종료일**(미종료 값은 ``created_at`` 폴백), 보관 기간은 설정값 ``RETENTION_RAW_DAYS``.
   종료(completed)·취소(cancelled) 클래스만 대상이며 일반 삭제로 숨긴 클래스도 포함한다.
2. **비회원 개인정보 스크럽** — 이름·성별·생년월일·리포트 이메일과 이메일 초대 주소를 비운다(행·세션 참조 유지,
   ``pii_scrubbed_at`` 기록). 보관 기간은 ``RETENTION_GUEST_PII_DAYS``.
3. **연구 게이트** — 연구 동의(미철회) 참여자의 EEG raw 는 ``export_state=acked`` 가 아니면 삭제를 **보류**하고(내보내기 큐 유지),
   보류가 삭제 기한을 ``RETENTION_HOLD_ALERT_DAYS`` 넘기면 플랫폼 관리자에게 **1회** 알린다. 거부·철회 건은 게이트가 없다.
4. **임시·고아 정리** — pending/failed EEG 청크와 부모 없는 미디어 청크 같은 재생성 가능한 임시 데이터만 즉시 정리한다.

안전장치
- 기본 ``RETENTION_SWEEP_ENABLED=false`` — 이때는 항상 dry-run(삭제 0)이며 후보 건수·바이트·보류 건수만 보고한다.
- 활성이어도 ``RETENTION_APPLY_FROM``(N-5)이 비어 있으면 실제 삭제를 거부하고 dry-run 으로만 동작한다.
- 리포트 본문·지표 요약·회원 계정은 대상이 아니다(N-2). 모든 실행은 ``retention_sweep_runs`` 에 이력을 남긴다.
- 파일/객체 삭제는 DB 커밋 뒤 best-effort 다(S3 버저닝이 꺼져 있어 복구 불가 — dry-run 승인 후에만 활성화).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import AudioChunk, EEGRawChunk, EEGRecord, SessionRecord, VideoChunk
from app.models.research import ResearchConsent
from app.models.retention_sweep_run import RetentionSweepRun
from app.models.session import Session as SessionModel, SessionParticipant
from app.models.session_email_invite import SessionEmailInvite
from app.models.user import User
from app.services import media_cleanup_service, session_email_invite_service

logger = logging.getLogger(__name__)

TARGET_STATUSES = ("completed", "cancelled")
# 연구 DB 적재가 끝났거나(acked) 적재 대상이 아닌 상태는 게이트 없이 삭제할 수 있다.
_NO_GATE_STATES = ("acked", "withdrawn", "blocked_withdrawn", "not_applicable")
_BLOCKED_STATES = ("blocked_key_missing", "blocked_identity_missing")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def parse_apply_from(value: str | None) -> datetime | None:
    """``RETENTION_APPLY_FROM``(YYYY-MM-DD, UTC) → 해당 날짜 00:00 UTC. 비었거나 잘못되면 None."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        d = date.fromisoformat(text)
    except ValueError:
        logger.warning("[retention] RETENTION_APPLY_FROM 형식 오류 — 무시")
        return None
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _eligible_sessions(
    db: DBSession, days: int, now: datetime, apply_from: datetime | None
) -> dict[uuid.UUID, datetime]:
    """세션 종료일 기준 보관 기간이 지난 종료·취소 클래스 → {session_id: 기준일}."""
    ref = func.coalesce(SessionModel.ended_at, SessionModel.created_at)
    cutoff = now - timedelta(days=days)
    q = (
        db.query(SessionModel.id, ref)
        .filter(
            SessionModel.status.in_(TARGET_STATUSES),
            SessionModel.is_template.is_(False),
            ref < cutoff,
        )
        .execution_options(include_hidden=True)
    )
    if apply_from is not None:
        q = q.filter(ref >= apply_from)
    return {sid: _aware(r) for sid, r in q.all()}


def _held_consents(db: DBSession, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, ResearchConsent]:
    """삭제를 보류해야 하는 연구 동의(participant_id → 동의 행)."""
    if not session_ids:
        return {}
    rows = (
        db.query(ResearchConsent)
        .filter(
            ResearchConsent.session_id.in_(session_ids),
            ResearchConsent.consented.is_(True),
            ResearchConsent.withdrawn_at.is_(None),
            ResearchConsent.export_state.notin_(_NO_GATE_STATES),
        )
        .all()
    )
    return {r.participant_id: r for r in rows}


def _platform_admin_ids(db: DBSession) -> list[uuid.UUID]:
    return [uid for (uid,) in db.query(User.id).filter(User.role == "platform_admin").all()]


def _notify_hold_overdue(db: DBSession, count: int) -> None:
    """삭제 기한을 넘겨 보류 중인 연구 동의 건이 있음을 플랫폼 관리자에게 알린다(건수만, 개인정보 없음)."""
    from app.services import notification_service

    for admin_id in _platform_admin_ids(db):
        try:
            notification_service.notify_event(
                "retention_hold_overdue",
                admin_id,
                {
                    "title": "연구 동의 건의 삭제가 보류되고 있어요",
                    "body": f"연구 DB 내보내기 확인이 늦어져 삭제 기한을 넘긴 건이 {count}건 있어요. 내보내기 상태를 확인해 주세요.",
                    "extra": {"event_type": "retention_hold_overdue", "target_type": "notice", "count": count},
                },
                db,
            )
        except Exception:  # noqa: BLE001 — 알림 실패가 스위프를 막지 않는다
            logger.exception("[retention] 보류 임계 알림 실패: admin=%s", admin_id)


def _raw_stage(
    db: DBSession,
    eligible: dict[uuid.UUID, datetime],
    holds: dict[uuid.UUID, ResearchConsent],
    *,
    execute: bool,
) -> tuple[dict, list[str]]:
    """원본 후보를 세고(execute 면) 삭제한다. 반환: (보고, 커밋 뒤 지울 스토리지 참조)."""
    rep = {
        "sessions": 0, "eeg_raw_chunks": 0, "audio_chunks": 0, "video_chunks": 0,
        "merged_videos": 0, "transcripts": 0, "bytes_known": 0,
        "deleted": {"eeg_raw_chunks": 0, "audio_chunks": 0, "video_chunks": 0, "merged_videos": 0, "transcripts": 0},
    }
    refs_all: list[str] = []
    for sid in eligible:
        eeg_rows = [
            c for c in db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid).all()
            if c.participant_id not in holds
        ]
        audio_rows = db.query(AudioChunk).filter(AudioChunk.session_id == sid).all()
        video_rows = db.query(VideoChunk).filter(VideoChunk.session_id == sid).all()
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        has_audio_key = bool(record and record.audio_s3_key)
        has_merged = bool(record and record.video_s3_key)
        summary = record.ai_summary if record and isinstance(record.ai_summary, dict) else {}
        has_transcript = bool(record and ((record.transcript or "").strip() or summary.get("segments")))

        if not (eeg_rows or audio_rows or video_rows or has_audio_key or has_merged or has_transcript):
            continue
        rep["sessions"] += 1
        rep["eeg_raw_chunks"] += len(eeg_rows)
        rep["audio_chunks"] += len(audio_rows)
        rep["video_chunks"] += len(video_rows)
        rep["merged_videos"] += 1 if has_merged else 0
        rep["transcripts"] += 1 if has_transcript else 0
        rep["bytes_known"] += sum(int(c.size_bytes or 0) for c in (*eeg_rows, *audio_rows, *video_rows))
        if not execute:
            continue

        refs: list[str] = []
        affected: set[uuid.UUID] = set()
        for c in eeg_rows:
            refs.append(c.object_key)
            if c.participant_id:
                affected.add(c.participant_id)
            db.delete(c)
        for c in audio_rows:
            refs.append(c.file_path)
            db.delete(c)
        for c in video_rows:
            refs.append(c.file_path)
            db.delete(c)
        if record is not None:
            if record.audio_s3_key:
                refs.append(record.audio_s3_key)
                record.audio_s3_key = None
            if record.video_s3_key:
                refs.append(record.video_s3_key)
                record.video_s3_key = None
            if has_transcript:
                record.transcript = None
                new_summary = dict(summary)
                new_summary.pop("segments", None)
                record.ai_summary = new_summary
        db.flush()
        for pid in affected:
            remaining = (
                db.query(EEGRawChunk)
                .filter(EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == pid,
                        EEGRawChunk.upload_status == "uploaded")
                .count()
            )
            for rec in db.query(EEGRecord).filter(EEGRecord.session_id == sid, EEGRecord.participant_id == pid):
                rec.file_count = remaining
        db.commit()
        refs_all += [r for r in refs if r]
        d = rep["deleted"]
        d["eeg_raw_chunks"] += len(eeg_rows)
        d["audio_chunks"] += len(audio_rows)
        d["video_chunks"] += len(video_rows)
        d["merged_videos"] += 1 if has_merged else 0
        d["transcripts"] += 1 if has_transcript else 0
    return rep, refs_all


def _hold_stage(
    db: DBSession,
    eligible: dict[uuid.UUID, datetime],
    holds: dict[uuid.UUID, ResearchConsent],
    now: datetime,
    *,
    execute: bool,
) -> dict:
    """연구 게이트: 보류 건수를 세고 임계 초과분을 알린다(execute 일 때만 알림·표식)."""
    rep = {
        "participants": 0, "eeg_raw_chunks": 0, "queued_for_export": 0, "blocked": 0,
        "overdue": 0, "alerted": 0,
    }
    if not holds:
        return rep
    alert_after = timedelta(days=settings.retention_raw_days + settings.retention_hold_alert_days)
    newly_overdue: list[ResearchConsent] = []
    for pid, consent in holds.items():
        chunks = db.query(EEGRawChunk).filter(EEGRawChunk.participant_id == pid).count()
        if chunks == 0:
            continue  # 지울 원본이 없으면 보류할 것도 없다
        rep["participants"] += 1
        rep["eeg_raw_chunks"] += chunks
        if consent.export_state in _BLOCKED_STATES:
            rep["blocked"] += 1
        else:
            rep["queued_for_export"] += 1  # pending(내보내기 대기) / exported(ack 대기) — B13 배치가 이어받는다
        ref_date = eligible.get(consent.session_id)
        if ref_date is not None and now > ref_date + alert_after:
            rep["overdue"] += 1
            if consent.hold_alerted_at is None:
                newly_overdue.append(consent)
    if execute and newly_overdue:
        _notify_hold_overdue(db, rep["overdue"])
        stamp = _now()
        for consent in newly_overdue:
            consent.hold_alerted_at = stamp
        db.commit()
        rep["alerted"] = len(newly_overdue)
    return rep


def _pii_stage(db: DBSession, eligible: dict[uuid.UUID, datetime], *, execute: bool) -> dict:
    rep = {"participants": 0, "invites": 0, "scrubbed": {"participants": 0, "invites": 0}}
    ids = list(eligible)
    if not ids:
        return rep
    guests = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id.in_(ids),
            SessionParticipant.user_id.is_(None),
            SessionParticipant.pii_scrubbed_at.is_(None),
        )
        .execution_options(include_removed=True)
        .all()
    )
    guests = [
        g for g in guests
        if g.guest_name or g.gender or g.birth_date or g.report_email
    ]
    invite_count = (
        db.query(SessionEmailInvite)
        .filter(SessionEmailInvite.session_id.in_(ids), SessionEmailInvite.pii_scrubbed_at.is_(None))
        .count()
    )
    rep["participants"] = len(guests)
    rep["invites"] = invite_count
    if not execute:
        return rep
    stamp = _now()
    for g in guests:
        g.guest_name = None
        g.gender = None
        g.birth_date = None
        g.report_email = None
        g.pii_scrubbed_at = stamp
    rep["scrubbed"]["participants"] = len(guests)
    rep["scrubbed"]["invites"] = session_email_invite_service.scrub_invite_emails(
        db, session_ids=ids, commit=False
    )
    db.commit()
    return rep


def run_retention_sweep(
    db: DBSession,
    *,
    now: datetime | None = None,
    dry_run: bool | None = None,
    trigger: str = "manual",
) -> dict:
    """스위프 1회 실행. ``dry_run=True`` 이거나 설정이 비활성이면 삭제 없이 보고만 한다."""
    moment = _aware(now) if now else _now()
    enabled = bool(settings.retention_sweep_enabled)
    apply_from = parse_apply_from(settings.retention_apply_from)
    blocked_reason: str | None = None
    execute = enabled and dry_run is not True
    if execute and apply_from is None:
        execute = False
        blocked_reason = "apply_from_unset"
    elif not enabled:
        blocked_reason = "sweep_disabled"
    elif dry_run is True:
        blocked_reason = "dry_run_requested"

    run = RetentionSweepRun(
        mode="execute" if execute else "dry_run", trigger=trigger, enabled=enabled, status="running",
        report={},
    )
    db.add(run)
    db.commit()

    try:
        raw_eligible = _eligible_sessions(db, settings.retention_raw_days, moment, apply_from)
        pii_eligible = _eligible_sessions(db, settings.retention_guest_pii_days, moment, apply_from)
        holds = _held_consents(db, list(raw_eligible))
        raw_rep, refs = _raw_stage(db, raw_eligible, holds, execute=execute)
        hold_rep = _hold_stage(db, raw_eligible, holds, moment, execute=execute)
        pii_rep = _pii_stage(db, pii_eligible, execute=execute)

        # 스토리지 삭제는 DB 커밋 뒤 best-effort
        for ref in refs:
            media_cleanup_service._delete_media_ref(ref)  # noqa: SLF001 — 같은 도메인의 삭제 헬퍼

        orphan_rep: dict | None = None
        if execute:
            from app.services import eeg_raw_service

            orphan_rep = {
                # 임시·고아만(보관 기간 없이): pending/failed EEG 청크, 부모 없는 미디어 청크
                "eeg_raw": eeg_raw_service.sweep_stale_eeg_raw(db, retention_days=0),
                "media": media_cleanup_service.sweep_stale_media(db, retention_days=36500),
            }

        report = {
            "mode": run.mode,
            "enabled": enabled,
            "blocked_reason": blocked_reason,
            "cutoffs": {
                "raw_days": settings.retention_raw_days,
                "guest_pii_days": settings.retention_guest_pii_days,
                "apply_from": apply_from.isoformat() if apply_from else None,
                "evaluated_at": moment.isoformat(),
            },
            "raw": raw_rep,
            "research_hold": hold_rep,
            "guest_pii": pii_rep,
            "orphan_cleanup": orphan_rep,
        }
        run.report = report
        run.status = "completed"
        run.finished_at = _now()
        db.commit()
        report["run_id"] = str(run.id)
        logger.info("[retention] %s 완료: raw=%s hold=%s pii=%s", run.mode, raw_rep["sessions"],
                    hold_rep["participants"], pii_rep["participants"])
        return report
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.query(RetentionSweepRun).filter(RetentionSweepRun.id == run.id).one()
        run.status = "failed"
        run.error = f"{type(exc).__name__}: {exc}"[:500]
        run.finished_at = _now()
        db.commit()
        logger.exception("[retention] 실행 실패: run_id=%s", run.id)
        raise

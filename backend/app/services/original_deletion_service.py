"""플랫폼 관리자 전용 원본 삭제 (SDD-209 B1 / BE-1④ · D-2).

보관 기간 전에 원본(EEG raw · 음성 · 영상 · STT 원문)을 지우는 유일한 수동 경로다.
- 호출자 권한(플랫폼 관리자)은 라우트 의존성에서 강제한다 — 상담사·기관 관리자는 403.
- 사유 필수. 감사 행(대상·실행자·시각·사유·범위·건수) 1건을 같은 트랜잭션에 남긴다.
- 파일/객체 삭제는 DB 커밋 뒤 best-effort(실패해도 DB·감사는 유지, 실패 건수를 결과에 기록).
- 리포트 본문·지표 요약·계정은 대상이 아니다(N-2).
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.original_deletion_audit import OriginalDeletionAudit
from app.models.record import AudioChunk, EEGRawChunk, EEGRecord, SessionRecord, VideoChunk
from app.models.session import Session as SessionModel
from app.services import media_cleanup_service

logger = logging.getLogger(__name__)

SCOPES = ("eeg_raw", "audio", "video", "transcript")


def delete_session_originals(
    session_id: uuid.UUID,
    actor_id: uuid.UUID,
    reason: str,
    scopes: list[str] | None,
    db: DBSession,
) -> dict:
    cleaned_reason = (reason or "").strip()
    if not cleaned_reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="삭제 사유는 필수입니다")
    chosen = list(scopes) if scopes else list(SCOPES)
    invalid = [s for s in chosen if s not in SCOPES]
    if invalid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="유효하지 않은 삭제 범위입니다")

    # 숨김(보존 전환) 클래스도 대상이다.
    session = (
        db.query(SessionModel)
        .filter(SessionModel.id == session_id)
        .execution_options(include_hidden=True)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="클래스를 찾을 수 없습니다")

    refs: list[str] = []
    result = {"eeg_raw_chunks": 0, "audio_chunks": 0, "video_chunks": 0, "transcript_cleared": False,
              "merged_video_removed": False}

    if "eeg_raw" in chosen:
        rows = db.query(EEGRawChunk).filter(EEGRawChunk.session_id == session.id).all()
        refs += [r.object_key for r in rows if r.object_key]
        result["eeg_raw_chunks"] = len(rows)
        for row in rows:
            db.delete(row)
        for rec in db.query(EEGRecord).filter(EEGRecord.session_id == session.id).all():
            rec.file_count = 0
    if "audio" in chosen:
        rows = db.query(AudioChunk).filter(AudioChunk.session_id == session.id).all()
        refs += [r.file_path for r in rows if r.file_path]
        result["audio_chunks"] = len(rows)
        for row in rows:
            db.delete(row)
    if "video" in chosen:
        rows = db.query(VideoChunk).filter(VideoChunk.session_id == session.id).all()
        refs += [r.file_path for r in rows if r.file_path]
        result["video_chunks"] = len(rows)
        for row in rows:
            db.delete(row)

    record = db.query(SessionRecord).filter(SessionRecord.session_id == session.id).first()
    if record is not None:
        if "audio" in chosen and record.audio_s3_key:
            refs.append(record.audio_s3_key)
            record.audio_s3_key = None
        if "video" in chosen and record.video_s3_key:
            refs.append(record.video_s3_key)
            record.video_s3_key = None
            result["merged_video_removed"] = True
        if "transcript" in chosen:
            record.transcript = None
            summary = dict(record.ai_summary or {})
            summary.pop("segments", None)
            record.ai_summary = summary
            result["transcript_cleared"] = True

    result["refs"] = len(refs)
    audit = OriginalDeletionAudit(
        actor_id=actor_id,
        target_type="session",
        target_id=session.id,
        reason=cleaned_reason,
        scopes=chosen,
        result=result,
    )
    db.add(audit)
    db.commit()

    # 스토리지 삭제는 커밋 뒤 best-effort — 행/감사 정합이 우선이다.
    for ref in refs:
        media_cleanup_service._delete_media_ref(ref)  # noqa: SLF001 — 같은 도메인의 내부 삭제 헬퍼

    return {"audit_id": str(audit.id), "session_id": str(session.id), "scopes": chosen, **result}

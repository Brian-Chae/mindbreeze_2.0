"""세션·사용자 삭제 및 보관 기간 경과 미디어 정리 (STG-03 / STG-05).

audio/video 청크와 raw EEG 는 실제 바이트를 S3 객체 또는 로컬 폴백 파일에 둔다.
DB 행만 삭제하면 개인정보(상담 음성·영상·뇌파)가 스토리지에 영구 잔존하므로,
삭제 경로(세션/사용자)와 주기 스윕에서 실제 미디어도 함께 제거한다.

- STG-05: 세션/사용자 삭제 시 S3 객체·로컬 파일도 삭제.
- STG-03: 보관 기간 경과 audio/video 청크를 행·미디어와 함께 정리(고아 포함).

모든 미디어 삭제는 best-effort — 실패해도 DB 정리(호출측)를 막지 않는다.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.record import AudioChunk, EEGRawChunk, SessionRecord, VideoChunk
from app.services import storage_service

logger = logging.getLogger(__name__)

# STG-03: audio/video 청크 보관 기간(일). 경과분은 행·실제 미디어와 함께 삭제한다.
MEDIA_RETENTION_DAYS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_s3_key(ref: str) -> bool:
    """S3 object key(예: video/..., eeg-raw/...)인지 로컬 폴백 절대경로인지 판별한다.

    로컬 폴백 파일은 CHUNK_STORAGE_DIR/VIDEO_CHUNK_DIR(절대경로)에 저장되고,
    S3 키는 프리픽스로 시작하는 상대 키다.
    """
    return not ref.startswith("/")


def _delete_media_ref(ref: str | None) -> None:
    """단일 미디어 참조(S3 객체 또는 로컬 파일)를 best-effort 로 삭제한다."""
    if not ref:
        return
    if _is_s3_key(ref):
        try:
            storage_service.delete_object(ref)
        except Exception:  # noqa: BLE001 — 미디어 삭제 실패가 DB 정리를 막지 않는다.
            logger.warning("[media-cleanup] S3 객체 삭제 실패: %s", ref)
        return
    try:
        os.remove(ref)
    except FileNotFoundError:
        pass
    except OSError as exc:  # noqa: BLE001
        logger.warning("[media-cleanup] 로컬 파일 삭제 실패: %s (%s)", ref, exc)


def _collect_session_media_refs(session_ids: list, db: DBSession) -> list[str]:
    """세션들의 미디어 참조(청크 파일·raw 객체 키·병합본 키)를 모은다."""
    ids = [sid for sid in session_ids if sid]
    if not ids:
        return []
    refs: list[str] = []
    refs += [p for (p,) in db.query(AudioChunk.file_path).filter(AudioChunk.session_id.in_(ids)).all()]
    refs += [p for (p,) in db.query(VideoChunk.file_path).filter(VideoChunk.session_id.in_(ids)).all()]
    refs += [k for (k,) in db.query(EEGRawChunk.object_key).filter(EEGRawChunk.session_id.in_(ids)).all()]
    for record in db.query(SessionRecord).filter(SessionRecord.session_id.in_(ids)).all():
        refs.append(record.audio_s3_key or "")
        refs.append(record.video_s3_key or "")
    return [r for r in refs if r]


def delete_session_media(session_ids: list, db: DBSession) -> int:
    """세션(들)의 실제 미디어(S3 객체·로컬 파일)를 삭제한다 (STG-05).

    호출측이 DB 행을 삭제하기 전에 호출해야 파일 참조를 수집할 수 있다.
    삭제한 미디어 참조 수를 반환한다.
    """
    refs = _collect_session_media_refs(session_ids, db)
    for ref in refs:
        _delete_media_ref(ref)
    if refs:
        logger.info("[media-cleanup] 세션 미디어 삭제: sessions=%s refs=%d", session_ids, len(refs))
    return len(refs)


def delete_user_media(user_id, db: DBSession) -> int:
    """사용자(호스트 세션 + 소유 raw)의 실제 미디어를 삭제한다 (STG-05)."""
    from app.models.session import Session as SessionModel

    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    session_ids = [
        sid for (sid,) in db.query(SessionModel.id).filter(SessionModel.host_id == uid).all()
    ]
    refs = _collect_session_media_refs(session_ids, db)
    # 세션이 이미 정리됐거나 참가자로 남은 본인 소유 raw 객체도 함께 지운다.
    refs += [k for (k,) in db.query(EEGRawChunk.object_key).filter(EEGRawChunk.user_id == uid).all()]
    refs = [r for r in refs if r]
    for ref in refs:
        _delete_media_ref(ref)
    if refs:
        logger.info("[media-cleanup] 사용자 미디어 삭제: user=%s refs=%d", uid, len(refs))
    return len(refs)


def _purge_chunks(db: DBSession, model, *criteria) -> int:
    """모델 행을 삭제하고 각 행의 file_path 미디어도 함께 제거한다."""
    rows = db.query(model).filter(*criteria).all()
    refs = [getattr(row, "file_path", None) for row in rows]
    for row in rows:
        db.delete(row)
    db.flush()
    for ref in refs:
        _delete_media_ref(ref)
    return len(rows)


def sweep_stale_media(
    db: DBSession,
    *,
    now: datetime | None = None,
    retention_days: int = MEDIA_RETENTION_DAYS,
) -> dict:
    """보관 기간 경과 audio/video 청크를 행·미디어와 함께 정리한다 (STG-03).

    - 생성 후 retention_days 경과한 audio/video 청크 → 행 삭제 + S3 객체/로컬 파일 삭제.
    - 부모 세션이 사라진 고아 청크(방어)도 정리한다.

    삭제 행 수를 {audio_deleted, video_deleted} 로 반환한다.
    """
    from app.models.session import Session as SessionModel

    moment = now or _now()
    # SQLite/Postgres 저장값과 비교 시 tz 혼용을 피하려고 naive UTC 로 정규화한다.
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    cutoff = moment - timedelta(days=retention_days)

    audio_deleted = _purge_chunks(db, AudioChunk, AudioChunk.created_at < cutoff)
    video_deleted = _purge_chunks(db, VideoChunk, VideoChunk.created_at < cutoff)

    # 고아 방어: 부모 세션이 없는 청크(정상 경로에서는 CASCADE 로 제거됨).
    session_subq = db.query(SessionModel.id)
    audio_orphans = _purge_chunks(db, AudioChunk, AudioChunk.session_id.notin_(session_subq))
    video_orphans = _purge_chunks(db, VideoChunk, VideoChunk.session_id.notin_(session_subq))
    audio_deleted += audio_orphans
    video_deleted += video_orphans

    db.commit()
    result = {"audio_deleted": audio_deleted, "video_deleted": video_deleted}
    logger.info("[media-cleanup] 보관 스윕: %s", result)
    return result

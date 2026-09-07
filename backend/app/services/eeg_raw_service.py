"""SDD-027 T3 — raw EEG chunk manifest + presigned PUT / ack.

경로: SDK raw → 로컬 영속 큐 → presigned PUT → 확인(ack).
- presign: 참가자 소유 검증 후 EEGRawChunk(status=pending) 를 멱등 생성하고 PUT URL 발급.
- ack: 업로드 완료를 status=uploaded 로 확정하고, 세그먼트 단위 EEGRecord.file_count 를 갱신.

소유 검증은 SDD-026 resolve_upload_participant 를 재사용한다(게스트 raw 지원 — participant_id 기반).
"""

import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import EEGRawChunk, EEGRecord
from app.services import session_service, storage_service


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_session(session_id: str, db: DBSession) -> tuple[UUID, Session]:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return sid, s


def _object_prefix(sid: UUID, participant: SessionParticipant, play_group_id: str | None) -> str:
    """세그먼트(참가자·실행세그먼트) 단위 S3 키 프리픽스."""
    seg = play_group_id or "default"
    return f"eeg-raw/{sid}/{participant.id}/{seg}"


def _build_object_key(prefix: str, stream_id: str, chunk_index: int) -> str:
    # 재발급 시 결정적으로 재사용할 수 있게 (stream_id, chunk_index) 로 키를 구성한다.
    return f"{prefix}/{stream_id}/{chunk_index:08d}.bin"


def presign_upload(
    session_id: str,
    payload,
    db: DBSession,
    *,
    current_user_id: str | None = None,
) -> dict:
    """raw chunk presigned PUT URL 발급 + manifest(EEGRawChunk) 멱등 생성."""
    sid, _ = _get_session(session_id, db)
    participant = session_service.resolve_upload_participant(
        sid, payload.participant_id, current_user_id, db
    )
    prefix = _object_prefix(sid, participant, payload.play_group_id)

    items: list[dict] = []
    for meta in payload.chunks:
        # 동일 (session, participant, stream, chunk_index) 는 멱등 — 기존 행 재사용(재발급).
        existing = (
            db.query(EEGRawChunk)
            .filter(
                EEGRawChunk.session_id == sid,
                EEGRawChunk.participant_id == participant.id,
                EEGRawChunk.stream_id == meta.stream_id,
                EEGRawChunk.chunk_index == meta.chunk_index,
            )
            .first()
        )
        if existing is not None:
            chunk = existing
            object_key = chunk.object_key
        else:
            object_key = _build_object_key(prefix, meta.stream_id, meta.chunk_index)
            chunk = EEGRawChunk(
                session_id=sid,
                participant_id=participant.id,
                user_id=participant.user_id,
                stream_id=meta.stream_id,
                chunk_index=meta.chunk_index,
                start_ms=meta.start_ms,
                end_ms=meta.end_ms,
                sample_rate=meta.sample_rate,
                channel_count=meta.channel_count,
                unit=meta.unit,
                schema_version=meta.schema_version,
                checksum=meta.checksum,
                size_bytes=meta.size_bytes,
                object_key=object_key,
                upload_status="pending",
            )
            try:
                with db.begin_nested():
                    db.add(chunk)
                    db.flush()
            except IntegrityError:
                # 동시 발급 경합 — SAVEPOINT 는 컨텍스트 매니저가 롤백. 기존 행을 조회해 재사용
                chunk = (
                    db.query(EEGRawChunk)
                    .filter(
                        EEGRawChunk.session_id == sid,
                        EEGRawChunk.participant_id == participant.id,
                        EEGRawChunk.stream_id == meta.stream_id,
                        EEGRawChunk.chunk_index == meta.chunk_index,
                    )
                    .first()
                )
                object_key = chunk.object_key

        upload_url = storage_service.generate_presigned_put(
            object_key, content_type=meta.content_type
        )
        items.append(
            {
                "chunk_id": str(chunk.id),
                "stream_id": chunk.stream_id,
                "chunk_index": chunk.chunk_index,
                "object_key": object_key,
                "upload_url": upload_url,
                "upload_status": chunk.upload_status,
            }
        )

    db.commit()
    return {
        "session_id": str(sid),
        "participant_id": str(participant.id),
        "chunks": items,
    }


def ack_upload(
    session_id: str,
    payload,
    db: DBSession,
    *,
    current_user_id: str | None = None,
) -> dict:
    """업로드 완료 확인 — EEGRawChunk.status=uploaded + EEGRecord.file_count 갱신."""
    sid, _ = _get_session(session_id, db)
    participant = session_service.resolve_upload_participant(
        sid, payload.participant_id, current_user_id, db
    )

    acked = 0
    for item in payload.chunks:
        chunk = (
            db.query(EEGRawChunk)
            .filter(
                EEGRawChunk.id == _to_uuid(item.chunk_id),
                EEGRawChunk.session_id == sid,
                EEGRawChunk.participant_id == participant.id,
            )
            .first()
        )
        if chunk is None:
            # 타 참가자/세션 청크 확인 시도 차단 (소유 위반)
            raise HTTPException(status_code=404, detail="raw 청크를 찾을 수 없습니다")
        # checksum/size 는 실제 업로드 값으로 갱신 가능(null 보존 — 미제공 시 기존값 유지)
        if item.checksum is not None:
            chunk.checksum = item.checksum
        if item.size_bytes is not None:
            chunk.size_bytes = item.size_bytes
        if chunk.upload_status != "uploaded":
            chunk.upload_status = "uploaded"
            chunk.uploaded_at = _now()
            acked += 1

    # autoflush=False 환경에서도 아래 count 쿼리가 방금 갱신한 upload_status 를 보도록 명시 flush.
    db.flush()
    # 세그먼트(참가자·play_group) 단위 EEGRecord 를 get-or-create 하고 file_count 를 재계산한다.
    record = _sync_eeg_record(sid, participant, payload.play_group_id, db)
    db.commit()

    return {
        "session_id": str(sid),
        "acked": acked,
        "eeg_record_id": str(record.id) if record else None,
        "file_count": record.file_count if record else 0,
    }


def _sync_eeg_record(
    sid: UUID,
    participant: SessionParticipant,
    play_group_id: str | None,
    db: DBSession,
) -> EEGRecord | None:
    """참가자 단위 EEGRecord 를 만들거나 갱신한다(file_count = 업로드 완료 청크 수).

    raw 청크는 play_group_id 를 보유하지 않으므로 EEGRecord 는 (session, participant) 단위로
    유지하고, play_group_id 는 최신 ack 세그먼트 값으로 갱신한다(중복 카운트 방지).
    """
    uploaded_count = (
        db.query(EEGRawChunk)
        .filter(
            EEGRawChunk.session_id == sid,
            EEGRawChunk.participant_id == participant.id,
            EEGRawChunk.upload_status == "uploaded",
        )
        .count()
    )
    if uploaded_count == 0:
        return None

    record = (
        db.query(EEGRecord)
        .filter(
            EEGRecord.session_id == sid,
            EEGRecord.participant_id == participant.id,
        )
        .first()
    )
    prefix = _object_prefix(sid, participant, play_group_id)
    if record is None:
        record = EEGRecord(
            session_id=sid,
            user_id=participant.user_id,
            participant_id=participant.id,
            play_group_id=play_group_id,
            s3_key=prefix,
            file_count=uploaded_count,
        )
        db.add(record)
        db.flush()
    else:
        record.file_count = uploaded_count
        if play_group_id is not None:
            record.play_group_id = play_group_id
    return record

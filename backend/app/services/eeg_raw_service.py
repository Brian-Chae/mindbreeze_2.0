"""SDD-027 T3 — raw EEG chunk manifest + presigned PUT / ack.

경로: SDK raw → 로컬 영속 큐 → presigned PUT → 확인(ack).
- presign: 참가자 소유 검증 후 EEGRawChunk(status=pending) 를 멱등 생성하고 PUT URL 발급.
- ack: 업로드 완료를 status=uploaded 로 확정하고, 세그먼트 단위 EEGRecord.file_count 를 갱신.

소유 검증은 SDD-026 resolve_upload_participant 를 재사용한다(게스트 raw 지원 — participant_id 기반).
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
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


# STG-11: S3 key 에 삽입되는 stream_id 허용 문자(영숫자·.·_·-).
_STREAM_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def _validate_stream_id(stream_id: str) -> str:
    """STG-11: stream_id 를 S3 key 에 삽입하기 전 허용 문자를 검증한다.

    stream_id 는 클라이언트 입력이며 object key 에 그대로 들어간다. ``../``·``/`` 같은
    문자가 허용되면 다른 prefix(참가자·세션 경계)로 키가 이탈하거나 예기치 않은 객체를
    덮어쓸 수 있다. 허용: 영숫자와 ``.``·``_``·``-`` (1~128자).
    """
    if not isinstance(stream_id, str) or not _STREAM_ID_RE.fullmatch(stream_id):
        raise HTTPException(status_code=422, detail="stream_id 형식이 올바르지 않습니다")
    return stream_id


def _build_object_key(prefix: str, stream_id: str, chunk_index: int) -> str:
    # 재발급 시 결정적으로 재사용할 수 있게 (stream_id, chunk_index) 로 키를 구성한다.
    _validate_stream_id(stream_id)
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

    # EEG-QRY-03: 청크별 개별 SELECT(N+1) 대신 요청에 담긴 (stream_id, chunk_index) 를 한 번의
    # SELECT 로 조회한다. chunk_index/stream_id 로 범위를 좁혀 요청 크기에 비례하되 쿼리 수는
    # 1회로 고정한다. 상한(max_length)은 스키마에서 강제한다.
    stream_ids = {meta.stream_id for meta in payload.chunks}
    chunk_indices = {meta.chunk_index for meta in payload.chunks}
    existing_map: dict[tuple[str, int], EEGRawChunk] = {}
    if stream_ids and chunk_indices:
        rows = (
            db.query(EEGRawChunk)
            .filter(
                EEGRawChunk.session_id == sid,
                EEGRawChunk.participant_id == participant.id,
                EEGRawChunk.stream_id.in_(stream_ids),
                EEGRawChunk.chunk_index.in_(chunk_indices),
            )
            .all()
        )
        existing_map = {(c.stream_id, c.chunk_index): c for c in rows}

    items: list[dict] = []
    for meta in payload.chunks:
        # STG-11: 재사용 경로를 포함해 모든 stream_id 를 key 삽입 전에 검증한다.
        _validate_stream_id(meta.stream_id)
        key = (meta.stream_id, meta.chunk_index)
        # 동일 (session, participant, stream, chunk_index) 는 멱등 — 기존 행 재사용(재발급).
        existing = existing_map.get(key)
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
                if chunk is None:  # 방어 — 유니크 위반인데 기존 행이 없으면 재전파
                    raise
                object_key = chunk.object_key
            # 한 요청 안에 중복 키가 있어도 방금 만든 행을 재사용하도록 맵을 갱신한다.
            existing_map[key] = chunk

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

    # EEG-QRY-03: 청크별 개별 SELECT(N+1) 대신 id 목록을 한 번의 SELECT 로 조회한다.
    # 세션·참가자 조건을 함께 걸어 타 참가자/세션 청크는 조회 결과에서 제외한다(소유 위반 → 404).
    wanted_ids = [_to_uuid(item.chunk_id) for item in payload.chunks]
    rows = (
        db.query(EEGRawChunk)
        .filter(
            EEGRawChunk.id.in_(wanted_ids),
            EEGRawChunk.session_id == sid,
            EEGRawChunk.participant_id == participant.id,
        )
        .all()
    )
    by_id = {row.id: row for row in rows}

    acked = 0
    failed = 0
    for item, chunk_id in zip(payload.chunks, wanted_ids):
        chunk = by_id.get(chunk_id)
        if chunk is None:
            # 타 참가자/세션 청크 확인 시도 차단 (소유 위반)
            raise HTTPException(status_code=404, detail="raw 청크를 찾을 수 없습니다")
        # checksum/size 는 실제 업로드 값으로 갱신 가능(null 보존 — 미제공 시 기존값 유지)
        if item.checksum is not None:
            chunk.checksum = item.checksum
        if item.size_bytes is not None:
            chunk.size_bytes = item.size_bytes
        if chunk.upload_status != "uploaded":
            # EEG-RAW-02: ack 확정 전 S3 객체 존재·크기(HEAD)를 검증한다. 검증 없이 uploaded 로
            # 확정하면 실제 유실된 청크가 성공으로 기록된다. 자격증명 미설정(스텁)은 None → 건너뜀.
            verified = storage_service.verify_object(
                chunk.object_key, expected_size=chunk.size_bytes
            )
            if verified is False:
                # 객체 없음/크기 불일치 — uploaded 로 확정하지 않고 failed 로 마킹.
                chunk.upload_status = "failed"
                chunk.uploaded_at = None
                failed += 1
                continue
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
        "failed": failed,
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
        try:
            with db.begin_nested():
                db.add(record)
                db.flush()
        except IntegrityError:
            # EEG-RAW-04: 동시 ack 경합 — (session, participant) 유니크 제약 위반 시 SAVEPOINT 가
            # 롤백되므로 기존 행을 재조회해 file_count 만 갱신한다(중복 레코드 방지).
            record = (
                db.query(EEGRecord)
                .filter(
                    EEGRecord.session_id == sid,
                    EEGRecord.participant_id == participant.id,
                )
                .first()
            )
            if record is None:  # 방어 — 유니크 위반인데 기존 행이 없으면 재전파
                raise
            record.file_count = uploaded_count
            if play_group_id is not None:
                record.play_group_id = play_group_id
    else:
        record.file_count = uploaded_count
        if play_group_id is not None:
            record.play_group_id = play_group_id
    return record


# ─────────────────────────────────────────────────────────────────────────
# EEG-RAW-03 / EEG-RET-01: 스테일·고아 raw 청크 및 보관 기간 정리
# ─────────────────────────────────────────────────────────────────────────

# presigned 발급(pending) 후 이 시간 내 ack 되지 않은 청크는 고아(orphan)로 정리한다.
EEG_RAW_PENDING_TTL_HOURS = 24
# ack 무결성 검증 실패(failed)로 방치된 청크 정리 기준.
EEG_RAW_FAILED_TTL_HOURS = 24
# 업로드 완료(uploaded) raw 청크의 과거 보관 기간(일). SDD-197(D5)로 뇌파 원본은 **영구 보관**이 기본이다.
# 실제 적용값은 settings.eeg_raw_retention_days(0 이하=무기한). 이 상수는 명시 호출(테스트·수동 정리)용 참고값이다.
EEG_RAW_RETENTION_DAYS = 90


def _refresh_eeg_record_file_count(sid: UUID, participant_id: UUID | None, db: DBSession) -> None:
    """보관 만료 삭제로 어긋난 EEGRecord.file_count 를 남은 uploaded 청크 수로 재계산한다."""
    if participant_id is None:
        return
    uploaded = (
        db.query(EEGRawChunk)
        .filter(
            EEGRawChunk.session_id == sid,
            EEGRawChunk.participant_id == participant_id,
            EEGRawChunk.upload_status == "uploaded",
        )
        .count()
    )
    record = (
        db.query(EEGRecord)
        .filter(EEGRecord.session_id == sid, EEGRecord.participant_id == participant_id)
        .first()
    )
    if record is not None:
        record.file_count = uploaded


def sweep_stale_eeg_raw(
    db: DBSession,
    *,
    now: datetime | None = None,
    pending_ttl_hours: int = EEG_RAW_PENDING_TTL_HOURS,
    failed_ttl_hours: int = EEG_RAW_FAILED_TTL_HOURS,
    retention_days: int | None = None,
) -> dict:
    """스테일/고아 raw 청크와 보관 기간 경과 업로드분을 정리한다 (EEG-RAW-03, EEG-RET-01).

    - pending: 발급 후 pending_ttl_hours 내 ack 되지 않은 고아 → 행 삭제(객체는 best-effort).
    - failed: 검증 실패로 방치된 청크(failed_ttl_hours 초과) → 행 삭제.
    - uploaded: 보관 기간(retention_days) 경과분 → 행 삭제 + S3 객체 삭제.
      retention_days 미지정 시 settings.eeg_raw_retention_days 를 쓰며 0 이하(기본)는 **무기한 보관**(만료 삭제 없음).

    삭제 행 수를 {pending_deleted, failed_deleted, expired_deleted} 로 반환한다.
    """
    moment = now or _now()
    # SQLite/Postgres 저장값과 비교 시 tz 혼용을 피하려고 naive UTC 로 정규화한다.
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)

    pending_cutoff = moment - timedelta(hours=pending_ttl_hours)
    failed_cutoff = moment - timedelta(hours=failed_ttl_hours)
    effective_days = settings.eeg_raw_retention_days if retention_days is None else retention_days
    unlimited = effective_days <= 0
    retention_cutoff = moment - timedelta(days=effective_days) if not unlimited else None

    pending_query = db.query(EEGRawChunk).filter(
        EEGRawChunk.upload_status == "pending",
        EEGRawChunk.created_at.is_not(None),
        EEGRawChunk.created_at < pending_cutoff,
    )
    failed_query = db.query(EEGRawChunk).filter(
        EEGRawChunk.upload_status == "failed",
        EEGRawChunk.created_at.is_not(None),
        EEGRawChunk.created_at < failed_cutoff,
    )
    # uploaded 는 uploaded_at(있으면) 또는 created_at 기준으로 보관 기간을 판정한다.
    expired_query = None
    affected_pairs: set = set()
    if not unlimited:
        expired_query = db.query(EEGRawChunk).filter(
            EEGRawChunk.upload_status == "uploaded",
            func.coalesce(EEGRawChunk.uploaded_at, EEGRawChunk.created_at) < retention_cutoff,
        )
        # 보관 만료 대상의 (세션, 참가자) — 삭제 후 file_count 재계산이 필요하다.
        affected_pairs = {(c.session_id, c.participant_id) for c in expired_query.all()}

    def _delete(query) -> int:
        chunks = query.all()
        object_keys = [c.object_key for c in chunks if c.object_key]
        for chunk in chunks:
            db.delete(chunk)
        db.flush()
        # S3 객체 삭제는 best-effort — 실패해도 DB 정리는 유지한다.
        for key in object_keys:
            storage_service.delete_object(key)
        return len(chunks)

    pending_deleted = _delete(pending_query)
    failed_deleted = _delete(failed_query)
    expired_deleted = _delete(expired_query) if expired_query is not None else 0
    db.commit()

    for sid, participant_id in affected_pairs:
        _refresh_eeg_record_file_count(sid, participant_id, db)
    if affected_pairs:
        db.commit()

    return {
        "pending_deleted": pending_deleted,
        "failed_deleted": failed_deleted,
        "expired_deleted": expired_deleted,
    }

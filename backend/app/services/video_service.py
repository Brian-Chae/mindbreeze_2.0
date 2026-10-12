"""SDD-084 — 세션 영상 청크 수신 서비스 (audio_service 패턴 복제)

상담사(host) 본인 카메라 영상만 저장한다. 온라인 클래스에서도 내담자 영상·음성은
저장하지 않는다(데이터 프라이버시 정책). STT 등 후처리 파이프라인은 없다.
"""

import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord, VideoChunk
from app.schemas.record import MAX_VIDEO_EXPECTED_CHUNKS
from app.services import storage_service

logger = logging.getLogger(__name__)

# S3 자격증명 미설정/일시 실패 시 폴백 저장 위치 — audio(CHUNK_STORAGE_DIR)와 동일 방식.
# /tmp 는 EC2 재시작·디스크 정리 시 삭제되므로 영속 디스크(/var/lib/mindbreeze)를 기본으로 한다.
VIDEO_CHUNK_DIR = Path(os.environ.get("VIDEO_CHUNK_DIR", "/var/lib/mindbreeze/video"))


def _discard_written_media(file_path: str, uploaded_to_s3: bool) -> None:
    """STG-02: 유일 제약 충돌로 채택되지 않은 요청이 쓴 로컬 파일/S3 객체를 정리한다.

    조회-후-삽입 경합에서 진 요청이 남긴 고아 미디어(스토리지 비용·프라이버시)를 제거한다.
    정리 실패가 원래 응답(멱등 결과 반환)을 막지 않도록 best-effort 로 처리한다.
    """
    try:
        if uploaded_to_s3:
            storage_service.delete_object(file_path)
        elif file_path and os.path.exists(file_path):
            os.unlink(file_path)
    except Exception:  # noqa: BLE001
        logger.warning("[video] 미채택 청크 미디어 정리 실패: %s", file_path)


def _stream_chunk_to(chunk: VideoChunk, out) -> bool:
    """STG-08/09: 청크 1개를 순차 스트리밍으로 병합 파일에 기록한다.

    전체를 메모리에 올리지 않고 조각(copyfileobj)으로 복사해 메모리 사용을 상한 내로
    유지한다. 로드 실패(로컬 파일 없음/S3 객체 없음)는 False 로 알려 호출측이 누락으로
    판정하게 한다 — b'' 로 패딩해 잘린 영상을 성공으로 위장하지 않는다.

    반환: True(기록됨) / False(미디어 없음·로드 실패).
    """
    path = chunk.file_path or ""
    if path.startswith("video/"):  # S3 object key
        stream = storage_service.open_object_stream(path)
        if stream is None:
            # MB-ERR-012: S3 객체 로드 실패를 무음(False)으로만 알리지 않고 로그로 남긴다.
            logger.warning(
                "[video] 청크 로드 실패(S3 객체 없음): index=%d key=%s", chunk.chunk_index, path
            )
            return False
        try:
            shutil.copyfileobj(stream, out, length=64 * 1024)
        finally:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        return True
    if path and os.path.exists(path):  # 로컬 폴백 경로
        with open(path, "rb") as src:
            shutil.copyfileobj(src, out, length=64 * 1024)
        return True
    # MB-ERR-012: 로컬 파일 부재를 무음으로 건너뛰지 않는다(실패 청크 인덱스 기록).
    logger.warning("[video] 청크 로드 실패(로컬 파일 없음): index=%d path=%s", chunk.chunk_index, path)
    return False


def _cleanup_source_chunks(chunks: list[VideoChunk], db: DBSession) -> None:
    """STG-04: 병합 성공 후 원본 청크 미디어(S3 객체/로컬 파일)와 행을 정리한다.

    병합본이 만들어졌는데 원본을 남기면 동일 데이터를 두 번 보관해 스토리지 비용이
    배가되고, 삭제 시 추적이 어려운 고아가 된다. 정리 실패가 병합 성공을 막지 않도록
    best-effort 로 처리한다.
    """
    try:
        for chunk in chunks:
            path = chunk.file_path or ""
            if path.startswith("video/"):
                storage_service.delete_object(path)
            elif path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    logger.warning("[video] 원본 청크 파일 삭제 실패: %s", path)
            db.delete(chunk)
        db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("[video] 원본 청크 정리 실패", exc_info=True)
        db.rollback()


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_host_session(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def _get_or_create_record(session_id: UUID, db: DBSession) -> SessionRecord:
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record:
        record = SessionRecord(session_id=session_id, status="idle", markers=[], edit_history=[], ai_summary={})
        db.add(record)
        db.flush()
    return record


def start_recording(session_id: str, host_id: str, consent_video: bool, db: DBSession) -> dict:
    if not consent_video:
        raise HTTPException(status_code=400, detail="영상 녹화 동의가 필요합니다")

    s = _get_host_session(session_id, host_id, db)
    if s.status not in ("scheduled", "in_progress"):
        raise HTTPException(status_code=400, detail="종료된 세션은 녹화할 수 없습니다")

    record = _get_or_create_record(s.id, db)
    record.video_status = "recording"
    record.video_recording_started_at = _now()
    db.commit()
    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.video_status,
        "started_at": record.video_recording_started_at,
    }


def save_chunk(session_id: str, host_id: str, chunk_index: int, content: bytes, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    if record.video_status != "recording":
        raise HTTPException(status_code=400, detail="영상 녹화가 시작되지 않았습니다")

    # SDD-101 C1: 멱등 업로드 — 동일 (session_id, chunk_index) 청크가 이미 있으면
    # 중복 저장하지 않는다(네트워크 재시도로 인한 중복 청크 방지).
    existing = db.query(VideoChunk).filter(
        VideoChunk.session_id == s.id, VideoChunk.chunk_index == chunk_index
    ).first()
    if existing:
        total = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
        return {
            "chunk_index": chunk_index,
            "received_bytes": existing.size_bytes,
            "total_chunks": total,
        }

    # S3 우선 저장(file_path = object key). 자격증명 미설정 시 로컬 폴백(audio와 동일 방식).
    object_key = f"video/{s.id}/{chunk_index}_{uuid.uuid4().hex}.webm"
    uploaded_to_s3 = storage_service.upload_bytes(object_key, content, content_type="video/webm")
    if uploaded_to_s3:
        file_path = object_key
    else:
        # STG-12: 프로덕션에서 실제 S3 업로드가 실패했는데 조용히 로컬 폴백하면
        #   사용자는 성공으로 보지만 S3 객체는 없고(다중 인스턴스 유실) 프라이버시 요건도 깨진다.
        #   자격증명이 설정된 프로덕션이면 실패를 명시적으로 드러낸다(503).
        if storage_service.should_fail_on_upload_failure():
            logger.error("[video] 프로덕션 S3 청크 업로드 실패 — 로컬 폴백 금지: %s", object_key)
            raise HTTPException(
                status_code=503,
                detail="영상 저장소 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            )
        VIDEO_CHUNK_DIR.mkdir(parents=True, exist_ok=True)
        local_path = VIDEO_CHUNK_DIR / f"{s.id}_{chunk_index}_{uuid.uuid4().hex}.webm"
        local_path.write_bytes(content)
        file_path = str(local_path)

    chunk = VideoChunk(
        session_id=s.id,
        chunk_index=chunk_index,
        file_path=file_path,
        size_bytes=len(content),
    )
    # CONC-01: 유일 제약(uq_video_chunk_session_idx)을 savepoint 로 감싼다.
    # 동시 재시도에서 둘 다 기존 조회를 통과하면 IntegrityError(500)가 나므로,
    # 충돌 시 기존 행을 반환해 멱등을 보장한다.
    try:
        with db.begin_nested():
            db.add(chunk)
        db.commit()
    except IntegrityError:
        # STG-02: 진 요청이 S3/로컬에 쓴 미디어는 채택되지 않았으므로 정리한다(고아 방지).
        _discard_written_media(file_path, uploaded_to_s3)
        db.rollback()
        existing = db.query(VideoChunk).filter(
            VideoChunk.session_id == s.id, VideoChunk.chunk_index == chunk_index
        ).first()
        if existing is None:
            raise
        total = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
        return {
            "chunk_index": chunk_index,
            "received_bytes": existing.size_bytes,
            "total_chunks": total,
        }

    total = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
    return {
        "chunk_index": chunk_index,
        "received_bytes": len(content),
        "total_chunks": total,
    }


def stop_recording(session_id: str, host_id: str, expected_count: int | None, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    # VIDEO-EXPECTED-COUNT-DOS: 스키마 상한을 우회한 직접 호출·기존 오염값을 방어한다.
    # 비정상적으로 큰 expected_count 는 저장하지 않고 422 로 거부한다(누락 range OOM 방지).
    if expected_count is not None and not (0 <= expected_count <= MAX_VIDEO_EXPECTED_CHUNKS):
        raise HTTPException(status_code=422, detail="expected_count 값이 허용 범위를 벗어났습니다")
    # 멱등 종료 — 녹화 중일 때만 상태를 전이한다(중복 stop/미시작 stop 허용)
    if record.video_status == "recording":
        record.video_status = "completed"
        record.video_recording_ended_at = _now()
        # SDD-101 C4: 클라이언트가 선언한 예상 청크 수 저장(병합 50% 규칙의 정확한 분모)
        if expected_count is not None:
            record.video_expected_chunks = expected_count
        db.commit()
        db.refresh(record)

    present = {c[0] for c in db.query(VideoChunk.chunk_index).filter(VideoChunk.session_id == s.id).all()}
    total = len(present)
    expected = record.video_expected_chunks
    # 과거에 저장된 오염값(상한 초과)이 있어도 range() 폭발을 막는다.
    if expected is not None and not (0 <= expected <= MAX_VIDEO_EXPECTED_CHUNKS):
        expected = None
    missing = [i for i in range(expected) if i not in present] if expected is not None else []
    return {
        "session_id": str(s.id),
        "status": record.video_status,
        "total_chunks": total,
        "expected_chunks": expected,
        "missing_chunks": missing,
        "ended_at": record.video_recording_ended_at,
    }


def merge_video_chunks(session_id: UUID, db: DBSession) -> str | None:
    """영상 청크를 chunk_index 순서대로 병합해 하나의 .webm 파일로 저장한다.

    S3 청크(object key)는 다운로드, 로컬 청크는 직접 읽어 병합한다.
    성공 시 object_key(또는 로컬 경로)를 반환, 청크 없으면 None.

    SDD-088 후속 개선:
      - STG-08: 청크를 chunk_index 순서대로 하나씩 스트리밍(copyfileobj) 병합해 전체 청크를
        동시에 메모리에 보관하지 않는다.
      - 업로드는 storage_service.upload_file(멀티파트 스트리밍)로 — 전체 파일을
        메모리에 통째로 올리지 않는다(기존 f.read() 대용량 버퍼·OOM 위험 제거).
      - STG-09: 로드 실패(누락 미디어) 청크는 b'' 로 패딩하지 않고 병합을 보류한다.
      - STG-04: 병합 성공 후 원본 청크 미디어/행을 정리한다.
    """
    chunks = (
        db.query(VideoChunk)
        .filter(VideoChunk.session_id == session_id)
        .order_by(VideoChunk.chunk_index.asc())
        .all()
    )
    if not chunks:
        return None

    # SDD-101 C5: chunk_index 갭(누락 청크) 감지 — 부분 실패를 '잘린 영상 성공' 처리하지 않는다.
    # 분모: 클라이언트 선언(video_expected_chunks, C4) 우선, 없으면 최대 인덱스 기반 추정.
    # 50% 미만만 존재하면 merge_failed 로 마킹하고 video_s3_key 를 보류한다(결정 #2).
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    indices = [c.chunk_index for c in chunks]
    present = len(indices)
    declared = record.video_expected_chunks if record else None
    expected = declared if declared is not None else (max(indices) + 1)
    missing = expected - present
    if missing > 0:
        ratio = present / expected if expected > 0 else 1.0
        logger.warning(
            "[video] 청크 누락 감지: present=%d, expected=%d (%.0f%%)",
            present, expected, ratio * 100,
        )
        if ratio < 0.5:
            if record:
                record.video_status = "merge_failed"
                db.commit()
            return None

    failed_indices: list[int] = []

    fd, merged_path = tempfile.mkstemp(suffix=".webm")
    os.close(fd)
    try:
        # STG-08: 청크를 chunk_index 순서대로 하나씩 스트리밍 기록한다 — 전체 청크를
        #   동시에 메모리에 보관하지 않고(기존 ThreadPool 8 동시 보관) 상한 내에서 처리한다.
        with open(merged_path, "wb") as out:
            for chunk in chunks:
                if not _stream_chunk_to(chunk, out):
                    failed_indices.append(chunk.chunk_index)

        # STG-09: DB 에 있으나 실제 미디어 로드에 실패한 청크는 b'' 패딩으로 성공 위장하지
        #   않는다 — 누락 미디어가 하나라도 있으면 잘린 영상을 '성공'으로 마감하지 않고
        #   merge_failed 로 보류한다(무결성 게이트 강화).
        if failed_indices:
            logger.warning(
                "[video] 청크 로드 실패(누락 미디어) — 병합 보류: indices=%s",
                sorted(failed_indices),
            )
            if record:
                record.video_status = "merge_failed"
                db.commit()
            return None

        if os.path.getsize(merged_path) == 0:
            return None

        object_key = f"video/{session_id}/merged.webm"
        if storage_service.upload_file(merged_path, object_key, content_type="video/webm"):
            logger.info("[video] 병합 영상 S3 업로드 완료(스트리밍): %s", object_key)
            _cleanup_source_chunks(chunks, db)
            return object_key
        # STG-12: 프로덕션에서 설정된 S3 업로드 실패를 조용히 로컬 폴백으로 숨기지 않는다.
        if storage_service.should_fail_on_upload_failure():
            logger.error("[video] 프로덕션 S3 병합 업로드 실패 — 로컬 폴백 금지: %s", object_key)
            if record:
                record.video_status = "merge_failed"
                db.commit()
            raise storage_service.StorageUploadError("merged_video_upload_failed")
        # 로컬 폴백(dev/스텁 환경)
        VIDEO_CHUNK_DIR.mkdir(parents=True, exist_ok=True)
        final_path = VIDEO_CHUNK_DIR / f"{session_id}_merged.webm"
        shutil.copyfile(merged_path, final_path)
        logger.info("[video] 병합 영상 로컬 저장: %s", final_path)
        _cleanup_source_chunks(chunks, db)
        return str(final_path)
    finally:
        if os.path.exists(merged_path):
            os.unlink(merged_path)


def video_merge_needed(session_id: UUID, db: DBSession) -> bool:
    """세션 종료 후 영상 병합이 필요한지 판별한다(비동기 체인 구성용).

    영상이 완료됐고(video_status=completed) 아직 병합본(video_s3_key)이 없으며,
    청크가 1개 이상 존재할 때만 True.
    """
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record or record.video_s3_key:
        return False
    if record.video_status != "completed":
        return False
    return db.query(VideoChunk).filter(VideoChunk.session_id == session_id).count() > 0


def finalize_on_session_end(session_id: UUID, db: DBSession) -> None:
    """세션 /end 시 자동 호출. 영상 녹화 중이면 종료 처리(상태 전이)만 수행한다.

    청크 병합은 비동기 체인(video_task.merge_video_chunks_task)에서 실행해 세션
    종료 API 응답을 지연시키지 않는다. 병합 필요 여부는 audio_service 가
    video_merge_needed() 로 판별해 리포트 체인의 선행 태스크로 삽입한다.
    """
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record:
        return
    if record.video_status == "recording":
        record.video_status = "completed"
        record.video_recording_ended_at = _now()
    db.commit()


def get_presigned_video_url(session_id: UUID, db: DBSession) -> str | None:
    """리포트 영상 리플레이용 presigned GET URL 발급. 영상 없으면 None."""
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record or not record.video_s3_key:
        return None
    key = record.video_s3_key
    if not key.startswith("video/"):
        return None  # 로컬 폴백 경로는 스트리밍 미지원(배포 환경은 S3)
    try:
        return storage_service.generate_presigned_get(
            key,
            expires_in=300,
            content_type="video/webm",
            content_disposition=None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[video] presigned GET 발급 실패: %s", exc)
        return None

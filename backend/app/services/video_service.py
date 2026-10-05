"""SDD-084 — 세션 영상 청크 수신 서비스 (audio_service 패턴 복제)

상담사(host) 본인 카메라 영상만 저장한다. 온라인 클래스에서도 내담자 영상·음성은
저장하지 않는다(데이터 프라이버시 정책). STT 등 후처리 파이프라인은 없다.
"""

import logging
import os
import shutil
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord, VideoChunk
from app.services import storage_service

logger = logging.getLogger(__name__)

# S3 자격증명 미설정/일시 실패 시 폴백 저장 위치 — audio(CHUNK_STORAGE_DIR)와 동일 방식.
# /tmp 는 EC2 재시작·디스크 정리 시 삭제되므로 영속 디스크(/var/lib/mindbreeze)를 기본으로 한다.
VIDEO_CHUNK_DIR = Path(os.environ.get("VIDEO_CHUNK_DIR", "/var/lib/mindbreeze/video"))


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
    if storage_service.upload_bytes(object_key, content, content_type="video/webm"):
        file_path = object_key
    else:
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
      - 다운로드는 스레드 풀(최대 8)로 병렬화해 순차 S3 GET N회 지연을 줄인다.
      - 업로드는 storage_service.upload_file(멀티파트 스트리밍)로 — 전체 파일을
        메모리에 통째로 올리지 않는다(기존 f.read() 대용량 버퍼·OOM 위험 제거).
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

    def _load(chunk: VideoChunk) -> bytes | None:
        path = chunk.file_path or ""
        if path.startswith("video/"):  # S3 object key
            return storage_service.download_bytes(path)
        if os.path.exists(path):  # 로컬 폴백 경로
            with open(path, "rb") as src:
                return src.read()
        return None

    fd, merged_path = tempfile.mkstemp(suffix=".webm")
    os.close(fd)
    try:
        with open(merged_path, "wb") as out:
            if len(chunks) <= 2:
                # 청크가 적으면 병렬화 오버헤드가 커 순차 처리한다.
                for chunk in chunks:
                    data = _load(chunk)
                    if data:
                        out.write(data)
            else:
                # 병렬 다운로드 + 입력 순서대로 스트리밍 기록.
                # as_completed 는 완료 순서로 yield 하므로, pending 딕셔너리에
                # 보관했다가 순서가 맞는 청크부터 순차 flush 해 메모리 사용을
                # (미완료 선행 청크 수준으로) 제한하면서 병렬 왕복을 얻는다.
                with ThreadPoolExecutor(max_workers=8) as pool:
                    futures = {pool.submit(_load, chunk): i for i, chunk in enumerate(chunks)}
                    pending: dict[int, bytes] = {}
                    next_idx = 0
                    for fut in as_completed(futures):
                        idx = futures[fut]
                        try:
                            data = fut.result() or b''
                        except Exception:  # noqa: BLE001 — 단일 청크 실패는 건너뛴다
                            # SDD-137: 실패 청크도 b'' 로 표시해 순차 flush 가 멈추지 않게 한다
                            # (앞선 청크 하나가 실패해도 뒤 청크들은 계속 기록)
                            data = b''
                        pending[idx] = data
                        while next_idx in pending:
                            d = pending.pop(next_idx)
                            if d:
                                out.write(d)
                            next_idx += 1

        if os.path.getsize(merged_path) == 0:
            return None

        object_key = f"video/{session_id}/merged.webm"
        if storage_service.upload_file(merged_path, object_key, content_type="video/webm"):
            logger.info("[video] 병합 영상 S3 업로드 완료(스트리밍): %s", object_key)
            return object_key
        # 로컬 폴백
        VIDEO_CHUNK_DIR.mkdir(parents=True, exist_ok=True)
        final_path = VIDEO_CHUNK_DIR / f"{session_id}_merged.webm"
        shutil.copyfile(merged_path, final_path)
        logger.info("[video] 병합 영상 로컬 저장: %s", final_path)
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

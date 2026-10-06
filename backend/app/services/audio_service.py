"""오디오 청크 수신 및 STT 트리거 서비스"""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord, AudioChunk

logger = logging.getLogger(__name__)

# S3 자격증명 미설정/일시 실패 시 폴백 저장 위치. /tmp 는 재시작 시 삭제되므로 영속 디스크 사용.
CHUNK_STORAGE_DIR = Path(os.environ.get("AUDIO_CHUNK_DIR", "/var/lib/mindbreeze/audio"))

# CEL-CHAIN-02: published 파이프라인 아웃박스의 재드라이브 판정 지연(초).
# status='published' 로 표시한 뒤 중간 태스크가 죽어 체인이 끝나지 않으면 워치독이 재발행한다.
# 정상 수행 시간을 확보하기 위해 이 시간이 지난 뒤에만 재드라이브 대상으로 본다
# (진행 중인 체인을 중복 발행하지 않는다).
PIPELINE_REDRIVE_DELAY_SECONDS = 30 * 60


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


def _emit_report_progress(session_id: str, db: DBSession) -> None:
    """SDD-095: 리포트 생성 진행 상태(`report:progress`) 브로드캐스트."""
    try:
        from app.services import report_progress_service

        report_progress_service.emit_report_progress(session_id, db)
    except Exception:  # noqa: BLE001 — WS 실패가 녹음 종료/파이프라인을 막지 않는다.
        logger.warning("[audio] report:progress emit failed: %s", session_id)


def start_recording(session_id: str, host_id: str, consent_audio: bool, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    if s.status not in ("scheduled", "in_progress"):
        raise HTTPException(status_code=400, detail="종료된 세션은 녹음할 수 없습니다")

    record = _get_or_create_record(s.id, db)

    # SDD-085: 마이크 오프(미동의) 선언 — 400 대신 status='manual' 기록 후 200.
    # "AI 요약이 왜 없는지"(의도적 오프 vs 처리 실패)를 사후 구분하는 단일 경로.
    if not consent_audio:
        if record.status in ("recording", "processing", "completed"):
            raise HTTPException(status_code=400, detail="이미 녹음이 진행되었거나 완료된 세션입니다")
        record.status = "manual"
        db.commit()
        db.refresh(record)
        return {
            "session_id": str(s.id),
            "status": record.status,
            "started_at": None,
        }

    # consent_audio=true: manual 상태에서도 recording 재전이 허용 (세션 중 재켜기 여지)
    record.status = "recording"
    record.recording_started_at = _now()
    db.commit()
    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.status,
        "started_at": record.recording_started_at,
    }


def _discard_local_file(path: str) -> None:
    """STG-02: 유일 제약 충돌로 채택되지 않은 요청이 쓴 로컬 파일을 정리한다(best-effort)."""
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except OSError:
        logger.warning("[audio] 미채택 청크 파일 정리 실패: %s", path)


def save_chunk(session_id: str, host_id: str, chunk_index: int, content: bytes, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    if record.status not in ("recording", "processing"):
        raise HTTPException(status_code=400, detail="녹음이 시작되지 않았습니다")

    # SDD-101 C1: 멱등 업로드 — 동일 (session_id, chunk_index) 청크가 이미 있으면
    # 중복 저장하지 않는다(네트워크 재시도로 인한 중복 청크 방지).
    existing = db.query(AudioChunk).filter(
        AudioChunk.session_id == s.id, AudioChunk.chunk_index == chunk_index
    ).first()
    if existing:
        total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()
        return {
            "chunk_index": chunk_index,
            "received_bytes": existing.size_bytes,
            "total_chunks": total,
        }

    CHUNK_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    file_path = CHUNK_STORAGE_DIR / f"{s.id}_{chunk_index}_{uuid.uuid4().hex}.bin"
    file_path.write_bytes(content)

    chunk = AudioChunk(
        session_id=s.id,
        chunk_index=chunk_index,
        file_path=str(file_path),
        size_bytes=len(content),
    )
    # CONC-01: 유일 제약(uq_audio_chunk_session_idx)을 savepoint 로 감싼다.
    # '기존 조회 후 삽입'은 동시 재시도(네트워크 중복)에서 둘 다 조회를 통과해
    # IntegrityError(500)가 날 수 있다. 충돌 시 기존 행을 반환해 멱등을 보장한다.
    try:
        with db.begin_nested():
            db.add(chunk)
        db.commit()
    except IntegrityError:
        # STG-02: 진 요청이 쓴 로컬 파일은 채택되지 않았으므로 정리한다(고아 파일 방지).
        _discard_local_file(str(file_path))
        db.rollback()
        existing = db.query(AudioChunk).filter(
            AudioChunk.session_id == s.id, AudioChunk.chunk_index == chunk_index
        ).first()
        if existing is None:
            raise
        total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()
        return {
            "chunk_index": chunk_index,
            "received_bytes": existing.size_bytes,
            "total_chunks": total,
        }

    total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()
    return {
        "chunk_index": chunk_index,
        "received_bytes": len(content),
        "total_chunks": total,
    }


def stop_recording(session_id: str, host_id: str, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)

    # SDD-085: 수동 기록 모드(manual)에서는 stop이 no-op — STT/요약 파이프라인 미실행
    if record.status == "manual":
        total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()
        # SDD-095: 마이크 오프 세션도 진행 상태(부분 산출)를 알린다.
        _emit_report_progress(str(s.id), db)
        return {
            "session_id": str(s.id),
            "status": record.status,
            "total_chunks": total,
            "ended_at": record.recording_ended_at,
        }

    # AUD-03: 멱등 종료 — 녹음 중일 때만 상태를 전이한다(video_service 와 동일).
    #   중복 stop / 미시작 stop 이 processing 으로 오전이하지 않도록 현재 상태를 확인한다.
    if record.status == "recording":
        record.status = "processing"
        record.recording_ended_at = _now()
        db.commit()

    total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()

    # SDD-101 Phase A: STT/요약 발행은 finalize_on_session_end 1곳으로 단일화.
    # stop은 recording_ended_at 기록 + processing 마킹만 한다(발행 없음).
    # (기존에는 여기서 stt_task/summary_task 미import로 NameError → 인라인 동기 실행되어
    #  /audio/stop 이 STT+요약을 동기 대기하는 지연 버그가 있었다.)

    # SDD-095: 녹음 저장 완료(STT 진행) 진행 상태 브로드캐스트
    _emit_report_progress(str(s.id), db)

    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.status,
        "total_chunks": total,
        "ended_at": record.recording_ended_at,
    }


def _build_pipeline_tasks(session_id, has_recording, needs_video_merge, needs_report):
    """종료 파이프라인 체인의 태스크 목록을 만든다."""
    from app.tasks.report_task import generate_reports_for_session

    tasks = []
    if needs_video_merge:
        from app.tasks.video_task import merge_video_chunks_task

        tasks.append(merge_video_chunks_task.si(str(session_id)))
    if has_recording:
        from app.tasks.stt_task import stt_task
        from app.tasks.summary_task import summary_task

        tasks += [stt_task.si(str(session_id)), summary_task.si(str(session_id))]
    if needs_report:
        tasks.append(generate_reports_for_session.si(str(session_id)))
    return tasks


def publish_pipeline(session_id, has_recording, needs_video_merge, needs_report) -> bool:
    """종료 파이프라인 체인을 Celery에 적재한다. 실패 시 예외를 던진다(호출측이 pending 유지)."""
    from celery import chain

    tasks = _build_pipeline_tasks(session_id, has_recording, needs_video_merge, needs_report)
    if not tasks:
        return False
    chain(*tasks).apply_async()
    return True


def finalize_on_session_end(session_id: UUID, db: DBSession) -> None:
    """세션 /end 시 자동 호출. STT/요약/리포트 생성을 Celery chain 으로 비동기 처리.

    세션 종료 API 가 STT(Whisper)·요약(LLM)·리포트 생성(LLM)을 동기 대기하지 않도록
    chain(stt → summary → generate_reports) 으로 큐에 적재한다.
    SDD-088 후속: 영상 청크 병합이 필요하면 chain 선두에 삽입해 리포트 생성 전에
    video_s3_key 가 준비되도록 한다.
    """
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    # SDD-101 Phase A: stop_recording이 이미 'processing'으로 마킹한 경우도 녹음으로 취급.
    # (direct /end 는 'recording', 정상 handleStop 경로는 'processing' 상태로 여기 도달)
    has_recording = record is not None and record.status in ("recording", "processing")
    if record is not None and record.status == "recording":
        record.status = "processing"
        record.recording_ended_at = _now()
        db.commit()

    # SDD-088 후속: 영상 병합 필요 여부 — 리포트가 video_s3_key 를 읽으므로
    # generate_reports_for_session 보다 선행 태스크로 넣는다.
    from app.services import video_service

    needs_video_merge = video_service.video_merge_needed(session_id, db)

    # SDD-101 Phase A: 리포트는 실제 데이터(녹음·영상·세션 진행)가 있을 때만 생성.
    # (빈 세션 — 시작조차 안 한 open/scheduled — 에 빈 리포트를 양산하지 않도록)
    session = db.query(Session).filter(Session.id == session_id).first()
    has_data = has_recording or needs_video_merge or (session is not None and session.started_at is not None)

    # SDD-101 Phase A4: 발행 의도를 세션 상태와 같은 트랜잭션으로 durable 기록(아웃박스).
    # 발행 실패·프로세스 사망 시에도 beat 스윕이 미발행(pending) 건을 재발행한다.
    if has_data:
        from app.models.pipeline_outbox import PipelineOutbox

        outbox = db.query(PipelineOutbox).filter(PipelineOutbox.session_id == session_id).first()
        if outbox is None:
            outbox = PipelineOutbox(
                session_id=session_id,
                has_recording=has_recording,
                needs_video_merge=needs_video_merge,
                needs_report=has_data,
            )
            db.add(outbox)
        else:
            outbox.has_recording = has_recording
            outbox.needs_video_merge = needs_video_merge
            outbox.needs_report = has_data
            outbox.status = "pending"
            outbox.attempts = 0
            outbox.available_at = _now()
        db.commit()

        try:
            publish_pipeline(str(session_id), has_recording, needs_video_merge, has_data)
            outbox.status = "published"
            # CEL-CHAIN-02: 이 시점 이후 체인이 미완료(중간 태스크 크래시 등)면 워치독이
            # 재발행한다. available_at 을 재드라이브 판정 시각으로 밀어 정상 진행 중인
            # 체인을 중복 발행하지 않게 한다.
            outbox.available_at = _now() + timedelta(seconds=PIPELINE_REDRIVE_DELAY_SECONDS)
            db.commit()
            logger.info(
                "[audio] chain enqueued for session %s (recording=%s, video_merge=%s)",
                session_id,
                has_recording,
                needs_video_merge,
            )
        except Exception as exc:
            # 발행 실패 — pending 유지(운영 인라인 폴백 제거). beat 스윕이 재발행.
            logger.exception("[audio] pipeline publish failed (outbox pending): %s", exc)
    else:
        logger.info("[audio] finalize skipped (no data) for session %s", session_id)

    # SDD-095: 세션 종료 직후 '처리 중' 진행 상태를 즉시 push — 프론트 대기 화면 스텝퍼 기동
    _emit_report_progress(str(session_id), db)

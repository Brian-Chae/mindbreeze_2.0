"""SDD-088 후속 — 세션 영상 청크 병합 Celery 태스크.

세션 종료 시 영상 청크 병합(다운로드 → 병합 → S3 업로드)을 비동기로 실행해
`/end` 응답 지연을 제거한다. audio_service 가 리포트 체인의 선행 태스크로
삽입하므로 generate_reports_for_session 보다 먼저 실행돼 video_s3_key 가
리포트 생성 전에 준비된다.
"""

import logging
from uuid import UUID

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy.orm import Session as DBSession

from app.core.celery_app import RetryableTaskError

logger = logging.getLogger(__name__)


def _mark_merge_failed(session_id: str, db: DBSession) -> None:
    """VID-5TH-09: 병합 실패를 기록한다 — 예외를 삼켜 '완료'로 남기는 것을 막는다.

    video_s3_key 는 채우지 않고(보류) video_status 만 merge_failed 로 마감한다.
    마킹 자체의 실패가 원 예외를 가리지 않도록 방어한다.
    """
    from app.models.record import SessionRecord

    try:
        record = (
            db.query(SessionRecord)
            .filter(SessionRecord.session_id == UUID(session_id))
            .first()
        )
        if record is not None:
            record.video_status = "merge_failed"
            db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("[video_task] merge_failed 마킹 실패: %s", session_id)
        db.rollback()


def run_video_merge_inline(session_id: str, db: DBSession) -> None:
    """동기 실행 헬퍼 — Celery 비활성 환경/테스트에서 직접 호출."""
    from app.models.record import SessionRecord
    from app.services import video_service

    sid = UUID(session_id)
    try:
        key = video_service.merge_video_chunks(sid, db)
    except SoftTimeLimitExceeded:
        # 시간 초과로 잘린 병합은 성공이 아니다 — merge_failed 마킹 후 재전파(워커 실패 인지).
        logger.exception("[video_task] 영상 병합 시간 초과: %s", session_id)
        _mark_merge_failed(session_id, db)
        raise
    except Exception as exc:  # noqa: BLE001
        # VID-5TH-09: 예외를 삼키면 잘린 영상이 조용히 방치된다 — merge_failed 마킹 후 재전파.
        logger.exception("[video_task] 영상 병합 실패: %s", session_id)
        _mark_merge_failed(session_id, db)
        # CEL-RETRY-01: autoretry_for=(RuntimeError,) 는 RuntimeError 계열만 잡는다.
        # S3/botocore 등 비-RuntimeError 인프라 예외도 재시도되도록 RetryableTaskError 로 승격한다.
        if isinstance(exc, RetryableTaskError):
            raise
        raise RetryableTaskError("video_merge_failed") from exc
    if key:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record and not record.video_s3_key:
            record.video_s3_key = key
            db.commit()
    logger.info("[video_task] 영상 병합 완료: %s -> %s", session_id, key)


try:
    from app.core.celery_app import celery_app

    # STT-5TH-04: 미처리 인프라 오류(일시)에 대한 Celery 레벨 재시도 — report_email_task 패턴.
    @celery_app.task(
        name="tasks.merge_video_chunks",
        soft_time_limit=600,
        time_limit=900,
        autoretry_for=(RuntimeError,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 3},
    )
    def merge_video_chunks_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_video_merge_inline(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    # MB-ERR-001: 등록 예외를 삼키면 영상 병합 태스크가 미등록된 채 조용히 유실된다.
    logger.exception("[video_task] Celery 태스크 등록 실패 — 태스크 미등록 가능")

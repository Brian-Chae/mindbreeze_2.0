"""MIND BREEZE 2.0 — 기능상 오류(중) 8차 수정 회귀 테스트.

Celery 3건
  [1] CEL-OUTBOX-02    이메일 아웃박스 배치 커밋 → 행 단위 커밋
  [2] CEL-RETRY-01     stt/summary/video autoretry 무력 → 재시도 가능 예외 전파
  [3] CEL-WATCHDOG-01  하드 타임리밋/크래시 리포트의 승인 게이트(status) 미마감

S3 7건
  [4]  STG-02  중복 업로드 유일 제약 충돌 시 진 요청 로컬 파일/S3 객체 정리
  [5]  STG-04  영상 병합 성공 후 원본 청크 객체/파일 정리
  [6]  STG-06  S3 엔드포인트(endpoint_url) 설정화
  [7]  STG-07  dev 더미 자격증명(dev/dev) 시 스텁 유지
  [8]  STG-08  영상 병합 스트리밍/청크 순차 처리(전량 메모리 적재 금지)
  [9]  STG-09  누락 청크 로드 실패를 b'' 패딩으로 성공 위장하지 않음
  [10] STG-12  프로덕션 S3 업로드 실패를 조용히 로컬 폴백하지 않고 명시
"""

import io
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pytest

from app.models.record import SessionRecord, VideoChunk
from app.services import video_service


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _video_session(client, email: str, *, started: bool = True) -> dict:
    from tests.test_video_record import _create_session, _register

    host = _register(client, email)
    sid = _create_session(client, host, started=started)
    return {"host": host, "sid": sid}


def _add_video_chunks(sid: str, indices, *, missing: tuple = (), content: bytes = b"data"):
    """로컬 파일을 가진 VideoChunk 행들을 만들고 파일 경로 목록을 돌려준다.

    missing 에 든 인덱스는 DB 행만 만들고 실제 파일은 만들지 않는다(미디어 누락 시뮬레이션).
    """
    db = _db()
    paths = []
    try:
        for i in indices:
            if i in missing:
                path = os.path.join(os.environ["VIDEO_CHUNK_DIR"], f"missing-{uuid.uuid4().hex}.webm")
            else:
                fd, path = tempfile.mkstemp(suffix=".webm")
                os.write(fd, content)
                os.close(fd)
                paths.append(path)
            db.add(
                VideoChunk(
                    session_id=uuid.UUID(sid), chunk_index=i, file_path=path, size_bytes=len(content),
                )
            )
        db.commit()
    finally:
        db.close()
    return paths


# ── [1] CEL-OUTBOX-02: 행 단위 커밋 ────────────────────────────────────────
def _seed_outbox(recipient: str, created_at) -> str:
    from app.models.notification_outbox import NotificationOutbox
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.email == "outbox8-user@test.com").first()
        if user is None:
            user = User(
                email="outbox8-user@test.com", password_hash="x", name="아웃박스8",
                role="counselor", status="active", verified_tier="email",
            )
            db.add(user)
            db.commit()
        item = NotificationOutbox(
            user_id=user.id, channel="email", recipient=recipient,
            payload={"subject": "s", "body": "b"}, status="pending", created_at=created_at,
        )
        db.add(item)
        db.commit()
        return str(item.id)
    finally:
        db.close()


def _load_outbox(oid: str):
    from app.models.notification_outbox import NotificationOutbox

    db = _db()
    try:
        return db.query(NotificationOutbox).filter(NotificationOutbox.id == uuid.UUID(oid)).first()
    finally:
        db.close()


def test_cel_outbox_02_행단위_커밋으로_발송유실_방지(client, monkeypatch):
    from app.tasks import outbox as outbox_task

    base = datetime.now(timezone.utc)
    oid_a = _seed_outbox("outbox8-a@test.com", base)
    oid_b = _seed_outbox("outbox8-b@test.com", base + timedelta(seconds=1))

    def _fake(to_email, subject, body, body_html=None):
        if to_email == "outbox8-b@test.com":
            # 배치 도중 워커 크래시(최종 커밋 이전 중단) — Exception 이 아닌 BaseException.
            raise SystemExit("worker crashed mid-batch")
        return True

    monkeypatch.setattr(outbox_task, "send_email_notification", _fake)

    with pytest.raises(SystemExit):
        outbox_task.process_email_outbox()

    # A 는 발송 직후 행 단위 커밋됐으므로 최종 커밋 없이도 status='sent' 가 durable.
    a = _load_outbox(oid_a)
    assert a is not None and a.status == "sent"
    # B 는 처리 전 중단 → pending 유지(다음 스윕 재시도 대상).
    b = _load_outbox(oid_b)
    assert b is not None and b.status == "pending"


# ── [2] CEL-RETRY-01: 재시도 가능 예외 전파 ────────────────────────────────
def test_cel_retry_01_stt_transient_exhausted_raises(client, monkeypatch):
    from app.core.celery_app import RetryableTaskError
    from app.tasks import stt_task
    from tests.test_mb2_func_fixes_5th import _seed_record_with_chunk

    info = _video_session(client, "retry8-stt@test.com")
    sid = uuid.UUID(info["sid"])
    db = _db()
    try:
        record = _seed_record_with_chunk(db, sid)
        monkeypatch.setattr(
            stt_task, "_call_gemini_transcribe",
            Mock(side_effect=stt_task.GeminiTransientError("503 exhausted")),
        )
        monkeypatch.setattr(stt_task, "_call_whisper", Mock(side_effect=RuntimeError("whisper down")))
        with pytest.raises(RetryableTaskError):
            stt_task.run_stt_inline(str(sid), db)
        db.refresh(record)
        assert record.status == "failed"  # 재시도 전 durable 마킹
    finally:
        db.close()


def test_cel_retry_01_summary_일시오류_재시도예외_전파(client, monkeypatch):
    from app.core.celery_app import RetryableTaskError
    from app.tasks import summary_task

    info = _video_session(client, "retry8-sum@test.com")
    sid = uuid.UUID(info["sid"])
    db = _db()
    try:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record is None:
            record = SessionRecord(session_id=sid, status="processing", transcript="대화 내용")
            db.add(record)
        else:
            record.status = "processing"
            record.transcript = "대화 내용"
        db.commit()

        monkeypatch.setattr(
            summary_task, "_call_gemini_summary",
            Mock(side_effect=RetryableTaskError("gemini_http_503")),
        )
        with pytest.raises(RetryableTaskError):
            summary_task.run_summary_inline(str(sid), db)

        db.refresh(record)
        # 일시 오류는 summary_failed 로 굳히지 않고 processing 유지(재시도 여지).
        assert record.status == "processing"
        assert not (record.ai_summary or {}).get("summary_failed")
    finally:
        db.close()


def test_cel_retry_01_video_비runtime_오류도_재시도예외로_승격(client, monkeypatch):
    from app.core.celery_app import RetryableTaskError
    from app.tasks import video_task

    info = _video_session(client, "retry8-vid@test.com")
    sid = uuid.UUID(info["sid"])
    db = _db()
    try:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record is None:
            record = SessionRecord(session_id=sid, video_status="completed")
            db.add(record)
            db.commit()
        # S3/botocore 류 비-RuntimeError 예외.
        monkeypatch.setattr(video_service, "merge_video_chunks", Mock(side_effect=ValueError("s3 boom")))
        with pytest.raises(RetryableTaskError):
            video_task.run_video_merge_inline(str(sid), db)
        db.refresh(record)
        assert record.video_status == "merge_failed"
    finally:
        db.close()


# ── [3] CEL-WATCHDOG-01: 승인 게이트 마감 ──────────────────────────────────
def test_cel_watchdog_01_승인게이트도_error로_마감(client):
    from app.services import report_progress_service as rps
    from tests.test_sdd095_report_progress import _create_session, _mk_report, _register

    host = _register(client, "wd8@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="processing", status="pending_analysis")
        rep.generation_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=rps.REPORT_GENERATION_TIMEOUT_SECONDS + 60
        )
        db.commit()

        affected = rps.sweep_stale_reports(db)
        assert sid in affected
        db.refresh(rep)
        assert rep.generation_status == rps.GENERATION_PARTIAL
        assert rep.generation_error == rps.REASON_TIMEOUT
        # 승인 게이트도 마감 — pending_analysis 로 영구 정지하지 않는다.
        assert rep.status == "error"
    finally:
        db.close()


def test_cel_watchdog_01_완료된_리포트_상태는_보존(client):
    from app.services import report_progress_service as rps
    from tests.test_sdd095_report_progress import _create_session, _mk_report, _register

    host = _register(client, "wd8b@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="partial", status="completed")
        rps.sweep_stale_reports(db)
        db.refresh(rep)
        assert rep.status == "completed"
    finally:
        db.close()


# ── [4] STG-02: 중복 업로드 충돌 시 미채택 요청 정리 ─────────────────────────
def test_stg02_video_충돌시_로컬파일_정리(client, monkeypatch):
    info = _video_session(client, "stg02-vid@test.com")
    host = info["host"]
    sid = info["sid"]
    client.post(
        f"/api/v1/sessions/{sid}/video/start",
        json={"consent_video": True}, headers=host["auth"],
    )

    db = _db()
    try:
        before = set(os.listdir(os.environ["VIDEO_CHUNK_DIR"]))

        def _fake_upload(object_key, content, content_type="video/webm"):
            # 경쟁 요청이 먼저 (session, index) 행을 커밋한 상태를 시뮬레이션.
            db.add(
                VideoChunk(
                    session_id=uuid.UUID(sid), chunk_index=0,
                    file_path="/tmp/competitor.webm", size_bytes=1,
                )
            )
            db.commit()
            return False  # 로컬 폴백 → 정리 대상 로컬 파일 생성

        monkeypatch.setattr(video_service.storage_service, "upload_bytes", _fake_upload)

        result = video_service.save_chunk(sid, host["id"], 0, b"payload", db)

        assert result["chunk_index"] == 0
        after = set(os.listdir(os.environ["VIDEO_CHUNK_DIR"]))
        assert after == before, "미채택 요청이 남긴 로컬 파일이 정리돼야 함"
        rows = db.query(VideoChunk).filter(VideoChunk.session_id == uuid.UUID(sid)).all()
        assert len(rows) == 1, "중복 행이 아니라 기존 행 하나만 유지돼야 함"
    finally:
        db.close()


def test_stg02_audio_미채택파일_정리헬퍼():
    from app.services import audio_service

    fd, path = tempfile.mkstemp(suffix=".bin")
    os.close(fd)
    assert os.path.exists(path)
    audio_service._discard_local_file(path)
    assert not os.path.exists(path)
    # 존재하지 않는 경로도 예외 없이 통과(best-effort).
    audio_service._discard_local_file(path)


# ── [5] STG-04: 병합 후 원본 청크 정리 ──────────────────────────────────────
def test_stg04_병합성공후_원본청크_정리(client):
    info = _video_session(client, "stg04@test.com", started=False)
    sid = info["sid"]
    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(sid)))
        db.commit()
        paths = _add_video_chunks(sid, [0, 1, 2])

        with patch.object(video_service.storage_service, "upload_file", return_value=True):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is not None
        remaining = db.query(VideoChunk).filter(VideoChunk.session_id == uuid.UUID(sid)).count()
        assert remaining == 0, "병합 후 원본 청크 행이 정리돼야 함"
        assert all(not os.path.exists(p) for p in paths), "병합 후 원본 청크 파일이 삭제돼야 함"
    finally:
        db.close()


# ── [6] STG-06: endpoint_url 설정화 ────────────────────────────────────────
def test_stg06_presigned_put_uses_configured_endpoint(monkeypatch):
    from app.config import settings
    from app.services import storage_service

    monkeypatch.setattr(settings, "aws_access_key_id", "AKIAREALKEY123")
    monkeypatch.setattr(settings, "aws_secret_access_key", "real-secret-value")
    monkeypatch.setattr(settings, "s3_endpoint_url", "http://minio.internal:9000")

    import boto3

    captured = {}

    class _Client:
        def generate_presigned_url(self, *a, **k):
            return "http://minio.internal:9000/presigned"

    def _fake_client(service, **kwargs):
        captured.update(kwargs)
        return _Client()

    monkeypatch.setattr(boto3, "client", _fake_client)

    url = storage_service.generate_presigned_put("video/x/chunk_0.webm")

    assert url == "http://minio.internal:9000/presigned"
    assert captured["endpoint_url"] == "http://minio.internal:9000"


# ── [7] STG-07: dev 더미 자격증명 시 스텁 유지 ───────────────────────────────
def test_stg07_더미_자격증명은_미설정으로_간주(monkeypatch):
    from app.config import settings
    from app.services import storage_service

    monkeypatch.setattr(settings, "aws_access_key_id", "dev")
    monkeypatch.setattr(settings, "aws_secret_access_key", "dev")

    assert storage_service.storage_configured() is False
    url = storage_service.generate_presigned_put("video/x/chunk_0.webm")
    assert "stub=1" in url, "더미 자격증명이면 실제 서명 대신 스텁 URL 을 유지해야 함"


# ── [8] STG-08: 스트리밍/순차 처리 ─────────────────────────────────────────
def test_stg08_병합은_전량메모리_다운로드_대신_스트림사용(client, monkeypatch):
    info = _video_session(client, "stg08@test.com", started=False)
    sid = info["sid"]
    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(sid)))
        db.commit()
        for i in range(3):
            db.add(VideoChunk(session_id=uuid.UUID(sid), chunk_index=i, file_path=f"video/{sid}/{i}.webm", size_bytes=3))
        db.commit()

        # download_bytes(전량 메모리 적재) 가 호출되면 실패.
        monkeypatch.setattr(
            video_service.storage_service, "download_bytes",
            lambda key: pytest.fail("download_bytes(전량 버퍼) 대신 스트리밍을 사용해야 함"),
        )
        opened = []

        def _open(key):
            opened.append(key)
            return io.BytesIO(b"abc")

        monkeypatch.setattr(video_service.storage_service, "open_object_stream", _open)

        with patch.object(video_service.storage_service, "upload_file", return_value=True):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is not None
        assert len(opened) == 3, "각 청크를 순차 스트리밍으로 열어야 함"
    finally:
        db.close()


# ── [9] STG-09: 누락 미디어를 b'' 패딩으로 성공 위장하지 않음 ────────────────
def test_stg09_미디어_로드실패시_병합보류(client):
    info = _video_session(client, "stg09@test.com", started=False)
    sid = info["sid"]
    db = _db()
    try:
        record = SessionRecord(session_id=uuid.UUID(sid))
        db.add(record)
        db.commit()
        _add_video_chunks(sid, [0, 1], missing=(1,))  # index 1 은 파일 없음(DB 행은 존재)

        with patch.object(video_service.storage_service, "upload_file", return_value=True):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is None, "미디어 누락 청크가 있으면 잘린 영상을 성공으로 마감하면 안 됨"
        db.refresh(record)
        assert record.video_status == "merge_failed"
    finally:
        db.close()


# ── [10] STG-12: 프로덕션 업로드 실패 명시 ──────────────────────────────────
def _force_production_storage(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "aws_access_key_id", "AKIAREALKEY123")
    monkeypatch.setattr(settings, "aws_secret_access_key", "real-secret-value")


def test_stg12_프로덕션_청크업로드_실패는_503_명시(client, monkeypatch):
    from app.services import storage_service
    from tests.test_video_record import _upload_chunk

    info = _video_session(client, "stg12-chunk@test.com")
    host = info["host"]
    sid = info["sid"]
    client.post(
        f"/api/v1/sessions/{sid}/video/start",
        json={"consent_video": True}, headers=host["auth"],
    )
    before = set(os.listdir(os.environ["VIDEO_CHUNK_DIR"]))
    _force_production_storage(monkeypatch)
    monkeypatch.setattr(storage_service, "upload_bytes", lambda *a, **k: False)

    res = _upload_chunk(client, sid, host["auth"], index=0)
    assert res.status_code == 503, res.text
    assert set(os.listdir(os.environ["VIDEO_CHUNK_DIR"])) == before, "프로덕션 실패는 로컬 폴백을 남기면 안 됨"


def test_stg12_프로덕션_병합업로드_실패는_명시예외(client, monkeypatch):
    from app.services import storage_service

    info = _video_session(client, "stg12-merge@test.com", started=False)
    sid = info["sid"]
    db = _db()
    try:
        record = SessionRecord(session_id=uuid.UUID(sid))
        db.add(record)
        db.commit()
        _add_video_chunks(sid, [0, 1])
        _force_production_storage(monkeypatch)

        with patch.object(video_service.storage_service, "upload_file", return_value=False):
            with pytest.raises(storage_service.StorageUploadError):
                video_service.merge_video_chunks(uuid.UUID(sid), db)

        db.refresh(record)
        assert record.video_status == "merge_failed"
    finally:
        db.close()

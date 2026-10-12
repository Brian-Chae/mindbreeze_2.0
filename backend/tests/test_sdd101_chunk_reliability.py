"""SDD-101 Phase C5 — 영상 병합 무결성(누락 청크 감지 + 50% 규칙) QA

검증 시나리오:
- 누락 청크가 50% 미만이면(50% 이상 존재) 병합을 진행한다(부분 정상 허용).
- 누락 청크가 50% 이상이면 merge_failed 로 마킹하고 video_s3_key 를 보류한다.
"""

import os
import tempfile
import uuid

from unittest.mock import patch

from app.models.record import SessionRecord, VideoChunk
from app.services import video_service
from tests.test_video_record import _create_session, _register, _upload_chunk


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _write_chunk_file(content: bytes = b"chunk-data") -> str:
    fd, path = tempfile.mkstemp(suffix=".webm")
    os.write(fd, content)
    os.close(fd)
    return path


def _add_chunks(sid: str, indices: list[int], db) -> None:
    for i in indices:
        path = _write_chunk_file()
        db.add(VideoChunk(session_id=uuid.UUID(sid), chunk_index=i, file_path=path, size_bytes=10))
    db.commit()


def test_병합_누락_50퍼센트이상_존재하면_병합(client):
    host = _register(client, "rel01@test.com")
    sid = _create_session(client, host, started=False)

    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(sid)))
        db.commit()
        _add_chunks(sid, [0, 1, 2, 4], db)  # 3 누락 → 4/5 = 80% 존재

        with patch.object(video_service.storage_service, "upload_file", return_value=True):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is not None, "50% 이상 존재하면 병합해야 함"
    finally:
        db.close()


def test_청크_재업로드_멱등(client):
    host = _register(client, "rel03@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])

    r1 = _upload_chunk(client, sid, host["auth"], index=0)
    assert r1.status_code == 200, r1.text
    assert r1.json()["total_chunks"] == 1

    # 동일 인덱스 재업로드(네트워크 재시도) → 중복 저장 없이 멱등 처리
    r2 = _upload_chunk(client, sid, host["auth"], index=0)
    assert r2.status_code == 200, r2.text
    assert r2.json()["total_chunks"] == 1


def test_종료_expected_count_누락인덱스_반환(client):
    host = _register(client, "rel04@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    _upload_chunk(client, sid, host["auth"], index=0)
    _upload_chunk(client, sid, host["auth"], index=1)
    _upload_chunk(client, sid, host["auth"], index=2)

    r = client.post(f"/api/v1/sessions/{sid}/video/stop", json={"expected_count": 5}, headers=host["auth"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_chunks"] == 3
    assert body["expected_chunks"] == 5
    assert body["missing_chunks"] == [3, 4]


def test_기록지_영상_무결성_필드_노출(client):
    host = _register(client, "rel05@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    _upload_chunk(client, sid, host["auth"], index=0)
    _upload_chunk(client, sid, host["auth"], index=1)
    _upload_chunk(client, sid, host["auth"], index=2)
    client.post(f"/api/v1/sessions/{sid}/video/stop", json={"expected_count": 5}, headers=host["auth"])

    r = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"])
    assert r.status_code == 200, r.text
    body = r.json()
    # D1: merge_failed/누락 표시용 필드 노출
    assert body["video_status"] == "completed"
    assert body["video_expected_chunks"] == 5
    assert body["video_actual_chunks"] == 3


def test_병합_누락_50퍼센트미만이면_merge_failed(client):
    host = _register(client, "rel02@test.com")
    sid = _create_session(client, host, started=False)

    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(sid)))
        db.commit()
        _add_chunks(sid, [0, 5], db)  # 2/6 = 33% 존재 → 누락 67%

        with patch.object(video_service.storage_service, "upload_file", return_value=True):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is None, "50% 미만이면 병합을 보류해야 함"
        rec = db.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        assert rec is not None
        assert rec.video_status == "merge_failed"
    finally:
        db.close()

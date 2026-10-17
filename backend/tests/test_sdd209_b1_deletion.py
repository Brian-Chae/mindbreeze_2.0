"""SDD-209 B1 — 삭제 경로 정리·관리자 삭제 (verify RV1-4~6, BT3·BT4·BT48 일부, AZ16·AZ18).

정책: 일반 삭제·탈퇴·참여자 제거는 행을 지우지 않고 숨김(보존 전환)한다. 원본은 보관 스위프나
플랫폼 관리자 삭제로만 지워지며, 관리자 삭제는 사유 필수 + 감사 1건.
"""

import os
import uuid

from tests.test_audio_record import _create_session, _register, _upload_chunk


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _promote(email_id: str, role: str) -> None:
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(email_id)).first()
        user.role = role
        db.commit()
    finally:
        db.close()


def _make_platform_admin(client, email="b1admin@test.com"):
    admin = _register(client, email)
    _promote(admin["id"], "platform_admin")
    return admin


def _seed_originals(client, host, sid: str):
    """음성 청크(로컬 파일) + EEG raw 청크 행 + 병합 영상 키 + 전사문을 만든다."""
    from app.models.record import EEGRawChunk, EEGRecord, SessionRecord

    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)
    sid_uuid = uuid.UUID(sid)
    db = _db()
    try:
        from app.models.record import AudioChunk
        from app.models.session import SessionParticipant

        chunk = db.query(AudioChunk).filter(AudioChunk.session_id == sid_uuid).first()
        local_path = chunk.file_path
        part = SessionParticipant(session_id=sid_uuid, user_id=uuid.UUID(host["id"]))
        db.add(part)
        db.flush()
        db.add(EEGRecord(session_id=sid_uuid, user_id=uuid.UUID(host["id"]), participant_id=part.id,
                         s3_key="eeg-raw/x", file_count=1))
        db.add(EEGRawChunk(
            session_id=sid_uuid, participant_id=part.id, user_id=uuid.UUID(host["id"]),
            stream_id="eeg", chunk_index=0, object_key=f"eeg-raw/{sid}/{part.id}/0.bin",
            upload_status="uploaded", size_bytes=10, sample_rate=250, channel_count=2,
            start_ms=0, end_ms=1000,
        ))
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid_uuid).first()
        record.video_s3_key = f"video/{sid}/merged.webm"
        record.transcript = "전사문 원문"
        record.ai_summary = {"segments": [{"text": "a"}], "summary": "요약"}
        db.commit()
        return local_path, str(part.id)
    finally:
        db.close()


def _counts(sid: str) -> dict:
    from app.models.record import AudioChunk, EEGRawChunk, EEGRecord, Report, SessionRecord
    from app.models.session import Session as S, SessionParticipant

    sid_uuid = uuid.UUID(sid)
    db = _db()
    try:
        return {
            "session": db.query(S).filter(S.id == sid_uuid).execution_options(include_hidden=True).count(),
            "audio": db.query(AudioChunk).filter(AudioChunk.session_id == sid_uuid).count(),
            "raw": db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid_uuid).count(),
            "eeg_records": db.query(EEGRecord).filter(EEGRecord.session_id == sid_uuid).count(),
            "records": db.query(SessionRecord).filter(SessionRecord.session_id == sid_uuid).count(),
            "reports": db.query(Report).filter(Report.session_id == sid_uuid).count(),
            "participants": db.query(SessionParticipant).filter(SessionParticipant.session_id == sid_uuid)
            .execution_options(include_removed=True).count(),
        }
    finally:
        db.close()


# ── RV1-4 / BT3 / BT62: 클래스 삭제 = 숨김 ───────────────────────────────


def test_클래스_삭제는_숨김_원본_참조_행수_보존(client, monkeypatch):
    from app.services import storage_service

    deleted: list = []
    monkeypatch.setattr(storage_service, "delete_object", lambda key: deleted.append(key) or True)
    host = _register(client, "b1host1@test.com")
    sid = _create_session(client, host)
    local_path, _ = _seed_originals(client, host, sid)
    before = _counts(sid)

    r = client.delete(f"/api/v1/sessions/{sid}", headers=host["auth"])
    assert r.status_code == 204

    assert _counts(sid) == before, "삭제 전후 원본·기록 행 수가 같아야 한다(CASCADE 소실 0)"
    assert os.path.exists(local_path), "로컬 음성 파일은 즉시 지워지지 않는다"
    assert deleted == [], "S3 객체도 즉시 지워지지 않는다"
    # 목록·상세에서 제외 (BT62)
    assert client.get(f"/api/v1/sessions/{sid}", headers=host["auth"]).status_code == 404
    listed = client.get("/api/v1/sessions", headers=host["auth"]).json()["sessions"]
    assert all(x["id"] != sid for x in listed)


def test_숨긴_클래스_청크는_스위프_고아로_오판되지_않는다(client):
    from app.services import media_cleanup_service

    host = _register(client, "b1host2@test.com")
    sid = _create_session(client, host)
    _seed_originals(client, host, sid)
    client.delete(f"/api/v1/sessions/{sid}", headers=host["auth"])

    db = _db()
    try:
        media_cleanup_service.sweep_stale_media(db)
    finally:
        db.close()
    assert _counts(sid)["audio"] == 1


def test_삭제된_클래스는_코드로_입장되지_않는다(client):
    host = _register(client, "b1host3@test.com")
    sid = _create_session(client, host, started=False)
    code = client.get(f"/api/v1/sessions/{sid}", headers=host["auth"]).json()["access_code"]
    client.delete(f"/api/v1/sessions/{sid}", headers=host["auth"])

    guest = client.post(f"/api/v1/sessions/by-code/{code}/join", json={"guest_name": "손님"})
    assert guest.status_code in (400, 404), guest.text


# ── 참여자 제거 = 제거 시각 기록 ─────────────────────────────────────────


def test_참여자_제거는_행을_지우지_않고_원본을_보존한다(client):
    from app.models.record import EEGRecord
    from app.models.session import SessionParticipant

    host = _register(client, "b1host4@test.com")
    member = _register(client, "b1member4@test.com", "client")
    sid = _create_session(client, host, started=False)
    assert client.post(f"/api/v1/sessions/{sid}/invite", json={"user_id": member["id"]},
                       headers=host["auth"]).status_code in (200, 201)
    db = _db()
    try:
        part = db.query(SessionParticipant).filter(
            SessionParticipant.session_id == uuid.UUID(sid),
            SessionParticipant.user_id == uuid.UUID(member["id"]),
        ).first()
        db.add(EEGRecord(session_id=uuid.UUID(sid), user_id=uuid.UUID(member["id"]),
                         participant_id=part.id, s3_key="eeg-raw/k", file_count=1))
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/v1/sessions/{sid}/participants/{member['id']}", headers=host["auth"])
    assert r.status_code == 200, r.text
    assert all(p["user_id"] != member["id"] for p in r.json()["participants"])
    c = _counts(sid)
    assert c["participants"] == 1 and c["eeg_records"] == 1, "참여자 행·EEG 행이 CASCADE 로 사라지면 안 된다"

    # 제거된 회원은 접근 불가
    assert client.get(f"/api/v1/sessions/{sid}", headers=member["auth"]).status_code == 403

    # 다시 초대하면 같은 행을 되살린다(unique 충돌 없음)
    again = client.post(f"/api/v1/sessions/{sid}/invite", json={"user_id": member["id"]},
                        headers=host["auth"])
    assert again.status_code in (200, 201), again.text
    assert _counts(sid)["participants"] == 1
    assert client.get(f"/api/v1/sessions/{sid}", headers=member["auth"]).status_code == 200


# ── 계정 삭제(관리자) = 비활성 전환 ──────────────────────────────────────


def test_사용자_삭제는_비활성_전환_호스트_클래스_숨김_원본_보존(client):
    admin = _make_platform_admin(client, "b1admin5@test.com")
    host = _register(client, "b1host5@test.com")
    sid = _create_session(client, host)
    local_path, _ = _seed_originals(client, host, sid)
    before = _counts(sid)

    r = client.delete(f"/api/v1/admin/users/{host['id']}", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert r.status_code == 204, r.text

    assert _counts(sid) == before
    assert os.path.exists(local_path)
    from app.models.user import User

    db = _db()
    try:
        assert db.query(User).filter(User.id == uuid.UUID(host["id"])).first().status == "deleted"
    finally:
        db.close()
    # 토큰이 남아 있어도 차단
    assert client.get("/api/v1/sessions", headers=host["auth"]).status_code == 401
    listing = client.get("/api/v1/admin/users?q=b1host5", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert all(it["email"] != "b1host5@test.com" for it in listing.json()["items"])


# ── RV1-5 / RV1-6 / BT4 / AZ16·AZ18: 관리자 원본 삭제 ─────────────────────


def test_관리자_원본_삭제_권한_403_상담사_기관관리자(client):
    host = _register(client, "b1host6@test.com")
    sid = _create_session(client, host)
    org_admin = _register(client, "b1orgadmin6@test.com")
    _promote(org_admin["id"], "org_admin")
    for actor in (host, org_admin):
        r = client.post(f"/api/v1/admin/sessions/{sid}/originals/delete",
                        json={"reason": "요청"}, headers=actor["auth"])
        assert r.status_code == 403, r.text


def test_관리자_원본_삭제_사유_필수_감사_파일DB_정합(client, monkeypatch):
    from app.models.original_deletion_audit import OriginalDeletionAudit
    from app.services import storage_service

    deleted: list = []
    monkeypatch.setattr(storage_service, "delete_object", lambda key: deleted.append(key) or True)
    admin = _make_platform_admin(client, "b1admin7@test.com")
    h = {"Authorization": f"Bearer {admin['access_token']}"}
    host = _register(client, "b1host7@test.com")
    sid = _create_session(client, host)
    local_path, part_id = _seed_originals(client, host, sid)
    url = f"/api/v1/admin/sessions/{sid}/originals/delete"

    # 사유 누락/공백 거부, 삭제 0
    assert client.post(url, json={}, headers=h).status_code == 422
    assert client.post(url, json={"reason": "   "}, headers=h).status_code == 422
    assert _counts(sid)["audio"] == 1 and os.path.exists(local_path)

    r = client.post(url, json={"reason": "정보주체 삭제 요청 #1"}, headers=h)
    assert r.status_code == 200, r.text
    c = _counts(sid)
    assert c["audio"] == 0 and c["raw"] == 0, "행 삭제"
    assert not os.path.exists(local_path), "로컬 파일 삭제"
    assert f"eeg-raw/{sid}/{part_id}/0.bin" in deleted and f"video/{sid}/merged.webm" in deleted
    # 리포트·세션·참여자·EEG 레코드(지표)는 대상 아님
    assert c["session"] == 1 and c["records"] == 1 and c["participants"] == 1

    db = _db()
    try:
        audits = db.query(OriginalDeletionAudit).filter(OriginalDeletionAudit.target_id == uuid.UUID(sid)).all()
        assert len(audits) == 1
        a = audits[0]
        assert str(a.actor_id) == admin["id"] and a.reason == "정보주체 삭제 요청 #1" and a.created_at is not None
        from app.models.record import SessionRecord

        rec = db.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        assert rec.video_s3_key is None and rec.transcript is None
        assert "segments" not in (rec.ai_summary or {}) and rec.ai_summary.get("summary") == "요약"
    finally:
        db.close()


def test_관리자_원본_삭제_숨김_클래스도_대상(client):
    admin = _make_platform_admin(client, "b1admin8@test.com")
    host = _register(client, "b1host8@test.com")
    sid = _create_session(client, host)
    local_path, _ = _seed_originals(client, host, sid)
    client.delete(f"/api/v1/sessions/{sid}", headers=host["auth"])
    r = client.post(f"/api/v1/admin/sessions/{sid}/originals/delete", json={"reason": "만료 전 삭제", "scopes": ["audio"]},
                    headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert r.status_code == 200, r.text
    assert _counts(sid)["audio"] == 0 and _counts(sid)["raw"] == 1, "범위 지정(audio)만 삭제"
    assert not os.path.exists(local_path)

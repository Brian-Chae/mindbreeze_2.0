"""5차 코드리뷰 기능오류(중) 13건 회귀 테스트.

- STT-5TH-01: Gemini STT 예외 구분(일시 backoff 재시도 / 영구 즉시 실패) + responseMimeType=json
- STT-5TH-02: OPENAI_API_KEY 를 settings 에서 읽는다(config 필드)
- STT-5TH-03: Whisper 폴백 시 diarization_fallback 기록(화자분리 소실 표시)
- STT-5TH-04: stt/summary/video 태스크 autoretry
- EMAIL-XSS-003: 초대/재설정 메일 HTML 이스케이프
- PDF-METRIC-002: emotional_stability 저스트레스 역전·불연속 제거
- PDF-NARR-001: 하락(down) 세션 개선 어휘 모순 제거
- VIEW-HTTP-004: /reports/view 보안 헤더
- VID-5TH-09: 영상 병합 예외 시 merge_failed 마킹
- EEG-QRY-02: group_aggregate 참가자 윈도우 일괄 조회(N+1 제거)
- EEG-RAW-03: 스테일 pending/failed 고아 정리 스윕
- EEG-RET-01: 보관 기간 상수 + 정리 스윕
- EEG-RUP-01/02: rollup play_group_id 노출 + coverage 참가자 정규화
"""

import os
import tempfile
import uuid
from datetime import datetime, timedelta
from unittest.mock import Mock

import httpx
import pytest

from app.core.database import get_db
from app.main import app


def _db():
    return next(app.dependency_overrides[get_db]())


def _one_participant_rollup():
    """eeg_rollup_service._bucket_payload 입력용 최소 윈도우 모사 객체."""
    from app.services.eeg_rollup_service import ROLLUP_METRIC_KEYS

    class _Window:
        def __init__(self, participant_id, quality="valid"):
            self.participant_id = participant_id
            self.quality = quality
            self.window_index = 0
            self.play_group_id = None

        def __getattr__(self, name):  # 지표 컬럼은 전부 None(null 보존)
            if name in ROLLUP_METRIC_KEYS:
                return None
            raise AttributeError(name)

    return _Window


# ── STT-5TH-01 / STT-5TH-02 / STT-5TH-03 ────────────────────────────────


def test_stt_gemini_request_forces_json_response(tmp_path, monkeypatch):
    """Gemini STT 요청에 responseMimeType=application/json 이 지정된다."""
    from app.tasks import stt_task

    audio = tmp_path / "c0.webm"
    audio.write_bytes(b"fake-audio")

    captured = {}

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {
                "candidates": [
                    {"content": {"parts": [{"text": '[{"speaker":"speaker_0","text":"안녕","start":0,"end":1}]'}]}}
                ]
            }

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["body"] = json
        return _Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    stt_task._transcribe_batch([str(audio)], "meditation")

    gc = captured["body"]["generationConfig"]
    assert gc["responseMimeType"] == "application/json"


def test_stt_transient_error_retries_then_raises(monkeypatch):
    """503/네트워크 오류는 backoff 재시도 후 GeminiTransientError 로 전파된다."""
    from app.tasks import stt_task

    monkeypatch.setattr("time.sleep", lambda _s: None)
    calls = {"n": 0}

    def fake_post(url, headers=None, json=None, timeout=None):
        calls["n"] += 1
        return httpx.Response(503, request=httpx.Request("POST", url), json={})

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(stt_task.GeminiTransientError):
        stt_task._gemini_post_with_retry("https://x", {}, {}, 10)
    assert calls["n"] == stt_task.GEMINI_RETRY_ATTEMPTS


def test_stt_permanent_error_does_not_retry(monkeypatch):
    """400 4xx 는 재시도 없이 즉시 전파된다(불필요한 재시도/폴백 비용 방지)."""
    from app.tasks import stt_task

    monkeypatch.setattr("time.sleep", lambda _s: None)
    calls = {"n": 0}

    def fake_post(url, headers=None, json=None, timeout=None):
        calls["n"] += 1
        return httpx.Response(400, request=httpx.Request("POST", url), json={})

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(httpx.HTTPStatusError):
        stt_task._gemini_post_with_retry("https://x", {}, {}, 10)
    assert calls["n"] == 1


def test_stt_whisper_reads_settings_not_environ(monkeypatch):
    """OPENAI_API_KEY 는 os.environ 이 아니라 settings.openai_api_key 에서 읽는다."""
    from app.config import settings
    from app.tasks import stt_task

    monkeypatch.setenv("OPENAI_API_KEY", "env-only-secret")
    monkeypatch.setattr(settings, "openai_api_key", "")

    with pytest.raises(RuntimeError, match="OPENAI_API_KEY not set"):
        stt_task._call_whisper(["nope.webm"])


def _seed_record_with_chunk(db, sid):
    from app.models.record import AudioChunk, SessionRecord

    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    if record is None:
        record = SessionRecord(session_id=sid, status="processing")
        db.add(record)
    db.add(AudioChunk(session_id=sid, chunk_index=0, file_path="/tmp/mb-test-missing.webm"))
    db.commit()
    return record


def test_stt_permanent_failure_skips_whisper(client, monkeypatch):
    """Gemini 영구 오류는 Whisper 재전사(비용 2배) 없이 즉시 실패 처리한다."""
    from app.tasks import stt_task
    from tests.test_video_record import _create_session, _register

    host = _register(client, "stt05-perm@test.com")
    sid = uuid.UUID(_create_session(client, host))

    db = _db()
    try:
        record = _seed_record_with_chunk(db, sid)
        monkeypatch.setattr(
            stt_task, "_call_gemini_transcribe",
            Mock(side_effect=RuntimeError("gemini 400 permanent")),
        )
        whisper = Mock()
        monkeypatch.setattr(stt_task, "_call_whisper", whisper)

        stt_task.run_stt_inline(str(sid), db)

        whisper.assert_not_called()
        db.refresh(record)
        assert record.status == "failed"
    finally:
        db.close()


def test_stt_transient_failure_falls_back_and_records_diarization(client, monkeypatch):
    """일시 오류 소진 시 Whisper 폴백 + diarization_fallback 기록."""
    from app.tasks import stt_task
    from tests.test_video_record import _create_session, _register

    host = _register(client, "stt05-trans@test.com")
    sid = uuid.UUID(_create_session(client, host))

    db = _db()
    try:
        record = _seed_record_with_chunk(db, sid)
        monkeypatch.setattr(
            stt_task, "_call_gemini_transcribe",
            Mock(side_effect=stt_task.GeminiTransientError("503 exhausted")),
        )
        monkeypatch.setattr(
            stt_task, "_call_whisper",
            Mock(return_value={
                "segments": [{"speaker": "speaker_0", "text": "안녕하세요", "start": 0.0, "end": 1.0}],
                "raw_text": "[speaker_0] 안녕하세요",
                "missing_chunks": 0,
                "diarization_fallback": True,
            }),
        )

        stt_task.run_stt_inline(str(sid), db)

        db.refresh(record)
        assert record.transcript
        assert record.ai_summary.get("diarization_fallback") is True
        assert "화자 분리" in record.ai_summary.get("diarization_note", "")
    finally:
        db.close()


def test_whisper_fallback_result_marks_diarization():
    """_call_whisper 결과가 화자분리 소실을 명시한다(모든 세그먼트 speaker_0)."""
    from app.tasks import stt_task
    from app.config import settings
    import pytest as _pytest

    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"text": "안녕", "segments": [{"text": "안녕", "start": 0, "end": 1}]}

    def fake_post(url, headers=None, files=None, data=None, timeout=None):
        captured["auth"] = headers["Authorization"]
        return _Resp()

    monkeypatch = _pytest.MonkeyPatch()
    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    tmp.write(b"x")
    tmp.close()
    try:
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        monkeypatch.setattr("requests.post", fake_post)
        result = stt_task._call_whisper([tmp.name])
        assert result["diarization_fallback"] is True
        assert all(s["speaker"] == "speaker_0" for s in result["segments"])
        assert captured["auth"] == "Bearer sk-test"
    finally:
        monkeypatch.undo()
        os.unlink(tmp.name)


def test_tasks_have_autoretry():
    """stt/summary/video 태스크에 autoretry_for+retry_backoff+max_retries 가 설정된다."""
    from app.core.celery_app import celery_app
    import app.tasks.stt_task  # noqa: F401
    import app.tasks.summary_task  # noqa: F401
    import app.tasks.video_task  # noqa: F401

    for name in ("tasks.stt", "tasks.summary", "tasks.merge_video_chunks"):
        task = celery_app.tasks[name]
        assert getattr(task, "autoretry_for", ()), name
        assert getattr(task, "retry_backoff", False), name
        assert task.retry_kwargs.get("max_retries", task.max_retries) >= 1, name


# ── EMAIL-XSS-003 ───────────────────────────────────────────────────────


def _capture_email(monkeypatch):
    from app.tasks import email as email_task

    captured = {}

    def _fake_send(to_email, subject, body_text, body_html=None):
        captured.update(to=to_email, subject=subject, text=body_text, html=body_html)
        return True

    monkeypatch.setattr(email_task, "_send_email", _fake_send)
    return captured


def test_membership_invite_email_html_escapes_user_input(monkeypatch):
    from app.tasks import email as email_task

    captured = _capture_email(monkeypatch)
    email_task.send_membership_invite_email(
        "a@b.com",
        "https://x/report?a=1&b=2",
        counselor_name="<script>alert(1)</script>",
        org_name="A&B <Org>",
        expires_days=7,
    )
    html = captured["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "A&amp;B" in html
    # href/text 링크의 & 도 이스케이프된다
    assert "a=1&amp;b=2" in html
    # plain text 본문은 이스케이프하지 않는다(HTML 컨텍스트 아님)
    assert "<script>" in captured["text"]


def test_client_and_admin_reset_email_html_escape(monkeypatch):
    from app.tasks import email as email_task

    captured = _capture_email(monkeypatch)
    email_task.send_client_invite_email(
        "c@d.com",
        "https://x/set?t=1&u=2",
        client_name="<img src=x>",
        counselor_name="<b>별명</b>",
        expires_days=3,
    )
    assert "<img src=x>" not in captured["html"]
    assert "&lt;img src=x&gt;" in captured["html"]

    captured2 = _capture_email(monkeypatch)
    email_task.send_admin_password_reset_email(
        "e@f.com",
        "https://x/reset?t=1&u=2",
        target_name="<i>대상</i>",
        admin_name="<u>관리</u>",
        admin_role_label="<em>기관</em>",
        expires_hours=1,
    )
    assert "<i>대상</i>" not in captured2["html"]
    assert "&lt;i&gt;대상&lt;/i&gt;" in captured2["html"]


def test_org_and_counselor_invite_email_html_escape(monkeypatch):
    from app.tasks import email as email_task

    captured = _capture_email(monkeypatch)
    email_task.send_org_invite_email(
        "g@h.com", "https://x/org?t=1&u=2",
        admin_name="<s>관리</s>", org_name="<Org>", expires_days=7,
    )
    assert "<s>관리</s>" not in captured["html"]
    assert "&lt;s&gt;" in captured["html"]

    captured2 = _capture_email(monkeypatch)
    email_task.send_counselor_invite_email(
        "i@j.com", "https://x/c?t=1&u=2",
        admin_name="<p>상담</p>", org_name="<기관>", expires_days=7,
    )
    assert "<p>상담</p>" not in captured2["html"]
    assert "&lt;p&gt;" in captured2["html"]


# ── PDF-METRIC-002 / PDF-NARR-001 ───────────────────────────────────────


def test_emotional_stability_low_stress_not_inverted():
    from app.services.report_pdf_narrative import metric_value

    # 스트레스 0 → 안정도 100 (역전 없음)
    assert metric_value({"stress": 0.0}, "emotional_stability") == 100.0
    assert metric_value({"stress": 50.0}, "emotional_stability") == 50.0
    assert metric_value({"stress": 100.0}, "emotional_stability") == 0.0
    # 스트레스가 낮을수록 안정도는 높다(단조 감소)
    assert metric_value({"stress": 10.0}, "emotional_stability") > metric_value(
        {"stress": 80.0}, "emotional_stability"
    )


def test_emotional_stability_is_continuous_at_boundary():
    from app.services.report_pdf_narrative import metric_value

    # 경계(1.0) 근방에서 튀지 않는다(종전 0 ↔ 99 불연속 제거)
    a = metric_value({"stress": 0.999}, "emotional_stability")
    b = metric_value({"stress": 1.0}, "emotional_stability")
    c = metric_value({"stress": 1.001}, "emotional_stability")
    assert max(a, b, c) - min(a, b, c) < 0.5


def test_mind_sentence_down_uses_decline_vocabulary():
    from app.services.report_pdf_narrative import build_metric_narrative, mind_sentence

    for metric, banned in (
        ("focus", "되찾았습니다"),
        ("relaxation", "찾았습니다"),
        ("emotional_stability", "찾았습니다"),
    ):
        sentence = mind_sentence(metric, 20, 80, 40, "40", "down")
        assert banned not in sentence, (metric, sentence)
    # 하락은 하락으로 서술
    assert "흔들렸습니다" in mind_sentence("focus", 20, 80, 40, "40", "down")
    # 상승은 개선 어휘 유지
    assert "되찾았습니다" in mind_sentence("focus", 80, 40, 80, "40", "up")

    metric = build_metric_narrative("focus", 80, 40)
    assert metric["direction"] == "down"
    assert "되찾았습니다" not in metric["sentence"]


# ── VIEW-HTTP-004 ───────────────────────────────────────────────────────


def test_report_view_sets_security_headers(client):
    from app.services import report_email_service
    from tests.test_sdd052_report_view import _view_report

    db, provider, session, participant, report = _view_report(client)
    try:
        token = report_email_service._token(
            "report_view", str(report.id), str(session.id), email=participant.report_email
        )
        res = client.get("/api/v1/reports/view", params={"token": token})
        assert res.status_code == 200, res.text
        assert res.headers.get("cache-control") == "no-store"
        assert res.headers.get("referrer-policy") == "no-referrer"
        assert res.headers.get("x-content-type-options") == "nosniff"
    finally:
        provider.close()


# ── VID-5TH-09 ──────────────────────────────────────────────────────────


def _video_record(db, sid):
    from app.models.record import SessionRecord

    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    if record is None:
        record = SessionRecord(session_id=sid, video_status="completed")
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


def test_video_merge_exception_marks_merge_failed(client, monkeypatch):
    from app.services import video_service
    from app.tasks import video_task
    from tests.test_video_record import _create_session, _register

    host = _register(client, "vid5th@test.com")
    sid = uuid.UUID(_create_session(client, host))

    db = _db()
    try:
        record = _video_record(db, sid)
        monkeypatch.setattr(
            video_service, "merge_video_chunks",
            Mock(side_effect=RuntimeError("s3 download boom")),
        )
        with pytest.raises(RuntimeError):
            video_task.run_video_merge_inline(str(sid), db)

        db.refresh(record)
        assert record.video_status == "merge_failed"
        assert record.video_s3_key is None
    finally:
        db.close()


def test_video_merge_soft_time_limit_marks_merge_failed(client, monkeypatch):
    from celery.exceptions import SoftTimeLimitExceeded

    from app.services import video_service
    from app.tasks import video_task
    from tests.test_video_record import _create_session, _register

    host = _register(client, "vid5th-timeout@test.com")
    sid = uuid.UUID(_create_session(client, host))

    db = _db()
    try:
        record = _video_record(db, sid)
        monkeypatch.setattr(
            video_service, "merge_video_chunks",
            Mock(side_effect=SoftTimeLimitExceeded()),
        )
        with pytest.raises(SoftTimeLimitExceeded):
            video_task.run_video_merge_inline(str(sid), db)

        db.refresh(record)
        assert record.video_status == "merge_failed"
    finally:
        db.close()


# ── EEG-QRY-02 ──────────────────────────────────────────────────────────


def test_batch_participant_windows_matches_per_participant(client):
    from app.services import eeg_query
    from tests.test_class_group_aggregate import (
        _seed_windows,
        _started_group_class,
    )
    from tests.test_sdd024_session_live_ws import _join_guest, _register

    counselor = _register(client, "qry02c@test.com")
    cls = _started_group_class(client, counselor)
    pids = [_join_guest(client, cls["access_code"], f"q{i}") for i in range(3)]
    for pid in pids:
        _seed_windows(
            cls["id"], pid, count=140,
            relaxation=lambda i: 0.25 if i < 120 else 0.30, focus=lambda i: 1.0,
        )

    db = _db()
    try:
        sid = uuid.UUID(cls["id"])
        pids_u = [uuid.UUID(p) for p in pids]
        batched = eeg_query.feature_windows_chronological_for_participants(
            db, sid, pids_u, limit=120
        )
        assert set(batched) == set(pids_u)
        for pid in pids_u:
            expected = eeg_query.feature_windows_chronological(db, sid, pid, limit=120)
            assert [w.id for w in batched[pid]] == [w.id for w in expected]
    finally:
        db.close()


def test_group_aggregate_feature_query_count_is_constant(client):
    from sqlalchemy import event

    from app.services import group_aggregate as ga
    from tests.test_class_group_aggregate import _seed_windows, _started_group_class
    from tests.test_sdd024_session_live_ws import _join_guest, _register

    counselor = _register(client, "qry02n@test.com")
    cls = _started_group_class(client, counselor)
    pids = [_join_guest(client, cls["access_code"], f"n{i}") for i in range(4)]
    for pid in pids:
        _seed_windows(
            cls["id"], pid, count=140,
            relaxation=lambda i: 0.25 if i < 120 else 0.30, focus=lambda i: 1.0,
        )

    db = _db()
    try:
        statements = []
        engine = db.get_bind()

        def _before(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", _before)
        try:
            payload = ga.compute_group_aggregate(cls["id"], db)
        finally:
            event.remove(engine, "before_cursor_execute", _before)

        assert payload["wearer_count"] == 4
        feature_queries = [s for s in statements if "eeg_feature_windows" in s.lower()]
        # 참가자 4명이어도 윈도우 조회는 2회(초반/최근)로 고정 — N+1 이면 8회.
        assert len(feature_queries) <= 3, feature_queries
    finally:
        db.close()


# ── EEG-RAW-03 / EEG-RET-01 ─────────────────────────────────────────────


def test_eeg_raw_retention_constants_exist():
    from app.services import eeg_raw_service

    assert eeg_raw_service.EEG_RAW_RETENTION_DAYS >= 1
    assert eeg_raw_service.EEG_RAW_PENDING_TTL_HOURS >= 1
    assert eeg_raw_service.EEG_RAW_FAILED_TTL_HOURS >= 1


def test_sweep_stale_eeg_raw_removes_orphans_and_expired(client):
    from app.models.record import EEGRawChunk
    from app.services import eeg_raw_service
    from tests.test_video_record import _create_session, _register

    host = _register(client, "raw03@test.com")
    sid = uuid.UUID(_create_session(client, host))
    now = datetime(2026, 1, 1, 12, 0, 0)  # naive UTC

    db = _db()
    try:
        def _chunk(index, status, created_at, uploaded_at=None, key="k"):
            return EEGRawChunk(
                session_id=sid, participant_id=None, stream_id="s0",
                chunk_index=index, object_key=f"{key}{index}",
                upload_status=status, created_at=created_at, uploaded_at=uploaded_at,
            )

        db.add_all([
            _chunk(0, "pending", now - timedelta(hours=25)),          # 고아 → 삭제
            _chunk(1, "pending", now - timedelta(hours=1)),           # 최근 → 유지
            _chunk(2, "failed", now - timedelta(hours=25)),           # 방치 → 삭제
            _chunk(3, "uploaded", now - timedelta(days=100),
                   uploaded_at=now - timedelta(days=100)),            # 보관 만료 → 삭제
            _chunk(4, "uploaded", now - timedelta(days=1),
                   uploaded_at=now - timedelta(days=1)),              # 보관 내 → 유지
        ])
        db.commit()

        result = eeg_raw_service.sweep_stale_eeg_raw(db, now=now)
        assert result == {"pending_deleted": 1, "failed_deleted": 1, "expired_deleted": 1}

        remaining = {
            c.chunk_index
            for c in db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid).all()
        }
        assert remaining == {1, 4}
    finally:
        db.close()


def test_sweep_eeg_raw_task_inline(client):
    from app.tasks import eeg_raw_task

    db = _db()
    try:
        result = eeg_raw_task.run_sweep_eeg_raw(db)
        assert set(result) == {"pending_deleted", "failed_deleted", "expired_deleted"}
    finally:
        db.close()


# ── EEG-RUP-01 / EEG-RUP-02 ─────────────────────────────────────────────


def test_rollup_bucket_schema_exposes_play_group_id():
    from app.schemas.eeg import EEGRollupBucket

    assert "play_group_id" in EEGRollupBucket.model_fields


def test_rollup_api_buckets_include_play_group_id(client):
    from tests.test_sdd027_rollup_raw_report import (
        _create_group_class,
        _feature,
        _join_guest,
        _register,
    )

    counselor = _register(client, "rup01c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "pg게스트")
    feats = [_feature(i, relaxation_index=0.5, signal_quality=0.9) for i in range(10)]
    client.post(f"/api/v1/sessions/{cls['id']}/features",
                json={"participant_id": pid, "features": feats})

    body = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=counselor["h"]).json()
    assert body["buckets"]
    assert all("play_group_id" in b for b in body["buckets"])


def test_rollup_coverage_normalized_by_participants():
    from app.services.eeg_rollup_service import _bucket_payload

    Window = _one_participant_rollup()
    pid_a, pid_b = uuid.uuid4(), uuid.uuid4()

    # 참가자 2명이 각각 30초(valid)씩 → 유효 60초. 종전 coverage=1.0(포화)이지만
    # 참가자 정규화하면 60 / (60 × 2) = 0.5 다.
    windows = [Window(pid_a) for _ in range(30)] + [Window(pid_b) for _ in range(30)]
    bucket = _bucket_payload(0, windows, 60, play_group_id="g1")
    assert bucket["valid_count"] == 60
    assert bucket["coverage"] == pytest.approx(0.5)
    assert bucket["play_group_id"] == "g1"

    # 단일 참가자가 60초 채우면 1.0(회귀 방지)
    single = _bucket_payload(0, [Window(pid_a) for _ in range(60)], 60)
    assert single["coverage"] == pytest.approx(1.0)

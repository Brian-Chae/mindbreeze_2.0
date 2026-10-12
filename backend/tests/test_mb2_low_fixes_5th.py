"""MIND BREEZE 2.0 기능상 오류(하) 5차 15건 회귀 테스트.

검증 대상:
  [1]  EEG-AGG-01     group_average sample_status ↔ per-metric 표본 게이트 일관성
  [2]  EEG-QRY-03     presign/ack 청크 배치 조회 + 요청 청크 수 상한(max_length)
  [3]  EEG-RAW-04     EEGRecord (session, participant) 유니크 제약
  [4]  EEG-STO-01     raw presigned PUT 서버측 암호화(AES256) 지정
  [5]  EMAIL-SEND-008 성공(2xx) 응답 본문 파싱 실패가 발송 실패로 뒤집히지 않음
  [6]  GEN-5TH-10     Gemini/Whisper 모델명 설정화(하드코딩 제거)
  [7]  PDF-DATE-009   scheduled_at date 타입 tzinfo AttributeError 방어
  [8]  PDF-FMT-007    이중 막대 차트 라벨 :g 포맷 통일
  [9]  PDF-PERF-010   결정적 content 캐시로 재렌더 방지
  [10] RESEND-006     재발송이 report_email 을 덮어쓰지 않음(불변)
  [11] STT-5TH-05     세그먼트 분할 기준은 벽시계가 아닌 실제 오디오 길이
  [12] STT-5TH-06     청크 누락 시 타임스탬프 오프셋 보정
  [13] SUM-5TH-07     Gemini 요약 필수 키 검증 + 실패 마킹
  [14] SUM-5TH-08     direction None 시 부분 시그니처 캐시
  [15] VIEW-NORM-005  HTML 리포트 content 정규화(500 방지)
"""

import os
import sys
import types
import uuid
from datetime import date, datetime, timezone
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app


def _db():
    return next(app.dependency_overrides[get_db]())


# ---------------------------------------------------------------------------
# [1] EEG-AGG-01 — sample_status ↔ per-metric 게이트 일관성
# ---------------------------------------------------------------------------


def test_eeg_agg_01_sample_status_matches_per_metric_gate():
    from app.services import group_aggregate as ga

    # 착용자 총수는 충분(3)하지만 모든 지표를 실제로 보고한 사람이 1명뿐 → 표본 부족.
    wearer_means = {field: [1.0, None, None] for _, field in ga._ABSOLUTE_METRIC_FIELDS}
    payload = ga._group_average_payload("sid", "now", wearer_means, wearer_count=3)
    assert payload["sample_status"] == "insufficient"
    assert all(m["mean"] is None for m in payload["metrics"].values())

    # 한 지표라도 실제 표본이 MIN_WEARERS 이상이면 ok 이며 그 지표 평균은 산출된다.
    wearer_means = {field: [None, None, None] for _, field in ga._ABSOLUTE_METRIC_FIELDS}
    wearer_means["focus_index"] = [1.0, 2.0, 3.0]
    payload = ga._group_average_payload("sid", "now", wearer_means, wearer_count=3)
    assert payload["sample_status"] == "ok"
    assert payload["metrics"]["focus_index"]["mean"] == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# [2] EEG-QRY-03 — 배치 조회 + 상한
# ---------------------------------------------------------------------------


def _presign(client, sid, participant_id, indices):
    chunks = [{"stream_id": "s0", "chunk_index": i} for i in indices]
    return client.post(
        f"/api/v1/sessions/{sid}/eeg-raw/presign",
        json={"participant_id": participant_id, "chunks": chunks},
    )


def test_eeg_qry_03_presign_batches_existing_lookup(client):
    from tests.test_sdd024_session_live_ws import (
        _create_group_class,
        _join_guest,
        _register,
    )

    counselor = _register(client, "qry03@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "배치게스트")

    # 1차 발급(신규 생성) 후 2차 재발급(기존 조회)에서 eeg_raw_chunks SELECT 수를 계측한다.
    assert _presign(client, cls["id"], pid, range(5)).status_code == 200

    db = _db()
    try:
        count = {"n": 0}

        def _on_execute(conn, cursor, statement, params, ctx, executemany):
            if "FROM eeg_raw_chunks" in statement:
                count["n"] += 1

        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", _on_execute)
        try:
            res = _presign(client, cls["id"], pid, range(5))
        finally:
            event.remove(engine, "before_cursor_execute", _on_execute)

        assert res.status_code == 200, res.text
        # 청크별 개별 SELECT(N+1)였다면 5회 — 배치 조회면 1회.
        assert count["n"] == 1
    finally:
        db.close()


def test_eeg_qry_03_chunk_batch_max_length():
    from pydantic import ValidationError

    from app.schemas.eeg import RawAckRequest, RawPresignRequest, _RAW_CHUNK_BATCH_MAX

    ok = RawPresignRequest(
        chunks=[{"chunk_index": i} for i in range(_RAW_CHUNK_BATCH_MAX)]
    )
    assert len(ok.chunks) == _RAW_CHUNK_BATCH_MAX

    with pytest.raises(ValidationError):
        RawPresignRequest(
            chunks=[{"chunk_index": i} for i in range(_RAW_CHUNK_BATCH_MAX + 1)]
        )
    with pytest.raises(ValidationError):
        RawAckRequest(
            chunks=[{"chunk_id": str(uuid.uuid4())} for _ in range(_RAW_CHUNK_BATCH_MAX + 1)]
        )


# ---------------------------------------------------------------------------
# [3] EEG-RAW-04 — (session, participant) 유니크 제약
# ---------------------------------------------------------------------------


def test_eeg_raw_04_duplicate_record_rejected_by_db(client):
    from app.models.record import EEGRecord
    from app.models.session import SessionParticipant
    from tests.test_report import _create_session, _register

    names = {c.name for c in EEGRecord.__table__.constraints}
    assert "uq_eeg_record_session_participant" in names

    host = _register(client, "raw04@test.com")
    session_id = _create_session(client, host)
    db = _db()
    try:
        participant = SessionParticipant(session_id=session_id, guest_name="g")
        db.add(participant)
        db.flush()
        db.add(EEGRecord(session_id=session_id, participant_id=participant.id, s3_key="k", file_count=1))
        db.commit()

        db.add(EEGRecord(session_id=session_id, participant_id=participant.id, s3_key="k2", file_count=1))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [4] EEG-STO-01 — presigned PUT 서버측 암호화 강제
# ---------------------------------------------------------------------------


def test_eeg_sto_01_presigned_put_requires_sse(monkeypatch):
    from app.services import storage_service

    captured: dict = {}
    fake = types.ModuleType("boto3")

    class _Client:
        def generate_presigned_url(self, _op, Params, ExpiresIn):  # noqa: N803
            captured["Params"] = Params
            return "https://s3.example/x?sig=1"

    fake.client = lambda *a, **k: _Client()
    monkeypatch.setitem(sys.modules, "boto3", fake)
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "test-key")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "test-secret")

    url = storage_service.generate_presigned_put("eeg-raw/a/b/0.bin")
    assert url.startswith("https://s3.example/")
    assert captured["Params"]["ServerSideEncryption"] == "AES256"


# ---------------------------------------------------------------------------
# [5] EMAIL-SEND-008 — 성공 발송의 본문 파싱 실패가 실패로 뒤집히지 않음
# ---------------------------------------------------------------------------


def test_email_send_008_success_non_json_body_is_still_success(monkeypatch):
    from app.config import settings
    from app.tasks import email as email_task

    class _Resp:
        is_success = True
        status_code = 200

        def json(self):
            raise ValueError("empty body")

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "resend_api_key", "test-key")
    monkeypatch.setattr(email_task.httpx, "Client", lambda *a, **k: _Client())

    assert email_task._send_email("a@b.com", "subject", "body") is True


# ---------------------------------------------------------------------------
# [6] GEN-5TH-10 — 모델명 설정화
# ---------------------------------------------------------------------------


def test_gen_5th_10_model_names_are_settings():
    from app.config import settings

    # 하드코딩 대신 설정 기본값을 제공한다(필드 존재 = 설정화).
    assert settings.gemini_model
    assert settings.whisper_model


def test_gen_5th_10_gemini_model_read_from_settings(tmp_path, monkeypatch):
    from app.config import settings
    from app.tasks import stt_task

    audio = tmp_path / "c0.webm"
    audio.write_bytes(b"fake-audio")
    captured: dict = {}

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
        captured["url"] = url
        return _Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(settings, "gemini_model", "gemini-test-9x")

    stt_task._transcribe_batch([str(audio)], "meditation")
    assert "models/gemini-test-9x:generateContent" in captured["url"]


def test_gen_5th_10_whisper_model_read_from_settings(tmp_path, monkeypatch):
    import requests

    from app.config import settings
    from app.tasks import stt_task

    audio = tmp_path / "c0.webm"
    audio.write_bytes(b"fake-audio")
    captured: dict = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"segments": [], "text": ""}

    def fake_post(url, headers=None, files=None, data=None, timeout=None):
        captured["data"] = data
        return _Resp()

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(settings, "whisper_model", "whisper-test-1")
    monkeypatch.setattr(requests, "post", fake_post)

    stt_task._call_whisper([str(audio)])
    assert captured["data"]["model"] == "whisper-test-1"


# ---------------------------------------------------------------------------
# [7] PDF-DATE-009 — date 타입 방어
# ---------------------------------------------------------------------------


def test_pdf_date_009_date_and_datetime_are_safe():
    from app.services.report_pdf_service import render_report_html

    base = {"session_title": "t", "participant_name": "n", "content": {}}

    # datetime.date(tzinfo 없음) → AttributeError 없이 날짜만 포맷.
    html = render_report_html({**base, "scheduled_at": date(2026, 10, 6)})
    assert "2026.10.06" in html

    # tz-aware datetime 은 KST 로 변환(09:00Z → 18:00 KST).
    html = render_report_html(
        {**base, "scheduled_at": datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc)}
    )
    assert "2026.10.06 18:00" in html


# ---------------------------------------------------------------------------
# [8] PDF-FMT-007 — 이중 막대 라벨 :g
# ---------------------------------------------------------------------------


def test_pdf_fmt_007_dual_bar_labels_use_g_format():
    from app.services.report_pdf_narrative import dual_bar_svg

    m = {
        "id": "focus", "label": "집중도", "unit": "점",
        "early": 61.333333333333336, "late": 42.666666666666664,
        "overall": 52.0, "delta": -18.7, "direction": "down",
        "arrow": "↓", "sentence": "x",
    }
    svg = dual_bar_svg(m)
    assert "61.3333" in svg and "42.6667" in svg
    assert "61.333333333333336" not in svg
    assert "42.666666666666664" not in svg


# ---------------------------------------------------------------------------
# [9] PDF-PERF-010 — 결정적 content 캐시
# ---------------------------------------------------------------------------


def test_pdf_perf_010_deterministic_content_cache(tmp_path, monkeypatch):
    from app.services import report_pdf_service as svc

    svc._PDF_CACHE.clear()
    fake_font = tmp_path / "f.ttf"
    fake_font.write_bytes(b"font")
    monkeypatch.setattr(svc, "FONT_PATH", fake_font)

    renders = {"n": 0}

    class _Doc:
        pages = [1, 2, 3, 4]

        def write_pdf(self):
            return b"%PDF-fake"

    class _HTML:
        def __init__(self, string=None, url_fetcher=None):
            pass

        def render(self, font_config=None):
            renders["n"] += 1
            return _Doc()

    fake_wp = types.ModuleType("weasyprint")
    fake_wp.HTML = _HTML
    fake_text = types.ModuleType("weasyprint.text")
    fake_fonts = types.ModuleType("weasyprint.text.fonts")

    class _FontConfig:
        pass

    fake_fonts.FontConfiguration = _FontConfig
    fake_text.fonts = fake_fonts
    fake_wp.text = fake_text
    monkeypatch.setitem(sys.modules, "weasyprint", fake_wp)
    monkeypatch.setitem(sys.modules, "weasyprint.text", fake_text)
    monkeypatch.setitem(sys.modules, "weasyprint.text.fonts", fake_fonts)

    report = {"session_title": "t", "participant_name": "n", "scheduled_at": None, "content": {}}
    first = svc.generate_report_pdf(report)
    second = svc.generate_report_pdf(dict(report))
    assert first == second == b"%PDF-fake"
    # 동일 content 재호출은 재렌더하지 않는다.
    assert renders["n"] == 1

    # 키는 content 결정적 해시 — 같은 입력은 같은 키, 다른 입력은 다른 키.
    assert svc._content_cache_key(report) == svc._content_cache_key(dict(report))
    assert svc._content_cache_key(report) != svc._content_cache_key({**report, "session_title": "u"})
    svc._PDF_CACHE.clear()


# ---------------------------------------------------------------------------
# [10] RESEND-006 — report_email 불변
# ---------------------------------------------------------------------------


def test_resend_006_does_not_overwrite_report_email(client, monkeypatch):
    from app.models.record import Report
    from app.models.session import SessionParticipant
    from app.services import report_email_service
    from tests.test_report import _create_session, _register

    host = _register(client, "resend006@test.com")
    session_id = _create_session(client, host)
    db = _db()
    try:
        participant = SessionParticipant(
            session_id=session_id, guest_name="재발송", report_email="before@example.com"
        )
        db.add(participant)
        db.flush()
        report = Report(
            session_id=session_id, participant_id=participant.id,
            type="client", status="completed", content={},
        )
        db.add(report)
        db.commit()

        monkeypatch.setattr(report_email_service, "send_report_email", Mock(return_value=True))
        assert report_email_service.resend_report_email(str(report.id), "new@example.com", db) is True
        db.refresh(participant)
        assert participant.report_email == "before@example.com"
        assert participant.report_email_status == "sent"
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [11] STT-5TH-05 — 분할 기준은 실제 오디오 길이
# ---------------------------------------------------------------------------


def test_stt_5th_05_segment_split_uses_actual_audio_length(tmp_path, monkeypatch):
    from app.config import settings
    from app.tasks import stt_task

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    files = []
    for i in range(4):
        p = tmp_path / f"c{i}.webm"
        p.write_bytes(b"x")
        files.append(str(p))

    calls = {"n": 0}

    def fake_batch(batch, session_type):
        calls["n"] += 1
        return ([{"speaker": "speaker_0", "text": "hi", "start": 0.0, "end": 1.0}], "hi", 0)

    monkeypatch.setattr(stt_task, "_transcribe_batch", fake_batch)

    # 벽시계 30분이지만 실제 오디오는 4청크 × 5초 = 20초 → 분할 없이 1회 호출.
    result = stt_task._call_gemini_transcribe(files, "meditation", audio_duration_sec=1800.0)
    assert calls["n"] == 1
    assert len(result["segments"]) == 1


# ---------------------------------------------------------------------------
# [12] STT-5TH-06 — 청크 누락 오프셋 보정
# ---------------------------------------------------------------------------


def test_stt_5th_06_missing_chunk_offset_is_corrected(tmp_path, monkeypatch):
    from app.config import settings
    from app.tasks import stt_task

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    n = 40
    files = []
    for i in range(n):
        p = tmp_path / f"c{i}.webm"
        if i != 13:  # 13번 청크 누락(파일 없음)
            p.write_bytes(b"x")
        files.append(str(p))

    def fake_batch(batch, session_type):
        present = [p for p in batch if os.path.exists(p)]
        return ([{"speaker": "speaker_0", "text": "hi", "start": 0.0, "end": 1.0}], "hi", len(batch) - len(present))

    monkeypatch.setattr(stt_task, "_transcribe_batch", fake_batch)

    result = stt_task._call_gemini_transcribe(files, "meditation", audio_duration_sec=None)
    starts = [s["start"] for s in result["segments"]]
    # 40청크/90초 → 3배치(14,14,12). 배치0 후 존재 13개(누락 1) → 65s, 배치1 후 65+70=135s.
    # 누락을 배치 전체 길이로 셌다면 70s/140s 로 어긋난다.
    assert starts == [0.0, 65.0, 135.0]


# ---------------------------------------------------------------------------
# [13] SUM-5TH-07 — 요약 필수 키 검증
# ---------------------------------------------------------------------------


def test_sum_5th_07_summary_required_keys_validated(monkeypatch):
    from app.tasks import summary_task

    monkeypatch.setattr(summary_task, "_call_gemini_text", lambda *a, **k: '{"headline":"h"}')
    with pytest.raises(ValueError):
        summary_task._call_gemini_summary("clinical", "전사문")

    ok = '{"headline":"h","sections":{"요약":"x"},"keywords":[],"risk_flags":[]}'
    monkeypatch.setattr(summary_task, "_call_gemini_text", lambda *a, **k: ok)
    parsed = summary_task._call_gemini_summary("clinical", "전사문")
    assert parsed["headline"] == "h"
    assert parsed["transcript_present"] is True


def test_sum_5th_07_run_summary_marks_failed_on_contract_violation(client, monkeypatch):
    from app.models.record import SessionRecord
    from app.tasks import summary_task
    from tests.test_video_record import _create_session, _register

    host = _register(client, "sum07@test.com")
    sid = uuid.UUID(_create_session(client, host))
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

        monkeypatch.setattr(summary_task, "_call_gemini_text", lambda *a, **k: '{"headline":"h"}')
        summary_task.run_summary_inline(str(sid), db)
        db.refresh(record)
        assert record.ai_summary.get("summary_failed") is True
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [14] SUM-5TH-08 — direction None 부분 시그니처 캐시
# ---------------------------------------------------------------------------


def _all_none_summary() -> dict:
    groups = {
        "body": ("respiratory_rate", "heart_rate", "hrv"),
        "mind": ("focus", "relaxation", "emotional_stability"),
    }
    return {group: {metric: {"direction": None} for metric in metrics} for group, metrics in groups.items()}


def test_sum_5th_08_partial_signature_and_cache(monkeypatch):
    from app.models.narrative_cache import NarrativeCache  # noqa: F401
    from app.services.report_narrative import build_narrative_signature
    from app.tasks import summary_task
    from app.core.database import Base

    summary = _all_none_summary()
    # 전체 시그니처는 결측이 하나라도 있으면 None.
    assert build_narrative_signature(summary) is None
    key = summary_task._partial_narrative_signature(summary)
    assert len(key) == 6 and "?" in key

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        first = summary_task._call_narrative_llm(summary, db)
        # 이전에는 시그니처가 None 이라 캐시가 저장되지 않았다.
        assert db.get(NarrativeCache, key) is not None

        calls = {"n": 0}

        def boom(*a, **k):
            calls["n"] += 1
            raise RuntimeError("gemini_api_key not set")

        monkeypatch.setattr(summary_task, "_call_gemini_text", boom)
        second = summary_task._call_narrative_llm(summary, db)
        assert second == first
        assert calls["n"] == 0  # 캐시 재사용
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [15] VIEW-NORM-005 — HTML 리포트 content 정규화
# ---------------------------------------------------------------------------


def test_view_norm_005_malformed_content_does_not_500(client):
    from app.models.record import Report
    from app.models.session import SessionParticipant
    from app.services import report_email_service
    from tests.test_report import _create_session, _register

    host = _register(client, "viewnorm@test.com")
    session_id = _create_session(client, host)
    db = _db()
    try:
        participant = SessionParticipant(
            session_id=session_id, guest_name="g", report_email="g@example.com"
        )
        db.add(participant)
        db.flush()
        report = Report(
            session_id=session_id, participant_id=participant.id, type="client",
            status="completed",
            content={"eeg": ["malformed"], "insights": "not-a-list", "title": "t"},
        )
        db.add(report)
        db.commit()

        token = report_email_service._token(
            "report_view", str(report.id), str(report.session_id), email="g@example.com"
        )
        html = report_email_service.view_report_email(report.session_id, token, db)
        assert "<!doctype html>" in html
        # 정규화로 eeg list 는 제거되고 인사이트는 빈 목록으로 대체된다.
        assert "측정된 뇌파 지표가 없습니다" in html
    finally:
        db.close()

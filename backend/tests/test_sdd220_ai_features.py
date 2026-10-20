"""SDD-220 (트랙 ⓑ) — AI 기능 단일 가드 QA (TS3~TS8 서버 부분)

핵심: AI off 에서 외부 LLM transport 호출 0건 · API 403 AI_FEATURES_DISABLED · 큐 적재 작업 skip(retry 0)
      · 녹음/영상/EEG/규칙 리포트는 유지(source=rule). on 은 기존 계약 유지.

기본 conftest 는 기존 테스트를 위해 AI on 으로 실행하므로 이 파일은 `ai_off`/`ai_on` fixture 로 명시한다.
공급자 키는 일부러 비어 있지 않은 가짜 값을 넣어 "키 미설정" 에 기대지 않게 한다.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

from app.config import settings
from app.core import ai_features
from tests import agent_helpers as H
from tests.test_audio_record import _create_session, _register, _upload_chunk


@pytest.fixture
def ai_off(monkeypatch):
    monkeypatch.setattr(settings, "ai_features_enabled", False)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-gemini-key")
    monkeypatch.setattr(settings, "openai_api_key", "fake-openai-key")


@pytest.fixture
def ai_on(monkeypatch):
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-gemini-key")
    monkeypatch.setattr(settings, "openai_api_key", "fake-openai-key")


@pytest.fixture
def transport_spy(monkeypatch):
    """6개 transport(httpx.post/httpx.stream/requests.post)의 호출 횟수를 센다 — 실제 네트워크는 없다."""
    import httpx
    import requests

    spy = MagicMock(name="transport")

    def _boom_post(*args, **kwargs):
        spy("httpx.post")
        raise httpx.ConnectError("blocked in test")

    def _boom_stream(*args, **kwargs):
        spy("httpx.stream")
        raise httpx.ConnectError("blocked in test")

    def _boom_requests(*args, **kwargs):
        spy("requests.post")
        raise requests.ConnectionError("blocked in test")

    monkeypatch.setattr(httpx, "post", _boom_post)
    monkeypatch.setattr(httpx, "stream", _boom_stream)
    monkeypatch.setattr(requests, "post", _boom_requests)
    # 재시도 backoff 가 테스트를 지연시키지 않게 한다
    monkeypatch.setattr("time.sleep", lambda *_: None)
    return spy


# ── 가드 자체 (TS3) ──────────────────────────────────────────────


def test_TS3_기본값은_off_이고_true_만_on(monkeypatch):
    from app.config import Settings

    assert Settings.model_fields["ai_features_enabled"].default is False
    monkeypatch.setattr(settings, "ai_features_enabled", False)
    assert ai_features.is_ai_enabled() is False
    # 호출 시점에 설정을 읽는다 — import 시 캐싱하지 않는다
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    assert ai_features.is_ai_enabled() is True
    monkeypatch.setattr(settings, "ai_features_enabled", "false")  # true 외 값은 off
    assert ai_features.is_ai_enabled() is False


def test_TS3_가드_예외는_RuntimeError_가_아니라_Celery_재시도_대상이_아니다():
    assert not issubclass(ai_features.AiFeaturesDisabled, RuntimeError)


# ── TS4: API 403 ────────────────────────────────────────────────


def test_TS4_off_루시_API_전부_403_AI_FEATURES_DISABLED(client, ai_off, transport_spy):
    member = H.register_client(client, "ai220-off1@test.com")
    calls = [
        ("get", "/api/v1/agent/consent", None),
        ("post", "/api/v1/agent/consent", {}),
        ("get", "/api/v1/agent/messages", None),
        ("post", "/api/v1/agent/messages", {"content": "안녕하세요"}),
        ("post", "/api/v1/agent/messages/stream", {"content": "안녕하세요"}),
        ("get", "/api/v1/agent/unread-count", None),
        ("get", "/api/v1/agent/checkin-prefs", None),
    ]
    for method, url, body in calls:
        res = getattr(client, method)(url, headers=member["h"], **({"json": body} if body is not None else {}))
        assert res.status_code == 403, (url, res.text)
        assert res.json()["detail"]["code"] == "AI_FEATURES_DISABLED", url
    assert transport_spy.call_count == 0


def test_TS4_off_상담사_AI_API_403_이고_리포트_기록_API_는_막히지_않는다(client, ai_off, transport_spy):
    counselor = H.register_counselor("ai220-off-c@test.com")
    for url in (
        "/api/v1/agent/counselor/messages",
        "/api/v1/agent/counselor/unread-count",
        "/api/v1/agent/counselor/risk-signals",
    ):
        res = client.get(url, headers=counselor["h"])
        assert res.status_code == 403, (url, res.text)
        assert res.json()["detail"]["code"] == "AI_FEATURES_DISABLED"
    # 일괄 403 이 아님 — 리포트/세션 API 는 정상
    assert client.get("/api/v1/sessions", headers=counselor["h"]).status_code == 200
    assert transport_spy.call_count == 0


def test_TS5_on_이면_루시_API_가_다시_열린다(client, ai_on):
    member = H.register_client(client, "ai220-on1@test.com")
    res = client.get("/api/v1/agent/consent", headers=member["h"])
    assert res.status_code == 200, res.text


# ── TS4: transport 직전 가드 ─────────────────────────────────────


def test_TS4_off_Gemini_멀티턴_단일턴_스트림_transport_0(ai_off, transport_spy):
    from app.services import agent_llm

    chat = agent_llm.ChatRequest(system="s", contents=[{"role": "user", "parts": [{"text": "hi"}]}])
    assert agent_llm.generate("프롬프트", "폴백문장") == "폴백문장"
    assert agent_llm.generate(chat, "폴백문장") == "폴백문장"
    assert list(agent_llm.generate_stream("프롬프트", "폴백문장")) == ["폴백문장"]
    with pytest.raises(agent_llm.LLMUnavailableError):
        list(agent_llm.generate_stream(chat, "폴백문장", raise_on_failure=True))
    # transport 함수를 직접 불러도 네트워크 직전에서 막힌다
    with pytest.raises(ai_features.AiFeaturesDisabled):
        agent_llm._call_gemini_chat(chat)
    assert transport_spy.call_count == 0


def test_TS4_off_코멘트_단일턴_공유_transport_0_이고_초안은_규칙(ai_off, transport_spy):
    from app.services import report_comment_service as rc

    assert rc._call_gemini("프롬프트") is None
    context = {
        "participant_name": "홍길동",
        "scheduled_at": "10월 20일",
        "session_type": "명상",
    }
    draft, source = rc._generate_draft(context)
    assert source == "rule"
    assert draft == rc._rule_based_draft(context)
    assert transport_spy.call_count == 0


def test_TS4_off_STT_Gemini_Whisper_요약_transport_0_재시도_0(ai_off, transport_spy):
    from app.tasks import stt_task, summary_task

    with pytest.raises(ai_features.AiFeaturesDisabled):
        stt_task._gemini_request_once("http://x", {}, {}, 1)
    with pytest.raises(ai_features.AiFeaturesDisabled):
        stt_task._gemini_post_with_retry("http://x", {}, {}, 1)  # 재시도 루프도 1회로 끝
    with pytest.raises(ai_features.AiFeaturesDisabled):
        stt_task._call_whisper(["/nonexistent.webm"])
    with pytest.raises(ai_features.AiFeaturesDisabled):
        summary_task._call_gemini_text("프롬프트")
    with pytest.raises(ai_features.AiFeaturesDisabled):
        summary_task._call_gemini_summary("clinical", "전사")
    assert transport_spy.call_count == 0


def test_TS5_on_Gemini_transport_는_요청당_1회_호출된다(ai_on, transport_spy):
    from app.services import report_comment_service as rc

    assert rc._call_gemini("프롬프트") is None  # 위조 연결 실패는 폴백(None) — 그러나 호출은 1회 시도
    assert transport_spy.call_count == 1


# ── TS6/TS8: 이미 큐에 적재된 STT·요약 작업 / 녹음 파이프라인 ─────────


def _record_for(sid: str):
    from app.models.record import SessionRecord

    conn = H.db()
    try:
        rec = conn.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        return rec.status if rec else None
    finally:
        conn.close()


def _set_record_status(sid: str, status: str, transcript: str | None = None) -> None:
    from app.models.record import SessionRecord

    conn = H.db()
    try:
        rec = conn.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        rec.status = status
        rec.transcript = transcript
        conn.commit()
    finally:
        conn.close()


def test_TS8_off_큐에_남은_STT_요약_작업은_skip_이고_retry_0(client, ai_off, transport_spy):
    from app.tasks import stt_task, summary_task

    host = _register(client, "ai220-stale@test.com")
    sid = _create_session(client, host)
    assert client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"]).status_code == 200
    _upload_chunk(client, sid, host)
    assert client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"]).status_code == 200
    assert _record_for(sid) == "processing"

    conn = H.db()
    try:
        stt_task.run_stt_inline(sid, conn)  # 예외 없이 종료 = retry 예약 0
        assert _record_for(sid) == "completed"
        _set_record_status(sid, "processing", "기존 전사")
        summary_task.run_summary_inline(sid, conn)
        assert _record_for(sid) == "completed"
    finally:
        conn.close()
    assert transport_spy.call_count == 0


def test_TS6_off_종료_파이프라인은_STT_요약만_빠지고_영상병합_리포트는_유지(ai_off):
    from app.services import audio_service

    sid = str(uuid.uuid4())
    names = [t.task for t in audio_service._build_pipeline_tasks(sid, True, True, True)]
    assert "tasks.stt" not in names and "tasks.summary" not in names
    assert len(names) == 2  # video merge 1 + report 1
    assert names.count("tasks.stt") == 0


def test_TS6_on_종료_파이프라인은_STT_요약_순서를_보존한다(ai_on):
    from app.services import audio_service

    sid = str(uuid.uuid4())
    names = [t.task for t in audio_service._build_pipeline_tasks(sid, True, True, True)]
    assert names.index("tasks.stt") + 1 == names.index("tasks.summary")
    assert len(names) == 4


def test_TS6_off_세션_종료시_녹음_원본_보존_completed_마감_리포트_발행(client, ai_off, transport_spy, monkeypatch):
    from app.models.record import AudioChunk
    from app.services import audio_service

    published = MagicMock(return_value=True)
    monkeypatch.setattr(audio_service, "publish_pipeline", published)

    host = _register(client, "ai220-rec@test.com")
    sid = _create_session(client, host)
    r = client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    assert r.status_code == 200, r.text
    _upload_chunk(client, sid, host)
    r = client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    assert _record_for(sid) == "completed"
    conn = H.db()
    try:
        chunks = conn.query(AudioChunk).filter(AudioChunk.session_id == uuid.UUID(sid)).all()
        assert len(chunks) == 1 and chunks[0].size_bytes == len(b"fake-audio" * 50)
    finally:
        conn.close()
    assert published.call_count == 1  # 리포트 생성 의도(체인)는 유지
    assert published.call_args.args[1] is True  # has_recording 보존
    assert transport_spy.call_count == 0


def test_TS6_off_마이크_미사용_세션은_manual_유지(client, ai_off):
    host = _register(client, "ai220-manual@test.com")
    sid = _create_session(client, host)
    r = client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": False}, headers=host["auth"])
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert r.status_code == 200, r.text
    assert _record_for(sid) == "manual"


# ── TS7: 규칙 서사·캐시 ──────────────────────────────────────────


def _metrics_summary() -> dict:
    from app.services.report_narrative import SIGNATURE_METRICS, summary_from_signature  # noqa: F401

    return summary_from_signature("↓↓↑↑↑↑")


@pytest.fixture
def narrative_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.core.database import Base
    from app.models.narrative_cache import NarrativeCache  # noqa: F401

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)


def test_TS7_off_서사는_fallback_과_정확히_일치하고_LLM_캐시를_재사용하지_않는다(ai_off, transport_spy, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.services.report_narrative import build_narrative_signature, fallback_narrative
    from app.tasks import summary_task

    summary = _metrics_summary()
    signature = build_narrative_signature(summary)
    assert signature
    llm_text = {"journey": "LLM 여정", "body": "LLM 몸", "mind": "LLM 마음", "closing": "LLM 마무리"}
    narrative_db.add(NarrativeCache(signature=signature, narrative=llm_text, source="llm"))
    narrative_db.commit()

    result = summary_task._call_narrative_llm(summary, narrative_db)
    assert result == fallback_narrative(summary)
    assert result != llm_text
    # 기존 캐시 행은 변경하지 않는다(과거 콘텐츠 무단 재작성 금지)
    assert narrative_db.get(NarrativeCache, signature).narrative == llm_text
    assert transport_spy.call_count == 0


def test_TS7_on_LLM_캐시_hit_는_기존대로_재사용된다(ai_on, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.services.report_narrative import build_narrative_signature
    from app.tasks import summary_task

    summary = _metrics_summary()
    signature = build_narrative_signature(summary)
    llm_text = {"journey": "LLM 여정", "body": "LLM 몸", "mind": "LLM 마음", "closing": "LLM 마무리"}
    narrative_db.add(NarrativeCache(signature=signature, narrative=llm_text, source="llm"))
    narrative_db.commit()
    assert summary_task._call_narrative_llm(summary, narrative_db) == llm_text


def test_TS7_TS8_off_서사_업그레이드는_외부호출_0_행_변경_0(ai_off, transport_spy, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.services.report_narrative import seed_narrative_cache
    from app.tasks.upgrade_narrative_cache import upgrade_rule_narratives

    seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑"])
    narrative_db.commit()
    assert upgrade_rule_narratives(narrative_db, limit=5) == 0
    assert narrative_db.get(NarrativeCache, "↓↓↑↑↑↑").source == "rule"
    assert transport_spy.call_count == 0


# ── TS8: 예약·기억 추출·리포트 대화 ───────────────────────────────


def test_TS8_off_체크인_브리핑_리마인더_스윕은_0건_외부호출_0(client, ai_off, transport_spy):
    from app.services import agent_briefing, agent_checkin, agent_reminder

    conn = H.db()
    try:
        assert agent_checkin.sweep(conn) == {"scanned": 0, "created": 0, "skipped": 0}
        assert agent_checkin.close_stale(conn) == 0
        assert agent_briefing.sweep(conn) == {"scanned": 0, "sent": 0, "skipped": 0}
        assert agent_reminder.sweep(conn) == {"scanned": 0, "sent": 0, "corrected": 0}
        assert agent_checkin.start_outreach(conn, uuid.uuid4()) is None
    finally:
        conn.close()
    assert transport_spy.call_count == 0


def test_TS8_off_기억_프로필_추출은_행을_만들지_않는다(client, ai_off, transport_spy):
    from app.models.agent import AgentMemoryItem, AgentProfileItem
    from app.services import agent_memory, agent_profile

    conn = H.db()
    try:
        texts = [("user", "요즘 회사 때문에 잠이 안 와요")]
        assert agent_memory.extract_and_store(conn, client_id=uuid.uuid4(), texts=texts) == []
        assert (
            agent_profile.extract_and_store(
                conn, client_id=uuid.uuid4(), counselor_id=uuid.uuid4(), texts=texts
            )
            == []
        )
        assert conn.query(AgentMemoryItem).count() == 0
        assert conn.query(AgentProfileItem).count() == 0
    finally:
        conn.close()
    assert transport_spy.call_count == 0


def test_TS8_off_리포트_승인시_루시_대화_생성_skip(client, ai_off):
    from app.services import agent_report_chat

    assert agent_report_chat.on_report_approved(MagicMock(), MagicMock()) is False


def test_TS4_off_서비스_진입점도_직접_호출시_차단된다(client, ai_off, transport_spy):
    from app.services import agent_counselor_service, agent_service

    conn = H.db()
    try:
        with pytest.raises(ai_features.AiFeaturesDisabled):
            agent_service.send_user_message(conn, str(uuid.uuid4()), "안녕")
        with pytest.raises(ai_features.AiFeaturesDisabled):
            list(agent_service.stream_user_message(conn, str(uuid.uuid4()), "안녕"))
        with pytest.raises(ai_features.AiFeaturesDisabled):
            agent_service.execute_cta(conn, str(uuid.uuid4()), str(uuid.uuid4()), "x")
        with pytest.raises(ai_features.AiFeaturesDisabled):
            agent_counselor_service.send_user_message(conn, str(uuid.uuid4()), "안녕")
    finally:
        conn.close()
    assert transport_spy.call_count == 0

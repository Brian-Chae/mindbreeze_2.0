"""SDD-202 — 스트리밍 LLM 실패 시 고정 폴백 대신 오류 + 재시도 안내."""

from __future__ import annotations

import httpx
import pytest

from app.services import agent_llm


def _ok_resp(tokens: list[str]):
    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def raise_for_status(self):
            return None

        def iter_lines(self):
            for token in tokens:
                yield 'data: {"candidates":[{"content":{"parts":[{"text":"%s"}]}}]}' % token

    return Resp()


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.invalid/?key=SECRET")
    return httpx.HTTPStatusError("boom", request=request, response=httpx.Response(code, request=request))


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)


def test_정상_스트림은_오류_없이_토큰을_yield(monkeypatch):
    monkeypatch.setattr(httpx, "stream", lambda *a, **k: _ok_resp(["안녕", "하세요"]))
    assert list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True)) == ["안녕", "하세요"]


def test_503_은_한번_재시도해_성공한다(monkeypatch):
    calls = []

    def fake_stream(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise _status_error(503)
        return _ok_resp(["네"])

    monkeypatch.setattr(httpx, "stream", fake_stream)
    assert list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True)) == ["네"]
    assert len(calls) == 2


def test_연속_실패하면_LLMUnavailableError(monkeypatch):
    calls = []

    def fake_stream(*a, **k):
        calls.append(1)
        raise _status_error(503)

    monkeypatch.setattr(httpx, "stream", fake_stream)
    with pytest.raises(agent_llm.LLMUnavailableError) as info:
        list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True))
    assert len(calls) == 2
    assert "SECRET" not in str(info.value)  # 키가 든 URL 이 사유에 새지 않는다


def test_read_타임아웃은_재시도하지_않는다(monkeypatch):
    calls = []

    def fake_stream(*a, **k):
        calls.append(1)
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "stream", fake_stream)
    with pytest.raises(agent_llm.LLMUnavailableError):
        list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True))
    assert len(calls) == 1


def test_일부_전송_후_끊기면_재시도_없이_받은_만큼으로_종료(monkeypatch):
    calls = []

    class Broken(_ok_resp([]).__class__):
        def iter_lines(self):
            yield 'data: {"candidates":[{"content":{"parts":[{"text":"절반"}]}}]}'
            raise httpx.ReadError("cut")

    def fake_stream(*a, **k):
        calls.append(1)
        return Broken()

    monkeypatch.setattr(httpx, "stream", fake_stream)
    assert list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True)) == ["절반"]
    assert len(calls) == 1


def test_빈_응답도_실패로_본다(monkeypatch):
    monkeypatch.setattr(httpx, "stream", lambda *a, **k: _ok_resp([]))
    with pytest.raises(agent_llm.LLMUnavailableError):
        list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True))


def test_키가_없어도_raise_on_failure_면_오류(monkeypatch):
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: False)
    with pytest.raises(agent_llm.LLMUnavailableError):
        list(agent_llm.generate_stream("p", "폴백", raise_on_failure=True))


def test_기본값은_기존처럼_폴백을_yield(monkeypatch):
    monkeypatch.setattr(httpx, "stream", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert list(agent_llm.generate_stream("p", "고정 폴백")) == ["고정 폴백"]


# ── API: 스트림 엔드포인트 ─────────────────────────────────────────


def _api_pair(client, prefix: str):
    from tests import agent_helpers as H

    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    return H, counselor, member


def _fail_llm(monkeypatch):
    def fake_stream(*a, **k):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "stream", fake_stream)
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)


def test_스트림_LLM_실패시_error_이벤트를_보내고_메시지를_저장하지_않는다(client, monkeypatch):
    H, _, member = _api_pair(client, "sf-api1")
    _fail_llm(monkeypatch)

    res = client.post("/api/v1/agent/messages/stream", json={"content": "요즘 의욕이 없어요"}, headers=member["h"])

    assert res.status_code == 200, res.text
    assert '"error": "llm_unavailable"' in res.text
    assert res.text.rstrip().endswith("data: [DONE]")
    assert '"token"' not in res.text  # 고정 폴백 문구가 흘러나가지 않는다
    items = client.get("/api/v1/agent/messages", headers=member["h"]).json()["items"]
    assert all(m["content"] != "요즘 의욕이 없어요" for m in items)  # 사용자 메시지도 롤백
    assert not any(m["sender"] == "agent" and m["kind"] in ("free", "checkin") for m in items)


def test_스트림_실패_후_같은_내용으로_재전송하면_정상_저장된다(client, monkeypatch):
    H, _, member = _api_pair(client, "sf-api2")
    _fail_llm(monkeypatch)
    client.post("/api/v1/agent/messages/stream", json={"content": "다시 해볼게요"}, headers=member["h"])

    monkeypatch.setattr(httpx, "stream", lambda *a, **k: _ok_resp(["들려주셔서 고마워요."]))
    res = client.post("/api/v1/agent/messages/stream", json={"content": "다시 해볼게요"}, headers=member["h"])

    assert '"token"' in res.text and "error" not in res.text
    items = client.get("/api/v1/agent/messages", headers=member["h"]).json()["items"]
    assert [m["content"] for m in items if m["sender"] == "user"].count("다시 해볼게요") == 1


def test_체크인_스트림_실패는_turn_count_를_소모하지_않는다(client, monkeypatch):
    from app.core.database import SessionLocal
    from app.models.agent import AgentCheckin
    from tests import agent_helpers as H

    counselor = H.register_counselor("sf-ck-c@test.com", name="김상담")
    member = H.register_client(client, "sf-ck-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    H.set_checkin_enabled(counselor["id"], member["id"], True)
    H.run_checkin_sweep(now=H.kst_at(10, 0, day_offset=-1))

    def turns() -> int:
        db = SessionLocal()
        try:
            rows = db.query(AgentCheckin).all()
            return max((r.turn_count or 0) for r in rows) if rows else 0
        finally:
            db.close()

    before = turns()
    db = SessionLocal()
    try:
        assert db.query(AgentCheckin).count() >= 1  # 체크인 경로를 실제로 타는지 확인
    finally:
        db.close()
    _fail_llm(monkeypatch)
    res = client.post("/api/v1/agent/messages/stream", json={"content": "그냥 그래요"}, headers=member["h"])

    assert '"error": "llm_unavailable"' in res.text
    assert turns() == before

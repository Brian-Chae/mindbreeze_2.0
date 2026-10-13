"""SDD-203 — 루시 멀티턴 대화 구조 QA (verify.md TS1~TS6)."""

from app.services import agent_llm


def _hist(*pairs):
    return [{"sender": s, "content": c} for s, c in pairs]


def test_TS1_이력이_user_model_턴으로_전달된다():
    request = agent_llm.build_chat_request(
        "■ 예약된 상담 일정\n- 없음",
        _hist(("user", "안녕?"), ("agent", "안녕하세요!"), ("user", "피곤해")),
        "회사에 나왔어",
    )
    roles = [c["role"] for c in request.contents]
    assert roles == ["user", "model", "user"]
    assert request.contents[-1]["parts"][0]["text"].endswith("회사에 나왔어")
    assert "최근 대화" not in request.system
    assert "[허용 자료]" in request.system


def test_TS2_저장된_현재_입력은_한_번만_남는다():
    request = agent_llm.build_chat_request(
        "", _hist(("user", "안녕"), ("agent", "반가워요"), ("user", "피곤해")), "피곤해"
    )
    texts = [c["parts"][0]["text"] for c in request.contents]
    assert texts == ["안녕", "반가워요", "피곤해"]


def test_TS3_역할이_정규화된다():
    contents = agent_llm.build_chat_contents(
        _hist(
            ("agent", "먼저 건넨 인사"),
            ("system", "안내문"),
            ("user", "하나"),
            ("user", "둘"),
            ("agent", "답"),
        ),
        "셋",
    )
    assert [c["role"] for c in contents] == ["user", "model", "user"]
    assert contents[0]["parts"][0]["text"] == "하나\n둘"
    assert all("안내문" not in c["parts"][0]["text"] for c in contents)


def test_이력이_없으면_현재_입력_한_턴이다():
    assert agent_llm.build_chat_contents([], "안녕") == [{"role": "user", "parts": [{"text": "안녕"}]}]
    assert agent_llm.build_chat_contents(_hist(("agent", "혼잣말"), ("user", "")), "안녕") == [
        {"role": "user", "parts": [{"text": "안녕"}]}
    ]


def test_TS4_요청_본문은_systemInstruction_과_contents_를_쓴다():
    request = agent_llm.build_chat_request("자료", _hist(("agent", "x")), "안녕", task="맥락")
    body = agent_llm._request_body(request)
    assert body["systemInstruction"]["parts"][0]["text"] == request.system
    assert body["contents"] == request.contents
    assert body["generationConfig"]["temperature"] == agent_llm.AGENT_CHAT_TEMPERATURE == 0.9
    assert "[이번 대화의 맥락]\n맥락" in request.system

    legacy = agent_llm._request_body("프롬프트")
    assert "systemInstruction" not in legacy
    assert legacy["contents"] == [{"parts": [{"text": "프롬프트"}]}]
    assert legacy["generationConfig"]["temperature"] == 0.6


def test_TS5_시스템_프롬프트_기준():
    system = agent_llm.COMPANION_SYSTEM
    for token in ("열린 질문", "가벼운 초대", "덕담", "바로 앞의 루시 답변", "지어내지"):
        assert token in system, token
    assert "[대화 예시" not in system
    assert "경험을 곁들" not in system
    for token in ("우울증", "80점", "처방해"):
        assert token not in system.replace("처방, ", ""), token


def test_TS6_문장_경계에서_자른다():
    sentence = "가나다라마바사아자차카타파하." * 3
    text = (sentence + " ") * 40
    clipped = agent_llm.clip_message(text, limit=200)
    assert len(clipped) <= 200
    assert clipped.endswith(".")
    assert agent_llm.clip_message("짧은 문장이에요.") == "짧은 문장이에요."


def test_generate_chat_request_는_폴백과_가드를_유지한다(monkeypatch):
    monkeypatch.setattr(agent_llm, "_invoke", lambda prompt: None)
    request = agent_llm.build_chat_request("", [], "안녕")
    assert agent_llm.generate(request, "고정 폴백") == "고정 폴백"

    monkeypatch.setattr(agent_llm, "_invoke", lambda prompt: "약을 드세요. 그중 마음 쓰이는 곳은 어디예요?")
    assert agent_llm.generate(request, "폴백") == "그중 마음 쓰이는 곳은 어디예요?"


def test_generate_stream_은_chat_요청_본문을_보낸다(monkeypatch):
    import httpx

    captured = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_lines(self):
            return ['data: {"candidates":[{"content":{"parts":[{"text":"네"}]}}]}']

    def fake_stream(method, url, **kwargs):
        captured["json"] = kwargs["json"]
        return FakeResp()

    monkeypatch.setattr(httpx, "stream", fake_stream)
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)

    request = agent_llm.build_chat_request("", [], "안녕")
    assert list(agent_llm.generate_stream(request, "폴백")) == ["네"]
    assert "systemInstruction" in captured["json"]

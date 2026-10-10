"""SDD-200 — 루시 페르소나 few-shot QA.

verify.md 시나리오: TS1(프롬프트 포함), TS2(금지 표현 없음), TS3(어조 기준).
"""

from app.services import agent_llm


def test_TS1_few_shot_예시가_프롬프트에_포함된다():
    prompt = agent_llm.build_prompt("(없음)", user_text="요즘 힘들어요", task="공감하세요")

    assert "[대화 예시" in prompt
    assert "요즘 너무 힘들어요" in prompt
    # few-shot 예시가 시스템 지시 영역([해야 할 일] 블록보다 앞)에 온다
    assert prompt.index("[대화 예시") < prompt.index("[해야 할 일]")


def test_TS2_예시에_진단_점수_조언_표현이_없다():
    for token in ("우울증", "불안장애", "점수", "80점", "처방", "복용", "치료"):
        assert token not in agent_llm.FEW_SHOT_EXAMPLES, token


def test_TS3_예시가_존댓말_어미를_쓴다():
    for token in ("래요", "세요", "죠", "봐요"):
        assert token in agent_llm.FEW_SHOT_EXAMPLES, token


def test_TS3_예시에_이모지가_없다():
    for token in ("😊", "😢", "❤️", "✨", "😭"):
        assert token not in agent_llm.FEW_SHOT_EXAMPLES, token


def test_예시는_4개_이상_5개_이하다():
    count = agent_llm.FEW_SHOT_EXAMPLES.count("내담자:")
    assert 4 <= count <= 5


def test_generate_stream_thinking_토큰을_건너뛰고_텍스트만_모은다(monkeypatch):
    import httpx

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_lines(self):
            return [
                'data: {"candidates":[{"content":{"parts":[{"text":"사고 중...","thought":true}]}}]}',
                'data: {"candidates":[{"content":{"parts":[{"text":"안녕","thought":false}]}}]}',
                'data: {"candidates":[{"content":{"parts":[{"text":"하세요","thought":false}]}}]}',
            ]

    monkeypatch.setattr(httpx, "stream", lambda *a, **k: FakeResp())
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)

    tokens = list(agent_llm.generate_stream("프롬프트", "폴백"))

    assert tokens == ["안녕", "하세요"]


def test_generate_stream_실패_시_폴백을_yield_한다(monkeypatch):
    import httpx

    def raise_stream(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(httpx, "stream", raise_stream)
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)

    tokens = list(agent_llm.generate_stream("프롬프트", "고정 폴백"))

    assert tokens == ["고정 폴백"]

"""SDD-199 — 루시 감정·상황 인식 QA.

verify.md 시나리오: TS1(감정 6종), TS2(중립), TS3(강도), TS4(오탐), TS5(프롬프트 직렬화).
"""

from app.services import agent_emotion


def test_TS1_감정_6종을_감지한다():
    cases = {
        "요즘 너무 슬프고 눈물이 나요": "sadness",
        "내일 발표가 불안하고 걱정돼요": "anxiety",
        "상사 때문에 화가 나요": "anger",
        "요즘 너무 피곤하고 지쳐요": "fatigue",
        "혼자 있으면 너무 외로워요": "loneliness",
        "오늘 좋은 일이 있어서 기뻐요": "joy",
    }
    for text, expected in cases.items():
        assert agent_emotion.detect_emotion(text)["emotion"] == expected, text


def test_TS2_감정_키워드가_없으면_중립이다():
    result = agent_emotion.detect_emotion("내일 점심 뭐 먹을까요")
    assert result == {"emotion": "neutral", "intensity": None}


def test_TS2_빈_문자열도_중립이다():
    assert agent_emotion.detect_emotion("") == {"emotion": "neutral", "intensity": None}
    assert agent_emotion.detect_emotion(None) == {"emotion": "neutral", "intensity": None}


def test_TS3_강도를_구분한다():
    assert agent_emotion.detect_emotion("조금 힘들어요")["intensity"] == "mild"
    assert agent_emotion.detect_emotion("힘들어요")["intensity"] == "moderate"
    assert agent_emotion.detect_emotion("너무 힘들어요")["intensity"] == "strong"


def test_TS4_화요일은_분노가_아니다():
    result = agent_emotion.detect_emotion("화요일에 만나요")
    assert result["emotion"] != "anger"


def test_TS5_감정_신호가_프롬프트용_한_줄로_직렬화된다():
    signal = agent_emotion.detect_emotion("너무 불안해요")
    line = agent_emotion.signal_line(signal)

    assert "불안" in line
    assert "강함" in line
    assert "공감" in line


def test_최신_우선으로_첫_비중립_감정을_고른다():
    signal = agent_emotion.emotion_signal(["점심 뭐 먹을까", "요즘 슬프네요"])

    assert signal is not None
    assert signal["emotion"] == "sadness"


def test_모두_중립이면_None_이다():
    assert agent_emotion.emotion_signal(["점심 뭐 먹을까", "내일 날씨 좋대요"]) is None

"""SDD-199: 루시 감정·상황 인식 — 감정 톤·강도 분류 → 맞춤 공감.

키워드 기반으로 감정 6종 + 중립과 강도(약·중·강)를 감지한다. 별도 LLM 호출 없이
루시 응답 프롬프트에 "현재 감정 신호"를 실어 공감 정확도를 높인다. 진단·점수·위험
판정은 여기서 다루지 않는다(agent_guard 담당).
"""

from __future__ import annotations

# 감정 사전 — 오탐을 피하려 짧은 단일 글자("화", "좋")는 쓰지 않는다.
EMOTION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "sadness": ("슬프", "눈물", "속상", "서럽", "우울", "괴롭", "서글프", "마음이 무거"),
    "anxiety": ("불안", "걱정", "초조", "긴장", "두렵", "무섭", "떨리", "노심초사"),
    "anger": ("화나", "화가 나", "화가", "짜증", "열받", "분노", "억울", "빡치"),
    "fatigue": ("피곤", "지치", "지쳤", "힘들", "번아웃", "탈진"),
    "loneliness": ("외롭", "혼자", "쓸쓸", "고립", "공허", "외로"),
    "joy": ("기쁘", "기뻐", "좋아", "행복", "즐거", "신나", "뿌듯", "감사", "설레", "고마"),
}

EMOTION_LABELS: dict[str, str] = {
    "sadness": "슬픔",
    "anxiety": "불안",
    "anger": "분노",
    "fatigue": "피로",
    "loneliness": "외로움",
    "joy": "기쁨",
    "neutral": "중립",
}

INTENSITY_LABELS: dict[str, str] = {"mild": "약함", "moderate": "보통", "strong": "강함"}

_STRONG_WORDS: tuple[str, ...] = (
    "너무", "완전", "정말", "진짜", "극도", "미치겠", "죽겠", "엄청", "몹시", "심하게",
)
_MILD_WORDS: tuple[str, ...] = ("조금", "약간", "살짝", "좀", "가끔", "살며시")


def detect_emotion(text: str | None) -> dict:
    """감정 + 강도 감지. 매칭 없으면 {"emotion": "neutral", "intensity": None}."""
    if not text:
        return {"emotion": "neutral", "intensity": None}

    best = None
    best_score = 0
    for emotion, keywords in EMOTION_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in text)
        if score > best_score:
            best_score = score
            best = emotion

    if best is None:
        return {"emotion": "neutral", "intensity": None}

    intensity = "moderate"
    if any(word in text for word in _STRONG_WORDS):
        intensity = "strong"
    elif any(word in text for word in _MILD_WORDS):
        intensity = "mild"
    return {"emotion": best, "intensity": intensity}


def emotion_signal(texts: list[str]) -> dict | None:
    """최근 메시지에서 첫 번째 비중립 감정을 돌려준다(최신 우선). 없으면 None."""
    for text in reversed(texts):
        signal = detect_emotion(text)
        if signal["emotion"] != "neutral":
            return signal
    return None


def signal_line(signal: dict) -> str:
    """프롬프트용 한 줄 — "- 현재 감정 신호: 불안(강함) — 먼저 이 감정에 공감하세요."."""
    label = EMOTION_LABELS.get(signal["emotion"], signal["emotion"])
    intensity = INTENSITY_LABELS.get(signal["intensity"], "")
    return f"- 현재 감정 신호: {label}({intensity}) — 먼저 이 감정에 공감하세요."

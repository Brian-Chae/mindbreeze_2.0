"""SDD-085 G5 확장 — STT 신뢰도 판정(_assess_transcript_confidence) 단위 테스트.

판정 규칙:
  1) 타임스탬프 환각(끝 > 실제 길이의 115%) → low
  2) 비언어([잡음]/[무음]) 마커 지배 → low
  3) 발화량 부족 → low
  그 외 정상 대화 → high
"""

from app.tasks.stt_task import _assess_transcript_confidence


def _seg(*items):
    return [
        {"speaker": s, "text": t, "start": a, "end": b} for (s, t, a, b) in items
    ]


def test_빈_세그먼트는_low():
    assert _assess_transcript_confidence([], None) == "low"


def test_타임스탬프_환각은_low():
    # 실제 100초인데 세그먼트 끝이 200초 → 환각
    segs = _seg(("counselor", "안녕하세요", 0.0, 200.0))
    assert _assess_transcript_confidence(segs, 100.0) == "low"


def test_비발화_마커_지배는_low():
    segs = _seg(
        ("speaker_0", "[잡음]", 0.0, 1.0),
        ("speaker_0", "[무음]", 1.0, 3.0),
        ("speaker_0", "[잡음]", 3.0, 5.0),
    )
    assert _assess_transcript_confidence(segs, 30.0) == "low"


def test_발화량_부족은_low():
    # 60초 오디오인데 발화가 한 글자뿐
    segs = _seg(("speaker_0", "네", 0.0, 1.0))
    assert _assess_transcript_confidence(segs, 60.0) == "low"


def test_정상_대화는_high():
    segs = _seg(
        ("counselor", "안녕하세요, 오늘 어떤 이야기를 해볼까요?", 0.0, 3.0),
        ("client", "요즘 스트레스가 많아서 힘들어요.", 3.5, 6.5),
        ("counselor", "어떤 부분이 가장 힘드신가요?", 7.0, 9.0),
    )
    assert _assess_transcript_confidence(segs, 60.0) == "high"


def test_짧은_오디오_정상_대화는_high():
    # 타임스탬프·밀도 검사는 짧은 오디오(<10초, <30초)에서 스킵 — 정상 대화는 high
    segs = _seg(
        ("counselor", "안녕하세요", 0.0, 3.0),
        ("client", "네, 안녕하세요", 3.5, 6.5),
    )
    assert _assess_transcript_confidence(segs, 5.0) == "high"

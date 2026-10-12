"""SDD-188: AI 에이전트 출력 가드 — 진단·처방·점수 표현 차단.

AI 비서는 상담사가 아니다. 리포트 본문을 함께 읽고 이야기할 수는 있어도
새 해석을 만들거나 진단명을 붙이거나 상태를 숫자로 환원하면 안 된다(기획 §3.3, §4).

프롬프트 지시만으로는 모델 출력을 보장할 수 없으므로, 저장 직전에 문장 단위로 한 번 더
걸러낸다. 금지 표현이 섞인 문장은 버리고, 전부 버려졌으면 안전 문구로 대체한다.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# 전부 걸러졌을 때 쓰는 대체 문구 — 상담사 연결 방향으로 닫는다.
SAFE_FALLBACK = (
    "이 부분은 제가 판단해 말씀드리기 어려운 이야기예요. "
    "상담사님과 함께 이야기 나눠 보시면 좋겠어요."
)

# 진단·질환·처방·치료 지시 표현. AI 가 임상 판단을 내리는 문장을 차단한다.
_DIAGNOSIS_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"우울증", r"불안장애", r"공황장애", r"조현병", r"양극성", r"조울",
        r"ADHD", r"주의력결핍", r"강박장애", r"외상후\s*스트레스", r"PTSD",
        r"수면장애", r"섭식장애", r"인격장애", r"성격장애", r"적응장애",
        r"진단", r"확진", r"의심(?:됩니다|됩니데|돼요|스럽)", r"소견",
        r"처방", r"복약", r"약을\s*(?:드|먹|복용)", r"투약",
        r"치료(?:가|를)\s*(?:필요|받으|시작)", r"병명", r"질환", r"증상입니다",
    )
)

# 숫자 척도 표현. 점수·백분율·별점·NPS 로 상태를 환원하는 것을 금지한다(기획 §3.3).
_SCORE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"\d+\s*점", r"\d+\s*%", r"\d+\s*퍼센트", r"\d+\s*/\s*\d+",
        r"\d+\s*등급", r"\d+\s*단계\s*(?:수준|정도)", r"점수", r"지수는",
        r"별점", r"NPS", r"상위\s*\d+", r"하위\s*\d+", r"\d+\s*분위",
    )
)

# SDD-191: 조언·해결 선언·애착 유발 표현. AI 는 경청·공감·열린 질문만 한다(기획 §3.4).
#
# "~하세요" 를 통째로 막지는 않는다 — "편하게 적어 주세요" 처럼 대화를 여는 표현까지
# 걸러지면 기존 메시지가 전부 폐기된다. 약·병원·치료·운동 같은 **조언 맥락의 명령형**만
# 막는다.
_ADVICE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"(?:약|병원|의사|진료|치료|입원|상담)\s*(?:을|를|에|은|는)?\s*"
        r"(?:드세요|먹으세요|받으세요|가세요|가\s*보세요|시작하세요|끊으세요|받아\s*보세요)",
        r"(?:운동|명상|호흡|산책|일기|요가|스트레칭)\s*(?:을|를)?\s*"
        r"(?:하세요|해\s*보세요|추천(?:해|합니다|드려요))",
        r"(?:하시는|드시는|해\s*보시는)\s*(?:게|것이)\s*좋(?:겠어요|아요|습니다)",
        r"제가\s*(?:해결|고쳐|치료|낫게)",
        r"(?:항상|언제나|늘|24시간)\s*(?:곁에|옆에|함께)",
        r"(?:저|제가)\s*(?:늘|항상)?\s*있으니\s*(?:걱정|안심)",
        r"혼자가\s*아니에요",
    )
)

# 문장 분리 — 한국어 종결부호 기준. 줄바꿈도 경계로 본다.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。？！])\s+|\n+")


def is_blocked(sentence: str) -> bool:
    """한 문장이 진단·점수·조언 금지 규칙에 걸리는지 판정한다."""
    for pattern in (*_DIAGNOSIS_PATTERNS, *_SCORE_PATTERNS, *_ADVICE_PATTERNS):
        if pattern.search(sentence):
            return True
    return False


def sanitize(text: str | None, *, fallback: str | None = None) -> str:
    """LLM/템플릿 출력에서 진단·점수 표현이 있는 문장을 제거한다.

    - 문장 단위로 검사해 걸린 문장만 버린다(남은 문장은 그대로 쓴다).
    - 모두 걸러졌거나 입력이 비면 fallback(기본 SAFE_FALLBACK)을 반환한다.
    - 로그에는 대화 원문을 남기지 않는다 — 제거 건수만 기록한다(보안 리뷰 항목).
    """
    safe_text = fallback if fallback is not None else SAFE_FALLBACK
    if not text or not text.strip():
        return safe_text

    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s and s.strip()]
    kept = [s for s in sentences if not is_blocked(s)]
    removed = len(sentences) - len(kept)
    if removed:
        logger.info("[agent_guard] 금지 표현 문장 %d개 제거 (전체 %d문장)", removed, len(sentences))
    if not kept:
        return safe_text
    return " ".join(kept)

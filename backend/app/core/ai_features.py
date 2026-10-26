"""AI 기능 단일 정책 가드 (SDD-220).

외부 LLM(Gemini·OpenAI) 호출은 모두 이 모듈의 판정을 따른다.
- 설정은 호출 시점마다 `app.config.settings.ai_features_enabled` 에서 읽는다(import 시 값 캐싱 금지).
- API 경계는 `require_ai_enabled_dep` 로 403 `AI_FEATURES_DISABLED` 로 매핑한다.
- 네트워크 직전 transport 는 `require_ai_enabled()` 를 호출해 API 우회·이미 큐에 적재된 작업을 막는다.
- 가드 예외(`AiFeaturesDisabled`)는 공급자 장애가 아니므로 재시도 대상이 아니다.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from app.config import settings

AI_FEATURES_DISABLED_CODE = "AI_FEATURES_DISABLED"
STT_DISABLED_CODE = "STT_DISABLED"


class AiFeaturesDisabled(Exception):
    """AI 기능이 꺼진 상태에서 외부 LLM 경로에 진입했다.

    RuntimeError 를 상속하지 않는다 — Celery autoretry_for=(RuntimeError,) 가 재시도하지 않게 한다.
    """


def is_ai_enabled() -> bool:
    """현재 AI 기능 사용 여부 — 호출 시점의 설정을 읽는다."""
    return settings.ai_features_enabled is True


def is_stt_enabled() -> bool:
    """음성 받아쓰기(STT·전사 기반 요약) 사용 여부 — SDD-228. AI 전체 스위치와 STT 전용 스위치의 AND.

    STT 만 끄고 리포트 AI 초안 등 다른 AI 는 유지할 수 있다. 호출 시점의 설정을 읽는다.
    """
    return settings.ai_features_enabled is True and settings.stt_enabled is True


def require_stt_enabled() -> None:
    """STT 외부 호출 직전 가드 — 꺼져 있으면 AiFeaturesDisabled(재시도 대상 아님)."""
    if not is_stt_enabled():
        raise AiFeaturesDisabled(STT_DISABLED_CODE)


def require_ai_enabled() -> None:
    """꺼져 있으면 AiFeaturesDisabled — transport 직전·작업 진입점에서 호출한다."""
    if not is_ai_enabled():
        raise AiFeaturesDisabled(AI_FEATURES_DISABLED_CODE)


def require_ai_enabled_dep() -> None:
    """FastAPI 의존성 — AI 라우터에 적용해 403 AI_FEATURES_DISABLED 로 응답한다."""
    if not is_ai_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": AI_FEATURES_DISABLED_CODE,
                "message": "AI 기능은 현재 제공되지 않습니다.",
            },
        )

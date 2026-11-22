"""SDD-329 C — raw presign 권한 거절(403)의 사유 로그와 반복 거절 단축.

11/18 운영에서 한 IP 가 `eeg-raw/presign` 403 을 15,212건(3.4회/초) 반복했다. 권한 검사는 완화하지 않는다(403 유지,
429 전환 금지 — 구앱 처리 미확인). 대신 ① 거절 사유를 개인정보 없이 구조화 로그로 남기고 ② 같은 (사용자, 회차)의
반복 거절은 DB 조회 전에 같은 403 으로 짧게 끊어 서버 부하를 줄인다.

- 캐시는 Redis(60초). Redis 장애면 캐시 없이 기존 동작(fail-open: 권한 판정은 항상 원 경로가 한다).
- 캐시 적중은 "직전에 거절된 같은 주체"에 한해 같은 응답을 재생할 뿐 새 허용을 만들지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Callable

from fastapi import HTTPException

logger = logging.getLogger(__name__)

REJECT_CACHE_TTL_SEC = 60
SHORT_CIRCUIT_AFTER = 3  # 60초 안에 같은 (주체, 회차)가 이만큼 거절된 뒤부터 단축(동의·재입장 직후의 정당한 재시도는 막지 않는다)
_KEY = "raw_presign_reject:{kind}:{session}:{subject}"

# 거절 사유 분류 — 응답 문구에서 코드만 뽑는다(개인정보 없음).
_REASONS: tuple[tuple[str, str], ...] = (
    ("대기열", "waitlisted"),
    ("본인 참여자", "not_owner"),
    ("세션 참가자만", "not_participant"),
    ("호스트", "host"),
    ("뇌파", "eeg_consent_required"),
    ("동의", "consent_required"),
    ("archive_rejected", "archive_rejected"),
    ("capture_stream_not_owned", "stream_not_owned"),
)


def reason_code(detail: Any) -> str:
    text = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False, default=str)
    for needle, code in _REASONS:
        if needle in text:
            return code
    return "forbidden_other"


def _hash8(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]


def subject_key(current_user_id: Any, entry_credential: Any) -> tuple[str, str] | None:
    """(종류, 해시) — 원문 식별자는 키·로그에 남기지 않는다. 주체를 알 수 없으면 None(캐시 미적용)."""
    if current_user_id:
        return "u", _hash8(str(current_user_id))
    if entry_credential:
        return "c", _hash8(str(entry_credential))
    return None


def _redis():
    from app.services.pipeline_backlog_service import get_redis_client

    return get_redis_client()


def _cache_key(kind: str, session_id: Any, subject: tuple[str, str]) -> str:
    return _KEY.format(kind=kind, session=session_id, subject=f"{subject[0]}{subject[1]}")


def check_cached_reject(kind: str, session_id: Any, current_user_id: Any, entry_credential: Any) -> None:
    """직전에 거절된 같은 (주체, 회차)면 DB 조회 없이 같은 403 을 다시 올린다."""
    subject = subject_key(current_user_id, entry_credential)
    if subject is None:
        return
    try:
        raw = _redis().get(_cache_key(kind, session_id, subject))
    except Exception:  # noqa: BLE001 — Redis 장애는 캐시 없이 진행
        return
    if not raw:
        return
    try:
        cached = json.loads(raw)
        detail, reason, count = cached["detail"], cached["reason"], int(cached.get("count", 1))
    except (ValueError, KeyError, TypeError):
        return
    if count < SHORT_CIRCUIT_AFTER:
        return  # 아직 반복으로 보지 않는다 — 원 경로가 다시 판정한다
    logger.info("[presign-reject] kind=%s session=%s subject=%s reason=%s cached=1", kind, session_id, subject[1], reason)
    raise HTTPException(status_code=403, detail=detail)


def run_guarded(kind: str, session_id: Any, current_user_id: Any, entry_credential: Any, fn: Callable[[], Any]) -> Any:
    """`fn`(권한 판정 포함 presign 본체)을 실행한다. 403 이면 사유를 로그하고 60초 캐시한 뒤 그대로 다시 올린다."""
    check_cached_reject(kind, session_id, current_user_id, entry_credential)
    try:
        return fn()
    except HTTPException as exc:
        if exc.status_code == 403:
            record_reject(kind, session_id, current_user_id, entry_credential, exc.detail)
        raise


def record_reject(kind: str, session_id: Any, current_user_id: Any, entry_credential: Any, detail: Any) -> None:
    subject = subject_key(current_user_id, entry_credential)
    reason = reason_code(detail)
    logger.warning(
        "[presign-reject] kind=%s session=%s subject=%s reason=%s cached=0",
        kind, session_id, subject[1] if subject else "anon", reason,
    )
    if subject is None:
        return
    try:
        client = _redis()
        key = _cache_key(kind, session_id, subject)
        count = 1
        prev = client.get(key)
        if prev:
            try:
                count = int(json.loads(prev).get("count", 1)) + 1
            except (ValueError, TypeError, AttributeError):
                count = 1
        client.set(key, json.dumps({"detail": detail, "reason": reason, "count": count}, ensure_ascii=False, default=str),
                   ex=REJECT_CACHE_TTL_SEC)
    except Exception:  # noqa: BLE001
        logger.debug("[presign-reject] 캐시 저장 실패", exc_info=True)

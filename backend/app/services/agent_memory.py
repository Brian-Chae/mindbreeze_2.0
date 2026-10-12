"""SDD-198: 루시 전용 구조화 장기기억 — 사실·선호·관계·감정 트렌드 추출·저장·조회.

내담자 대화에서 루시가 "기억할 만한 것"을 키-밸류로 구조화해 저장한다. 요약 덩어리
(SDD-194)와 달리 (category, key) 당 최신 1건을 유지해 "이서·이준이 자녀" 같은 사실을
정확히 인출한다. 진단·점수 표현은 agent_guard 로 걸러 저장하지 않는다.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.agent import AgentMemoryItem
from app.services import agent_guard, agent_llm

logger = logging.getLogger(__name__)

CATEGORIES: tuple[str, ...] = ("fact", "preference", "relation", "emotion_trend")

CATEGORY_LABELS: dict[str, str] = {
    "fact": "사실",
    "preference": "선호",
    "relation": "관계",
    "emotion_trend": "감정 트렌드",
}

KEY_MAX_LENGTH = 80
VALUE_MAX_LENGTH = 300

_LLM_TASK = (
    "아래 [사용자 입력]은 내담자가 안부 대화에서 남긴 말입니다. 내담자에 대해 루시가 "
    "기억할 사실·선호·관계·감정 트렌드를 JSON 배열로만 출력하세요. "
    "형식: [{\"category\":\"fact|preference|relation|emotion_trend\",\"key\":\"주제\",\"value\":\"내용\"}]\n"
    "- fact: 이름·직업·가족·나이 등 사실\n"
    "- preference: 선호·취향·좋아하는 것\n"
    "- relation: 가족·지인 관계\n"
    "- emotion_trend: 최근 감정 상태 추이(예: \"최근 힘들어함\")\n"
    "진단명·병명·점수·숫자 척도를 쓰지 말고, 입력에 있는 내용만 적으세요. "
    "추측해서 새 사실을 만들지 마세요. 설명 없이 JSON 만 출력하세요."
)


def _parse_json_array(raw: str) -> list | None:
    """응답에서 JSON 배열만 떼어 파싱한다(agent_profile._parse_json_array 와 동일 규약)."""
    if not raw:
        return None
    start = raw.find("[")
    end = raw.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, list) else None


def extract_candidates(texts: list[tuple[str, str]]) -> list[dict]:
    """[(message_id, text)] → [{category, key, value, evidence}]. LLM 없으면 빈 목록."""
    if not texts or not agent_llm.is_enabled():
        return []

    joined = "\n".join(text for _, text in texts)
    prompt = agent_llm.build_prompt("(없음)", user_text=joined, task=_LLM_TASK)
    try:
        raw = agent_llm.generate(prompt, "")
    except Exception:  # noqa: BLE001 — 추출 실패가 체크인 마무리를 막지 않는다
        logger.warning("[agent_memory] LLM 추출 실패")
        return []
    parsed = _parse_json_array(raw)
    if not parsed:
        return []

    evidence = [message_id for message_id, _ in texts]
    candidates: list[dict] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        category = (entry.get("category") or "").strip()
        key = (entry.get("key") or "").strip()
        value = (entry.get("value") or "").strip()
        if category not in CATEGORIES or not key or not value:
            continue
        # 진단·점수 표현이 섞이면 그 항목을 버린다.
        if agent_guard.is_blocked(value) or agent_guard.is_blocked(key):
            continue
        candidates.append({
            "category": category,
            "key": key[:KEY_MAX_LENGTH],
            "value": value[:VALUE_MAX_LENGTH],
            "evidence": evidence,
        })
    return candidates


def _merge_evidence(current: list | None, incoming: list) -> list:
    merged = [str(value) for value in (current or [])]
    for value in incoming:
        text = str(value)
        if text not in merged:
            merged.append(text)
    return merged


def upsert_items(
    db: DBSession,
    *,
    client_id: UUID,
    candidates: list[dict],
    commit: bool = False,
) -> list[AgentMemoryItem]:
    """(client_id, category, key) 당 최신 1건 — 같은 키는 value 를 갱신한다."""
    saved: list[AgentMemoryItem] = []
    for candidate in candidates:
        existing = (
            db.query(AgentMemoryItem)
            .filter(
                AgentMemoryItem.client_id == client_id,
                AgentMemoryItem.category == candidate["category"],
                AgentMemoryItem.key == candidate["key"],
            )
            .first()
        )
        if existing is not None:
            existing.value = candidate["value"]
            existing.evidence = _merge_evidence(existing.evidence, candidate["evidence"])
            saved.append(existing)
            continue
        item = AgentMemoryItem(
            client_id=client_id,
            category=candidate["category"],
            key=candidate["key"],
            value=candidate["value"],
            evidence=_merge_evidence([], candidate["evidence"]),
        )
        db.add(item)
        saved.append(item)
    db.flush()
    if commit:
        db.commit()
    return saved


def extract_and_store(
    db: DBSession, *, client_id: UUID, texts: list[tuple[str, str]], commit: bool = False
) -> list[AgentMemoryItem]:
    """추출+저장 한 묶음. 실패해도 예외를 밖으로 던지지 않는다."""
    try:
        candidates = extract_candidates(texts)
        if not candidates:
            return []
        return upsert_items(db, client_id=client_id, candidates=candidates, commit=commit)
    except Exception:  # noqa: BLE001 — 기억 실패가 체크인 종료를 되돌리지 않는다
        logger.exception("[agent_memory] 기억 추출 실패 (client=%s)", client_id)
        return []


def list_items(
    db: DBSession, client_id: UUID, *, limit: int = 100
) -> list[dict]:
    """루시 컨텍스트용 — (category, key, value) 만 반환한다."""
    rows = (
        db.query(AgentMemoryItem)
        .filter(AgentMemoryItem.client_id == client_id)
        .order_by(AgentMemoryItem.category.asc(), AgentMemoryItem.updated_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {"category": item.category, "key": item.key, "value": item.value}
        for item in rows
    ]

"""SDD-191: 상담사 전용 내담자 프로파일 — 안부 대화에서 항목 추출·병합.

성격이 분명한 두 가지 제약이 이 모듈의 전부다.
1. **내담자에게 노출되지 않는다.** 내담자 API 는 이 테이블을 조회하지 않고, 상담사 API 는
   소유자(counselor_id)를 검증한다. 항목은 (내담자, 상담사) 쌍으로 분리 저장된다.
2. **AI 추정임을 숨기지 않는다.** 새로 만든 항목은 항상 `ai_estimate` 이고, 근거 메시지
   id 를 함께 남긴다. 확정·수정·기각은 상담사만 한다.

추출은 키워드 규칙이 기본이고 LLM(JSON)은 보조다 — 키가 없거나 응답이 깨져도
키워드 폴백으로 항목이 만들어진다(TS16). 점수·진단 표현은 넣지 않는다.
"""

from __future__ import annotations

import json
import logging
import re
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.agent import AgentProfileItem
from app.services import agent_guard, agent_llm

logger = logging.getLogger(__name__)

# Contract — ProfileItem.category
CATEGORIES: tuple[str, ...] = ("sleep", "stress", "emotion", "coping", "people_events")

CATEGORY_LABELS: dict[str, str] = {
    "sleep": "수면",
    "stress": "스트레스",
    "emotion": "감정",
    "coping": "대처 방식",
    "people_events": "관계·사건",
}

# 상태 — Contract(ProfileItem.status)
STATUS_AI = "ai_estimate"
STATUS_CONFIRMED = "confirmed"
STATUS_DISMISSED = "dismissed"

# 카테고리당 유지 상한. 넘치면 가장 오래 갱신되지 않은 ai_estimate 를 지운다.
MAX_ITEMS_PER_CATEGORY = 5

# 항목 길이 상한 (Contract: PATCH text 1~300자)
TEXT_MAX_LENGTH = 300

# 키워드 폴백 — 카테고리별 단서. 띄어쓰기 변형은 공백 제거 문자열로 맞춘다.
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "sleep": ("잠", "수면", "불면", "뒤척", "새벽에깨", "졸", "낮잠", "악몽"),
    "stress": (
        "스트레스", "부담", "압박", "지쳐", "지쳤", "번아웃", "과로", "야근", "힘들", "힘든",
    ),
    "emotion": (
        "불안", "우울", "외롭", "화가", "짜증", "답답", "무기력", "슬프", "눈물", "두렵", "초조",
    ),
    "coping": (
        "산책", "운동", "음악", "일기", "명상", "호흡", "청소", "요리", "게임", "술", "담배",
        "버티",
    ),
    "people_events": (
        "상사", "직장", "회사", "동료", "친구", "가족", "엄마", "아빠", "부모", "남편", "아내",
        "남자친구", "여자친구", "아이", "학교", "선생님", "이사", "퇴사", "이직", "시험",
    ),
}

_SPACE_RE = re.compile(r"\s+")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。？！])\s+|[\n,·]+")


def _normalize(text: str) -> str:
    return _SPACE_RE.sub("", text or "")


# ---------------------------------------------------------------------------
# 추출
# ---------------------------------------------------------------------------


def extract_candidates(texts: list[tuple[str, str]]) -> list[dict]:
    """[(message_id, text)] → [{category, text, evidence:[message_id]}].

    LLM 이 가능하면 JSON 으로 받고, 실패하면 키워드 폴백을 쓴다. 두 경로 모두 결과를
    `agent_guard` 로 한 번 더 걸러 진단·점수 표현이 프로파일에 남지 않게 한다.
    """
    if not texts:
        return []

    items = _extract_with_llm(texts) or _extract_with_keywords(texts)
    cleaned: list[dict] = []
    for item in items:
        text = (item.get("text") or "").strip()[:TEXT_MAX_LENGTH]
        category = item.get("category")
        if not text or category not in CATEGORIES:
            continue
        if agent_guard.is_blocked(text):
            continue
        cleaned.append({
            "category": category,
            "text": text,
            "evidence": list(item.get("evidence") or []),
        })
    return cleaned


def _extract_with_keywords(texts: list[tuple[str, str]]) -> list[dict]:
    """키워드 폴백 — 문장 단위로 카테고리를 붙인다. 해석·추론을 하지 않는다."""
    results: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for message_id, text in texts:
        for sentence in (s.strip() for s in _SENTENCE_SPLIT.split(text or "")):
            if not sentence:
                continue
            normalized = _normalize(sentence)
            for category, keywords in _CATEGORY_KEYWORDS.items():
                if not any(keyword in normalized for keyword in keywords):
                    continue
                key = (category, normalized[:40])
                if key in seen:
                    continue
                seen.add(key)
                results.append({
                    "category": category,
                    "text": sentence[:TEXT_MAX_LENGTH],
                    "evidence": [message_id],
                })
    return results


_LLM_TASK = (
    "아래 [사용자 입력]은 내담자가 안부 대화에서 남긴 말입니다. 상담사가 참고할 관찰 항목을 "
    "JSON 배열로만 출력하세요. 형식: [{\"category\":\"sleep|stress|emotion|coping|people_events\","
    "\"text\":\"관찰 한 문장\"}]. 진단명·병명·점수·숫자 척도를 쓰지 말고, 입력에 있는 내용만 "
    "적으세요. 추측해서 새 사실을 만들지 마세요. 설명 문장 없이 JSON 만 출력하세요."
)


def _extract_with_llm(texts: list[tuple[str, str]]) -> list[dict] | None:
    """LLM JSON 추출 — 키 없음·응답 파싱 실패 시 None(호출부가 키워드 폴백)."""
    if not agent_llm.is_enabled():
        return None

    joined = "\n".join(text for _, text in texts)
    prompt = agent_llm.build_prompt("(없음)", user_text=joined, task=_LLM_TASK)
    try:
        raw = agent_llm.generate(prompt, "")
    except Exception:  # noqa: BLE001 — 추출 실패가 체크인 마무리를 막지 않는다
        logger.warning("[agent_profile] LLM 추출 실패 — 키워드 폴백")
        return None
    parsed = _parse_json_array(raw)
    if not parsed:
        return None

    evidence = [message_id for message_id, _ in texts]
    items: list[dict] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        items.append({
            "category": entry.get("category"),
            "text": str(entry.get("text") or ""),
            "evidence": evidence,
        })
    return items or None


def _parse_json_array(raw: str) -> list | None:
    """응답에서 JSON 배열만 떼어 파싱한다. 코드블록·앞뒤 설명이 섞여도 견딘다."""
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


# ---------------------------------------------------------------------------
# 병합 저장
# ---------------------------------------------------------------------------


def upsert_items(
    db: DBSession,
    *,
    client_id: UUID,
    counselor_id: UUID,
    candidates: list[dict],
    commit: bool = False,
) -> list[AgentProfileItem]:
    """후보를 (내담자, 상담사) 프로파일에 병합한다 — 같은 텍스트는 근거만 누적한다.

    이미 상담사가 `dismissed` 로 둔 항목은 같은 텍스트가 다시 들어와도 되살리지 않는다.
    """
    saved: list[AgentProfileItem] = []
    for candidate in candidates:
        existing = (
            db.query(AgentProfileItem)
            .filter(
                AgentProfileItem.client_id == client_id,
                AgentProfileItem.counselor_id == counselor_id,
                AgentProfileItem.category == candidate["category"],
                AgentProfileItem.text == candidate["text"],
            )
            .first()
        )
        if existing is not None:
            if existing.status != STATUS_DISMISSED:
                existing.evidence = _merge_evidence(existing.evidence, candidate["evidence"])
            saved.append(existing)
            continue

        item = AgentProfileItem(
            client_id=client_id,
            counselor_id=counselor_id,
            category=candidate["category"],
            text=candidate["text"],
            status=STATUS_AI,
            evidence=_merge_evidence([], candidate["evidence"]),
        )
        db.add(item)
        saved.append(item)
    db.flush()

    for category in {c["category"] for c in candidates}:
        _trim_category(db, client_id, counselor_id, category)

    if commit:
        db.commit()
    return saved


def _merge_evidence(current: list | None, incoming: list) -> list:
    """근거 message_id 누적 — 중복 없이, 불변성 규칙에 맞게 새 목록을 만든다."""
    merged = [str(value) for value in (current or [])]
    for value in incoming:
        text = str(value)
        if text not in merged:
            merged.append(text)
    return merged


def _trim_category(
    db: DBSession, client_id: UUID, counselor_id: UUID, category: str
) -> None:
    """카테고리당 상한 유지 — 상담사가 손댄 항목(confirmed)은 남기고 추정만 정리한다."""
    rows = (
        db.query(AgentProfileItem)
        .filter(
            AgentProfileItem.client_id == client_id,
            AgentProfileItem.counselor_id == counselor_id,
            AgentProfileItem.category == category,
            AgentProfileItem.status != STATUS_DISMISSED,
        )
        .order_by(AgentProfileItem.created_at.desc())
        .all()
    )
    if len(rows) <= MAX_ITEMS_PER_CATEGORY:
        return
    for item in rows[MAX_ITEMS_PER_CATEGORY:]:
        if item.status == STATUS_AI:
            db.delete(item)
    db.flush()


def extract_and_store(
    db: DBSession,
    *,
    client_id: UUID,
    counselor_id: UUID,
    texts: list[tuple[str, str]],
    commit: bool = False,
) -> list[AgentProfileItem]:
    """체크인 마무리 시점의 추출+저장 한 묶음. 실패해도 예외를 밖으로 던지지 않는다."""
    try:
        candidates = extract_candidates(texts)
        if not candidates:
            return []
        return upsert_items(
            db,
            client_id=client_id,
            counselor_id=counselor_id,
            candidates=candidates,
            commit=commit,
        )
    except Exception:  # noqa: BLE001 — 프로파일 실패가 체크인 종료를 되돌리지 않는다
        logger.exception("[agent_profile] 프로파일 추출 실패 (client=%s)", client_id)
        return []


# ---------------------------------------------------------------------------
# 조회 · 상담사 편집
# ---------------------------------------------------------------------------


def serialize_item(item: AgentProfileItem) -> dict:
    """Contract(ProfileItem) 형태로 직렬화 — 근거는 개수만 노출한다(원문·id 비노출)."""
    return {
        "id": str(item.id),
        "category": item.category,
        "text": item.text,
        "status": item.status,
        "evidence_count": len(item.evidence or []),
        "updated_at": item.updated_at or item.created_at,
    }


def list_items(db: DBSession, counselor_id: UUID, client_id: UUID) -> list[dict]:
    """상담사 본인이 가진 해당 내담자 프로파일 — dismissed 는 제외한다(Contract)."""
    rows = (
        db.query(AgentProfileItem)
        .filter(
            AgentProfileItem.counselor_id == counselor_id,
            AgentProfileItem.client_id == client_id,
            AgentProfileItem.status != STATUS_DISMISSED,
        )
        .order_by(AgentProfileItem.category.asc(), AgentProfileItem.created_at.desc())
        .all()
    )
    return [serialize_item(item) for item in rows]

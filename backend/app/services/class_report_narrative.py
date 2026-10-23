"""SDD-237 상담사용 클래스 리포트의 서사 문장 — 규칙 사전 + 필드 상태 기계.

원칙(plan.md §4.5·§4.6, class-narrative.md §2·§4.2):
- 모든 숫자는 서버 통계에서 온다. 규칙 문장은 AI 없이도 화면이 완결되도록 항상 만든다(결정론).
- 판정어(좋아졌어요·개선·순위 등)를 쓰지 않고 방향어 사전만 쓴다. 결측·측정 1명 지표는 문장을 만들지 않는다.
- 필드 하나 = {rule_text, ai_draft, edited_text, source, ...}. 표시 문장은 수정본 > AI 초안 > 규칙 순.
- 상담사 수정본은 통계 재계산·AI 재실행·리포트 재생성으로 덮어쓰지 않는다(merge_fields).
- 이 모듈의 함수는 입력을 변경하지 않는다(새 dict 반환).
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Literal

from app.services.class_report_stats_service import METRIC_KEYS

logger = logging.getLogger(__name__)

PROMPT_VERSION = "cr-1"

# 필드별 글자 수 상한(plan.md §4.5). 상담사 수정 검증과 규칙 문장 길이 보장에 쓴다.
_MAX_LEN = {"headline": 200, "flow": 150, "body_subtitle": 150, "mind_subtitle": 150}
_METRIC_MAX_LEN = 100
_PARTICIPANT_MAX_LEN = 100

LABELS = {"respiration": "호흡수", "bpm": "심박수", "hrv": "심박 간격의 변화",
          "focus": "집중도", "relaxation": "이완도", "emotional": "감정균형도"}
_FLOW_LABELS = {**LABELS, "hrv": "HRV"}
_FLOW_VERB = {"up": "올랐어요", "down": "내려갔어요", "stable": "비슷했어요"}

# 지표 × 방향 어휘 사전(class-narrative §4.2). 해석·판정이 섞인 표현은 쓰지 않는다.
_PHRASE = {
    "focus": {"up": "집중 신호가 높아졌어요", "stable": "집중 신호가 비슷했어요", "down": "집중 신호가 낮아졌어요"},
    "relaxation": {"up": "이완 신호가 높아졌어요", "stable": "이완 신호가 비슷했어요", "down": "이완 신호가 낮아졌어요"},
    "emotional": {"up": "정서 안정 신호가 높아졌어요", "stable": "정서 안정 신호가 비슷했어요",
                  "down": "정서 안정 신호가 낮아졌어요"},
    "bpm": {"up": "심박이 빨라졌어요", "stable": "심박이 일정했어요", "down": "심박이 느려졌어요"},
    "respiration": {"up": "호흡이 빨라졌어요", "stable": "호흡이 고르게 유지됐어요", "down": "호흡이 느려졌어요"},
    "hrv": {"up": "심박 간격의 변화가 커졌어요", "stable": "심박 간격의 변화가 비슷했어요",
            "down": "심박 간격의 변화가 작아졌어요"},
}
_PARTICIPANT_PHRASE = {
    "focus": {"up": "집중 신호가 높아졌", "stable": "집중 신호가 비슷했", "down": "집중 신호가 낮아졌"},
    "relaxation": {"up": "이완 신호가 높아졌", "stable": "이완 신호가 비슷했", "down": "이완 신호가 낮아졌"},
    "emotional": {"up": "정서 안정 신호가 높아졌", "stable": "정서 안정 신호가 비슷했", "down": "정서 안정 신호가 낮아졌"},
    "bpm": {"up": "심박이 빨라졌", "stable": "심박이 일정했", "down": "심박이 느려졌"},
    "respiration": {"up": "호흡이 빨라졌", "stable": "호흡이 고르게 유지됐", "down": "호흡이 느려졌"},
    "hrv": {"up": "심박 간격의 변화가 커졌", "stable": "심박 간격의 변화가 비슷했", "down": "심박 간격의 변화가 작아졌"},
}
_MIND_LABEL = {"focus": "집중", "relaxation": "이완", "emotional": "정서 안정"}

_STATUS_HEADLINE = {
    "single": "측정은 1명이라 클래스 평균은 보여드리지 않아요. 참여자별 결과에서 확인해 주세요.",
    "unworn": "이번 수업은 LINK BAND 없이 진행됐어요. 참여 기록과 코멘트로 리포트를 이어갈 수 있어요.",
    "lost": "연결이 끊겨 이번 수업의 측정 데이터를 확인하지 못했어요.",
    "zero": "이번 수업에는 참석 기록이 없어요.",
    "pending": "수업 분석이 진행 중이에요. 완료되면 이 자리에 이야기가 채워져요.",
    "error": "요약을 불러오지 못했어요.",
}
_NO_STORY = "신호가 고르지 않아 이번 수업의 변화는 정리하지 못했어요."
_PARTIAL_NOTE = "전체 참석자를 대표하지는 않아요."
_LOST_NOTE = "일부 구간은 연결이 끊겨 제외됐어요."


# ───────────────────────── 필드 키 규칙 ─────────────────────────

def max_len_for(key: str) -> int:
    if key in _MAX_LEN:
        return _MAX_LEN[key]
    if key.startswith("participant."):
        return _PARTICIPANT_MAX_LEN
    return _METRIC_MAX_LEN


def is_editable_key(key: str) -> bool:
    """수정 가능한 서사 키: 한 줄·흐름·소제목 2개·지표 문장 6개·참여자 한 줄. 수치/그래프/상태 문구는 불가."""
    if key in _MAX_LEN:
        return True
    if key.startswith("metric."):
        return key[len("metric."):] in METRIC_KEYS
    if key.startswith("participant."):
        return len(key) > len("participant.")
    return False


# ───────────────────────── 한국어 보조 ─────────────────────────

def _has_batchim(word: str) -> bool:
    last = word.rstrip()[-1:]
    if "가" <= last <= "힣":
        return (ord(last) - 0xAC00) % 28 != 0
    return False


def _and(labels: list[str]) -> str:
    """'A', 'A과/와 B', 'A·B·C'."""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return labels[0] + ("과 " if _has_batchim(labels[0]) else "와 ") + labels[1]
    return "·".join(labels)


def _num(key: str, value: float) -> str:
    """마음 지표(%)는 정수, 몸 지표는 소수 한 자리(불필요한 .0 제거)."""
    if key in _MIND_LABEL:
        return str(round(value))
    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


# 단위 뒤에 붙는 '로/으로' — 읽는 소리의 받침 기준(퍼센트·엠에스=로, 회/분·비피엠=으로).
_UNIT_PARTICLE = {"%": "로", "회/분": "으로", "bpm": "으로", "ms": "로"}


# ───────────────────────── 규칙 문장 ─────────────────────────

def _dir(block: dict, key: str) -> str | None:
    m = (block.get("metrics") or {}).get(key) or {}
    return m.get("direction") if m.get("state") == "ok" else None


def _body_trend(block: dict) -> tuple[str | None, list[str]]:
    """몸 추세(relax/arouse/stable)와 대상 지표 — 호흡·심박만 본다. 엇갈리면 None."""
    keys = [k for k in ("respiration", "bpm") if _dir(block, k)]
    dirs = {_dir(block, k) for k in keys}
    if not keys or ({"up", "down"} <= dirs):
        return None, keys
    if "down" in dirs:
        return "relax", keys
    if "up" in dirs:
        return "arouse", keys
    return "stable", keys


def _mind_clause(block: dict) -> str | None:
    """집중·이완 신호의 후반 방향 절(끝맺음 형태). 엇갈리거나 없으면 None."""
    keys = [k for k in ("focus", "relaxation") if _dir(block, k)]
    if not keys:
        return None
    dirs = {_dir(block, k) for k in keys}
    if {"up", "down"} <= dirs:
        return None
    if "up" in dirs:
        moved = [_MIND_LABEL[k] for k in keys if _dir(block, k) == "up"]
        return f"{_and(moved)} 신호는 후반으로 갈수록 높아졌어요"
    if "down" in dirs:
        moved = [_MIND_LABEL[k] for k in keys if _dir(block, k) == "down"]
        return f"{_and(moved)} 신호는 후반에 낮아졌어요"
    return f"{_and([_MIND_LABEL[k] for k in keys])} 신호는 비슷하게 유지됐어요"


_BODY_TAIL = {  # (이어지는 형태, 끝맺음 형태)
    "relax": ("차분해지는 쪽으로 움직였고", "차분해지는 쪽으로 움직였어요"),
    "stable": ("비슷한 리듬을 유지했고", "비슷한 리듬을 유지했어요"),
    "arouse": ("조금 빨라졌고", "조금 빨라졌어요"),
}
_BODY_LABEL = {"respiration": "호흡", "bpm": "심박"}


def _headline(block: dict) -> str:
    status = block.get("status")
    if status in _STATUS_HEADLINE:
        return _STATUS_HEADLINE[status]
    scope = block.get("scope") or {}
    prefix = f"{scope.get('duration_min')}분 수업 동안 측정한 {scope.get('measured')}명의 "
    trend, body_keys = _body_trend(block)
    mind = _mind_clause(block)
    if trend and mind:
        text = f"{prefix}{_and([_BODY_LABEL[k] for k in body_keys])}이 {_BODY_TAIL[trend][0]}, {mind}."
    elif trend:
        text = f"{prefix}{_and([_BODY_LABEL[k] for k in body_keys])}이 {_BODY_TAIL[trend][1]}."
    elif mind:
        text = f"{prefix}{mind}."
    else:
        return _NO_STORY if status == "poor_signal" else f"{prefix.rstrip('의 ')}의 수업 흐름은 아래 카드에서 확인해 주세요."
    flags = block.get("flags") or []
    if status == "partial":
        text += f" {_PARTIAL_NOTE}"
    if "lost" in flags:
        text += f" {_LOST_NOTE}"
    return text


def _compared(block: dict, key: str) -> dict | None:
    m = (block.get("metrics") or {}).get(key) or {}
    if m.get("state") == "ok" and m.get("direction") and m.get("early") is not None and m.get("late") is not None:
        return m
    return None


def _change_score(key: str, m: dict) -> float:
    """지표 간 변화 크기 비교용 — 단위가 달라 임계 대비 배수로 정규화한다(순위 표시에는 쓰지 않는다)."""
    from app.services.class_report_stats_service import _attr_and_threshold

    threshold = _attr_and_threshold(key)[1]
    delta = abs(m["late"] - m["early"])
    if threshold is not None:
        return delta / threshold
    return (delta / abs(m["early"]) * 100 / 5) if m["early"] else 0.0


def _flow(block: dict) -> str | None:
    best = None
    for key in METRIC_KEYS:
        m = _compared(block, key)
        if m is None:
            continue
        score = _change_score(key, m)
        if best is None or score > best[0]:
            best = (score, key, m)
    if best is None:
        return None
    _, key, m = best
    unit = m.get("unit") or ""
    particle = _UNIT_PARTICLE.get(unit, "로")
    label = _FLOW_LABELS[key]
    return (f"{label}는 전반 {_num(key, m['early'])}{unit}에서 "
            f"후반 {_num(key, m['late'])}{unit}{particle} {_FLOW_VERB[m['direction']]}.")


def _items(block: dict, keys: tuple[str, ...]) -> list[str]:
    out = []
    for key in keys:
        m = _compared(block, key)
        if m:
            out.append(f"{LABELS[key]} {_num(key, m['early'])}→{_num(key, m['late'])}{m.get('unit') or ''}")
    return out


def _body_subtitle(block: dict) -> str | None:
    items = _items(block, ("respiration", "bpm", "hrv"))
    if not items:
        return None
    trend, _ = _body_trend(block)
    tail = _BODY_TAIL[trend][1] if trend else "지표마다 다르게 움직였어요"
    return f"{', '.join(items)}. 전반에서 후반으로 {tail}."


def _mind_subtitle(block: dict) -> str | None:
    items = _items(block, ("focus", "relaxation", "emotional"))
    if not items:
        return None
    keys = [k for k in ("focus", "relaxation", "emotional") if _compared(block, k)]
    dirs = {_dir(block, k) for k in keys}
    if dirs == {"stable"}:
        tail = "비슷하게 유지됐어요"
    elif dirs <= {"up", "stable"} and "up" in dirs:
        tail = f"후반으로 갈수록 {_and([_MIND_LABEL[k] for k in keys if _dir(block, k) == 'up'])} 신호가 높아졌어요"
    elif dirs <= {"down", "stable"} and "down" in dirs:
        tail = f"후반에 {_and([_MIND_LABEL[k] for k in keys if _dir(block, k) == 'down'])} 신호가 낮아졌어요"
    else:
        tail = "지표마다 다르게 움직였어요"
    return f"{', '.join(items)}. {tail}."


def _metric_sentence(key: str, direction: str) -> str:
    phrase = _PHRASE[key][direction]
    return phrase + "." if direction == "stable" else f"후반으로 갈수록 {phrase}."


def _participant_line(row: dict) -> str:
    state = row.get("state")
    if state == "unworn":
        return "측정 없이 참여했어요. 기록과 코멘트로 리포트가 이어져요."
    if state == "lost":
        return "연결이 끊겨 측정 구간을 확인하지 못했어요."
    if state != "measured":
        return "신호가 고르지 않아 계산하지 못한 지표가 있어요."
    dirs = {k: (row.get("metrics") or {}).get(k, {}).get("direction") for k in METRIC_KEYS}
    ordered = sorted((k for k in METRIC_KEYS if dirs[k]), key=lambda k: dirs[k] == "stable")[:3]
    if not ordered:
        return "전반과 후반을 비교하기에는 측정 시간이 짧았어요."
    phrases = [_PARTICIPANT_PHRASE[k][dirs[k]] for k in ordered]
    return "고 ".join(phrases) + "어요."


def build_rule_fields(block: dict) -> dict[str, str]:
    """블록(통계부)에서 필드별 규칙 문장을 만든다. 만들 근거가 없는 필드는 키를 생략한다."""
    fields: dict[str, str] = {"headline": _headline(block)}
    for key, text in (("flow", _flow(block)), ("body_subtitle", _body_subtitle(block)),
                      ("mind_subtitle", _mind_subtitle(block))):
        if text:
            fields[key] = text
    for key in METRIC_KEYS:
        m = _compared(block, key)
        if m:
            fields[f"metric.{key}"] = _metric_sentence(key, m["direction"])
    for row in block.get("participants") or []:
        fields[f"participant.{row['participant_id']}"] = _participant_line(row)
    return fields


# ───────────────────────── 필드 상태 기계 ─────────────────────────

Source = Literal["rule", "ai", "edited"]


def compute_input_hash(block: dict) -> str:
    """통계 입력 해시 — 수정본이 '수치가 바뀌기 전 문장'인지(stale) 판단하는 기준. 서사 영역은 제외."""
    core = {k: v for k, v in block.items() if k != "narrative"}
    raw = json.dumps(core, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def new_field(rule_text: str) -> dict:
    return {"rule_text": rule_text, "ai_draft": None, "ai_draft_input_hash": None,
            "edited_text": None, "edited_by": None, "edited_at": None, "edited_input_hash": None,
            "source": "rule"}


def resolve_text(field: dict) -> str:
    source = field.get("source")
    if source == "edited" and field.get("edited_text"):
        return field["edited_text"]
    if source == "ai" and field.get("ai_draft"):
        return field["ai_draft"]
    return field.get("rule_text") or ""


def is_stale(field: dict, current_hash: str) -> bool:
    return field.get("source") == "edited" and field.get("edited_input_hash") != current_hash


def merge_fields(previous: dict | None, new_rule_fields: dict[str, str], input_hash: str) -> dict:
    """통계 재계산 결과를 이전 필드에 합친다. 규칙 문장은 항상 최신, 수정본은 이월, AI 초안은 입력이 같을 때만 유지."""
    previous = previous or {}
    merged: dict[str, dict] = {}
    for key, rule_text in new_rule_fields.items():
        merged[key] = _carry(previous.get(key), rule_text, input_hash)
    for key, prev in previous.items():
        # 사라진 필드: 상담사가 고친 비참여자 문장은 보존(수치가 바뀌었음은 stale 로 알린다). 참여자 줄은 대상에서
        # 빠지면 함께 사라진다(제외된 참여자의 문장이 남지 않게).
        if key not in merged and prev.get("source") == "edited" and not key.startswith("participant."):
            merged[key] = _carry(prev, "", input_hash)
    return merged


def _carry(prev: dict | None, rule_text: str, input_hash: str) -> dict:
    field = new_field(rule_text)
    if not prev:
        return field
    edited = prev.get("source") == "edited" and prev.get("edited_text")
    ai_valid = prev.get("ai_draft") and prev.get("ai_draft_input_hash") == input_hash
    if edited or ai_valid:
        field.update(ai_draft=prev.get("ai_draft"), ai_draft_input_hash=prev.get("ai_draft_input_hash"))
    if edited:
        field.update(edited_text=prev["edited_text"], edited_by=prev.get("edited_by"),
                     edited_at=prev.get("edited_at"), edited_input_hash=prev.get("edited_input_hash"),
                     source="edited")
    elif ai_valid:
        field["source"] = "ai"
    return field


def present_field(key: str, field: dict, input_hash: str, names: dict[str, str] | None = None) -> dict:
    """저장 형태 → 응답 형태(표시 문장·출처·stale·max_len). 이름은 저장하지 않고 조회 시 매핑한다."""
    names = names or {}
    editor = field.get("edited_by")
    return {
        "text": resolve_text(field),
        "source": field.get("source", "rule"),
        "ai_draft": field.get("ai_draft"),
        "rule_text": field.get("rule_text"),
        "edited_text": field.get("edited_text"),
        "edited_by": editor,
        "edited_by_name": names.get(editor) if editor else None,
        "edited_at": field.get("edited_at"),
        "stale": is_stale(field, input_hash),
        "max_len": max_len_for(key),
    }


# ───────────────────────── 블록 조립 ─────────────────────────

def error_block() -> dict:
    """통계 계산이 실패했을 때의 블록. 리포트 상태는 바꾸지 않는다(S9)."""
    stub = {"schema_version": 1, "status": "error", "flags": [], "normalization_version": None,
            "scope": {"attended": 0, "measured": 0, "included": 0, "duration_min": 0,
                      "bucket_min": 5, "split_min": 0},
            "metrics": {}, "participants": []}
    stub["narrative"] = {"prompt_version": PROMPT_VERSION, "model": None, "input_hash": compute_input_hash(stub),
                         "generated_at": None, "ai_attempt": None,
                         "fields": {k: new_field(v) for k, v in build_rule_fields(stub).items()},
                         "fallback_fields": []}
    return stub


def build_block(db, session, previous: dict | None) -> dict:
    """통계 + 규칙 서사로 `content.class_report` 블록을 만든다. 이전 블록의 수정본·AI 이력은 이월한다."""
    from app.services import class_report_stats_service as stats

    block = stats.compute_class_stats(db, session)
    input_hash = compute_input_hash(block)
    prev_narr = (previous or {}).get("narrative") or {}
    block["narrative"] = {
        "prompt_version": PROMPT_VERSION,
        "model": prev_narr.get("model"),
        "input_hash": input_hash,
        "generated_at": prev_narr.get("generated_at"),
        "ai_attempt": prev_narr.get("ai_attempt"),
        "fields": merge_fields(prev_narr.get("fields"), build_rule_fields(block), input_hash),
        "fallback_fields": list(prev_narr.get("fallback_fields") or []),
    }
    return block

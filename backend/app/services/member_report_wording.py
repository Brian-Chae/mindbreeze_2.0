"""SDD-327 T4 — 회원 리포트 문장 규칙.

확정 시안 v11(sample 픽스처)의 결론·해석 문장을 규칙으로 재현한다. 입력 dict 는 바꾸지 않고 새 dict 를 돌려준다.

규칙 요약
- 방향(direction)·톤(tone): 지표별 임계(심박 3bpm·HRV 5ms·마음/움직임 변화율 5%)는 `direction_for_change`.
- 문장의 증감 표현은 변화량의 **부호**를 따른다. 임계 미만(stable)이어도 시안처럼 숨기지 않는다.
  단, 표시 자릿수에서 변화가 0이거나 변화율 5% 미만이면 "비슷했어요" 문장을 쓴다(`is_flat`).
- 반대 방향(기대 방향과 반대)도 같은 형식으로 정직하게 표기하고 `other_directions`·해당 지표 해석에 남긴다.
- 인과 단정("명상 때문에/덕분에") 금지, 점수·등급·좋음/나쁨 판정 금지. `assert_clean` 이 검사한다.
- 결측 지표(state=missing)는 문장을 만들지 않는다(쪽 자체가 생략됨).
"""

from __future__ import annotations

import copy
import re
from typing import Any, Mapping, Optional

from app.services import member_report_narrative as narr
from app.services.member_report_metrics import _DIRECTION_THRESHOLD
from app.services.report_narrative import direction_for_change as _base_direction

# ── 금지어·인과 단정 검사 ─────────────────────────────────────────
FORBIDDEN_WORDS: tuple[str, ...] = (
    "B5", "건강 수준", "점수", "등급", "스트레스", "우울", "진단합니다", "위험",
)
_CAUSAL = re.compile(r"명상\s*(?:때문|덕분)|덕분에|때문에\s*(?:심박|이완|집중|좋아|나아)")


def find_violations(text: str) -> list[str]:
    """금지어·인과 단정 표현 목록(없으면 빈 리스트)."""
    found = [w for w in FORBIDDEN_WORDS if w in text]
    found += [m.group(0) for m in _CAUSAL.finditer(text)]
    return found


def assert_clean(text: str) -> None:
    """금지어·인과 단정이 있으면 ValueError."""
    bad = find_violations(text)
    if bad:
        raise ValueError(f"금지 표현 포함: {bad}")


def _iter_strings(obj: Any):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, Mapping):
        for v in obj.values():
            yield from _iter_strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _iter_strings(v)


def assert_report_clean(report: Mapping[str, Any]) -> None:
    """리포트 전체 문자열에서 금지 표현 검사."""
    for s in _iter_strings(report):
        assert_clean(s)


# ── 방향·톤 규칙 ─────────────────────────────────────────────────
# 기대(차분) 방향 — 히어로 톤과 '반대 방향' 판정 기준. 없는 지표는 방향에 가치 판단을 두지 않는다.
CALM_DIRECTION: dict[str, Optional[str]] = {
    "heart_rate": "down", "rmssd": "up", "relaxation": "up", "motion": "down",
    "emotional_balance": "up", "focus": None, "lf_hf": None, "aperiodic": None,
}
FLAT_PCT = 5.0  # 변화율 이 값 미만이면 문장은 '비슷'


def direction_for_change(metric: str, before: Optional[float], after: Optional[float]) -> Optional[str]:
    """방향 임계 규칙(심박 3bpm·RMSSD/SDNN 5ms·그 외 변화율 5%) — 결측이면 None."""
    return _base_direction(before, after, _DIRECTION_THRESHOLD.get(metric))


def tone_for(metric: str, direction: str) -> str:
    return "calm" if CALM_DIRECTION.get(metric) == direction else "neutral"


def _sign(change: Mapping[str, Any]) -> str:
    """표시 자릿수 기준 부호 방향(up/down/flat)."""
    d = change["decimals"]
    delta = round(change["after"] - change["before"], d)
    if delta == 0:
        return "flat"
    before = change["before"]
    if before and abs(delta / before) * 100 < FLAT_PCT:
        return "flat"
    return "up" if delta > 0 else "down"


def _mag(change: Mapping[str, Any]) -> str:
    return f"{abs(change['delta']):.{change['decimals']}f}"


# ── 지표별 고정 문장 ─────────────────────────────────────────────
_READING_STD = (
    "이렇게 읽어요 · ‘통계로 보기’는 수업 전체의 분포, ‘시간으로 보기’는 시간 흐름이에요. "
    "개인 표시와 같은 수업의 기록을 함께 살펴봐요."
)
_SERIES_NOTE_LF = "출처: 서비스 저장 LF/HF 1분 값(보정 전). 같은 사람 안의 오르내림만 살펴봐요."

_BRIDGE = {
    "motion": "몸을 깨운 시간을 지나, 머무는 자세를 살펴봐요.",
    "heart_rate": "움직임이 잦아든 뒤, 심장의 속도는 어땠을까요.",
    "rmssd": "심장의 속도 옆에, 박동 사이의 작은 차이도 놓아 봐요.",
    "lf_hf": "작은 박동 차이에 이어, 비율의 오르내림을 살펴봐요.",
    "focus": "몸의 리듬에서, 마음에 머문 시간으로 이어가요.",
    "relaxation": "주의가 머문 시간 옆에, 편안함의 기억을 놓아 봐요.",
    "emotional_balance": "이완도 옆에, 감정의 균형도 함께 놓아 봐요.",
    "aperiodic": "마지막으로 뇌파의 전체 모양을 보고, 지금의 느낌으로 돌아와요.",
}
_BRIDGE_OPPOSITE = "모든 신호가 같은 방향은 아니었어요. 이 변화도 함께 남겨요."

_RESULT_NOTE = {
    "motion": "결과 해석 · 가속도 크기는 건강 척도가 아니에요. 몸 움직임 구간에서도 개인별 동작 크기와 밴드 착용 상태에 따라 달라질 수 있어요.",
    "heart_rate": "결과 해석 · 이 그래프는 서비스 1분 심박이에요. 앞쪽 척도의 5분 원시 맥파 재계산 심박과 산출 경로가 달라 직접 이어 붙이지 않아요.",
    "rmssd": "결과 해석 · 원시 맥파로 재계산한 1분 RMSSD예요. 건강 참고 척도는 별도로 계산한 안정된 5분 값에만 적용해요. 1분 값의 평균은 5분 RMSSD와 같지 않아요.",
    "lf_hf": "결과 해석 · 이 그래프는 보정 전 서비스 값으로, 탐색용이에요. 건강 판단·직접 비교에 쓰지 않아요. 낮음=휴식, 높음=긴장이라는 단순 해석도 하지 않아요.",
    "focus": "결과 해석 · 뇌파 서비스 지표에는 이 리포트에서 적용할 임상 표준 척도가 없어요. 같은 클래스 안에서만 비교하며 집중 능력을 평가하지 않아요.",
    "relaxation": "결과 해석 · 그룹 분포의 평균 ± 1SD는 이 클래스 안의 퍼짐이에요. 건강 정상 범위가 아니며 실제 느낌과 함께 살펴봐 주세요.",
    "emotional_balance": "결과 해석 · 감정 상태나 정신건강을 진단하는 값이 아니에요. 눈 움직임·이마 근육·착용 상태의 영향을 받을 수 있어요.",
    "aperiodic": "결과 해석 · 원시 뇌파 4초 창에서 재계산하고 신호 기준을 통과한 분만 표시해요. 절대적인 건강 기준이나 각성·이완의 확정 판정은 붙이지 않아요.",
}

_LF_CONCLUSION = "LF/HF는 전후 구간의 흐름만 살펴봐요"
_LF_INTERPRET = (
    "준비·호흡과 명상 후반의 배경을 나눠 같은 사람 안의 오르내림을 살펴봐요. 보정 전 서비스 값이어서 "
    "전후 변화량과 몸의 상태를 연결하지 않아요. 다음 수업에서도 호흡과 자세를 함께 기록해 흐름을 읽어 봐요."
)
_LF_READING = "절대값은 산출 방식 점검 중이라 변화 흐름만 보여요"


def _conclusion(key: str, ch: Mapping[str, Any]) -> str:
    s, m = _sign(ch), _mag(ch)
    if key == "motion":
        return {"down": f"밴드가 감지한 움직임은 {m} 줄었어요.", "up": f"밴드가 감지한 움직임은 {m} 늘었어요.",
                "flat": "밴드가 감지한 움직임은 비슷한 수준이었어요."}[s]
    if key == "heart_rate":
        return {"down": f"심장은 1분에 {m}회 더 천천히 뛰었어요.", "up": f"심장은 1분에 {m}회 더 빠르게 뛰었어요.",
                "flat": "심장의 속도는 비슷하게 이어졌어요."}[s]
    if key == "rmssd":
        return {"down": f"박동 사이의 미세한 변동은 {m}ms 줄었어요.", "up": f"박동 사이의 미세한 변동은 {m}ms 늘었어요.",
                "flat": "박동 사이의 미세한 변동은 비슷한 수준이었어요."}[s]
    if key == "focus":
        return {"down": f"집중도 지표는 시작보다 {m} 내려갔어요.", "up": f"집중도 지표는 시작보다 {m} 올라갔어요.",
                "flat": "집중도 지표는 시작과 비슷한 위치였어요."}[s]
    if key == "relaxation":
        return {"down": f"이완도 지표는 시작보다 {m} 낮아졌어요.", "up": f"이완도 지표는 시작보다 {m} 높아졌어요.",
                "flat": "이완도 지표는 시작과 비슷한 위치였어요."}[s]
    if key == "emotional_balance":
        return {"down": f"감정 균형도 지표는 이번에 {m} 내려갔어요.", "up": f"감정 균형도 지표는 이번에 {m} 올라갔어요.",
                "flat": "감정 균형도 지표는 시작과 비슷한 위치였어요."}[s]
    if key == "aperiodic":
        return {"down": f"뇌파 1/f 기울기는 {m} 낮아졌어요.", "up": f"뇌파 1/f 기울기는 {m} 높아졌어요.",
                "flat": "뇌파 1/f 기울기는 비슷한 수준이었어요."}[s]
    raise KeyError(key)


def _seg_value(body: Mapping[str, Any], seg: str) -> Optional[float]:
    for sv in body.get("my_segments") or []:
        if sv["segment_key"] == seg:
            return sv.get("value")
    return None


def _is_opposite(key: str, ch: Mapping[str, Any]) -> bool:
    calm = CALM_DIRECTION.get(key)
    s = _sign(ch)
    return calm is not None and s != "flat" and s != calm


def _relax_phrase(rel: Optional[Mapping[str, Any]]) -> Optional[str]:
    if rel is None:
        return None
    s = _sign(rel)
    return {"up": "이완도 상승", "down": "이완도 하락"}.get(s)


def _interpretation(key: str, body: Mapping[str, Any], rel: Optional[Mapping[str, Any]]) -> str:
    ch = body["change"]
    s = _sign(ch)
    if key == "motion":
        lead = {"down": "명상 후반에는 움직임이 잦아든 모습으로 읽을 수 있어요.",
                "up": "명상 후반에는 준비·호흡보다 움직임이 늘었어요. 자세를 바꾸거나 몸을 풀었을 수 있어요.",
                "flat": "명상 후반의 움직임은 준비·호흡과 비슷한 수준이었어요."}[s]
        zero = (f" 표시값 {ch['after']:.{ch['decimals']}f}이 미세한 움직임까지 전혀 없었다는 뜻은 아니에요."
                if s == "down" and round(ch["after"], ch["decimals"]) == 0 else "")
        return f"{lead}{zero} 그때 몸을 어떻게 놓고 있었는지 함께 떠올려 보세요."
    if key == "heart_rate":
        if s == "down":
            return ("명상 후반에는 시작보다 심박이 낮아졌어요. 몸이 차분해지는 방향의 변화로 읽을 수 있지만, "
                    "휴식·호흡·시간 경과도 함께 영향을 줄 수 있어요. 실제 편안함과 함께했는지는 그때의 느낌을 떠올려 보세요.")
        if s == "up":
            return ("명상 후반에는 시작보다 심박이 높아졌어요. 움직임·호흡·긴장 등 여러 조건이 함께 영향을 줄 수 있어 "
                    "이번 원인은 확인되지 않았어요. 그때의 느낌과 함께 읽어 보세요.")
        return ("명상 후반의 심박은 시작과 비슷한 수준이었어요. 휴식·호흡·시간 경과가 함께 영향을 줄 수 있어요. "
                "그때의 느낌과 함께 읽어 보세요.")
    if key == "rmssd":
        tail = "다음 수업에서도 같은 자세와 자연스러운 호흡으로 변화를 살펴봐요."
        if _is_opposite(key, ch):
            ref = _relax_phrase(rel) or "다른 지표"
            return (f"이번에는 {ref}과 다른 방향으로 움직였어요. 호흡·자세·맥박 검출 조건도 영향을 줄 수 있지만 "
                    f"이번 원인은 확인되지 않았어요. {tail}")
        if s == "flat":
            return f"박동 사이의 변동은 시작과 비슷한 수준이었어요. 호흡·자세·맥박 검출 조건도 함께 영향을 줘요. {tail}"
        return (f"박동 사이의 변동이 시작보다 커진 모습이에요. 호흡·자세·맥박 검출 조건도 함께 영향을 주므로 "
                f"한 번의 값으로 단정하지 않아요. {tail}")
    if key == "lf_hf":
        return _LF_INTERPRET
    if key == "focus":
        pos = {"up": "높은", "down": "낮은", "flat": "비슷한"}[s]
        return (f"명상 후반의 뇌파 서비스 지표가 준비·호흡보다 {pos} 위치에 있었어요." if s != "flat"
                else "명상 후반의 뇌파 서비스 지표가 준비·호흡과 비슷한 위치에 있었어요.") + \
            " 집중 능력이나 참여의 충실함을 뜻하지는 않아요. 주의가 어디에 머물렀는지 자신의 기억과 나란히 읽어 보세요."
    if key == "relaxation":
        if s == "up":
            first, second = _seg_value(body, "first_half"), _seg_value(body, "second_half")
            clause = ""
            if first is not None and second is not None and first > second:
                clause = (f" 다만 명상 전반 {first:.{ch['decimals']}f}에서 후반 {second:.{ch['decimals']}f}로는 내려가, "
                          "내내 상승한 것은 아니에요.")
            return f"명상 후반에도 준비·호흡보다 높은 위치에 머물렀어요.{clause} 몸을 편하게 놓았던 순간이 있었는지 함께 떠올려 보세요."
        if s == "down":
            return "명상 후반에는 준비·호흡보다 낮은 위치에 있었어요. 몸을 편하게 놓았던 순간이 있었는지 함께 떠올려 보세요."
        return "명상 후반의 이완도는 준비·호흡과 비슷한 위치에 있었어요. 몸을 편하게 놓았던 순간이 있었는지 함께 떠올려 보세요."
    if key == "emotional_balance":
        tail = "다음 수업에는 시작과 끝의 느낌도 짧게 적어 함께 살펴봐요."
        if _is_opposite(key, ch) and _relax_phrase(rel):
            ref = _relax_phrase(rel)
            return (f"{ref}과는 다른 방향이에요. 눈 움직임·이마 근육·착용 상태의 영향일 수도 있어 "
                    f"실제 기분 변화로 단정하지 않아요. {tail}")
        pos = {"up": "시작보다 높은 위치로 올라간 기록이에요.", "down": "시작보다 낮은 위치로 내려간 기록이에요.",
               "flat": "시작과 비슷한 위치에 머문 기록이에요."}[s]
        return f"{pos} 눈 움직임·이마 근육·착용 상태의 영향도 받을 수 있어 실제 기분 변화로 단정하지 않아요. {tail}"
    if key == "aperiodic":
        return ("뇌파의 전체 모양이 달라진 기록으로 읽어요. 이 값 하나로 각성이나 이완 상태를 확정하지 않아요. "
                "준비·호흡은 비교 가능한 5분만 포함하므로 앞의 지표들과 조건도 함께 살펴봐요.")
    raise KeyError(key)


def _apply_metric(key: str, body: dict[str, Any], rel: Optional[Mapping[str, Any]]) -> None:
    ch = body["change"]
    body["eyebrow"] = body["eyebrow"]  # 쪽 머리말은 집계 단계(T5) 소관 — 그대로 둔다
    if key == "lf_hf":
        body["conclusion"] = _LF_CONCLUSION
        body["reading"] = _LF_READING
        body["source_note"] = _SERIES_NOTE_LF
    else:
        body["conclusion"] = _conclusion(key, ch)
        body["reading"] = _READING_STD
    bridge = _BRIDGE[key]
    if key == "emotional_balance" and _is_opposite(key, ch):
        bridge = _BRIDGE_OPPOSITE
    body["bridge"] = bridge
    body["interpretation"] = _interpretation(key, body, rel)
    body["result_note"] = _RESULT_NOTE[key]


# ── 히어로 ───────────────────────────────────────────────────────
_ORDER = ("motion", "heart_rate", "rmssd", "lf_hf", "focus", "relaxation", "emotional_balance", "aperiodic")
_OTHER_LABEL = {"motion": "움직임", "heart_rate": "심박", "rmssd": "RMSSD", "relaxation": "이완도",
                "emotional_balance": "감정 균형도", "focus": "집중도", "aperiodic": "뇌파 1/f 기울기"}
_OTHER_UNIT = {"rmssd": "ms", "heart_rate": "회/분"}
_CAUTION = ("별도 사전 측정이 아닌 수업 안의 구간 중앙값 비교예요.\n"
            "명상만의 영향인지는 이 기록으로 확인할 수 없어요.")
_HEAD_HR = {"down": "심박은 내려가고,", "up": "심박은 올라가고,", "stable": "심박은 비슷하고,"}
_HEAD_RELAX = {"up": "이완도는 올라갔어요.", "down": "이완도는 내려갔어요.", "stable": "이완도는 비슷했어요."}
_HEAD_HR_END = {"down": "심박은 내려갔어요.", "up": "심박은 올라갔어요.", "stable": "심박은 비슷했어요."}


def _dir_of(ch: Optional[Mapping[str, Any]]) -> Optional[str]:
    """문장용 방향: 변화가 사실상 없으면 stable, 아니면 부호."""
    if ch is None:
        return None
    s = _sign(ch)
    return "stable" if s == "flat" else s


def _hero(report: dict[str, Any], changes: Mapping[str, Optional[Mapping[str, Any]]], worn: bool) -> None:
    hero = report["hero"]
    if not worn:
        hero["headline"] = "이번 수업에\n함께해 주셨어요."
        hero["lead"] = "밴드 없이 수업에 머문 시간을 기록으로 남겨요."
        hero["caution"] = None
        hero["other_directions"] = None
        return
    hr, rel = _dir_of(changes.get("heart_rate")), _dir_of(changes.get("relaxation"))
    if hr and rel:
        hero["headline"] = f"{_HEAD_HR[hr]}\n{_HEAD_RELAX[rel]}"
    elif hr:
        hero["headline"] = _HEAD_HR_END[hr]
    elif rel:
        hero["headline"] = _HEAD_RELAX[rel]
    else:
        hero["headline"] = "이번 수업의 변화를\n살펴봤어요."
    hero["lead"] = ("명상 후반, 몸이 차분해지는 방향의 변화가 관찰됐어요."
                    if (hr == "down" or rel == "up") else "명상 후반의 변화를 관찰한 그대로 보여 드려요.")
    hero["caution"] = _CAUTION if hero.get("pairs") else None

    items: list[str] = []
    for key in _ORDER:
        ch = changes.get(key)
        if ch is not None and key in _OTHER_LABEL and _is_opposite(key, ch):
            arrow = "↓" if ch["delta"] < 0 else "↑"
            items.append(f"{_OTHER_LABEL[key]} {arrow}{_mag(ch)}{_OTHER_UNIT.get(key, '')}")
    hero["other_directions"] = (
        "함께 볼 변화 · " + " · ".join(items) + "\n서로 다른 방향도 있었어요. 각 장에서 함께 살펴봐요."
        if items else None
    )


# ── 공개 진입점 ──────────────────────────────────────────────────
def apply_wording(report: Mapping[str, Any], ai_text: Optional[str] = None) -> dict[str, Any]:
    """문장 규칙을 적용한 새 리포트 dict. 입력은 바꾸지 않는다.

    `ai_text`: AI(Gemini) 종합 소견 응답 JSON 문자열(호출자가 주입, 기본 None=off).
    검증(금지어·인과·사실 외 숫자)을 통과하면 opinion.narrative 만 source="ai" 로 대체, 아니면 규칙 문장 유지.
    """
    out = copy.deepcopy(dict(report))
    worn = (out.get("meta") or {}).get("band_status") != "not_worn"

    changes: dict[str, Optional[dict[str, Any]]] = {}
    for key, sec in (out.get("metrics") or {}).items():
        body = sec.get("body") if sec.get("state") == "ok" else None
        changes[key] = body["change"] if body else None

    rel = changes.get("relaxation")
    for key, sec in (out.get("metrics") or {}).items():
        if sec.get("state") == "ok" and sec.get("body"):
            _apply_metric(key, sec["body"], rel)

    _hero(out, changes, worn)

    directions = {k: _dir_of(c) for k, c in changes.items()}
    out["opinion"]["narrative"] = narr.build_opinion_narrative(out, directions)
    if ai_text is not None:
        ai = narr.merge_ai_narrative(out, ai_text, check=assert_clean)
        if ai is not None:
            out["opinion"]["narrative"] = ai
    out["next_steps"] = narr.build_next_steps(out)
    return out

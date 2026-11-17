"""SDD-328 B2 — 회원 리포트 v2 문장 틀(규칙 기반, AI 호출 없음, 결정적 출력).

용어 대응(spec §3.2): 큰 글씨에는 전문 용어(RMSSD·SDNN·HRV·LF/HF·PRV·심박수)를 쓰지 않고 원어는 각주(`footnote`)에만 둔다.
시안 `build.py` 의 문장을 규칙으로 옮긴 것이며, 금지어 검사는 v1 `assert_report_clean` 을 재사용한다.
"""

from __future__ import annotations

from typing import Optional

from app.services.member_report_wording import assert_report_clean, find_violations  # noqa: F401  (재사용)

TITLE = {
    "motion": "몸이 움직인 정도", "heart_rate": "1분 동안 뛴 횟수", "rmssd": "심장 리듬의 여유",
    "lf_hf": "긴장과 휴식의 균형", "focus": "집중도", "relaxation": "이완도", "emotional_balance": "감정 균형도",
    "aperiodic": "뇌파 1/f 기울기",
}
CHAPTER = {"motion": "body", "heart_rate": "body", "rmssd": "body", "lf_hf": "body", "focus": "mind",
           "relaxation": "mind", "emotional_balance": "mind", "aperiodic": "mind"}
UNIT = {"motion": "가속도 크기", "heart_rate": "회/분", "rmssd": "%", "lf_hf": "방향", "focus": "지표",
        "relaxation": "지표", "emotional_balance": "지표", "aperiodic": "지표"}
DECIMALS = {"motion": 3, "heart_rate": 1, "rmssd": 1, "lf_hf": 2, "focus": 1, "relaxation": 1,
            "emotional_balance": 1, "aperiodic": 1}
_JOSA = {"motion": "가", "heart_rate": "가", "rmssd": "가", "lf_hf": "가", "focus": "는", "relaxation": "는",
         "emotional_balance": "는", "aperiodic": "는"}
_PAIR_NAME = {"heart_rate": "1분 동안 뛴 횟수", "relaxation": "이완도", "motion": "몸이 움직인 정도", "focus": "집중도"}
_PAIR_UNIT = {"heart_rate": "회/분", "relaxation": "지표", "motion": "가속도 크기", "focus": "지표"}
_CALM_DIR = {"heart_rate": "down", "relaxation": "up", "motion": "down"}  # 집중도는 가치 판단 없음 → neutral

QUIET_NOTE = "움직임이 가장 적었던 연속 5분을 찾았어요. 실제로 편안했는지는 그때의 느낌과 함께 확인해 주세요."
SETTLE_NOTE = "첫 2분은 밴드 안착 시간으로 비교에서 제외했어요. 수업 전후에 따로 측정한 결과가 아닌, 수업 안의 변화예요."
FEEL_TITLE = "숫자와 느낌을 함께 읽어요"
FEEL_BODY = ("움직임이 적었다는 사실만으로 편안함이 확인되지는 않아요. 그때 어떤 자세로 쉬었는지, "
             "호흡이 어땠는지 함께 떠올려 보세요.")

EXPLAIN = {
    "motion": "밴드가 감지한 움직임 크기예요. 작은 값은 몸이나 밴드가 덜 움직였다는 뜻이에요. 편안함은 그때의 느낌과 함께 살펴봐요.",
    "heart_rate": "1분 동안 심장이 뛴 횟수예요. 호흡과 자세, 움직임에 따라 달라져요. 횟수가 줄었다면 몸이 차분해진 순간과 겹쳤는지 떠올려 보세요.",
    "rmssd": ("박동과 박동 사이 간격이 자연스럽게 달라지는 정도예요. 박동 사이 간격이 조금 더 다양해졌다면 몸이 쉬는 흐름과 "
              "함께 나타날 수 있어요. 변화 방향을 중심으로 읽어요."),
    "lf_hf": ("심장 박동 사이 간격의 느린 변화와 빠른 변화를 나란히 본 흐름이에요. 이 선 하나만으로 긴장이나 휴식의 정도를 "
              "정할 수는 없어요. 호흡과 움직임, 실제 느낌을 함께 살펴봐요."),
    "focus": "주의가 한곳에 머무는 모습을 뇌파에서 살펴보는 지표예요. 높아졌다는 사실이 집중 능력이나 수업 참여의 충실함을 뜻하지는 않아요.",
    "relaxation": "뇌파에서 편안히 쉬는 흐름을 살펴보는 지표예요. 수치의 변화와 실제 편안함이 항상 같지는 않아요. 그때의 경험과 나란히 읽어 주세요.",
    "emotional_balance": "뇌파에서 마음의 흐름을 살펴보는 지표예요. 이 값만으로 기분이나 평소 성향을 알 수는 없어요. 다른 지표와 반대 방향으로 바뀌어도 함께 남겨요.",
    "aperiodic": "뇌파 전체의 모양을 살펴보는 지표예요. 이 값만으로 상태를 판단하지 않고, 앞의 지표들과 함께 읽어요.",
}
READING_STD = "위 그래프는 시간이 지나며 달라진 모습, 아래 분포는 수업 전체에서 값이 머문 위치예요."
READING_LF = "한 가지 흐름만으로 휴식 여부를 정하지 않고 다른 신호와 느낌을 함께 살펴봐요."
READING_NO_GROUP = "위 그래프는 시간이 지나며 달라진 모습이에요. 그룹 비교는 같은 수업 참여자가 충분할 때만 보여 드려요."
SERIES_LEGEND = "━ 나 · ┄ 그룹 평균 / 띠: 그룹 평균 ±1 표준편차 · 회색 배경: 첫 2분 · 기록이 없는 분은 선을 끊었어요"
SERIES_LEGEND_NO_GROUP = "━ 나 · 회색 배경: 첫 2분 · 기록이 없는 분은 선을 끊었어요"
SERIES_LEGEND_LF = "━ 나의 상대 흐름 · 세로축 숫자와 그룹 비교는 생략했어요"
FOOT_GROUP = "그룹 평균선과 띠는 유효 인원 10명 이상인 분만 표시해요. 평균−표준편차가 0 아래로 내려가도 실제 음수 기록을 뜻하지는 않아요."
FOOT_NO_GROUP = "같은 수업 참여자가 10명 미만인 분은 평균선과 띠를 그리지 않았어요."
FOOT_RMSSD = ("원어: RMSSD(박동 간격 변화) · 이마 맥파에서 계산한 값으로 심전도와 같은 측정이 아니에요. "
              "처음 5분을 0%로 둔 상대 변화만 표시해요.")
FOOT_SDNN = "원어: SDNN(박동 간격 전체 변화) · 이마 맥파에서 계산한 값이에요. 처음 5분을 0%로 둔 상대 변화만 표시해요."
FOOT_LF = "원어: LF/HF · 보정 전 값의 로그 변환 흐름이에요. 절대값과 그룹 비교는 표시하지 않아요."
FOOT_REL_AXIS = ("세로축과 분포축은 회원님의 처음 5분을 0%로 둔 상대 변화예요. 모든 사람에게 같은 기준값을 적용했으며, "
                 "다른 사람 자신의 시작 대비 변화율은 아니에요.")
GROUP_TITLE = "통계로 보기 · 같은 수업의 기록과 함께"
GROUP_LEGEND = "회색 띠는 전체 분포의 평균 ±1 표준편차 · 서로 얼마나 다른지를 보여줘요."
SHORT_NOTE = "측정 시간이 짧아 처음과 마지막의 전후 비교는 담지 않았어요. 안착 이후 평균과 시간 흐름만 보여 드려요."


def fmt(key: str, v: Optional[float]) -> str:
    return "—" if v is None else f"{v:.{DECIMALS[key]}f}"


def direction_abs(key: str, delta: float) -> str:
    if round(abs(delta), DECIMALS[key]) == 0:
        return "stable"
    return "up" if delta > 0 else "down"


def direction_pct(pct: float) -> str:
    if round(abs(pct), 1) == 0:
        return "stable"
    return "up" if pct > 0 else "down"


def direction_flow(before: float, after: float) -> str:
    d = after - before
    if abs(d) / max(abs(before), 1e-9) < 0.05:
        return "stable"
    return "up" if d > 0 else "down"


def change_sentence(key: str, kind: str, direction: str, delta: Optional[float] = None,
                    pct: Optional[float] = None) -> str:
    """지표 하나의 변화 한 문장(쉬운 말)."""
    name, josa = TITLE[key], _JOSA[key]
    if kind == "flow":
        verb = {"down": "낮아졌어요.", "up": "높아졌어요.", "stable": "비슷했어요."}[direction]
        return "수업 뒤로 갈수록 리듬의 흐름이 " + verb
    if direction == "stable":
        return f"{name}{'는' if josa == '는' else '는'} 처음과 마지막이 비슷했어요."
    if kind == "pct":
        return f"{name}{josa} {abs(pct or 0):.1f}% {'늘었어요' if direction == 'up' else '줄었어요'}."
    unit = UNIT[key]
    unit_txt = "" if unit == "지표" else f" {unit}"
    return f"{name}{josa} {abs(delta or 0):.{DECIMALS[key]}f}{unit_txt} {'높아졌어요' if direction == 'up' else '낮아졌어요'}."


def bridge(first_label: str, last_label: str) -> str:
    return f"처음 5분({first_label})과 마지막 5분({last_label})을 비교했어요."


def comparison_text(key: str, kind: str, before: Optional[float], after: Optional[float],
                    pct: Optional[float]) -> str:
    if kind == "pct":
        return f"처음 5분 대비 마지막 5분 · {pct:+.1f}%"
    if kind == "flow":
        return "처음과 마지막 5분의 중앙값으로 흐름 방향만 살펴봐요"
    return f"처음 5분 → 마지막 5분 · {fmt(key, before)} → {fmt(key, after)} {UNIT[key]}"


def group_paragraphs(n_people: int) -> list[str]:
    return ["막대는 나의 매분 값, 곡선은 같은 수업 참여자들의 매분 값 분포예요. 실선은 나의 평균, 점선은 그룹 평균이에요.",
            f"그룹에는 회원님을 제외한 {n_people}명이 포함돼요. 기록이 긴 사람은 전체 분포에 더 많이 반영돼요."]


def companion_body(hr_sentence: Optional[str], relax_sentence: Optional[str]) -> str:
    parts = [s for s in (hr_sentence, relax_sentence) if s]
    lead = (" ".join(parts) + " ") if parts else ""
    return lead + "이 변화들이 실제 편안함과 함께했는지는 회원님의 기억으로 확인해 주세요."


# ── 히어로·종합 의견 ──────────────────────────────────────────────
def pair_change_text(delta: float, direction: str, decimals: int) -> str:
    mag = f"{abs(delta):.{decimals}f}"
    return {"down": f"↓ {mag} 감소", "up": f"↑ {mag} 상승", "stable": f"→ {mag} 비슷"}[direction]


def pair_tone(key: str, direction: str) -> str:
    return "calm" if _CALM_DIR.get(key) == direction else "neutral"


def pair_meta(key: str) -> tuple[str, str]:
    return _PAIR_NAME[key], _PAIR_UNIT[key]


def hero_headline(hr_dir: Optional[str], relax_dir: Optional[str], worn: bool, short: bool) -> str:
    if not worn:
        return "이번에는 밴드 기록이\n없어요."
    if short:
        return "짧은 시간의\n몸과 마음을 담았어요."
    hr_txt = {"down": "천천히 뛰고", "up": "더 자주 뛰고", "stable": "비슷하게 뛰고"}.get(hr_dir or "")
    rel_txt = {"up": "올라갔어요", "down": "내려갔어요", "stable": "비슷했어요"}.get(relax_dir or "")
    if hr_txt and rel_txt:
        return f"심장은 {hr_txt},\n이완도는 {rel_txt}."
    if hr_txt:
        return f"심장은 {hr_txt.replace('고', '었어요')}."
    if rel_txt:
        return f"이완도는 {rel_txt}."
    return "수업 안에서 몸과 마음의\n흐름을 담았어요."


def hero_lead(worn: bool, short: bool) -> str:
    if not worn:
        return "밴드를 착용하지 않아 수업 참여 기록만 담았어요."
    if short:
        return "측정이 짧아 전후 비교 없이 평균과 흐름만 담았어요."
    return "수업의 처음과 끝에서 몸과 마음의 흐름이 달라졌어요."


def quiet_title(when: str, start_label: int, end_label: int) -> str:
    return f"{when}({start_label}~{end_label}분) 가장 편안했던 5분을 찾았어요."


def observations(hr: Optional[str], relax: Optional[str], emotion: Optional[str], rmssd: Optional[str],
                 cross: int, quiet: Optional[str], hr_q: Optional[float], rel_q: Optional[float]) -> list[dict[str, str]]:
    first = " ".join(s for s in (hr, relax) if s)
    if cross:
        first = (first + " " if first else "") + (f"직전 분보다 심장이 천천히 뛰고 이완도가 올라간 순간은 {cross}분 있었어요. "
                                                 "두 변화가 함께 나타났지만 원인과 결과를 뜻하지는 않아요.")
    elif first:
        first += " 두 변화가 함께 나타났는지는 그래프에서 확인해 주세요. 원인과 결과를 뜻하지는 않아요."
    else:
        first = "이번 기록에서는 심장과 이완도의 변화를 비교할 만큼 신호가 충분하지 않았어요."
    second_head = " ".join(s for s in (emotion, rmssd) if s)
    second = (second_head + " " if second_head else "") + "모든 신호가 같은 방향으로 바뀌지는 않았어요. 호흡, 자세, 그날의 느낌도 함께 떠올려 보세요."
    if quiet:
        bits = []
        if hr_q is not None:
            bits.append(f"그때 1분 동안 뛴 횟수는 {hr_q:.1f}회" + (f", 이완도는 {rel_q:.1f}였어요." if rel_q is not None else "였어요."))
        third = quiet + " " + " ".join(bits + [QUIET_NOTE]) if bits else quiet + " " + QUIET_NOTE
        third = third.replace("  ", " ")
    else:
        third = "이번 수업에서는 가장 편안했던 5분 후보를 고르지 못했어요. 움직임과 심장 기록이 함께 있는 연속 5분이 필요해요."
    return [
        {"title": "01 / 몸이 차분해진 순간을 살펴봐요", "body": first},
        {"title": "02 / 서로 다른 변화도 함께 남겨요", "body": second},
        {"title": "03 / 편안했던 순간을 기억해요", "body": third},
    ]


def next_step_items(hr: Optional[str], relax: Optional[str], emotion: Optional[str]) -> list[dict[str, str]]:
    a = " ".join(s for s in (hr, relax) if s)
    return [
        {"title": "이번에 살펴본 변화",
         "body": (a + " " if a else "") + "이 변화와 편안함이 함께했는지 자신의 기억으로 확인해 주세요."},
        {"title": "함께 남겨 둘 느낌",
         "body": (emotion + " " if emotion else "") + "숫자와 실제 기분이 달랐다면 그 차이도 소중한 기록이에요."},
        {"title": "다음 수업에서 해 볼 것",
         "body": "시작 전 수면과 피로, 마친 뒤의 편안함을 한 문장으로 적어 보세요. 비슷한 자세와 자연스러운 호흡으로 기록하면 비교에 도움이 돼요."},
    ]


def quiet_item_hr(hr_median: float, delta: Optional[float]) -> dict:
    if delta is None:
        body = "처음 5분 기록이 없어 비교하지 않았어요."
    elif round(abs(delta), 1) == 0:
        body = "처음 5분과 비슷했어요."
    else:
        body = f"처음 5분보다 {abs(delta):.1f}회/분 {'줄었어요' if delta < 0 else '늘었어요'}."
    return {"title": TITLE["heart_rate"], "value_text": f"{hr_median:.1f} 회/분", "body": body, "footnote": None}


def quiet_item_pct(key: str, pct: float) -> dict:
    title = "심장 리듬의 여유" if key == "rmssd" else "심장 리듬의 여유 · 전체 흐름"
    body = ("처음 5분과 비교한 변화예요. 박동 사이 간격이 자연스럽게 달라지는 흐름을 살펴봐요." if key == "rmssd"
            else "처음 5분과 비교한 변화예요. 수업 중 박동 간격이 전체적으로 얼마나 다양했는지 살펴봐요.")
    word = "증가" if pct > 0 else "감소"
    return {"title": title, "value_text": f"{abs(pct):.1f}% {word}", "body": body,
            "footnote": FOOT_RMSSD if key == "rmssd" else FOOT_SDNN}


METHOD_REFS = [
    "Shaffer & Ginsberg(2017). 심박 변이 지표의 개요와 규준.",
    "Billman(2013). 자율신경 균형 해석의 한계.",
    "PPG 측정 위치·표본화 주파수 연구(2024), PMID 38610260.",
]


def method_paragraphs(group_n: Optional[int], short: bool) -> list[str]:
    grp = (f"회원님을 제외한 {group_n}명의 개인별 값을 먼저 변환한 뒤, 매분 산술평균과 모집단 표준편차를 계산해요. "
           "유효 인원 10명 이상인 분만 평균선과 띠를 표시해요." if group_n else
           "같은 수업 참여자가 충분하지 않으면 그룹 평균과 띠를 보여 드리지 않아요.")
    quiet = ("가장 편안했던 5분은 첫 2분 이후 움직임과 심장 기록이 모두 있는 연속 5분 중 움직임 평균이 가장 작은 때를 골라요. "
             "같으면 1분 동안 뛴 횟수의 중앙값이 작은 때, 다시 같으면 이른 때를 골라요. 실제 편안함을 확정하지는 않아요.")
    read = ("이마 맥파와 심전도는 같은 측정이 아니에요. 호흡, 움직임, 밴드 착용 상태의 영향을 받아요. "
            "한 번의 기록으로 평소 몸 상태를 판단하지 않아요.")
    return [read] if short else [grp, quiet, read]


def method_body(first_label: Optional[str], last_label: Optional[str]) -> str:
    if first_label is None or last_label is None:
        return "안착 시간(첫 2분)을 제외하고 남은 기록의 평균과 시간 흐름을 보여 드려요. 빈 분은 보간하지 않아요."
    return (f"첫 2분을 제외하고 처음 5분({first_label})과 마지막 5분({last_label})의 분별 중앙값을 비교해요. "
            "제공된 유효 기록만 사용하며 빈 분은 보간하지 않아요.")


METHOD_FOOTNOTE = ("심장 리듬의 여유(RMSSD·SDNN)는 상대 변화만 표시했어요. LF/HF는 절대값·참고 범위·그룹 비교를 생략했어요. "
                   "원어와 계산 근거는 각주에만 남겼어요.")


def clean_check(report_dict: dict) -> None:
    """금지어·인과 단정·'불규칙' 검사(v1 규칙 재사용 + v2 추가)."""
    assert_report_clean(report_dict)
    import json
    if "불규칙" in json.dumps(report_dict, ensure_ascii=False):
        raise ValueError("금지 표현 포함: 불규칙")

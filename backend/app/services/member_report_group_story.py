"""SDD-329 D — 본인 측정이 없는 회원(밴드 미착용·연결 실패)용 그룹 기록 기반 서사.

대표 결정(11/19): "본인의 데이터는 아니지만 이번 수업에서 우리는 이런 과정을 경험했습니다" 수준으로 리포트를 제공한다.
- 입력은 같은 회차 다른 참여자의 분 시계열뿐이다. 집계(매분 가운데 값)만 쓰고 개인 값·ID 는 담지 않는다.
- 그룹 유효 인원 < MIN_GROUP_N 이면 그래프·숫자·방향 문장 없이 수업 과정 서사만 둔다(`chart_hidden_reason="min_n"`).
- 규칙·문장 틀만 쓴다(AI 호출 없음). 점수·등급·종합점수·개인 비교 표현 없음, 첫머리는 항상 "그룹 기록".
"""

from __future__ import annotations

import math
import statistics
from typing import Mapping, Optional, Sequence

from app.schemas.member_report import MIN_BAND_N, MIN_GROUP_N, Segment
from app.services.member_report_group import valid_people
from app.services.member_report_metrics import Minutes, PersonMinutes, axis_range, segment_median

GROUP_LABEL = "그룹 기록"
STORY_TITLE = "그룹 기록으로 돌아보는 수업"

_CHARTS: tuple[tuple[str, str, str], ...] = (
    ("heart_rate", "그룹이 1분 동안 뛴 횟수 · 가운데 값", "회/분"),
    ("relaxation", "그룹의 이완도 지표 · 가운데 값", "지표"),
    ("focus", "그룹의 집중도 지표 · 가운데 값", "지표"),
)
_HR_THRESHOLD = 3.0  # 1분 동안 뛴 횟수 변화 임계(회) — 기존 방향 규칙과 같은 값
_PCT_THRESHOLD = 5.0  # 그 외 지표 변화율 임계(%)


def group_extent(others: Mapping[str, PersonMinutes]) -> Optional[tuple[int, int]]:
    """그룹(다른 참여자) 실제 측정 범위(첫~끝 유효 분). 구간 분할에 쓴다."""
    ms = [m for pm in others.values() for k in ("heart_rate", "motion") for m, v in pm.get(k, {}).items()
          if isinstance(v, (int, float)) and math.isfinite(v)]
    return (min(ms), max(ms)) if ms else None


def _median_by_minute(people: Mapping[str, Minutes], first: int, last: int) -> list[Optional[float]]:
    out: list[Optional[float]] = []
    for minute in range(first, last + 1):
        vals = [float(m[minute]) for m in people.values()
                if minute in m and isinstance(m[minute], (int, float)) and math.isfinite(m[minute])]
        out.append(round(statistics.median(vals), 3) if len(vals) >= MIN_BAND_N else None)
    return out


def _direction(key: str, before: Optional[float], after: Optional[float]) -> Optional[str]:
    if before is None or after is None:
        return None
    delta = after - before
    if key == "heart_rate":
        return "flat" if abs(delta) < _HR_THRESHOLD else ("up" if delta > 0 else "down")
    pct = abs(delta / before) * 100 if before else 0.0
    return "flat" if pct < _PCT_THRESHOLD else ("up" if delta > 0 else "down")


def build_group_story(others: Mapping[str, PersonMinutes], segments: Sequence[Segment], first: int, last: int) -> dict:
    """GroupStory 계약 dict. `others` = 같은 회차 리포트 반영 참여자(나 제외)의 분 시계열."""
    seg = {s.key: s for s in segments}
    charts: list[dict] = []
    flows: dict[str, tuple[Optional[float], Optional[float]]] = {}
    n_people = 0
    for key, title, unit in _CHARTS:
        people = valid_people({pid: pm.get(key, {}) for pid, pm in others.items()}, first, last)
        if len(people) < MIN_GROUP_N:
            continue
        values = _median_by_minute(people, first, last)
        present = [v for v in values if v is not None]
        if not present:
            continue
        lo, hi = axis_range(present, floor_zero=True)
        charts.append(dict(key=key, title=title, unit_label=unit, minutes=list(range(first, last + 1)),
                           values=values, axis_min=lo, axis_max=hi))
        n_people = max(n_people, len(people))
        series = {m: v for m, v in zip(range(first, last + 1), values) if v is not None}
        flows[key] = (segment_median(series, seg["prep"]), segment_median(series, seg["second_half"]))

    paragraphs = [
        "이 쪽은 회원님의 측정 기록이 아니라, 이번 수업에 함께한 그룹의 기록이에요. 회원님의 몸과 마음 수치는 담지 않았고, "
        "이번 수업에서 우리는 이런 과정을 함께 경험했어요.",
        "수업은 준비하며 호흡을 살피는 시간으로 시작해 몸을 움직이는 시간을 지나, 명상 전반과 후반의 고요한 시간으로 "
        "이어졌어요.",
    ]
    if charts:
        paragraphs.append(f"측정에 함께한 그룹 {n_people}명의 기록을 모아 보면 다음과 같은 흐름이 있었어요.")
        hr = flows.get("heart_rate")
        if hr and hr[0] is not None and hr[1] is not None:
            d = _direction("heart_rate", hr[0], hr[1])
            verb = {"down": "내려왔어요", "up": "올라갔어요", "flat": "비슷하게 이어졌어요"}[d or "flat"]
            paragraphs.append(
                f"그룹이 1분 동안 뛴 횟수의 가운데 값은 준비·호흡 때 약 {hr[0]:.0f}회에서 명상 후반 약 {hr[1]:.0f}회로 {verb}.")
        for key, name in (("relaxation", "이완도 지표"), ("focus", "집중도 지표")):
            f = flows.get(key)
            if f and f[0] is not None and f[1] is not None:
                d = _direction(key, f[0], f[1])
                phrase = {"down": "수업 후반에 낮아졌어요", "up": "수업 후반에 높아졌어요",
                          "flat": "수업 내내 비슷한 위치였어요"}[d or "flat"]
                paragraphs.append(f"그룹의 {name}는 가운데 값 기준으로 {phrase}.")
        chart_note = "그룹 가운데 값만 보여 줘요. 한 사람의 기록이 아니며, 회원님의 수치와 비교하지 않아요."
    else:
        chart_note = None
        paragraphs.append("이번에는 그룹의 측정 인원이 적어 흐름 그래프는 담지 않았어요. 수업 과정을 글로만 남겨요.")
    paragraphs.append("그때 몸이 어떻게 느껴졌는지, 어떤 장면이 마음에 머물렀는지는 회원님의 기억과 함께 읽어 주세요.")

    return dict(
        label=GROUP_LABEL, title=STORY_TITLE, paragraphs=paragraphs,
        n_people=n_people if charts else None, charts=charts,
        chart_hidden_reason=None if charts else "min_n", chart_note=chart_note,
    )

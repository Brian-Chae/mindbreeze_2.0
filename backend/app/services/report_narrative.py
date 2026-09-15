"""SDD-045: 원천 지표 변화와 결측을 보존하는 서사 입력/규칙 폴백."""
from app.services.eeg_metrics import mean

METRICS = {
    "body": {"respiratory_rate": ("respiratory_rate", 1), "heart_rate": ("heart_rate", 3),
             "hrv": ("sdnn", 5)},
    "mind": {"focus": ("focus_index", None), "relaxation": ("relaxation_index", None),
             "emotional_stability": ("emotional_stability", None)},
}
LABELS = {"respiratory_rate": "호흡수", "heart_rate": "심박수", "hrv": "HRV(SDNN)",
          "focus": "집중 지표", "relaxation": "이완 지표", "emotional_stability": "감정안정 지표"}


def build_metrics_summary(windows: list, session_status: str) -> dict:
    """시간 범위의 중간을 기준으로 나누며, 지표별 결측 제거는 분할 후 수행한다.

    몸 지표는 EEG 품질과 독립적이다. 여러 참가자를 한 사람의 전후 변화로
    해석하지 않도록 혼합 집계에서는 방향을 산출하지 않는다.
    """
    midpoint = ((min(w.window_index for w in windows) + max(w.window_index for w in windows)) / 2
                if windows else 0)
    mixed = len({getattr(w, "participant_id", None) for w in windows}) > 1
    halves = ([w for w in windows if w.window_index < midpoint],
              [w for w in windows if w.window_index >= midpoint])
    result = {"session_status": session_status, "body": {}, "mind": {}}
    for group, mapping in METRICS.items():
        for key, (attr, threshold) in mapping.items():
            early, late = [mean([getattr(w, attr, None) for w in half
                                if not mixed and (group == "body" or (
                                    session_status in ("valid", "degraded")
                                    and w.quality in ("valid", "degraded")))]) for half in halves]
            delta = late - early if early is not None and late is not None else None
            pct = delta / abs(early) * 100 if delta is not None and early != 0 else None
            direction = None
            if delta is not None:
                stable = (abs(delta) < threshold if threshold is not None else
                          (abs(pct) < 5 if pct is not None else delta == 0))
                direction = "stable" if stable else ("up" if delta > 0 else "down")
            result[group][key] = {"early": early, "late": late, "delta": delta,
                                  "percent_change": pct, "direction": direction}
    return result


def fallback_narrative(summary: dict) -> dict[str, str]:
    """프론트의 변화 임계와 방향 규칙을 사용하되 관측하지 않은 상태는 단정하지 않는다."""
    sections = {}
    for group, label in (("body", "몸"), ("mind", "마음")):
        sentences = []
        for key, metric in summary.get(group, {}).items():
            direction = metric.get("direction")
            if direction is None:
                continue
            phrase = {"up": "높아졌어요", "down": "낮아졌어요", "stable": "비슷하게 유지됐어요"}[direction]
            sentences.append(f"{LABELS[key]}는 전반에 비해 후반에 {phrase}.")
        sections[group] = " ".join(sentences) or f"측정 자료가 부족해 {label}의 전후 변화를 확인하기 어려워요."
    return {"journey": f"이번 세션의 흐름을 돌아봅니다. {sections['body']} {sections['mind']}",
            **sections, "closing": "오늘의 경험을 있는 그대로 돌아보며, 잠시 자신의 몸과 마음에 귀 기울여 보세요."}

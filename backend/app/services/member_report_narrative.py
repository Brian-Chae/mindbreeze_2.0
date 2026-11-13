"""SDD-327 T4 — 회원 리포트 종합 소견(opinion.narrative)·다음 걸음(next_steps) 규칙 문장 + AI 보강 훅.

입력은 `reports.content.member_report` 형태의 dict(읽기 전용). 반환은 새 객체다.
규칙 문장이 확정이며, AI 문장은 `merge_ai_narrative` 검증을 통과한 경우에만 대체한다(기본 off).
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Mapping, Optional

NARRATIVE_EYEBROW = "01 / 종합 소견"
NEXT_STEPS_HEAD = {
    "eyebrow": "05 / 다음 걸음",
    "title": "오늘의 변화를, 다음 만남으로 이어가요",
    "body": (
        "이번 수업에서 보인 변화는 회원님을 규정하는 성격표가 아니에요. 몸이 반응한 순간을 기억하고 "
        "같은 조건에서 다시 살펴보면, 나만의 흐름을 조금 더 알아갈 수 있어요."
    ),
}
_CLOSING = "오늘의 신호를 차분히 돌아보되, 편안함을 느꼈는지는 회원님의 기억과 함께 읽어 주세요."

# AI 보강 제한 — 제목·본문 길이
AI_TITLE_MAX = 40
AI_BODY_MAX = 420

Metrics = Mapping[str, Any]


def _body(report: Mapping[str, Any], key: str) -> Optional[Mapping[str, Any]]:
    sec = (report.get("metrics") or {}).get(key)
    if not sec or sec.get("state") != "ok":
        return None
    return sec.get("body")


def _fmt(v: float, decimals: int) -> str:
    return f"{v:.{decimals}f}"


# ── 종합 소견 ─────────────────────────────────────────────────────
def _heart_title(direction: str) -> str:
    return {
        "down": "몸을 깨운 뒤, 심장은 천천히 내려왔어요",
        "up": "몸을 깨운 뒤, 심장은 조금 더 바쁘게 뛰었어요",
    }.get(direction, "몸을 깨운 뒤에도, 심장은 비슷한 속도를 지켰어요")


_HR_VERB = {"down": "내려왔어요", "up": "올라갔어요", "stable": "비슷했어요"}
_STEM = {"up": "올라갔", "down": "내려갔", "stable": "비슷했"}
_RELAX_POS = {"up": "시작보다 높은 위치에", "down": "시작보다 낮은 위치에", "stable": "시작과 비슷한 위치에"}


def build_opinion_narrative(
    report: Mapping[str, Any], directions: Mapping[str, Optional[str]]
) -> dict[str, str]:
    """종합 소견. `directions` = 지표키 → up/down/stable (noticeable 판정이 반영된 방향, 결측은 None)."""
    worn = (report.get("meta") or {}).get("band_status") != "not_worn"
    hr = _body(report, "heart_rate")
    hr_dir = directions.get("heart_rate")
    foc_dir, rel_dir = directions.get("focus"), directions.get("relaxation")

    if not worn:
        return {
            "eyebrow": NARRATIVE_EYEBROW,
            "title": "수업에 함께한 시간을 남겨요",
            "body": (
                "이번에는 밴드 없이 수업에 참여했어요. 몸과 마음의 지표는 비교하지 않고, 수업에서 느낀 점을 "
                "기록으로 남겨요. 편안함을 느꼈는지는 회원님의 기억과 함께 읽어 주세요."
            ),
            "source": "rule",
        }

    sentences: list[str] = []
    if hr is not None and hr_dir is not None:
        ch = hr["change"]
        d = ch["decimals"]
        sentences.append(
            f"몸을 움직인 뒤 명상으로 이어지면서, 심박 중앙값은 준비·호흡의 {_fmt(ch['before'], d)}회/분에서 "
            f"명상 후반의 {_fmt(ch['after'], d)}회/분으로 {_HR_VERB[hr_dir]}."
        )
        title = _heart_title(hr_dir)
    else:
        title = "수업의 흐름을 차분히 돌아봐요"

    if foc_dir and rel_dir:
        particle = "도" if foc_dir == rel_dir else "는"
        sentences.append(
            f"집중도 지표는 수업 뒤쪽에서 {_STEM[foc_dir]}고, 이완도 지표{particle} {_RELAX_POS[rel_dir]} 머물렀어요."
        )
    elif foc_dir:
        sentences.append(f"집중도 지표는 수업 뒤쪽에서 {_STEM[foc_dir]}어요.")
    elif rel_dir:
        sentences.append(f"이완도 지표는 {_RELAX_POS[rel_dir]} 머물렀어요.")

    if not sentences:
        sentences.append("이번 수업의 기록을 차분히 돌아봐요.")
        title = "수업의 흐름을 차분히 돌아봐요"
    sentences.append(_CLOSING)
    return {"eyebrow": NARRATIVE_EYEBROW, "title": title, "body": " ".join(sentences), "source": "rule"}


# ── 다음 걸음 ─────────────────────────────────────────────────────
def build_next_steps(report: Mapping[str, Any]) -> dict[str, Any]:
    worn = (report.get("meta") or {}).get("band_status") != "not_worn"
    hr = _body(report, "heart_rate") if worn else None
    stable5 = report.get("stable5") if worn else None

    if hr is not None:
        ch = hr["change"]
        d = ch["decimals"]
        strength = (
            "움직임과 안정 구간을 구분해 나의 흐름을 살펴볼 수 있었어요. 준비·호흡에서 명상 후반으로 나의 심박 "
            f"중앙값이 {_fmt(ch['before'], d)} → {_fmt(ch['after'], d)}회/분으로 바뀌었어요"
            f"({ch['delta']:+.{d}f}회/분). 이 변화가 편안함과 함께했는지는 회원님의 느낌으로 확인해 주세요."
        )
    else:
        strength = "수업에 참여해 몸을 돌보는 시간을 냈어요. 이 시간이 쌓이면 나만의 흐름을 알아가기 쉬워져요."

    scales = {s["key"]: s for s in (stable5 or {}).get("scales", [])}
    if "heart_rate" in scales:
        v = scales["heart_rate"]
        watch = (
            f"안정 심박은 {_fmt(v['value'], v['decimals'])}회/분이에요. 평소와 다른 느리거나 빠른 맥박이 반복되거나 "
            "어지러움·무기력 같은 증상이 있다면 의료진과 상의해 주세요. RMSSD·SDNN의 참고 위치만으로 건강을 "
            "보장하거나 질환을 판단할 수는 없어요."
        )
    else:
        watch = "몸이 불편하거나 평소와 다른 증상이 이어진다면 의료진과 상의해 주세요."

    if worn:
        nxt = (
            "시작 전 수면과 피로, 끝난 뒤의 편안함을 짧게 적어 보세요. 다음에도 같은 자세와 자연스러운 호흡으로 "
            "안정된 5분을 기록하면, 내 변화와 느낌을 함께 살펴보기 쉬워져요."
        )
    else:
        nxt = "다음에는 밴드를 착용해 보고, 시작 전 수면과 피로, 끝난 뒤의 편안함을 짧게 적어 보세요."

    return {
        **NEXT_STEPS_HEAD,
        "items": [
            {"title": "이번 기록에서 찾은 강점", "body": strength},
            {"title": "함께 살펴볼 점", "body": watch},
            {"title": "다음 수업에서 해 볼 것", "body": nxt},
        ],
    }


# ── AI 보강 훅 (기본 off · 실제 API 호출은 호출자가 주입) ──────────
def _facts(report: Mapping[str, Any]) -> dict[str, Any]:
    """AI에 넘기는 사실 목록 — 집계 숫자만, 개인 식별 정보 없음."""
    facts: dict[str, Any] = {}
    for key, sec in (report.get("metrics") or {}).items():
        body = sec.get("body") if sec.get("state") == "ok" else None
        if body:
            ch = body["change"]
            facts[key] = {"before": ch["before"], "after": ch["after"], "delta": ch["delta"],
                          "unit": ch["unit"], "direction": ch["direction"]}
    return facts


def build_ai_prompt(report: Mapping[str, Any]) -> str:
    return (
        "당신은 명상 수업 기록을 쉬운 한국어로 풀어 쓰는 작성자입니다. 아래 사실만 사용해 종합 소견을 JSON "
        '{"title": "...", "body": "..."} 로만 답하세요.\n'
        "규칙: 해요체, 관찰형 서술. 숫자는 아래 사실에 있는 값만. 인과 단정(명상 때문에/덕분에) 금지, 점수·등급·"
        "좋고 나쁨 판정 금지, 진단·위험·스트레스·우울 표현 금지. 반대 방향 변화도 숨기지 말 것. "
        f"제목 {AI_TITLE_MAX}자 이내, 본문 {AI_BODY_MAX}자 이내.\n"
        f"사실: {json.dumps(_facts(report), ensure_ascii=False)}"
    )


_NUM = re.compile(r"\d+(?:\.\d+)?")


def _allowed_numbers(report: Mapping[str, Any]) -> set[str]:
    out: set[str] = set()
    for f in _facts(report).values():
        d = max(len(str(f[k]).split(".")[-1]) if "." in str(f[k]) else 0 for k in ("before", "after", "delta"))
        for k in ("before", "after", "delta"):
            out.add(f"{abs(f[k]):.{d}f}")
            out.add(str(abs(f[k])))
    return out


def merge_ai_narrative(
    report: Mapping[str, Any],
    raw_text: Optional[str],
    check: Optional[Callable[[str], None]] = None,
) -> Optional[dict[str, str]]:
    """AI 응답(JSON 문자열)을 검증해 narrative dict(source="ai")로. 하나라도 어긋나면 None(규칙 문장 유지)."""
    if not raw_text:
        return None
    if check is None:
        from app.services.member_report_wording import assert_clean as check  # 지연 import(순환 방지)
    try:
        data = json.loads(raw_text)
        title, body = data["title"], data["body"]
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(title, str) or not isinstance(body, str):
        return None
    title, body = title.strip(), body.strip()
    if not title or not body or len(title) > AI_TITLE_MAX or len(body) > AI_BODY_MAX:
        return None
    try:
        check(title)
        check(body)
    except ValueError:
        return None
    allowed = _allowed_numbers(report)
    if any(n not in allowed for n in _NUM.findall(body + " " + title)):
        return None  # 사실에 없는 숫자 → 거부
    return {"eyebrow": NARRATIVE_EYEBROW, "title": title, "body": body, "source": "ai"}

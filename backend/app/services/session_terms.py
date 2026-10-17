"""세션 알림·유형 라벨 문구 사전 (SDD-211 Phase 0 / TD10).

호출부에 흩어진 문구 리터럴을 한 곳으로 옮기되 **한 글자도 바꾸지 않는다**. 영역(`meditation`/`counseling`)
차원은 Phase 2 에서 값을 갈라 쓰기 위한 구조이고, Phase 0 에서는 두 영역 값이 같다.
서버에는 아직 `session.area` 가 없으므로 호출부는 기본 영역을 쓴다.

- 알림 제목 = 이메일 제목 (`notification_service._build_email_content`) 이므로 제목 문구 변경은 메일 제목도 바꾼다.
- 유형 라벨은 호출부마다 값이 달라(`명상수업` / `명상 수업`, fallback `클래스` / `상담`) variant 별로 보존한다.
- 알 수 없는 키는 조용히 대체하지 않고 `KeyError` 를 낸다.
- 범위 밖: 메일/푸시 본문, 에러 `detail` 문구.
"""

from __future__ import annotations

from typing import Literal

Area = Literal["meditation", "counseling"]
DEFAULT_AREA: Area = "meditation"

TypeLabelVariant = Literal["reminder", "report_comment"]


def _same(text: str) -> dict[Area, str]:
    return {"meditation": text, "counseling": text}


_NOTIFICATION_TITLES: dict[str, dict[Area, str]] = {
    "session_booked": _same("새 세션 예약"),
    "session_ready": _same("새 세션이 열렸습니다"),
    "session_updated": _same("세션 정보가 변경되었습니다"),
    "session_deleted": _same("세션이 취소되었습니다"),
    "session_opened": _same("세션이 오픈되었습니다"),
    "session_started": _same("세션이 시작되었습니다"),
    "session_completed": _same("세션이 종료되었습니다"),
    "session_cancelled": _same("세션이 취소되었습니다"),
    "session_waitlist_promoted": _same("대기열에서 참여자로 승격되었습니다"),
    "session_invited": _same("세션에 초대되었습니다"),
    "session_participant_removed": _same("세션에서 제외되었습니다"),
    "session_invite_remind": _same("클래스에 입장해 주세요"),
}

_BODY_FALLBACK = _same("세션")
_INVITE_REMIND_BODY_FALLBACK = _same("클래스")

_TYPE_LABELS: dict[str, dict[str, str]] = {
    "reminder": {
        "clinical": "임상심리상담",
        "hypnosis": "최면심리상담",
        "meditation": "명상수업",
    },
    "report_comment": {
        "clinical": "임상심리상담",
        "hypnosis": "최면심리상담",
        "meditation": "명상 수업",
    },
}
_TYPE_LABEL_FALLBACK: dict[str, str] = {"reminder": "클래스", "report_comment": "상담"}


def notification_title(event: str, area: Area = DEFAULT_AREA) -> str:
    return _NOTIFICATION_TITLES[event][area]


def notification_body_fallback(area: Area = DEFAULT_AREA) -> str:
    """제목 없는 세션의 알림 본문 대체어."""
    return _BODY_FALLBACK[area]


def invite_remind_body_fallback(area: Area = DEFAULT_AREA) -> str:
    return _INVITE_REMIND_BODY_FALLBACK[area]


def session_type_label(session_type: str, custom_name: str | None, *, variant: TypeLabelVariant) -> str:
    """세션 유형 라벨 — custom 은 이름이 있으면 그 이름, 아니면 variant 별 fallback."""
    labels = _TYPE_LABELS[variant]
    fallback = _TYPE_LABEL_FALLBACK[variant]
    if session_type == "custom" and custom_name:
        return custom_name
    return labels.get(session_type, fallback)


def session_type_fallback_label(*, variant: TypeLabelVariant) -> str:
    """세션 정보가 아예 없을 때 쓰는 유형 라벨."""
    return _TYPE_LABEL_FALLBACK[variant]


def type_label_table(variant: TypeLabelVariant) -> dict[str, str]:
    """variant 의 유형 → 라벨 표 사본(모듈 상수 호환용)."""
    return dict(_TYPE_LABELS[variant])

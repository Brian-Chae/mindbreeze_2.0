"""SDD-211 T4 — session_terms 단위 테스트 (verify TM-11, BE-TERM-01~03).

사전 값은 호출부가 쓰던 현행 리터럴과 정확히 같아야 하고(Phase 0 은 문구 변경 없음),
두 영역 값이 같으며, 알 수 없는 키는 KeyError 다.
"""

from __future__ import annotations

import pytest

from app.services import session_terms

AREAS = ("meditation", "counseling")

GOLDEN_TITLES = {
    "session_booked": "새 세션 예약",
    "session_ready": "새 세션이 열렸습니다",
    "session_updated": "세션 정보가 변경되었습니다",
    "session_deleted": "세션이 취소되었습니다",
    "session_opened": "세션이 오픈되었습니다",
    "session_started": "세션이 시작되었습니다",
    "session_completed": "세션이 종료되었습니다",
    "session_cancelled": "세션이 취소되었습니다",
    "session_waitlist_promoted": "대기열에서 참여자로 승격되었습니다",
    "session_invited": "세션에 초대되었습니다",
    "session_participant_removed": "세션에서 제외되었습니다",
    "session_invite_remind": "클래스에 입장해 주세요",
}


def test_BE_TERM_01_알림_제목은_현행_리터럴과_정확히_같다():
    for event, expected in GOLDEN_TITLES.items():
        assert session_terms.notification_title(event) == expected, event


@pytest.mark.parametrize("event", sorted(GOLDEN_TITLES))
def test_BE_TERM_01_알림_제목은_두_영역에서_동일하다(event):
    assert {session_terms.notification_title(event, area) for area in AREAS} == {GOLDEN_TITLES[event]}


def test_BE_TERM_01_본문_fallback():
    for area in AREAS:
        assert session_terms.notification_body_fallback(area) == "세션"
        assert session_terms.invite_remind_body_fallback(area) == "클래스"


def test_BE_TERM_02_유형_라벨_variant_별_값_보존():
    f = session_terms.session_type_label
    assert [f(t, None, variant="reminder") for t in ("clinical", "hypnosis", "meditation")] == [
        "임상심리상담", "최면심리상담", "명상수업",
    ]
    assert [f(t, None, variant="report_comment") for t in ("clinical", "hypnosis", "meditation")] == [
        "임상심리상담", "최면심리상담", "명상 수업",
    ]


def test_BE_TERM_02_custom_과_fallback():
    f = session_terms.session_type_label
    assert f("custom", "마음챙김", variant="reminder") == "마음챙김"
    assert f("custom", "마음챙김", variant="report_comment") == "마음챙김"
    # 이름이 없거나 비어 있으면 variant 별 fallback
    for name in (None, ""):
        assert f("custom", name, variant="reminder") == "클래스"
        assert f("custom", name, variant="report_comment") == "상담"
    # 알 수 없는 유형도 variant 별 fallback
    assert f("unknown", None, variant="reminder") == "클래스"
    assert f("unknown", None, variant="report_comment") == "상담"
    assert session_terms.session_type_fallback_label(variant="reminder") == "클래스"
    assert session_terms.session_type_fallback_label(variant="report_comment") == "상담"


def test_BE_TERM_02_표_사본은_원본을_바꾸지_못한다():
    table = session_terms.type_label_table("reminder")
    table["meditation"] = "변조"
    assert session_terms.type_label_table("reminder")["meditation"] == "명상수업"


def test_BE_TERM_03_알_수_없는_키는_KeyError():
    with pytest.raises(KeyError):
        session_terms.notification_title("no_such_event")
    with pytest.raises(KeyError):
        session_terms.notification_title("session_opened", "no_such_area")  # type: ignore[arg-type]
    with pytest.raises(KeyError):
        session_terms.session_type_label("clinical", None, variant="no_such_variant")  # type: ignore[arg-type]
    with pytest.raises(KeyError):
        session_terms.session_type_fallback_label(variant="no_such_variant")  # type: ignore[arg-type]

"""SDD-211 T0-BE — 서버 문구(알림 제목/본문, 유형 라벨) 특성화 테스트 (BE-TERM-C01~C13).

목적: Phase 0 의 ``session_terms.py`` 도입(T4-BE, 문자열 상수 치환만) 전에 **현행 서버 문구**를 골든
리터럴로 박제한다. 이 파일은 현행 코드에서 GREEN 이어야 하며, T4 이후에도 **수정 없이** 통과해야 한다
(verify G7 — 특성화 테스트는 구현 커밋에서 수정 금지).

- 캡처 지점: ``notification_service.notify_event`` — 세션 이벤트 알림의 단일 경유점
  (``session_service._notify_participants_event``)이 호출하는 최하위 함수. 제목/본문은 ``data`` 로 전달된다.
- 현행 값이 어색해도(공백 차이·용어 불일치) **그대로** 박제한다. 값 정리는 Phase 2 의 일이다.
- 알림 제목은 이메일 제목(``[MIND BREEZE] {title}``)이 되므로 제목 골든은 메일 제목 불변의 근거이기도 하다.

| ID | 내용 |
|---|---|
| C01~C04 | 상태 전이 open·start·end·cancel (제목 있음 / 없음 fallback `세션`) |
| C05 | 생성(예약 scheduled) `session_booked` |
| C06 | 생성(즉석 ready) `session_ready` |
| C07 | 수정 `session_updated` |
| C08 | 삭제(직접 취소 문구) `session_deleted` |
| C09 | 초대 2경로(신규 등록 / 제거 후 재초대 되살림) `session_invited` |
| C10 | 제외 `session_participant_removed` |
| C11 | 대기 승격 `session_waitlist_promoted` |
| C12 | 초대 리마인드(session_invite_service, fallback `클래스`) |
| C13 | 유형 라벨 3함수 × 유형 전부 (+ agent_policy 세션 없음 리터럴) |
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from tests.test_sdd015_class_code import _create_class, _db, _open_class, _register

# 제목 없는 세션의 본문 fallback 을 확인하기 위한 파라미터. (제목 값, 기대 본문)
TITLED = "골든 제목 클래스"
TITLE_CASES = [
    pytest.param(TITLED, TITLED, id="titled"),
    pytest.param(None, "세션", id="untitled-fallback-세션"),
]


# ── 캡처 헬퍼 ───────────────────────────────────────────────────────────────


class _Captured:
    """notify_event 호출을 (event_type, user_id, title, body) 로 모은다."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None, str | None]] = []

    def record(self, event_type: str, user_id: object, data: dict, db: object) -> object:
        self.calls.append((event_type, str(user_id), data.get("title"), data.get("body")))
        # None 이 아니어야 호출부가 in_app="queued" 로 취급한다(결과 필드 값은 이 테스트의 관심사가 아님).
        return object()

    def of(self, event_type: str) -> list[tuple[str, str | None, str | None]]:
        """특정 이벤트의 (user_id, title, body) 목록."""
        return [(u, t, b) for (e, u, t, b) in self.calls if e == event_type]

    def clear(self) -> None:
        self.calls.clear()


@pytest.fixture
def captured(monkeypatch) -> _Captured:
    from app.services import notification_service

    cap = _Captured()
    monkeypatch.setattr(notification_service, "notify_event", cap.record)
    return cap


def _class_with_member(client, tag: str, title: str | None, **kw):
    """호스트 + 회원 1명이 참여자로 등록된 그룹 클래스를 만든다(생성 시 알림은 비운다)."""
    host = _register(client, f"term-h-{tag}@test.com")
    member = _register(client, f"term-m-{tag}@test.com", role="client")
    cls = _create_class(
        client,
        host["h"],
        participant_mode="group",
        max_participants=10,
        title=title,
        participant_ids=[member["id"]],
        **kw,
    )
    return host, member, cls


# ── C01~C04 상태 전이 ──────────────────────────────────────────────────────


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C01_open_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C01: open → 제목 `세션이 오픈되었습니다`, 본문 = 제목 또는 fallback `세션`."""
    host, member, cls = _class_with_member(client, "c01", title)
    captured.clear()
    res = client.post(f"/api/v1/sessions/{cls['id']}/open", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_opened") == [(member["id"], "세션이 오픈되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C02_start_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C02: start → 제목 `세션이 시작되었습니다`."""
    host, member, cls = _class_with_member(client, "c02", title)
    captured.clear()
    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_started") == [(member["id"], "세션이 시작되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C03_end_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C03: end → 제목 `세션이 종료되었습니다`(이벤트 session_completed)."""
    host, member, cls = _class_with_member(client, "c03", title)
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"]).status_code == 200
    captured.clear()
    res = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_completed") == [(member["id"], "세션이 종료되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C04_cancel_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C04: cancel → 제목 `세션이 취소되었습니다`(이벤트 session_cancelled)."""
    host, member, cls = _class_with_member(client, "c04", title)
    captured.clear()
    res = client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_cancelled") == [(member["id"], "세션이 취소되었습니다", expected_body)]


# ── C05~C06 생성 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C05_생성_예약_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C05: 일정 있는 생성(scheduled) → 제목 `새 세션 예약`(이벤트 session_booked)."""
    host = _register(client, "term-h-c05@test.com")
    member = _register(client, "term-m-c05@test.com", role="client")
    scheduled_at = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "meditation",
            "duration_min": 30,
            "title": title,
            "scheduled_at": scheduled_at,
            "participant_ids": [member["id"]],
        },
        headers=host["h"],
    )
    assert res.status_code == 201, res.text
    assert captured.of("session_booked") == [(member["id"], "새 세션 예약", expected_body)]
    assert captured.of("session_ready") == []


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C06_생성_즉석_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C06: 일정 없는 즉석 생성(ready) → 제목 `새 세션이 열렸습니다`(이벤트 session_ready)."""
    host = _register(client, "term-h-c06@test.com")
    member = _register(client, "term-m-c06@test.com", role="client")
    res = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "title": title, "participant_ids": [member["id"]]},
        headers=host["h"],
    )
    assert res.status_code == 201, res.text
    assert captured.of("session_ready") == [(member["id"], "새 세션이 열렸습니다", expected_body)]
    assert captured.of("session_booked") == []


# ── C07 수정 / C08 삭제 ────────────────────────────────────────────────────


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C07_수정_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C07: 수정 → 제목 `세션 정보가 변경되었습니다`(이벤트 session_updated)."""
    host, member, cls = _class_with_member(client, "c07", title)
    captured.clear()
    # 제목 없는 케이스를 유지하기 위해 제목 외 필드만 바꾼다.
    res = client.put(f"/api/v1/sessions/{cls['id']}", json={"duration_min": 45}, headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_updated") == [(member["id"], "세션 정보가 변경되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C08_삭제_직접취소_문구_알림(client, captured, title, expected_body):
    """BE-TERM-C08: 삭제(숨김) 시 제목은 `세션이 취소되었습니다`(이벤트 session_deleted).

    이벤트 이름은 deleted 인데 제목은 cancel 과 같은 문구 — 현행 값을 그대로 박제한다.
    """
    host, member, cls = _class_with_member(client, "c08", title)
    captured.clear()
    res = client.delete(f"/api/v1/sessions/{cls['id']}", headers=host["h"])
    assert res.status_code == 204, res.text
    assert captured.of("session_deleted") == [(member["id"], "세션이 취소되었습니다", expected_body)]


# ── C09 초대 2경로 / C10 제외 / C11 대기 승격 ───────────────────────────────


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C09_초대_신규와_되살림_두_경로_동일_문구(client, captured, title, expected_body):
    """BE-TERM-C09: 초대 신규 등록 경로 / 제거 후 재초대(되살림) 경로 모두 `세션에 초대되었습니다`."""
    host = _register(client, "term-h-c09@test.com")
    member = _register(client, "term-m-c09@test.com", role="client")
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=10, title=title)
    captured.clear()

    # 경로 1: 신규 등록
    res = client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": member["id"]}, headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_invited") == [(member["id"], "세션에 초대되었습니다", expected_body)]

    # 경로 2: 제거 후 재초대(제거 행 되살림)
    res = client.delete(f"/api/v1/sessions/{cls['id']}/participants/{member['id']}", headers=host["h"])
    assert res.status_code == 200, res.text
    captured.clear()
    res = client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": member["id"]}, headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_invited") == [(member["id"], "세션에 초대되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C10_제외_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C10: 참여자 제외 → 제목 `세션에서 제외되었습니다`(이벤트 session_participant_removed)."""
    host, member, cls = _class_with_member(client, "c10", title)
    captured.clear()
    res = client.delete(f"/api/v1/sessions/{cls['id']}/participants/{member['id']}", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_participant_removed") == [(member["id"], "세션에서 제외되었습니다", expected_body)]


@pytest.mark.parametrize("title,expected_body", TITLE_CASES)
def test_BE_TERM_C11_대기_승격_알림_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C11: 정원 1 에서 active 제거 → 대기자 승격, 제목 `대기열에서 참여자로 승격되었습니다`.

    승격 제목에는 `세션` 이 들어 있지 않다(현행 값). 제외 알림은 같은 요청에서 제거 대상에게 따로 간다.
    """
    host = _register(client, "term-h-c11@test.com")
    active = _register(client, "term-m-c11a@test.com", role="client")
    waiting = _register(client, "term-m-c11b@test.com", role="client")
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=1, title=title)
    for m in (active, waiting):
        res = client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m["id"]}, headers=host["h"])
        assert res.status_code == 200, res.text
    captured.clear()

    res = client.delete(f"/api/v1/sessions/{cls['id']}/participants/{active['id']}", headers=host["h"])
    assert res.status_code == 200, res.text
    assert captured.of("session_waitlist_promoted") == [
        (waiting["id"], "대기열에서 참여자로 승격되었습니다", expected_body)
    ]
    assert captured.of("session_participant_removed") == [(active["id"], "세션에서 제외되었습니다", expected_body)]


# ── C12 리마인드(session_invite_service) ────────────────────────────────────


@pytest.mark.parametrize(
    "title,expected_body",
    [
        pytest.param(TITLED, TITLED, id="titled"),
        pytest.param(None, "클래스", id="untitled-fallback-클래스"),
    ],
)
def test_BE_TERM_C12_초대_리마인드_제목_본문(client, captured, title, expected_body):
    """BE-TERM-C12: 초대 재발송(remind) → 제목 `클래스에 입장해 주세요`, fallback `클래스`(≠ session_service 의 `세션`).

    이벤트는 session_invited 이고 ``params={"remind": True}`` 로 일반 초대와 구분된다.
    """
    host = _register(client, "term-h-c12@test.com")
    member = _register(client, "term-m-c12@test.com", role="client")
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=10, title=title)
    _open_class(client, cls, host["h"])
    res = client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": member["id"]}, headers=host["h"])
    assert res.status_code == 200, res.text
    captured.clear()

    res = client.post(f"/api/v1/sessions/{cls['id']}/invite/remind", json={}, headers=host["h"])
    assert res.status_code == 200, res.text
    assert res.json()["summary"]["queued"] == 1
    assert captured.of("session_invited") == [(member["id"], "클래스에 입장해 주세요", expected_body)]


# ── C13 유형 라벨 ───────────────────────────────────────────────────────────


def _typed(session_type: str, custom_type_name: str | None = None) -> SimpleNamespace:
    """라벨 함수가 읽는 필드(type, custom_type_name)만 가진 세션 대역."""
    return SimpleNamespace(type=session_type, custom_type_name=custom_type_name)


# (입력 설명, 세션 대역, reminder_service, agent_policy, report_comment_service)
# 현행 값 차이: 명상 `명상수업`(reminder·agent) vs `명상 수업`(report_comment),
# custom 이름 없음/알 수 없는 유형 fallback `클래스`(reminder·agent) vs `상담`(report_comment).
LABEL_GOLDEN = [
    pytest.param(_typed("clinical"), "임상심리상담", "임상심리상담", "임상심리상담", id="clinical"),
    pytest.param(_typed("hypnosis"), "최면심리상담", "최면심리상담", "최면심리상담", id="hypnosis"),
    pytest.param(_typed("meditation"), "명상수업", "명상수업", "명상 수업", id="meditation"),
    pytest.param(_typed("custom", "마음챙김 워크숍"), "마음챙김 워크숍", "마음챙김 워크숍", "마음챙김 워크숍", id="custom-named"),
    pytest.param(_typed("custom", None), "클래스", "클래스", "상담", id="custom-unnamed"),
    pytest.param(_typed("custom", ""), "클래스", "클래스", "상담", id="custom-empty-name"),
    pytest.param(_typed("unknown-type"), "클래스", "클래스", "상담", id="unknown-type"),
]


@pytest.mark.parametrize("session,reminder,agent,report_comment", LABEL_GOLDEN)
def test_BE_TERM_C13_유형_라벨_3함수_골든(session, reminder, agent, report_comment):
    """BE-TERM-C13: 유형 라벨 함수 3종의 현행 값을 유형별로 박제한다(값이 서로 다름 — 그대로 보존)."""
    from app.services import agent_policy, reminder_service, report_comment_service

    assert reminder_service._session_type_label(session) == reminder
    assert agent_policy.session_type_label(session) == agent
    assert report_comment_service._session_type_label(session) == report_comment


def test_BE_TERM_C13_유형_라벨_상수_테이블_골든():
    """BE-TERM-C13: 라벨 상수 테이블 자체도 박제(`명상수업` vs `명상 수업` 공백 차이 포함)."""
    from app.services import agent_policy, report_comment_service

    assert agent_policy.SESSION_TYPE_LABELS == {
        "clinical": "임상심리상담",
        "hypnosis": "최면심리상담",
        "meditation": "명상수업",
    }
    assert report_comment_service._SESSION_TYPE_LABELS == {
        "clinical": "임상심리상담",
        "hypnosis": "최면심리상담",
        "meditation": "명상 수업",
    }


def test_BE_TERM_C13_agent_policy_세션_없을_때_리터럴_클래스(client):
    """BE-TERM-C13: agent_policy.report_facts 는 세션을 못 찾으면 type_label 리터럴 `클래스` 를 쓴다."""
    from app.services import agent_policy

    report = SimpleNamespace(id=uuid.uuid4(), session_id=uuid.uuid4(), content={})
    db = _db()
    try:
        facts = agent_policy.report_facts(report, db)
    finally:
        db.close()
    assert facts["type_label"] == "클래스"
    assert facts["session_title"] is None

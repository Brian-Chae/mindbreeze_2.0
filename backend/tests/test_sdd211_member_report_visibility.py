"""SDD-211 Task X1 — 회원 리포트 가시성(R6-X1, U1=B) 테스트 (RED 단계).

정책(plan TD5·§13.2, verify §2.4):
- 회원(리포트 소유자)에게 승인 전(`status != completed`) 리포트는 **행은 유지**하되 응답에서 마스킹한다.
  본문(content)·HRV 지표 10개·generation_error·data_credibility·pdf_url·subjective_state 는 null/빈 값,
  `in_review: true` 가산 필드. 총계·페이지네이션·정렬 불변, 상세는 마스킹 200, 마스킹 응답은 is_read 를 올리지 않는다.
- 타 참여자는 계속 403(소유자 검사가 마스킹보다 먼저). staff 경로·비회원 토큰·PDF·AI 비서는 불변.
- U3 변경(plan §13.2): report_generation_failed 알림은 호스트에게만 발송(회원 대상 중단).

현행 코드(X2 구현 전)에서 기대 결과:
- 노출/마스킹/in_review/알림 대상 테스트 = RED (진짜 노출·미구현 때문이어야 한다)
- 회귀 고정(PDF 403·타 참여자 403·staff 본문 불변·비회원 토큰·report-status 현행 문자열) = GREEN

마스킹 판정은 allow-list 방식이다. 응답 키는 아래 ALL_KEYS 에 모두 분류돼 있어야 하며,
열거되지 않은 키가 응답에 생기면 실패한다(이후 필드 추가로 인한 누출 방지).

고유 sentinel 문자열(`SECRET_*`, `ERR_TRACE*`)을 본문·코멘트·오류 원문에 심어 응답 어디에도 없음을 단언한다.
(승인 후 공개되는 시나리오는 `REVEAL_*`, 처음부터 공개되는 completed 는 `APPROVED_*` 를 쓴다.)
"""

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.schemas.eeg import HRVMotionSummary
from app.schemas.report import ReportResponse
from tests.conftest import create_test_counselor, create_test_org

VALID_PASSWORD = "Passw0rd!"
JsonDict = dict[str, object]

# ── allow-list (verify §2.4 박스) ─────────────────────────────────────────
# HRV 10개 지표는 DB 컬럼이 아니라 content.eeg 의 *_mean 키에서 파생돼 최상위로 올라온다
# (report_service._serialize → HRVMotionSummary.model_validate(content.eeg)).
HRV_KEYS: tuple[str, ...] = (
    "sdnn_mean",
    "rmssd_mean",
    "lf_hf_ratio_mean",
    "heart_rate_mean",
    "heart_rate_min",
    "heart_rate_max",
    "respiratory_rate_mean",
    "lf_power_mean",
    "hf_power_mean",
    "motion_mean",
)
# 마스킹 시 반드시 null 이어야 하는 최상위 키
NULL_KEYS: tuple[str, ...] = HRV_KEYS + (
    "generation_error",
    "data_credibility",
    "pdf_url",
    "subjective_state",
)
# 마스킹 시 값을 보존하는 키
PRESERVED_KEYS: tuple[str, ...] = (
    "id",
    "session_id",
    "user_id",
    "participant_id",
    "report_email",
    "type",
    "status",
    "generation_status",
    "is_read",
    "created_at",
    "session_title",
    "counselor_name",
    "session_type",
    "scheduled_at",
    "sent_at",
    "participant_name",
    "gender",
    "birth_date",
)
# verify §2.4 박스에는 열거되지 않았지만 ReportResponse 에 존재하는 비내용 메타 키(값 비단언, 키 존재만 요구).
# 분류 근거: 둘 다 내용이 아니라 생성 시작 시각/게스트 여부 메타다. X2 가 다르게 다루면 감독자 판단 필요.
META_KEYS: tuple[str, ...] = (
    "generation_started_at",
    "is_guest",
    "approval_required",
    # SDD-253: 승인 감사·발송 상태 가산 필드 — 스태프 경로에서만 값이 채워지고 회원 경로는 항상 null 이다
    #   (값 비단언 대신 test_sdd253_report_ops 가 회원 응답의 null 을 단언한다).
    "approved_at",
    "approved_by_name",
    "approved_by_role",
    "approval_source",
    "delivery_status",
    "delivery_attempted_at",
    "delivery_attempt_count",
    "delivery_failure_code",
    "capabilities",
)
# 마스킹 content 의 허용 형태 = normalize_report_content({}, "client") 결과
EMPTY_CONTENT: JsonDict = {
    "summary": None,
    "counselor_comment": None,
    "insights": [],
    "markers": [],
}
ALL_KEYS: frozenset[str] = frozenset(
    set(NULL_KEYS) | set(PRESERVED_KEYS) | set(META_KEYS) | {"content", "in_review", "in_review_delayed"}
)

# 키별 허용 타입 태그 (구 앱 호환: 마스킹 전후 타입 불변)
_STR_OR_NULL = {"string", "null"}
ALLOWED_TAGS: dict[str, set[str]] = {
    **{key: {"number", "null"} for key in HRV_KEYS},
    "generation_error": _STR_OR_NULL,
    "data_credibility": _STR_OR_NULL,
    "pdf_url": _STR_OR_NULL,
    "subjective_state": {"object", "null"},
    "id": {"string"},
    "session_id": {"string"},
    "user_id": _STR_OR_NULL,
    "participant_id": _STR_OR_NULL,
    "report_email": _STR_OR_NULL,
    "type": {"string"},
    "status": {"string"},
    "generation_status": {"string"},
    "is_read": {"bool"},
    "created_at": _STR_OR_NULL,
    "session_title": _STR_OR_NULL,
    "counselor_name": _STR_OR_NULL,
    "session_type": _STR_OR_NULL,
    "scheduled_at": _STR_OR_NULL,
    "sent_at": _STR_OR_NULL,
    "participant_name": _STR_OR_NULL,
    "gender": _STR_OR_NULL,
    "birth_date": _STR_OR_NULL,
    "generation_started_at": _STR_OR_NULL,
    "is_guest": {"bool", "null"},
    "approval_required": {"bool"},
    "content": {"object"},
    "in_review": {"bool"},
    # SDD-212: 생성 지연 안내 가산 필드(비내용 메타 — 마스킹 대상 아님)
    "in_review_delayed": {"bool"},
    # SDD-253: 회원 경로에서는 전부 null
    "approved_at": _STR_OR_NULL,
    "approved_by_name": _STR_OR_NULL,
    "approved_by_role": _STR_OR_NULL,
    "approval_source": _STR_OR_NULL,
    "delivery_status": _STR_OR_NULL,
    "delivery_attempted_at": _STR_OR_NULL,
    "delivery_attempt_count": {"number", "null"},
    "delivery_failure_code": _STR_OR_NULL,
    "capabilities": {"object", "null"},
}

# sentinel 접두 — 승인 전 영구 비공개 / 승인 후 공개 / 처음부터 공개
LEAK_FOREVER = ("SECRET_", "ERR_TRACE")
LEAK_UNTIL_APPROVED = ("REVEAL_",)

HRV_SEED_VALUES: dict[str, float] = {
    "sdnn_mean": 41.5,
    "rmssd_mean": 38.2,
    "lf_hf_ratio_mean": 1.7,
    "heart_rate_mean": 72.4,
    "heart_rate_min": 60.0,
    "heart_rate_max": 95.0,
    "respiratory_rate_mean": 14.2,
    "lf_power_mean": 520.0,
    "hf_power_mean": 480.0,
    "motion_mean": 0.12,
}

BASE_TIME = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)


# ── 공통 헬퍼 ─────────────────────────────────────────────────────────────
def _db():
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def _tag(value: object) -> str:
    """JSON 값의 타입 태그 (bool 은 number 보다 먼저 판별)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _make_host(email: str = "x1-host@test.com", org_code: str | None = None) -> JsonDict:
    created = create_test_counselor(email, org_code=org_code)
    return {
        "id": created["id"],
        "auth": {"Authorization": f"Bearer {created['access_token']}"},
    }


def _make_member(client, email: str) -> JsonDict:
    from app.services import email_verify_service

    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "내담자",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": {"tos": True, "privacy": True, "sensitive": True},
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "auth": {"Authorization": f"Bearer {body['access_token']}"},
    }


def _make_org_admin(org_code: str) -> JsonDict:
    from app.core.security import create_access_token, hash_password
    from app.models.organization import Organization
    from app.models.user import User

    db = _db()
    try:
        org = db.query(Organization).filter(Organization.org_code == org_code).first()
        user = User(
            email="x1-orgadmin@test.com",
            password_hash=hash_password(VALID_PASSWORD),
            name="기관관리자",
            role="org_admin",
            status="active",
            verified_tier="email",
            org_id=org.id,
        )
        db.add(user)
        db.flush()
        from app.services.membership_service import add_membership
        add_membership(db, user, org.id, status_="active", role="org_admin")
        db.commit()
        return {
            "id": str(user.id),
            "auth": {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"},
        }
    finally:
        db.close()


def _create_session(
    client, host: JsonDict, minutes: int = 60, title: str = "X1 리포트 세션", start: bool = False
) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "clinical",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(),
            "duration_min": 50,
            "title": title,
        },
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    if start:
        started = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
        assert started.status_code == 200, started.text
    return sid


def _add_participant(sid: str, member: JsonDict, report_email: str | None = None) -> str:
    """회원 참가자 추가. report_included=True 여야 content 가 제외 안내 스텁으로 덮이지 않는다."""
    from app.models.session import SessionParticipant

    db = _db()
    try:
        participant = SessionParticipant(
            session_id=UUID(sid),
            user_id=UUID(str(member["id"])),
            report_included=True,
            report_email=report_email,
        )
        db.add(participant)
        db.commit()
        return str(participant.id)
    finally:
        db.close()


def _full_content(tag: str) -> JsonDict:
    """승인 전 노출되면 안 되는 모든 종류의 값(본문·코멘트·지표·서사)을 sentinel 과 함께 심는다."""
    return {
        "title": f"{tag}_TITLE",
        "headline": f"{tag}_HEADLINE",
        "summary": f"{tag}_SUMMARY",
        "counselor_comment": f"{tag}_COMMENT",
        "insights": [f"{tag}_INSIGHT"],
        "markers": [{"label": f"{tag}_MARKER"}],
        "greeting": f"{tag}_GREETING",
        "approved": False,
        "eeg": {
            "status": "valid",
            "reliability": "high",
            "score": 77,
            **HRV_SEED_VALUES,
            "metrics": {"relaxation_score": 71, "stress_score": 33},
            "narrative": {"journey": f"{tag}_NARRATIVE"},
            "timeline": [{"timestamp_sec": 0, "relaxation_index": 0.7}],
        },
    }


def _error_content(tag: str) -> JsonDict:
    """report_task 실패 경로의 content 형태 + 이월된 상담사 코멘트(예외 원문은 ERR_TRACE)."""
    return {
        "headline": "리포트 생성 실패",
        "error": f"ERR_TRACE_{tag}: Traceback boom",
        "error_message": f"ERR_TRACE_{tag}: Traceback boom",
        "fallback": True,
        "counselor_comment": f"{tag}_COMMENT",
    }


_GENERATION_STATUS = {
    "pending_analysis": "processing",
    "pending_review": "ready",
    "error": "partial",
    "completed": "ready",
}


def _seed_report(
    *,
    sid: str,
    member: JsonDict,
    pid: str,
    status: str,
    tag: str,
    created_at: datetime,
    with_subjective: bool = True,
) -> str:
    """회원 M 의 type=client 리포트를 DB 에 직접 시드한다."""
    from app.models.record import Report, SessionRecord

    db = _db()
    try:
        content = _error_content(tag) if status == "error" else _full_content(tag)
        report = Report(
            session_id=UUID(sid),
            user_id=UUID(str(member["id"])),
            participant_id=UUID(pid),
            type="client",
            status=status,
            content=content,
            generation_status=_GENERATION_STATUS[status],
            generation_error=f"ERR_TRACE_GEN_{tag}" if status == "error" else None,
            data_credibility=None if status == "error" else "high",
            pdf_url=f"https://example.com/{tag}_PDF.pdf",
            sent_at=created_at if status == "completed" else None,
            is_read=False,
            created_at=created_at,
        )
        db.add(report)
        if with_subjective:
            # 주관 상태(셀프 체크인)도 승인 전에는 내려가면 안 된다.
            db.add(
                SessionRecord(
                    session_id=UUID(sid),
                    status="completed",
                    markers=[],
                    edit_history=[],
                    ai_summary={},
                    subjective_state={
                        "participants": {
                            pid: {
                                "after": {
                                    "arousal": 4,
                                    "valence": 2,
                                    "note": f"{tag}_NOTE",
                                    "recorded_at": created_at.isoformat(),
                                }
                            }
                        }
                    },
                )
            )
        db.commit()
        return str(report.id)
    finally:
        db.close()


def _scenario(
    client,
    statuses: tuple[str, ...],
    *,
    tag: str = "SECRET",
    host: JsonDict | None = None,
    member: JsonDict | None = None,
) -> JsonDict:
    """호스트 1명, 회원 1명, 상태별 세션 1개(= 리포트 1개)를 만든다. 세션 시각은 뒤 상태일수록 이르다."""
    host = host or _make_host()
    member = member or _make_member(client, "x1-member@test.com")
    sids: dict[str, str] = {}
    pids: dict[str, str] = {}
    ids: dict[str, str] = {}
    for index, status in enumerate(statuses):
        # 세션 시각이 서로 달라야 목록 정렬(coalesce(scheduled_at, created_at) desc)이 결정적이다.
        sid = _create_session(client, host, minutes=600 - index * 60, title=f"X1 {status} 세션")
        pid = _add_participant(sid, member)
        item_tag = "APPROVED" if status == "completed" and tag == "SECRET" else tag
        rid = _seed_report(
            sid=sid,
            member=member,
            pid=pid,
            status=status,
            tag=item_tag,
            created_at=BASE_TIME + timedelta(hours=index),
        )
        sids[status], pids[status], ids[status] = sid, pid, rid
    return {"host": host, "member": member, "sids": sids, "pids": pids, "ids": ids}


def _list(client, member: JsonDict, **params: object) -> JsonDict:
    res = client.get("/api/v1/reports", params=params, headers=member["auth"])
    assert res.status_code == 200, res.text
    return res.json()


def _detail(client, member: JsonDict, report_id: str):
    return client.get(f"/api/v1/reports/{report_id}", headers=member["auth"])


def _db_report(report_id: str):
    """새 세션으로 DB 의 리포트 행을 읽는다(캐시된 ORM 객체 방지)."""
    from app.models.record import Report

    db = _db()
    try:
        report = db.query(Report).filter(Report.id == UUID(report_id)).first()
        db.expunge(report)
        return report
    finally:
        db.close()


def _notifications(user_id: str, event_type: str) -> list:
    from app.models.notification import Notification

    db = _db()
    try:
        rows = db.query(Notification).filter(Notification.user_id == UUID(user_id)).all()
        return [
            n for n in rows if isinstance(n.extra, dict) and n.extra.get("event_type") == event_type
        ]
    finally:
        db.close()


def _dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _leak_violations(value: object, tokens: tuple[str, ...]) -> list[str]:
    text = _dump(value)
    return [f"sentinel 노출: {token}" for token in tokens if token in text]


def _masking_violations(
    row: JsonDict, *, expected: dict[str, object], leak_tokens: tuple[str, ...]
) -> list[str]:
    """마스킹 정의(verify §2.4) 위반 목록. 비어 있어야 통과다.

    한 번에 모든 위반을 모아 RED 사유가 (in_review 부재 / sentinel 노출 / 지표 노출 ...) 중 무엇인지 드러나게 한다.
    """
    problems: list[str] = []
    if row.get("in_review") is not True:
        problems.append(f"in_review != True (실제={row.get('in_review', '<키 없음>')!r})")
    extra_keys = set(row) - ALL_KEYS
    if extra_keys:
        problems.append(f"열거되지 않은 키: {sorted(extra_keys)}")
    missing_keys = ALL_KEYS - set(row)
    if missing_keys:
        problems.append(f"누락된 키(구 앱 호환 위반): {sorted(missing_keys)}")
    for key in NULL_KEYS:
        if row.get(key) is not None:
            problems.append(f"{key} 가 null 이 아님: {str(row.get(key))[:40]!r}")
    if row.get("content") != EMPTY_CONTENT:
        problems.append(f"content 가 정규화 빈 구조가 아님: {_dump(row.get('content'))[:120]}")
    for key, value in expected.items():
        if row.get(key) != value:
            problems.append(f"보존 키 {key} 불일치: 기대={value!r} 실제={row.get(key)!r}")
    if row.get("sent_at") is not None:
        problems.append("sent_at 이 null 이 아님")
    problems.extend(_leak_violations(row, leak_tokens))
    return problems


def _expected_preserved(env: JsonDict, status: str) -> dict[str, object]:
    return {
        "id": env["ids"][status],
        "session_id": env["sids"][status],
        "participant_id": env["pids"][status],
        "user_id": env["member"]["id"],
        "type": "client",
        "status": status,
        "generation_status": _GENERATION_STATUS[status],
        "is_read": False,
        "session_title": f"X1 {status} 세션",
        "session_type": "clinical",
    }


def _approved_violations(row: JsonDict, *, headline: str) -> list[str]:
    """승인(completed) 응답: 전체 content + HRV 지표 보존, in_review false."""
    problems: list[str] = []
    if row.get("in_review") is not False:
        problems.append(f"in_review != False (실제={row.get('in_review', '<키 없음>')!r})")
    content = row.get("content") or {}
    if content.get("headline") != headline:
        problems.append(f"승인본 content.headline 불일치: {content.get('headline')!r}")
    if row.get("sdnn_mean") != HRV_SEED_VALUES["sdnn_mean"]:
        problems.append(f"승인본 지표 누락: sdnn_mean={row.get('sdnn_mean')!r}")
    if row.get("status") != "completed":
        problems.append(f"status 가 completed 가 아님: {row.get('status')!r}")
    return problems


def _approve(client, host: JsonDict, report_id: str):
    res = client.post(f"/api/v1/reports/{report_id}/approve", headers=host["auth"])
    assert res.status_code == 200, res.text
    return res.json()


# ═════════════════════════════════════════════════════════════════════════
# RX-1 ~ RX-2: 회원 목록
# ═════════════════════════════════════════════════════════════════════════
def test_RX1_회원_목록_4상태_모두_반환_비승인_마스킹(client):
    env = _scenario(client, ("pending_analysis", "pending_review", "error", "completed"))
    body = _list(client, env["member"])

    assert body["total"] == 4
    assert len(body["reports"]) == 4
    by_id = {row["id"]: row for row in body["reports"]}
    assert set(by_id) == set(env["ids"].values())

    problems: list[str] = []
    for status in ("pending_analysis", "pending_review", "error"):
        problems += [
            f"[{status}] {p}"
            for p in _masking_violations(
                by_id[env["ids"][status]],
                expected=_expected_preserved(env, status),
                leak_tokens=LEAK_FOREVER,
            )
        ]
    problems += [
        f"[completed] {p}"
        for p in _approved_violations(by_id[env["ids"]["completed"]], headline="APPROVED_HEADLINE")
    ]
    # 응답 JSON 전체(승인본 행 포함)에 승인 전 sentinel 이 없어야 한다.
    problems += _leak_violations(body, LEAK_FOREVER)
    assert not problems, "\n".join(problems)


def test_RX2_총계_페이지_정렬_불변_limit2(client):
    # 최신순(세션 시각 desc): 승인 전 / 승인 / 승인 / 승인 전 / 승인  → 마스킹 대상이 페이지 경계에 걸쳐 흩어진다.
    statuses = ("pending_review", "completed", "completed", "pending_analysis", "completed")
    host = _make_host()
    member = _make_member(client, "x1-page@test.com")
    expected_order: list[str] = []
    unapproved_ids: set[str] = set()
    for index, status in enumerate(statuses):
        sid = _create_session(client, host, minutes=900 - index * 60, title=f"X1 RX2 {index}")
        pid = _add_participant(sid, member)
        rid = _seed_report(
            sid=sid,
            member=member,
            pid=pid,
            status=status,
            tag="APPROVED" if status == "completed" else "SECRET",
            created_at=BASE_TIME + timedelta(hours=index),
            with_subjective=False,
        )
        expected_order.append(rid)
        if status != "completed":
            unapproved_ids.add(rid)

    unpaged = _list(client, member)
    assert unpaged["total"] == 5
    assert [r["id"] for r in unpaged["reports"]] == expected_order, "정렬 순서(세션 시각 desc) 불변"

    pages: list[JsonDict] = []
    for page, expected_len in ((1, 2), (2, 2), (3, 1)):
        chunk = _list(client, member, page=page, limit=2)
        assert chunk["total"] == 5, "마스킹과 무관하게 페이지마다 total 불변"
        assert (chunk["page"], chunk["limit"]) == (page, 2)
        assert len(chunk["reports"]) == expected_len
        pages.extend(chunk["reports"])
    assert [r["id"] for r in pages] == expected_order, "페이지 합 순서 == 전체 순서"

    problems: list[str] = []
    for row in pages:
        if row["id"] in unapproved_ids:
            if row.get("in_review") is not True:
                problems.append(f"{row['status']} 행 in_review != True")
            problems += _leak_violations(row, LEAK_FOREVER)
        elif row.get("in_review") is not False:
            problems.append("completed 행 in_review != False")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-3 ~ RX-6: 회원 상세
# ═════════════════════════════════════════════════════════════════════════
def test_RX3_pending_review_상세_200_마스킹_is_read_유지(client):
    env = _scenario(client, ("pending_review",))
    rid = env["ids"]["pending_review"]

    res = _detail(client, env["member"], rid)

    assert res.status_code == 200, res.text
    problems = _masking_violations(
        res.json(),
        expected=_expected_preserved(env, "pending_review"),
        leak_tokens=LEAK_FOREVER,
    )
    if _db_report(rid).is_read is not False:
        problems.append("마스킹 응답이 is_read 를 올렸다(승인 후 NEW 소실)")
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("status", ["pending_analysis", "error"])
def test_RX4_pending_analysis_error_상세_200_마스킹_오류원문_비노출(client, status):
    env = _scenario(client, (status,))
    rid = env["ids"][status]

    res = _detail(client, env["member"], rid)

    assert res.status_code == 200, res.text
    row = res.json()
    problems = _masking_violations(
        row, expected=_expected_preserved(env, status), leak_tokens=LEAK_FOREVER
    )
    if status == "error" and "ERR_TRACE" in _dump(row):
        problems.append("예외 원문(content.error/generation_error)이 응답에 있다")
    if _db_report(rid).is_read is not False:
        problems.append("마스킹 응답이 is_read 를 올렸다(승인 후 NEW 소실)")
    assert not problems, "\n".join(problems)


def test_RX5_completed_상세_200_전체_content_is_read_true(client):
    env = _scenario(client, ("completed",))
    rid = env["ids"]["completed"]

    res = _detail(client, env["member"], rid)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["content"]["headline"] == "APPROVED_HEADLINE"
    assert body["content"]["counselor_comment"] == "APPROVED_COMMENT"
    assert body["sdnn_mean"] == HRV_SEED_VALUES["sdnn_mean"]
    assert body["pdf_url"] == "https://example.com/APPROVED_PDF.pdf"
    assert _db_report(rid).is_read is True, "승인본은 기존 계약대로 열람 시 is_read 마킹"


def test_RX6_타_참여자_403_소유자검사가_마스킹보다_먼저(client):
    host = _make_host()
    a = _make_member(client, "x1-a@test.com")
    b = _make_member(client, "x1-b@test.com")
    sid = _create_session(client, host, title="X1 그룹 세션")
    pa, pb = _add_participant(sid, a), _add_participant(sid, b)
    ra = _seed_report(
        sid=sid, member=a, pid=pa, status="pending_review", tag="SECRET",
        created_at=BASE_TIME, with_subjective=False,
    )
    rb = _seed_report(
        sid=sid, member=b, pid=pb, status="pending_review", tag="SECRET",
        created_at=BASE_TIME + timedelta(hours=1), with_subjective=False,
    )

    cross_ab = _detail(client, a, rb)
    cross_ba = _detail(client, b, ra)

    for res in (cross_ab, cross_ba):
        assert res.status_code == 403, res.text
        assert res.json() == {"detail": "접근 권한이 없습니다"}, "마스킹 200 이 아니라 403 + 본문 없음"
    # 타인 접근 시도가 소유자의 is_read 를 건드리지도 않는다.
    assert _db_report(ra).is_read is False and _db_report(rb).is_read is False


# ═════════════════════════════════════════════════════════════════════════
# RX-7 ~ RX-9: 승인 전/후
# ═════════════════════════════════════════════════════════════════════════
def test_RX7_호스트_approve_전후_마스킹_해제_알림1건_is_read_유지(client):
    env = _scenario(client, ("pending_review",), tag="REVEAL")
    host, member = env["host"], env["member"]
    rid = env["ids"]["pending_review"]
    problems: list[str] = []

    # 승인 전: 목록·상세 모두 마스킹 (이 열람이 is_read 를 올리면 승인 후 NEW 가 사라진다)
    before_list = _list(client, member)["reports"]
    before_detail = _detail(client, member, rid)
    assert before_detail.status_code == 200, before_detail.text
    expected = _expected_preserved(env, "pending_review")
    problems += [
        f"[승인 전 목록] {p}"
        for p in _masking_violations(before_list[0], expected=expected, leak_tokens=LEAK_UNTIL_APPROVED)
    ]
    problems += [
        f"[승인 전 상세] {p}"
        for p in _masking_violations(
            before_detail.json(), expected=expected, leak_tokens=LEAK_UNTIL_APPROVED
        )
    ]

    approved = _approve(client, host, rid)
    assert approved["status"] == "completed"

    # 승인 후: report_ready 알림 정확히 1건, 열람 전이므로 is_read False (NEW 정상 표시)
    ready = _notifications(str(member["id"]), "report_ready")
    if len(ready) != 1:
        problems.append(f"report_ready 알림 {len(ready)}건 (기대 1건)")
    if _db_report(rid).is_read is not False:
        problems.append("승인 후에도 열람 전인데 is_read 가 True (승인 전 열람이 읽음 처리했다)")

    after_list = _list(client, member)["reports"]
    problems += [
        f"[승인 후 목록] {p}" for p in _approved_violations(after_list[0], headline="REVEAL_HEADLINE")
    ]
    after_detail = _detail(client, member, rid)
    assert after_detail.status_code == 200
    problems += [
        f"[승인 후 상세] {p}"
        for p in _approved_violations(after_detail.json(), headline="REVEAL_HEADLINE")
    ]
    if _db_report(rid).is_read is not True:
        problems.append("승인 후 열람했는데 is_read 가 True 가 아님")
    assert not problems, "\n".join(problems)


def test_RX8_approve_all_후_회원_N명_모두_마스킹_해제(client):
    host = _make_host()
    sid = _create_session(client, host, title="X1 일괄 승인 세션")
    members = [_make_member(client, f"x1-bulk{i}@test.com") for i in range(2)]
    ids: dict[str, str] = {}
    for index, member in enumerate(members):
        pid = _add_participant(sid, member)
        ids[str(member["id"])] = _seed_report(
            sid=sid, member=member, pid=pid, status="pending_review", tag="REVEAL",
            created_at=BASE_TIME + timedelta(hours=index), with_subjective=False,
        )
    problems: list[str] = []

    # 승인 전: N 명 모두 마스킹
    for member in members:
        rid = ids[str(member["id"])]
        res = _detail(client, member, rid)
        assert res.status_code == 200, res.text
        if res.json().get("in_review") is not True:
            problems.append(f"승인 전 {member['id']} 상세 in_review != True")
        problems += _leak_violations(res.json(), LEAK_UNTIL_APPROVED)

    res = client.post("/api/v1/reports/approve-all", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["approved"] == 2

    for member in members:
        rid = ids[str(member["id"])]
        detail = _detail(client, member, rid)
        assert detail.status_code == 200
        problems += [
            f"[승인 후 {member['id']}] {p}"
            for p in _approved_violations(detail.json(), headline="REVEAL_HEADLINE")
        ]
        if len(_notifications(str(member["id"]), "report_ready")) != 1:
            problems.append(f"{member['id']} report_ready 알림이 1건이 아님")
    assert not problems, "\n".join(problems)


def test_RX9_자동승인_호스트_세션종료_파이프라인_생성직후_마스킹_승인후_전체(
    client, monkeypatch, celery_eager
):
    from app.services import report_service

    host = _make_host()
    member = _make_member(client, "x1-auto@test.com")
    res = client.patch("/api/v1/reports/auto-approve", json={"enabled": True}, headers=host["auth"])
    assert res.status_code == 200, res.text
    sid = _create_session(client, host, title="X1 자동 승인 세션", start=True)
    _add_participant(sid, member)

    # 승인 직전(= 생성 직후 pending_review 로 커밋된 구간)에 회원이 보는 목록을 포착한다.
    snapshots: list[JsonDict] = []
    real_approve = report_service.approve_report

    def spy_approve(report_id: str, host_id: str, db):
        snapshots.append(report_service.list_reports(str(member["id"]), db))
        return real_approve(report_id, host_id, db)

    monkeypatch.setattr(report_service, "approve_report", spy_approve)

    ended = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert ended.status_code == 200, ended.text

    problems: list[str] = []
    window = [
        row
        for snap in snapshots
        for row in snap["reports"]
        if row["type"] == "client" and row["status"] == "pending_review"
    ]
    if not window:
        problems.append("승인 직전 pending_review 구간을 포착하지 못함(테스트 전제 실패)")
    for row in window:
        problems += [
            f"[생성 직후] {p}"
            for p in _masking_violations(
                row,
                expected={"status": "pending_review", "type": "client", "is_read": False},
                leak_tokens=(),
            )
        ]

    rows = _list(client, member)["reports"]
    client_rows = [r for r in rows if r["type"] == "client"]
    assert len(client_rows) == 1, rows
    row = client_rows[0]
    if row.get("status") != "completed":
        problems.append(f"자동 승인 후 status={row.get('status')!r}")
    if row.get("in_review") is not False:
        problems.append(f"자동 승인 후 in_review != False ({row.get('in_review', '<키 없음>')!r})")
    if (row.get("content") or {}).get("approved") is not True:
        problems.append("자동 승인 후 content.approved != True (전체 content 아님)")
    if row.get("content") == EMPTY_CONTENT:
        problems.append("자동 승인 후에도 content 가 마스킹 빈 구조")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-10 ~ RX-11: 홈 recent_report · 모두 읽음
# ═════════════════════════════════════════════════════════════════════════
def test_RX10_client_home_recent_report_in_review(client):
    host = _make_host()
    member = _make_member(client, "x1-home@test.com")
    sid1 = _create_session(client, host, minutes=120, title="X1 홈 승인 전")
    pid1 = _add_participant(sid1, member)
    pending_id = _seed_report(
        sid=sid1, member=member, pid=pid1, status="pending_review", tag="SECRET",
        created_at=BASE_TIME, with_subjective=False,
    )
    problems: list[str] = []

    res = client.get("/api/v1/client/home", headers=member["auth"])
    assert res.status_code == 200, res.text
    recent = res.json()["recent_report"]
    assert recent is not None, "행 유지: 승인 전 리포트도 recent_report 로 내려간다"
    if recent["id"] != pending_id:
        problems.append("recent_report.id 불일치")
    if recent["title"] != BASE_TIME.strftime("%m월 %d일") + " 리포트":
        problems.append(f"제목 변경됨: {recent['title']!r}")
    if recent.get("in_review") is not True:
        problems.append(f"in_review != True ({recent.get('in_review', '<키 없음>')!r})")
    if set(recent) != {"id", "title", "created_at", "in_review"}:
        problems.append(f"내용 필드 노출/열거되지 않은 키: {sorted(recent)}")
    problems += _leak_violations(recent, LEAK_FOREVER)

    # completed 가 더 최신으로 생기면 그 건이 recent_report, in_review false
    sid2 = _create_session(client, host, minutes=180, title="X1 홈 승인")
    pid2 = _add_participant(sid2, member)
    completed_id = _seed_report(
        sid=sid2, member=member, pid=pid2, status="completed", tag="APPROVED",
        created_at=BASE_TIME + timedelta(days=1), with_subjective=False,
    )
    recent2 = client.get("/api/v1/client/home", headers=member["auth"]).json()["recent_report"]
    if recent2["id"] != completed_id:
        problems.append("completed 추가 후 recent_report.id 불일치")
    if recent2.get("in_review") is not False:
        problems.append(f"completed 의 in_review != False ({recent2.get('in_review', '<키 없음>')!r})")
    assert not problems, "\n".join(problems)


def test_RX11_read_all_은_승인분만_읽음_처리(client):
    env = _scenario(client, ("pending_review", "completed"))
    member = env["member"]

    res = client.put("/api/v1/reports/read-all", headers=member["auth"])

    assert res.status_code == 200, res.text
    problems: list[str] = []
    if res.json()["count"] != 1:
        problems.append(f"count={res.json()['count']} (기대 1 — 승인된 건만)")
    if _db_report(env["ids"]["pending_review"]).is_read is not False:
        problems.append("승인 전 건이 read-all 로 읽음 처리됨(승인 후 NEW 소실)")
    if _db_report(env["ids"]["completed"]).is_read is not True:
        problems.append("승인된 건이 읽음 처리되지 않음")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-12 ~ RX-14: 회귀 고정 (현행에서 GREEN)
# ═════════════════════════════════════════════════════════════════════════
def test_RX12_회원_PDF_다운로드_403_회귀고정(client):
    env = _scenario(client, ("pending_review", "completed"))

    for status in ("pending_review", "completed"):
        res = client.get(f"/api/v1/reports/{env['ids'][status]}/pdf", headers=env["member"]["auth"])
        assert res.status_code == 403, (status, res.text)


def test_RX13_report_status_와_WS_report_progress_상태문자열_Phase0_불변(client, monkeypatch):
    """현행 계약 고정 — 회원 컨텍스트에서도 report_status 는 'pending_review' 문자열 그대로 내려간다.

    TD5: 호스트 UI 와 공유하는 필드라 Phase 0 에서는 바꾸지 않는다(잔여 노출 R4).
    후속(Phase 5)에서 회원 컨텍스트를 분리하면 이 테스트를 개정한다.
    """
    from app.services import report_progress_service as rps
    from app.ws import sync_emit

    env = _scenario(client, ("pending_review",))
    sid = env["sids"]["pending_review"]

    res = client.get(f"/api/v1/sessions/{sid}/report-status", headers=env["member"]["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["report_status"] == "pending_review"

    captured: list[JsonDict] = []

    def fake_sync_emit(session_id: str, payload: JsonDict) -> bool:
        captured.append(payload)
        return True

    monkeypatch.setattr(sync_emit, "emit_report_progress_sync", fake_sync_emit)
    db = _db()
    try:
        payload = rps.emit_report_progress(sid, db)
    finally:
        db.close()
    assert captured and captured[0]["report_status"] == "pending_review"
    assert payload["report_status"] == "pending_review"


def test_RX14_비회원_토큰_열람_PDF는_승인전_403_승인후에만_열림(client):
    """비회원 경로의 completed 필터 회귀 고정. 상세 회귀는 test_sdd052/070 등 기존 파일이 지킨다."""
    from app.services import report_email_service

    env = _scenario(client, ("pending_review",), tag="REVEAL")
    rid, sid = env["ids"]["pending_review"], env["sids"]["pending_review"]
    # 토큰 열람은 participant.report_email 과 토큰 이메일이 일치해야 한다.
    from app.models.session import SessionParticipant

    db = _db()
    try:
        participant = db.query(SessionParticipant).filter(
            SessionParticipant.id == UUID(env["pids"]["pending_review"])
        ).first()
        participant.report_email = "guest-x1@example.com"
        db.commit()
    finally:
        db.close()
    token = report_email_service._token("report_view", rid, sid, email="guest-x1@example.com")

    assert client.get("/api/v1/reports/view", params={"token": token}).status_code == 403
    assert client.get("/api/v1/reports/view/pdf", params={"token": token}).status_code == 403

    from app.models.record import Report

    db = _db()
    try:
        report = db.query(Report).filter(Report.id == UUID(rid)).first()
        report.status = "completed"
        db.commit()
    finally:
        db.close()
    assert client.get("/api/v1/reports/view", params={"token": token}).status_code == 200


def test_RX14_AI_비서_컨텍스트에_승인전_리포트_부재(client):
    from app.services import agent_policy

    env = _scenario(client, ("pending_review", "error", "completed"))
    db = _db()
    try:
        facts = agent_policy.approved_client_reports(env["member"]["id"], db)
    finally:
        db.close()

    assert len(facts) == 1, "completed 1건만"
    assert "SECRET_" not in _dump(facts) and "ERR_TRACE" not in _dump(facts)


# ═════════════════════════════════════════════════════════════════════════
# RX-15: staff 경로 불변
# ═════════════════════════════════════════════════════════════════════════
def _staff_unmasked_problems(rows: list[JsonDict], env: JsonDict) -> list[str]:
    problems: list[str] = []
    by_id = {r["id"]: r for r in rows if r.get("id")}
    pending = by_id.get(env["ids"]["pending_review"])
    errored = by_id.get(env["ids"]["error"])
    if pending is None or errored is None:
        return ["staff 목록에 시드한 pending_review/error 행이 없음"]
    if (pending.get("content") or {}).get("headline") != "RAW_HEADLINE":
        problems.append("staff pending_review 본문이 마스킹됨")
    if pending.get("sdnn_mean") != HRV_SEED_VALUES["sdnn_mean"]:
        problems.append("staff pending_review 지표가 마스킹됨")
    if pending.get("pdf_url") is None:
        problems.append("staff pending_review pdf_url 이 마스킹됨")
    if not str(errored.get("generation_error") or "").startswith("ERR_TRACE_GEN_RAW"):
        problems.append("staff error 행 generation_error 가 마스킹됨")
    if "ERR_TRACE_RAW" not in _dump(errored.get("content")):
        problems.append("staff error 행 content.error 가 마스킹됨")
    return problems


def test_RX15_호스트_본문과_D28_관리자_상담_비공개(client):
    org_code = create_test_org()
    host = _make_host(org_code=org_code)
    org_admin = _make_org_admin(org_code)
    env = _scenario(client, ("pending_review", "error"), tag="RAW", host=host)
    # 리포트가 아직 없는 진행 중 세션 → staff 목록의 합성("생성 중/실패") 행
    bare_sid = _create_session(client, host, minutes=30, title="X1 합성 세션", start=True)

    problems: list[str] = []
    for label, viewer in (("호스트", host), ("org_admin", org_admin)):
        res = client.get("/api/v1/reports", headers=viewer["auth"])
        assert res.status_code == 200, res.text
        rows = res.json()["reports"]
        if label == "호스트":
            problems += [f"[{label} 목록] {p}" for p in _staff_unmasked_problems(rows, env)]
        else:
            # 이 fixture는 clinical 상담이다. D-28 관리자에게 본문 목록을 주지 않는다.
            assert rows == []
            for rid in env["ids"].values():
                assert client.get(f"/api/v1/reports/{rid}", headers=viewer["auth"]).status_code == 403
            continue
        if not any(r["session_id"] == bare_sid and r["id"] is None for r in rows):
            problems.append(f"[{label} 목록] 합성(미생성) 행이 사라짐")

    detail = client.get(f"/api/v1/reports/{env['ids']['pending_review']}", headers=host["auth"])
    assert detail.status_code == 200, detail.text
    if detail.json()["content"].get("headline") != "RAW_HEADLINE":
        problems.append("[호스트 상세] 본문이 마스킹됨")
    if detail.json()["sdnn_mean"] != HRV_SEED_VALUES["sdnn_mean"]:
        problems.append("[호스트 상세] 지표가 마스킹됨")
    assert not problems, "\n".join(problems)


def test_RX15_staff_응답은_in_review_false_가산필드(client):
    host = _make_host()
    env = _scenario(client, ("pending_review", "error"), tag="RAW", host=host)
    _create_session(client, host, minutes=30, title="X1 합성 세션 2", start=True)

    rows = client.get("/api/v1/reports", headers=host["auth"]).json()["reports"]
    detail = client.get(f"/api/v1/reports/{env['ids']['pending_review']}", headers=host["auth"]).json()

    problems = [
        f"목록 행 {row.get('id')} in_review != False ({row.get('in_review', '<키 없음>')!r})"
        for row in rows
        if row.get("in_review") is not False
    ]
    if detail.get("in_review") is not False:
        problems.append(f"상세 in_review != False ({detail.get('in_review', '<키 없음>')!r})")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-16: 재생성
# ═════════════════════════════════════════════════════════════════════════
def _spy_client_content(monkeypatch, member: JsonDict) -> list[JsonDict]:
    """재생성 진행 중(status 가 이미 커밋된 시점)에 회원이 보는 목록을 포착한다."""
    from app.services import report_service
    from app.tasks import report_task

    snapshots: list[JsonDict] = []
    real = report_task._client_content

    def spy(session, record, eeg_block):
        db = _db()
        try:
            snapshots.append(report_service.list_reports(str(member["id"]), db))
        finally:
            db.close()
        return real(session, record, eeg_block)

    monkeypatch.setattr(report_task, "_client_content", spy)
    return snapshots


def test_RX16_미승인_재생성_중_후_계속_마스킹(client, monkeypatch):
    env = _scenario(client, ("pending_review",))
    host, member = env["host"], env["member"]
    sid, pid, rid = env["sids"]["pending_review"], env["pids"]["pending_review"], env["ids"]["pending_review"]
    snapshots = _spy_client_content(monkeypatch, member)

    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": pid},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text

    problems: list[str] = []
    in_flight = [r for snap in snapshots for r in snap["reports"] if r["id"] == rid]
    if not in_flight:
        problems.append("재생성 진행 중 스냅샷을 포착하지 못함(테스트 전제 실패)")
    for row in in_flight:
        if row["status"] != "pending_analysis":
            problems.append(f"진행 중 status={row['status']!r} (pending_analysis 기대)")
        problems += [
            f"[재생성 중] {p}"
            for p in _masking_violations(
                row, expected={"id": rid, "type": "client"}, leak_tokens=LEAK_FOREVER
            )
        ]
    # 재생성 후: 새 content 가 만들어졌지만 아직 미승인 → 마스킹. 이월된 상담사 코멘트(SECRET_COMMENT)도 새면 안 된다.
    after = _detail(client, member, rid)
    assert after.status_code == 200, after.text
    row = after.json()
    if row["status"] != "pending_review":
        problems.append(f"재생성 후 status={row['status']!r}")
    problems += [
        f"[재생성 후] {p}"
        for p in _masking_violations(
            row, expected={"id": rid, "type": "client", "status": "pending_review"},
            leak_tokens=LEAK_FOREVER,
        )
    ]
    assert not problems, "\n".join(problems)


def test_RX16_승인본_재생성은_completed_유지_전체_content(client, monkeypatch):
    env = _scenario(client, ("completed",))
    host, member = env["host"], env["member"]
    sid, pid, rid = env["sids"]["completed"], env["pids"]["completed"], env["ids"]["completed"]
    snapshots = _spy_client_content(monkeypatch, member)

    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": pid},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text

    problems: list[str] = []
    in_flight = [r for snap in snapshots for r in snap["reports"] if r["id"] == rid]
    if not in_flight:
        problems.append("재생성 진행 중 스냅샷을 포착하지 못함(테스트 전제 실패)")
    for row in in_flight:
        if row["status"] != "completed":
            problems.append(f"재생성 중 status={row['status']!r} (completed 유지 기대)")
        if row.get("in_review") is not False:
            problems.append(f"재생성 중 in_review != False ({row.get('in_review', '<키 없음>')!r})")
        if row.get("content") == EMPTY_CONTENT:
            problems.append("재생성 중 승인본 content 가 마스킹됨")

    after = _detail(client, member, rid).json()
    if after["status"] != "completed":
        problems.append(f"재생성 후 status={after['status']!r}")
    if after.get("in_review") is not False:
        problems.append(f"재생성 후 in_review != False ({after.get('in_review', '<키 없음>')!r})")
    if after["content"] == EMPTY_CONTENT or "report_scope" not in after["content"]:
        problems.append("재생성 후 승인본 content 가 전체 content 가 아님")
    if after["content"].get("counselor_comment") != "APPROVED_COMMENT":
        problems.append("재생성 후 상담사 코멘트 이월 실패")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-22 · CS-11 ③: 구 앱 호환(키 보존·타입 태그)
# ═════════════════════════════════════════════════════════════════════════
def test_RX22_마스킹_응답_키집합_승인응답과_동일_타입_불변(client):
    env = _scenario(client, ("pending_analysis", "pending_review", "error", "completed"))
    rows = {r["id"]: r for r in _list(client, env["member"])["reports"]}
    problems: list[str] = []

    for status, rid in env["ids"].items():
        row = rows[rid]
        keys = set(row)
        if keys != ALL_KEYS:
            problems.append(
                f"[{status}] 키 집합 != ReportResponse 키 + in_review: "
                f"누락={sorted(ALL_KEYS - keys)} 초과={sorted(keys - ALL_KEYS)}"
            )
        if not isinstance(row.get("content"), dict):
            problems.append(f"[{status}] content 가 객체가 아님: {_tag(row.get('content'))}")
        for key in HRV_KEYS:
            if _tag(row.get(key)) not in {"number", "null"}:
                problems.append(f"[{status}] {key} 타입 {_tag(row.get(key))} (number|null 기대)")
        if row.get("status") != status:
            problems.append(f"[{status}] status 문자열 변경됨: {row.get('status')!r}")
        if row.get("generation_status") != _GENERATION_STATUS[status]:
            problems.append(f"[{status}] generation_status 문자열 변경됨: {row.get('generation_status')!r}")
    assert not problems, "\n".join(problems)


def test_RX22_allowlist_는_ReportResponse_필드와_일치_새필드는_분류_강제():
    """ReportResponse 에 필드가 추가되면 이 테스트가 실패해 마스킹/보존 분류를 강제한다."""
    assert set(ReportResponse.model_fields) | {"in_review"} == set(ALL_KEYS)
    assert tuple(HRVMotionSummary.model_fields) == HRV_KEYS, "HRV 10개 지표 목록 변경 시 마스킹 목록도 갱신"


def test_RX22_ReportResponse_에_in_review_가산필드_기본값_False():
    field = ReportResponse.model_fields.get("in_review")
    assert field is not None, "ReportResponse.in_review 미구현"
    assert field.default is False


def test_CS11_목록_상세_미승인_승인_키집합_동일_타입태그(client):
    """CS-11 ③ — GET /reports·GET /reports/{id}: 마스킹/승인 응답 키 집합 동일(= ReportResponse 키 + in_review)."""
    env = _scenario(client, ("pending_review", "completed"))
    member = env["member"]
    list_rows = {r["id"]: r for r in _list(client, member)["reports"]}
    shapes: dict[str, JsonDict] = {
        "list/pending_review": list_rows[env["ids"]["pending_review"]],
        "list/completed": list_rows[env["ids"]["completed"]],
        "detail/pending_review": _detail(client, member, env["ids"]["pending_review"]).json(),
        "detail/completed": _detail(client, member, env["ids"]["completed"]).json(),
    }
    problems: list[str] = []
    for label, row in shapes.items():
        if set(row) != ALL_KEYS:
            problems.append(
                f"[{label}] 키 집합 불일치: 누락={sorted(ALL_KEYS - set(row))} 초과={sorted(set(row) - ALL_KEYS)}"
            )
        for key, value in row.items():
            allowed = ALLOWED_TAGS.get(key)
            if allowed is not None and _tag(value) not in allowed:
                problems.append(f"[{label}] {key} 타입 태그 {_tag(value)} ∉ {sorted(allowed)}")
    key_sets = {label: frozenset(row) for label, row in shapes.items()}
    if len(set(key_sets.values())) != 1:
        problems.append("마스킹/승인, 목록/상세 사이 키 집합이 서로 다름")
    assert not problems, "\n".join(problems)


# ═════════════════════════════════════════════════════════════════════════
# RX-23: U3 변경 — report_generation_failed 는 호스트에게만 (plan §13.2)
# ═════════════════════════════════════════════════════════════════════════
def test_RX23_client_리포트_생성_실패_알림은_호스트에게만(client, monkeypatch):
    from app.tasks import report_task

    env = _scenario(client, ("pending_review",))
    host, member = env["host"], env["member"]
    sid, pid = env["sids"]["pending_review"], env["pids"]["pending_review"]

    def boom(session, record, eeg_block):
        raise RuntimeError("FORCED_GENERATION_FAILURE")

    monkeypatch.setattr(report_task, "_client_content", boom)

    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": pid},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "error", "전제: 생성 실패로 error 전이"

    to_member = _notifications(str(member["id"]), "report_generation_failed")
    to_host = _notifications(str(host["id"]), "report_generation_failed")
    problems: list[str] = []
    if to_member:
        problems.append(f"회원에게 report_generation_failed {len(to_member)}건 발송됨(중단되어야 함)")
    if len(to_host) != 1:
        problems.append(f"호스트 수신 {len(to_host)}건 (기대 1건)")
    assert not problems, "\n".join(problems)


def test_RX23_counselor_리포트_생성_실패_알림은_호스트_1건_회귀고정(client, monkeypatch):
    from app.tasks import report_task

    host = _make_host()
    member = _make_member(client, "x1-fail-counselor@test.com")
    sid = _create_session(client, host, title="X1 상담사 리포트 실패")
    _add_participant(sid, member)

    def boom(session, record, eeg_block):
        raise RuntimeError("FORCED_COUNSELOR_FAILURE")

    monkeypatch.setattr(report_task, "_counselor_content", boom)

    res = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "error", "전제: 생성 실패로 error 전이"

    assert len(_notifications(str(host["id"]), "report_generation_failed")) == 1
    assert _notifications(str(member["id"]), "report_generation_failed") == []

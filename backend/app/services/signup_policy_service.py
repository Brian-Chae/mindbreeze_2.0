"""SDD-220 — 신규 계정 생성 경로 공통 검증 (만 14세 · 필수 동의 · 탈퇴 처리 중 이메일).

이메일·Google·Apple·레거시 /auth/register·가입 신청이 같은 규칙을 거치게 한다.
클라이언트 검사는 신뢰하지 않으며, 서버가 매번 다시 확인한다.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.consent import Consent
from app.models.user import User

# 서버 기준일은 Asia/Seoul 달력 날짜(UTC+9, 서머타임 없음).
KST = timezone(timedelta(hours=9))
MIN_SIGNUP_AGE = 14

# 게시된 약관 버전. 가입 시점의 게시 버전을 그대로 consents.version 에 저장한다(기존 컬럼 재사용).
CONSENT_VERSIONS: dict[str, str] = {
    "tos": "1.0",
    "privacy": "1.0",
    "sensitive": "1.0",
    "eeg": "1.0",
    "research": "1.0",
}
REQUIRED_CONSENT_TYPES = ("tos", "privacy", "sensitive")
OPTIONAL_CONSENT_TYPES = ("eeg", "research")


def api_error(http_status: int, code: str, message: str) -> HTTPException:
    """오류 코드를 detail.code 로 싣는 예외 — 기존 클래스 API 와 같은 형식."""
    # msg 는 프론트 formatErrorDetail 이 읽는 키 — message 와 같은 문구를 싣는다.
    return HTTPException(status_code=http_status, detail={"code": code, "message": message, "msg": message})


def today_kst(now: datetime | None = None) -> date:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(KST).date()


def _years_between(birth: date, today: date) -> int:
    years = today.year - birth.year
    if (today.month, today.day) < (birth.month, birth.day):
        years -= 1
    return years


def is_age_eligible(birth: date, today: date) -> bool:
    """생일 당일부터 만 14세 허용. 2월 29일생은 평년에 3월 1일이 되어야 생일이 지난 것으로 본다."""
    return _years_between(birth, today) >= MIN_SIGNUP_AGE


def validate_birth_date(value: str | date | None, *, today: date | None = None, required: bool = True) -> date | None:
    """신규 계정의 생년월일 검증.

    - 빈 값: 422 BIRTH_DATE_REQUIRED (required=False 이면 None 반환)
    - 형식 오류·미래·비현실적 과거: 422 INVALID_BIRTH_DATE
    - 만 14세 미만: 422 AGE_RESTRICTED
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise api_error(422, "BIRTH_DATE_REQUIRED", "생년월일을 입력해 주세요")
        return None
    base = today or today_kst()
    if isinstance(value, date):
        birth = value
    else:
        try:
            birth = date.fromisoformat(value.strip())
        except ValueError:
            raise api_error(422, "INVALID_BIRTH_DATE", "생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    if birth > base or birth.year < 1900:
        raise api_error(422, "INVALID_BIRTH_DATE", "생년월일이 올바르지 않습니다")
    if not is_age_eligible(birth, base):
        raise api_error(422, "AGE_RESTRICTED", "만 14세 이상만 가입할 수 있어요")
    return birth


def validate_required_consents(consents: Any) -> None:
    """tos/privacy/sensitive 필수 동의 — 누락·거부 시 422(가입 행 0).

    기존 클라이언트·테스트가 detail 문구(문자열)를 읽으므로 문구는 유지하고,
    오류 코드는 ``X-Error-Code: CONSENT_REQUIRED`` 헤더로 싣는다.
    """
    headers = {"X-Error-Code": "CONSENT_REQUIRED"}
    if consents is None:
        message = "서비스 이용약관·개인정보 처리방침·민감정보 처리에 모두 동의해야 가입할 수 있습니다"
    elif not (getattr(consents, "tos", False) and getattr(consents, "privacy", False)):
        message = "서비스 이용약관/개인정보 처리방침 동의는 필수입니다"
    elif not getattr(consents, "sensitive", False):
        message = "민감정보 처리에 동의해야 가입할 수 있습니다"
    else:
        return
    raise HTTPException(status_code=422, detail=message, headers=headers)


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def email_hash(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


def assert_email_not_pending_deletion(db: Session, email: str) -> None:
    """F2 — 탈퇴 처리 중(영구 삭제 전) 이메일은 모든 가입 경로에서 거부한다.

    본인 탈퇴는 users.email 을 자리표시 주소로 바꾸므로 삭제 원장의 이메일 해시로 판정한다
    (원장이 purged 가 되기 전에는 날짜가 30일을 넘었어도 계속 차단). 관리자 삭제처럼 원본 이메일이
    남은 deleted 행도 함께 차단한다.
    """
    from app.models.account_deletion import AccountDeletionLedger

    existing = db.query(User).filter(func.lower(User.email) == normalize_email(email)).first()
    pending_ledger = (
        db.query(AccountDeletionLedger.id)
        .filter(AccountDeletionLedger.email_hash == email_hash(email), AccountDeletionLedger.status != "purged")
        .first()
    )
    if (existing is not None and existing.status == "deleted") or pending_ledger is not None:
        raise api_error(409, "ACCOUNT_DELETION_PENDING", "탈퇴 처리 중인 이메일이에요. 영구 삭제가 끝난 뒤 다시 가입할 수 있어요")


def record_consents(db: Session, user_id: Any, consents: Any, *, now: datetime | None = None) -> None:
    """제출된 동의를 게시 버전과 함께 저장한다. 선택 동의(eeg/research)는 제출값 그대로(미제출=거부)."""
    stamp = now or datetime.now(timezone.utc)
    for ctype in (*REQUIRED_CONSENT_TYPES, *OPTIONAL_CONSENT_TYPES):
        agreed = bool(getattr(consents, ctype, False))
        # 거부한 선택 동의도 agreed=False 이력으로 남긴다(true 로 추정하지 않음).
        db.add(
            Consent(
                user_id=user_id,
                type=ctype,
                version=CONSENT_VERSIONS[ctype],
                agreed=agreed,
                agreed_at=stamp,
            )
        )


def validate_new_account(db: Session, *, email: str, birth_date: str | date | None, consents: Any) -> date:
    """신규 계정 생성 직전 공통 검증. 거부 시 User·Consent·토큰 생성은 일어나지 않는다."""
    assert_email_not_pending_deletion(db, email)
    birth = validate_birth_date(birth_date, required=True)
    validate_required_consents(consents)
    assert birth is not None
    return birth

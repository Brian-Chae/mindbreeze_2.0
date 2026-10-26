"""영업일 기한 계산 — [MB261026][FIX] 채팅 신고 처리 기한(D4).

D4 승인 기한: 접수 확인 2영업일 · 1차 판단 5영업일.
규칙: 접수 시각을 KST 로 바꾼 접수일 D 의 **다음 날부터** 영업일(월~금, 휴일 제외)을 세어
n 번째 영업일의 23:59:59 KST 가 기한이다.
  예) 금 15:00 접수 → 2영업일 = 다음 주 화 23:59:59, 5영업일 = 다음 주 금 23:59:59.
휴일은 설정값으로만 받는다(기본 없음 = 주말만). 공휴일을 세지 않으면 기한이 더 짧아져
약속보다 엄격해지므로 안전 측이다.
"""

import logging
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
ACK_BUSINESS_DAYS = 2
DECISION_BUSINESS_DAYS = 5


def parse_holidays(raw: str | None) -> frozenset[date]:
    """쉼표 구분 YYYY-MM-DD 를 날짜 집합으로. 잘못된 값은 버리고 경고만 남긴다."""
    result: set[date] = set()
    for token in (raw or "").split(","):
        value = token.strip()
        if not value:
            continue
        try:
            result.add(date.fromisoformat(value))
        except ValueError:
            logger.warning("신고 기한 휴일 설정에 잘못된 날짜가 있어 무시합니다: %r", value)
    return frozenset(result)


def _to_kst(value: datetime) -> datetime:
    # SQLite 등은 시간대 없는 UTC 값을 돌려준다 — UTC 로 간주한다.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(KST)


def business_day_deadline(received_at: datetime, n: int, holidays: Iterable[date] = ()) -> datetime:
    """접수일 다음 날부터 n 번째 영업일의 23:59:59 KST."""
    if n < 1:
        raise ValueError("n 은 1 이상이어야 합니다")
    off_days = frozenset(holidays)
    day = _to_kst(received_at).date()
    counted = 0
    while counted < n:
        day += timedelta(days=1)
        if day.weekday() < 5 and day not in off_days:
            counted += 1
    return datetime.combine(day, time(23, 59, 59), tzinfo=KST)


def report_deadlines(received_at: datetime, holidays: Iterable[date] = ()) -> tuple[datetime, datetime]:
    """(접수 확인 기한, 1차 판단 기한)."""
    off_days = frozenset(holidays)
    return (
        business_day_deadline(received_at, ACK_BUSINESS_DAYS, off_days),
        business_day_deadline(received_at, DECISION_BUSINESS_DAYS, off_days),
    )

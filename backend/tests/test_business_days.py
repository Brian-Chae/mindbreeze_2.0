"""[MB261026][FIX] 채팅 신고 처리 기한(D4) — 영업일 계산 V-21~V-26.

기한 = 접수일(KST) 다음 날부터 영업일(월~금, 휴일 제외)을 세어 n번째 날의 23:59:59 KST.
"""

import logging
from datetime import date, datetime, timedelta, timezone

from app.services.business_days import (
    KST,
    business_day_deadline,
    parse_holidays,
    report_deadlines,
)


def _kst(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=KST)


def _end(y, m, d):
    return datetime(y, m, d, 23, 59, 59, tzinfo=KST)


# 2026-10-26 은 월요일이다.
MON = (2026, 10, 26)


def test_V21_월요일_접수는_수요일_확인_다음주_월요일_판단():
    ack, decision = report_deadlines(_kst(*MON, 10, 0))
    assert ack == _end(2026, 10, 28)
    assert decision == _end(2026, 11, 2)


def test_V22_금요일_접수는_화요일_확인_다음주_금요일_판단():
    ack, decision = report_deadlines(_kst(2026, 10, 30, 15, 0))
    assert ack == _end(2026, 11, 3)
    assert decision == _end(2026, 11, 6)


def test_V23_주말_접수는_화요일_확인_금요일_판단():
    for received in (_kst(2026, 10, 31, 11, 0), _kst(2026, 11, 1, 23, 30)):
        ack, decision = report_deadlines(received)
        assert ack == _end(2026, 11, 3)
        assert decision == _end(2026, 11, 6)


def test_V24_UTC_날짜가_아니라_KST_날짜로_센다():
    # 일요일 16:00 UTC = 월요일 01:00 KST → 월요일 접수
    received = datetime(2026, 10, 25, 16, 0, tzinfo=timezone.utc)
    ack, decision = report_deadlines(received)
    assert ack == _end(2026, 10, 28)
    assert decision == _end(2026, 11, 2)


def test_V24_시간대_없는_값은_UTC로_본다():
    # SQLite 는 created_at 을 naive UTC 로 돌려준다.
    received = datetime(2026, 10, 25, 16, 0)
    assert report_deadlines(received)[0] == _end(2026, 10, 28)


def test_V25_휴일은_영업일에서_뺀다():
    holidays = parse_holidays("2026-11-02")  # 다음 주 월요일 휴일
    ack, decision = report_deadlines(_kst(2026, 10, 30, 15, 0), holidays)
    assert ack == _end(2026, 11, 4)
    assert decision == _end(2026, 11, 9)


def test_V26_잘못된_휴일_값은_무시하고_경고한다(caplog):
    with caplog.at_level(logging.WARNING):
        holidays = parse_holidays("2026-13-01, abc, ,2026-11-02")
    assert holidays == frozenset({date(2026, 11, 2)})
    assert sum("휴일" in r.getMessage() for r in caplog.records) == 2
    ack, _ = report_deadlines(_kst(*MON, 10, 0), parse_holidays("2026-13-01, abc"))
    assert ack == _end(2026, 10, 28)


def test_빈_휴일_설정은_주말만_뺀다():
    assert parse_holidays("") == frozenset()
    assert business_day_deadline(_kst(*MON, 9, 0), 1) == _end(2026, 10, 27)


def test_기한은_23시59분59초_KST다():
    deadline = business_day_deadline(_kst(*MON, 23, 59), 2)
    assert deadline.utcoffset() == timedelta(hours=9)
    assert (deadline.hour, deadline.minute, deadline.second) == (23, 59, 59)

"""SDD-218 D1~D4: 자동 승인의 명상/상담 영역 분리 (D-37 공통 안전 분리).

이번 범위는 **분기점 도입만**이다. 두 영역 모두 기존과 똑같이 동작해야 한다.
한쪽 동작이 달라지면 D-37 범위를 넘은 것이므로 테스트가 깨져야 한다.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.services import report_service


def _host(*, role="counselor", auto=True):
    return SimpleNamespace(id=uuid.uuid4(), role=role, auto_approve_report=auto)


def _session(*, class_id=None):
    return SimpleNamespace(id=uuid.uuid4(), class_id=class_id)


def test_영역_판정은_클래스_소속_여부로_갈린다():
    assert report_service.report_domain(_session(class_id=uuid.uuid4())) == "meditation"
    assert report_service.report_domain(_session()) == "counseling"
    assert report_service.report_domain(None) == "counseling"


def test_d1_명상_클래스에서_자동_승인은_기존과_같다():
    assert report_service.auto_approve_enabled(
        _host(auto=True), _session(class_id=uuid.uuid4())) is True
    assert report_service.auto_approve_enabled(
        _host(auto=False), _session(class_id=uuid.uuid4())) is False


def test_d2_상담에서_자동_승인은_기존과_같다():
    """D-37 범위: 상담 동작을 이번에 바꾸지 않는다."""
    assert report_service.auto_approve_enabled(_host(auto=True), _session()) is True
    assert report_service.auto_approve_enabled(_host(auto=False), _session()) is False


def test_d2_두_영역의_판정이_현재는_동일하다():
    """분기점만 만들고 동작은 아직 가르지 않았다는 사실을 고정한다."""
    for auto in (True, False):
        host = _host(auto=auto)
        assert report_service.auto_approve_enabled(host, _session(class_id=uuid.uuid4())) \
            == report_service.auto_approve_enabled(host, _session())


def test_상담사가_아니면_영역과_무관하게_자동_승인하지_않는다():
    for session in (_session(), _session(class_id=uuid.uuid4())):
        assert report_service.auto_approve_enabled(_host(role="org_admin"), session) is False
        assert report_service.auto_approve_enabled(None, session) is False


def test_d4_자동_승인도_approve_report_단일_진입점을_쓴다():
    """훅 일원화 — 생성 경로가 approve_report 를 거치는지 소스로 확인한다."""
    import inspect

    source = inspect.getsource(report_service.generate_client_reports_for_session)
    assert "approve_report" in source
    # 자동 승인 판정은 분기 함수를 거쳐야 한다.
    assert "auto_approve_enabled" in source

"""명령 계측은 단계별 최대치/원인 수를 합산하고 세션·종류별 10초에 한 줄만 출력한다."""
import logging


def test_계측은_한_윈도우의_실패_원인과_최대치를_보존하고_로그를_제한(caplog):
    from app.services import live_command_timing as timing
    timing._windows.clear()
    caplog.set_level(logging.INFO, logger=timing.__name__)
    for i in range(100):
        timing.observe('synthetic', 'capture.renew', 'single_flight_wait' if i < 3 else 'lease_only',
                       {'apply_ms': float(i), 'projection_ms': 2000.0 if i < 3 else 0.0}, now=0.0)
    assert not caplog.records
    timing.observe('synthetic', 'capture.renew', 'lease_only', {'apply_ms': 1.0}, now=10.0)
    assert len(caplog.records) == 1
    msg = caplog.records[0].getMessage()
    assert 'live_command_timing' in msg and 'single_flight_wait' in msg and '2000.0' in msg
    assert '99.0' in msg and 'count=101' in msg
    timing.observe('synthetic', 'capture.renew', 'lease_only', {}, now=10.1)
    assert len(caplog.records) == 1


def test_busy_result는_내부_대기원인을_구분():
    from app.services import live_single_flight as sf
    assert sf._busy_result('single_flight_wait').wait_reason == 'single_flight_wait'
    assert sf._busy_result('publish_skip').wait_reason == 'publish_skip'

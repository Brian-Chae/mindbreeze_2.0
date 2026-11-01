"""SDD-269 — 결측 구간 API(저장 데이터 파생) 통합 시험: 실측 모양 fixture, 권한, 쿼리 수, 독립 SQL 대조."""
import uuid

import pytest
from sqlalchemy import event, text

from app.models.biosignal import BiosignalGapEvent
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from tests.sdd243_helpers import auth, db, dc_enabled, world  # noqa: F401
from tests.test_sdd243_measurements import (  # noqa: F401
    FakeBackend, backend_env, build_manifest, chunk_ref, eeg_maker, wf)

BASE = '/api/v1/data-center'
Q0 = {85, 86, 87, 90, 91, 92, 93, 94, 95, 97, 98, 99}
T0_MS = 1_700_000_000_000.0


def seed_fbb7ee46(db, sess, part):
    """실측 회차 모양: 품질0 85~87/90~95/97~99, window 101→102 간격 11.73초, 재연결 segment 사이 간격."""
    for i in range(80, 102):
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, window_index=i,
                                quality='invalid' if i in Q0 else 'valid', signal_quality=0.0 if i in Q0 else 0.9,
                                device_timestamp_ms=T0_MS + i * 1000))
    for i, extra in ((102, 11_730), (103, 12_730)):
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, window_index=i,
                                quality='valid', signal_quality=0.9, device_timestamp_ms=T0_MS + 101_000 + extra))
    db.flush()


def get_gaps(client, w, part=None, sess=None, user=None):
    part, sess = part or w.p_a1_c, sess or w.s_a1
    return client.get(f'{BASE}/measurements/{sess.id}/{part.id}/gaps', headers=auth(user or w.admin_a))


def test_A02_실측_모양_요약(client, world, db, dc_enabled):
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    body = get_gaps(client, world).json()
    assert [(round(int(g['start_us']) / 1e6), round((int(g['end_us']) - int(g['start_us'])) / 1e6, 2)) for g in body['gaps']] == [
        (5, 3.0), (10, 6.0), (17, 3.0), (22, 10.73)]  # 원점 = 최소 창 시각(80초)
    assert all(g['source'] == 'derived' for g in body['gaps'])
    assert body['count'] == 4 and body['total_seconds'] == 22.7
    assert {g['reason'] for g in body['gaps']} == {'signal_lost', 'unknown'}


def test_A04_독립_SQL_대조(client, world, db, dc_enabled):
    """서비스 결과와 별개로, 창 간격을 SQL(lead)로 계산해 큰 간격 합이 일치하는지 대조(품질0 제외 규칙 R3 부분)."""
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    rows = db.execute(text(
        "SELECT device_timestamp_ms - prev - 1000 AS gap FROM (SELECT device_timestamp_ms, "
        "LAG(device_timestamp_ms) OVER (ORDER BY window_index) AS prev FROM eeg_feature_windows "
        "WHERE participant_id = :p) t WHERE prev IS NOT NULL AND device_timestamp_ms - prev > 1500"),
        {'p': str(world.p_a1_c.id)}).fetchall()
    sql_gap_ms = [r[0] for r in rows]
    assert sql_gap_ms == [pytest.approx(10_730)]
    body = get_gaps(client, world).json()
    time_gap = [g for g in body['gaps'] if g['reason'] == 'unknown']
    assert int(time_gap[0]['end_us']) - int(time_gap[0]['start_us']) == round(sql_gap_ms[0] * 1000)


def test_A03_권한(client, world, db, dc_enabled):
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    assert get_gaps(client, world, user=world.admin_none).status_code in (403, 404)
    r = client.get(f'{BASE}/measurements/{uuid.uuid4()}/{uuid.uuid4()}/gaps', headers=auth(world.admin_a))
    assert r.status_code == 404
    assert get_gaps(client, world, part=world.p_b1_c, sess=world.s_b1).status_code == 404  # 타 기관 참여자


def test_V_R11_기록구간_우선(client, world, db, dc_enabled):
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    db.add(BiosignalGapEvent(id=uuid.uuid4(), session_id=world.s_a1.id, participant_id=world.p_a1_c.id,
                             event_id='e1', sequence=0, signal='eeg', stream_id='s', segment_id='g',
                             start_us=22_000_000, end_us=40_000_000, discovered_at_us=0, reason='ble_disconnect',
                             observed_or_estimated='observed', payload_hash='h'))
    db.flush()
    gaps = get_gaps(client, world).json()['gaps']
    rec = [g for g in gaps if g['source'] == 'recorded']
    assert len(rec) == 1 and rec[0]['reason'] == 'ble_disconnect'
    assert not [g for g in gaps if g['source'] == 'derived' and int(g['start_us']) >= 22_000_000]


def test_A01_파형_응답에_파생_구간_가산(client, world, db, dc_enabled, backend_env):
    chunks = [chunk_ref(i) for i in range(30)]
    backend_env(FakeBackend(build_manifest(chunks), eeg_maker()))
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    body = wf(client, world).json()
    assert body['availability'] == 'available'
    derived = [g for g in body['gaps'] if g['source'] == 'derived']
    assert len(derived) == 4
    narrow = wf(client, world, from_us=0, to_us=2_000_000).json()  # 요청 구간 밖 파생은 제외
    assert not [g for g in narrow['gaps'] if g['source'] == 'derived']


def test_V_P01_쿼리_수_고정(client, world, db, dc_enabled):
    seed_fbb7ee46(db, world.s_a1, world.p_a1_c)
    stmts = []

    def hook(conn, cursor, statement, *a):
        stmts.append(statement)
    event.listen(db.bind, 'before_cursor_execute', hook)
    try:
        assert get_gaps(client, world).status_code == 200
    finally:
        event.remove(db.bind, 'before_cursor_execute', hook)
    mine = [s for s in stmts if 'eeg_feature_windows' in s or 'eeg_raw_chunks' in s or 'biosignal_gap_events' in s]
    assert len(mine) == 3, mine


def test_V_P02_대용량_응답시간(client, world, db, dc_enabled):
    """회차에 600창 × 참여자 2명(결번 2%·품질0 3%)이 쌓인 상태에서 참여자 1명 요청 시간.
    쿼리가 참여자 단위(3개 고정)라 같은 회차의 다른 참여자 수와 무관하다."""
    import random
    import time
    rnd = random.Random(269)
    for part in (world.p_a1_c, world.p_a1_c2):
        for i in range(600):
            if rnd.random() < 0.02:
                continue
            bad = rnd.random() < 0.03
            db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=world.s_a1.id, participant_id=part.id, window_index=i,
                                    quality='invalid' if bad else 'valid', signal_quality=0.0 if bad else 0.9,
                                    device_timestamp_ms=T0_MS + i * 1000))
    db.flush()
    t = time.perf_counter()
    r = get_gaps(client, world)
    ms = (time.perf_counter() - t) * 1000
    assert r.status_code == 200 and r.json()['count'] > 0
    print(f'GAPS_600_WINDOWS_MS={ms:.0f}')
    assert ms < 300


def seed_real_shape(db, sess, part):
    """dev 실측 모양: 창=절대 epoch ms(원점 1793533138216), 측정 기록 파일=세션 상대 ms(최소 -55), 원점 다름."""
    base = 1_793_533_138_216.0
    for i in range(0, 143):
        if i in (102,):
            continue
        t = base + i * 1000 + (11_730 - 1000 if i >= 102 else 0)
        bad = i in Q0
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, window_index=i,
                                quality='invalid' if bad else 'valid', signal_quality=0.0 if bad else 0.9,
                                device_timestamp_ms=t))
    # 창 101 -> 103 로 만들어 간격 11.73초 재현(위에서 102 제거 + 이후 시각 이동은 index 결번 포함)
    spans = [(-55.0, 100_270.0), (115_342.0, 144_238.0)]
    for k, (a, b) in enumerate(spans):
        db.add(EEGRawChunk(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, stream_id='s', chunk_index=k,
                           start_ms=a, end_ms=b, object_key=f'k{k}', signal_type='eeg', segment_id=f'seg{k}',
                           upload_status='uploaded'))
    db.flush()


def test_실데이터_모양_원점_다름_RED(client, world, db, dc_enabled):
    seed_real_shape(db, world.s_a1, world.p_a1_c)
    gaps = get_gaps(client, world).json()['gaps']
    assert gaps and max(int(g['end_us']) for g in gaps) < 200_000_000, gaps  # 1.79e12 ms 위치로 튀지 않는다
    assert all(int(g['start_us']) >= 0 for g in gaps)


def test_창기반과_파일기반_같은_끊김은_하나로_병합(client, world, db, dc_enabled):
    seed_real_shape(db, world.s_a1, world.p_a1_c)
    body = get_gaps(client, world).json()
    around = [g for g in body['gaps'] if int(g['end_us']) > 100_000_000 and int(g['start_us']) < 116_000_000]
    assert len(around) == 1, around  # 11.7초(창) 와 15.1초(파일) 가 겹쳐 하나
    length = (int(around[0]['end_us']) - int(around[0]['start_us'])) / 1e6
    assert 14.9 <= length <= 15.2

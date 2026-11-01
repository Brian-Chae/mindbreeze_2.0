"""SDD-271 — end_us 없는 기록 구간을 다음 데이터 시점으로 닫는다. 05ed4aa8 실측 모양 fixture."""
import uuid

from app.models.biosignal import BiosignalGapEvent
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.services import gap_derivation as gd
from tests.sdd243_helpers import auth, db, dc_enabled, world  # noqa: F401

BASE = '/api/v1/data-center'
T0 = 1_700_000_000_000.0


def seed(db, sess, part, *, with_segments=True, tail=True):
    """창 0~89 정상, 89→90 사이 12.65초 간격. segment 두 개(간격 14.91초). 열린 기록 구간 3행(eeg/ppg/acc)."""
    for i in range(0, 91):
        t = T0 + i * 1000 + (11_650 if i >= 90 else 0)
        if not tail and i >= 90:
            continue
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, window_index=i,
                                quality='valid', signal_quality=0.9, device_timestamp_ms=t))
    if with_segments:
        for sig in ('eeg', 'ppg', 'acc'):
            for k, (a, b) in enumerate([(0.0, 89_000.0), (103_910.0, 130_000.0)]):
                db.add(EEGRawChunk(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, stream_id=f's{sig}',
                                   chunk_index=k, start_ms=a, end_ms=b, object_key=f'{sig}{k}', signal_type=sig,
                                   segment_id=f'{sig}{k}', upload_status='uploaded'))
    for seq, sig in enumerate(('eeg', 'ppg', 'acc')):
        db.add(BiosignalGapEvent(id=uuid.uuid4(), session_id=sess.id, participant_id=part.id, event_id=f'e{seq}',
                                 sequence=seq, signal=sig, stream_id='s', segment_id='g', start_us=89_000_000,
                                 end_us=None, discovered_at_us=0, reason='clock_reset', observed_or_estimated='observed',
                                 reconnect_count=2, payload_hash='h'))
    db.flush()


def gaps(client, w):
    return client.get(f'{BASE}/measurements/{w.s_a1.id}/{w.p_a1_c.id}/gaps', headers=auth(w.admin_a)).json()


def test_A1_다음_segment_시작으로_닫는다(client, world, db, dc_enabled):
    seed(db, world.s_a1, world.p_a1_c)
    body = gaps(client, world)
    rec = [g for g in body['gaps'] if g['source'] == 'recorded']
    assert len(rec) == 3 and all(g['end_us'] == '103910000' and g['end_inferred'] for g in rec)
    assert body['total_seconds'] >= 3 * 14.9  # 신호별 14.91초씩
    derived = [g for g in body['gaps'] if g['source'] == 'derived']
    assert not derived  # 기록 구간이 같은 끊김을 덮는다(중복 제거)


def test_A2_segment_없으면_다음_창으로_닫는다(client, world, db, dc_enabled):
    seed(db, world.s_a1, world.p_a1_c, with_segments=False)
    rec = [g for g in gaps(client, world)['gaps'] if g['source'] == 'recorded']
    assert len(rec) == 3 and all(g['end_inferred'] for g in rec)
    assert {round((int(g['end_us']) - int(g['start_us'])) / 1e6, 1) for g in rec} == {12.7}  # 창 89→90 간격 근거


def test_A3_이후_데이터_없으면_열린_채(client, world, db, dc_enabled):
    seed(db, world.s_a1, world.p_a1_c, with_segments=False, tail=False)
    body = gaps(client, world)
    rec = [g for g in body['gaps'] if g['source'] == 'recorded']
    assert len(rec) == 3 and all(g['end_us'] is None and not g['end_inferred'] for g in rec)
    assert body['total_seconds'] == 0.0


def test_A4_순수함수_역전은_닫지_않는다():
    assert gd.close_open([('eeg', 100.0)], {'eeg': [50.0, 100.0]}, [90.0]) == {}
    assert gd.close_open([('eeg', 100.0)], {'eeg': [150.0]}, [120.0]) == {0: (150.0, 'segment')}
    assert gd.close_open([('ppg', 100.0)], {'eeg': [150.0]}, [120.0]) == {0: (120.0, 'window')}

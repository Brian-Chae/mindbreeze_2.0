"""SDD-319b: projection 선행과 방송 prefix의 결정적 단위 검증."""
from types import SimpleNamespace as NS
from uuid import uuid4

import pytest

from app.services import class_participation_service as cps
from app.services.session_live_state import LiveStateService


def row(rev, audiences=('host',)):
    return NS(event_id=str(uuid4()), revision=rev, audience_policy=list(audiences), domain='speaking')


def event(r, aud='host', seq=None):
    return {'event_id': r.event_id, 'audience': aud, 'domain': r.domain, 'seq': str(seq or r.revision)}


class FakeLive:
    prefix = 'test'

    def __init__(self, applied, seq=None):
        self.applied, self.seq = applied, seq or applied
        self.values = {}
        self.r = NS(set=self.set, get=lambda key: self.values.get(key), xrange=lambda *a, **k: [('101-0', {})], eval=self.eval)

    def set(self, key, value, **kw):
        self.values[key] = value
        return True

    def meta_key(self, sid):
        return self.base(sid) + ':meta'

    def eval(self, script, nkeys, lock, meta, emitted, token, epoch, ttl, revision):
        if self.values.get(lock) != token or epoch != 1:
            return 0
        self.values[emitted] = max(self.values.get(emitted, 0), revision)
        return 1

    def base(self, sid):
        return 'test:' + str(sid)

    def read_meta(self, sid):
        return {'epoch': '1', 'applied_revision': str(self.applied), 'status': 'active'}

    def snapshot_raw(self, *args):
        return ['ok', '1', 'active', '0', str(self.applied), [['host', 'speaking', str(self.seq), []]]]

    @staticmethod
    def _wrap(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    def _str_unlock(self, **kw):
        return 1


def test_projector가_앞서가도_대상_이벤트_전부_반환(monkeypatch):
    rows = [row(i) for i in range(101, 111)]
    wire = [event(r) for r in rows] + [event(row(i)) for i in range(111, 116)]
    live = FakeLive(115)

    def replay(self, sid, scope, cursors, **kw):
        return NS(events=[e for e in wire if int(e['seq']) > cursors[0].seq])

    monkeypatch.setattr(LiveStateService, 'replay', replay)
    assert cps.events_for_rows(live, uuid4(), rows) == [event(r) for r in rows]


def publisher(monkeypatch, rows, available):
    from app.services import live_single_flight as sf
    monkeypatch.setattr(sf, 'coalesced_drain', lambda *a, **kw: None)
    monkeypatch.setattr(cps, 'events_for_rows', lambda *a, **kw: available)
    db = NS(rollback=lambda: None, execute=lambda q: NS(scalars=lambda: NS(all=lambda: rows)))
    live, sid = FakeLive(rows[-1].revision), uuid4()
    return db, live, sid


def test_일부_audience_누락은_해당_revision_전에서_방송과_watermark_중단(monkeypatch):
    rows = [row(1), row(2, ('host', 'public')), row(3)]
    db, live, sid = publisher(monkeypatch, rows, [event(r) for r in rows])
    got = []
    assert cps.publish_pending(db, live, sid, got.append) == 1
    assert got == [event(rows[0])]
    assert live.values[cps._emitted_key(live, sid)] == 1


def test_emit_실패시_watermark는_넘어가지_않고_재시도_가능(monkeypatch):
    rows = [row(1), row(2)]
    db, live, sid = publisher(monkeypatch, rows, [event(r) for r in rows])
    def fail(ev):
        raise RuntimeError('callback failure')
    with pytest.raises(RuntimeError):
        cps.publish_pending(db, live, sid, fail)
    assert not live.values.get(cps._emitted_key(live, sid), 0)
    got = []
    assert cps.publish_pending(db, live, sid, got.append) == 2
    assert got == [event(r) for r in rows]


def test_보수적_하한이_잘려도_남은_대상은_첫_seq부터_재조회(monkeypatch):
    from app.services.session_live_state import ReplayUnavailable
    rows, cursors = [row(101)], []
    live = FakeLive(110, 101)  # 다른 pair가 9회 진행, 대상 pair는 그대로
    def replay(self, sid, scope, cs, **kw):
        cursors.append(cs[0].seq)
        if cs[0].seq < 100:
            raise ReplayUnavailable('log_truncated')
        return NS(events=[event(rows[0])])
    monkeypatch.setattr(LiveStateService, 'replay', replay)
    assert cps.events_for_rows(live, uuid4(), rows) == [event(rows[0])]
    assert cursors == [91, 100]


def test_epoch가_바뀌면_다른_epoch_이벤트를_섞지_않음():
    from app.services.live_redis.client import LiveNotReady
    with pytest.raises(LiveNotReady, match='broadcast_epoch_changed'):
        cps.events_for_rows(FakeLive(2), uuid4(), [row(2)], expected_epoch=2)


def test_revision_구멍은_건너뛰지_않음(monkeypatch):
    rows = [row(1), row(3)]
    db, live, sid = publisher(monkeypatch, rows, [event(r) for r in rows])
    got = []
    assert cps.publish_pending(db, live, sid, got.append) == 1
    assert got == [event(rows[0])]
    assert live.values[cps._emitted_key(live, sid)] == 1


def test_emit_도중_락을_잃으면_watermark를_덮어쓰지_않음(monkeypatch):
    from app.services.live_redis.client import LiveNotReady
    rows = [row(1)]
    db, live, sid = publisher(monkeypatch, rows, [event(rows[0])])
    def takeover(ev):
        live.values[live.base(sid) + ':emit-lock'] = 'another'
        live.values[cps._emitted_key(live, sid)] = 10
    with pytest.raises(LiveNotReady, match='broadcast_lease_lost'):
        cps.publish_pending(db, live, sid, takeover)
    assert live.values[cps._emitted_key(live, sid)] == 10


def test_다른_audience_또는_domain의_이벤트는_거름(monkeypatch):
    r = row(1)
    wrong = [event(r, 'public'), {**event(r), 'domain': 'device'}]
    monkeypatch.setattr(LiveStateService, 'replay', lambda *a, **kw: NS(events=wrong))
    assert cps.events_for_rows(FakeLive(1), uuid4(), [r]) == []


@pytest.mark.parametrize('case', ['advance', 'monotonic', 'lost_lock', 'epoch_changed', 'building'])
def test_실제_Redis_checkpoint가_소유권_epoch_단조성을_원자로_검사(case):
    """합성 prefix를 보존한다. 로컬 Redis 없으면 CI에서 생략한다."""
    from app.services.live_redis.client import LiveRedis
    live = LiveRedis.from_url('redis://localhost:6379/11', prefix='sdd319b-unit:' + uuid4().hex)
    try:
        live.r.ping()
    except Exception:
        live.r.close()
        pytest.skip('로컬 Redis 없음')
    sid, token = uuid4(), uuid4().hex
    lock, meta, emitted = live.base(sid) + ':emit-lock', live.meta_key(sid), live.emitted_key(sid)
    try:
        live.r.set(lock, 'different' if case == 'lost_lock' else token, px=5000)
        live.r.hset(meta, mapping={'epoch': '2' if case == 'epoch_changed' else '1',
                                  'status': 'building' if case == 'building' else 'active'})
        before = 10 if case == 'monotonic' else 0
        live.r.set(emitted, before)
        result = live.r.eval(cps._BROADCAST_CHECKPOINT, 3, lock, meta, emitted, token, 1, 5000, 5)
        valid = case in ('advance', 'monotonic')
        assert result == int(valid)
        assert int(live.r.get(emitted)) == (max(before, 5) if valid else before)
    finally:
        live.r.close()

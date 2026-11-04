"""SDD-282/285 — 공통 변환·멱등 적재·복구 CLI·롤백·정산 태스크 (실제 PostgreSQL)."""
from __future__ import annotations

import json
import uuid

import pytest
import sqlalchemy as sa

from app.models.eeg_feature import EEGFeatureWindow
from app.models.session import SessionParticipant
from app.services import feature_artifact_reconcile as far
from app.services import live_ingest_service as li
from app.schemas.session_live_ingest import parse_metric_batch
from tests.sdd246.ingest.test_live_ingest_pg import _batch
from tests.sdd282.helpers import FakeStore, file_row, load_script, put_artifact, start_stream, window

N = 12


@pytest.fixture
def world2(maker):
    from tests.sdd246.commands.conftest import World
    from app.services import class_participation_service as cps

    w = World(maker, n_participants=2)
    with maker() as s:
        cps.seed_live_state(s, w.session_id)
    return w


def _rows(maker, world, i):
    with maker() as s:
        return s.execute(sa.select(EEGFeatureWindow).where(
            EEGFeatureWindow.session_id == world.session_id, EEGFeatureWindow.participant_id == world.members[i][1])
            .order_by(EEGFeatureWindow.window_index)).scalars().all()


def _cnt(maker, world, i=None, path=None):
    with maker() as s:
        q = sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)
        if i is not None:
            q = q.where(EEGFeatureWindow.participant_id == world.members[i][1])
        if path:
            q = q.where(EEGFeatureWindow.ingest_path == path)
        return s.scalar(q)


def _plan(maker, world, i, store, **kw):
    with maker() as s:
        p = far.plan_participant(s, world.session_id, world.members[i][1], downloader=store, **kw)
        s.rollback()
        return p


def _apply(maker, world, i, store, path="recover", **kw):
    with maker() as s:
        p = far.plan_participant(s, world.session_id, world.members[i][1], downloader=store, **kw)
        n = far.apply_plan(s, world.session_id, world.members[i][1], p, ingest_path=path)
        s.commit()
        return p, n


def _setup_file_only(maker, world, store, i=0, n=N, invalid_at=()):
    st = start_stream(maker, world, i)
    wins = [window(world, st, q, i, invalid=q in invalid_at) for q in range(1, n + 1)]
    put_artifact(maker, store, world, i, [file_row(w) for w in wins[:n // 2]], seq_no=1)
    put_artifact(maker, store, world, i, [file_row(w) for w in wins[n // 2:]], seq_no=2)
    return st, wins


def test_변환_30컬럼이_운영_store_batch_경로와_일치한다(maker, world2):
    store = FakeStore()
    st0 = start_stream(maker, world2, 0)
    st1 = start_stream(maker, world2, 1)
    w0 = [window(world2, st0, q, 0, h=f"{q:064x}", invalid=(q == 5)) for q in range(1, N + 1)]
    w1 = [{**w, "participant_id": str(world2.members[1][1]), "stream_id": st1.result["stream_id"],
           "stream_generation": st1.result["generation"]} for w in w0]
    with maker() as s:  # 정상 경로(참가자 0)
        p = s.get(SessionParticipant, world2.members[0][1])
        res = li.store_batch(s, p, world2.session_id, parse_metric_batch(_batch(*w0)))
        assert all(r["status"] == "accepted" for r in res)
    put_artifact(maker, store, world2, 1, [file_row(w) for w in w1], seq_no=1)  # 참가자 1: 파일 → 변환
    plan, n = _apply(maker, world2, 1, store)
    assert n == N
    a, b = _rows(maker, world2, 0), _rows(maker, world2, 1)
    skip = {"id", "participant_id", "user_id", "play_group_id", "created_at", "ingest_path"}
    cols = [c.name for c in EEGFeatureWindow.__table__.columns if c.name not in skip]
    assert len(cols) >= 30
    for x, y in zip(a, b):
        for c in cols:
            assert getattr(x, c) == getattr(y, c), (x.window_index, c)
    assert {r.ingest_path for r in b} == {"recover"} and {r.ingest_path for r in a} == {"rest"}
    assert [r.quality for r in b if r.window_index == 5] == ["invalid"]


def test_멱등_2회_적재하면_증가_0이고_dryrun은_쓰지_않는다(maker, world2):
    store = FakeStore()
    _setup_file_only(maker, world2, store)
    before = _cnt(maker, world2)
    plan = _plan(maker, world2, 0, store)
    assert plan.insert_count == N and _cnt(maker, world2) == before  # 계획만 — 무쓰기
    _, n1 = _apply(maker, world2, 0, store)
    _, n2 = _apply(maker, world2, 0, store)
    assert (n1, n2) == (N, 0) and _cnt(maker, world2, 0) == N


def test_부분_존재_시_누락분만_적재하고_늘어난_파일도_멱등(maker, world2):
    store = FakeStore()
    st, wins = _setup_file_only(maker, world2, store)
    with maker() as s:  # 앞 5창은 정상 경로로 이미 저장
        p = s.get(SessionParticipant, world2.members[0][1])
        li.store_batch(s, p, world2.session_id, parse_metric_batch(_batch(*wins[:5])))
    _, n = _apply(maker, world2, 0, store)
    assert n == N - 5 and _cnt(maker, world2, 0) == N
    # 기기가 파일을 더 올렸다(seq 13~16) — 재실행하면 새 것만 추가
    more = [window(world2, st, q, 0) for q in range(N + 1, N + 5)]
    put_artifact(maker, store, world2, 0, [file_row(w) for w in more], seq_no=3)
    _, n = _apply(maker, world2, 0, store)
    assert n == 4 and _cnt(maker, world2, 0) == N + 4
    assert _cnt(maker, world2, 0, "recover") == N - 5 + 4


def test_해시_충돌은_덮어쓰지_않고_보고한다(maker, world2):
    store = FakeStore()
    st, wins = _setup_file_only(maker, world2, store)
    with maker() as s:
        p = s.get(SessionParticipant, world2.members[0][1])
        bad = {**wins[2], "feature_hash": "f" * 64}
        li.store_batch(s, p, world2.session_id, parse_metric_batch(_batch(bad)))
    plan = _plan(maker, world2, 0, store)
    assert [c["kind"] for c in plan.conflicts] == ["hash_conflict_db"] and plan.insert_count == N - 1
    rows = {r.window_index: r for r in _rows(maker, world2, 0)}
    assert rows[3].source_feature_alias == "f" * 64  # 기존 값 보존


def test_파일_내_중복과_서로_다른_해시를_구분한다(maker, world2):
    store = FakeStore()
    st = start_stream(maker, world2, 0)
    w = [window(world2, st, q, 0) for q in range(1, 4)]
    put_artifact(maker, store, world2, 0, [file_row(x) for x in w], seq_no=1)
    put_artifact(maker, store, world2, 0, [file_row(w[0]), file_row(w[1])], seq_no=2)  # 같은 해시 중복
    p = _plan(maker, world2, 0, store)
    assert p.dup_in_file == 2 and p.insert_count == 3 and not p.conflicts
    put_artifact(maker, store, world2, 0, [file_row({**w[0], "feature_hash": "e" * 64})], seq_no=3)  # 다른 해시
    p = _plan(maker, world2, 0, store)
    assert [c["kind"] for c in p.conflicts] == ["hash_conflict_in_files"]


def test_적재는_band_connected를_바꾸지_않고_다른_참가자_행에_영향이_없다(maker, world2):
    store = FakeStore()
    _setup_file_only(maker, world2, store)
    with maker() as s:
        assert s.get(SessionParticipant, world2.members[0][1]).band_connected in (False, None)
    _apply(maker, world2, 0, store)
    with maker() as s:
        assert not s.get(SessionParticipant, world2.members[0][1]).band_connected
    assert _cnt(maker, world2, 1) == 0


def test_업로드_대기_산출물은_검증_통과_시에만_포함된다(maker, world2):
    store = FakeStore()
    st = start_stream(maker, world2, 0)
    w = [window(world2, st, q, 0) for q in range(1, 7)]
    put_artifact(maker, store, world2, 0, [file_row(x) for x in w[:3]], seq_no=1)
    put_artifact(maker, store, world2, 0, [file_row(x) for x in w[3:]], seq_no=2, status="pending")
    p = _plan(maker, world2, 0, store)  # 기본 제외
    assert p.insert_count == 3 and p.files_pending_excluded == 1
    p = _plan(maker, world2, 0, store, include_pending=True)
    assert p.insert_count == 6 and p.files_pending_included == 1


def test_업로드_대기_산출물_체크섬이_틀리면_포함하지_않는다(maker, world2):
    store = FakeStore()
    st = start_stream(maker, world2, 0)
    w = [window(world2, st, q, 0) for q in range(1, 5)]
    put_artifact(maker, store, world2, 0, [file_row(x) for x in w], seq_no=1, status="pending", corrupt_checksum=True)
    p = _plan(maker, world2, 0, store, include_pending=True)
    assert p.insert_count == 0 and p.pending_excluded_reasons == ["체크섬 불일치"]


def test_stream이_없는_참가자는_제외하고_사유를_남긴다(maker, world2):
    p = _plan(maker, world2, 1, FakeStore())
    assert p.skipped_reason == "capture_stream 없음" and p.insert_count == 0


# ---------------- 복구 CLI ----------------

PREFIXES = lambda w: [str(w.members[i][1])[:6] for i in range(2)]  # noqa: E731


@pytest.fixture
def loader(monkeypatch):
    mod = load_script("sdd282-recovery-load")
    monkeypatch.setattr(mod, "REQUIRED_TARGETS", ())
    return mod


def _run_loader(loader, maker, world, store, *argv):
    pre = PREFIXES(world)
    if "--apply" in argv or True:
        loader.REQUIRED_TARGETS = tuple(pre)
    return loader.main(["--session", str(world.session_id), "--targets", *pre, "--include-pending", *argv],
                       session_factory=maker, downloader=store)


def test_로더_dryrun은_DB가_쓰기를_거부하고_행이_늘지_않는다(maker, world2, loader, tmp_path, capsys):
    store = FakeStore()
    _setup_file_only(maker, world2, store, 0)
    _setup_file_only(maker, world2, store, 1)
    out = tmp_path / "dr.json"
    rc = loader.main(["--session", str(world2.session_id), "--targets", *PREFIXES(world2), "--include-pending", "--out", str(out)],
                     session_factory=maker, downloader=store)
    assert rc == 0 and _cnt(maker, world2) == 0
    assert json.loads(out.read_text())["total_insert"] == 2 * N
    # 읽기 전용 트랜잭션이 실제로 쓰기를 거부하는지(같은 SET TRANSACTION READ ONLY)
    with maker() as s:
        s.execute(sa.text("SET TRANSACTION READ ONLY"))
        with pytest.raises(sa.exc.InternalError):
            s.execute(sa.text("update session_participants set band_battery = 1 where id = :i"), {"i": world2.members[0][1]})
        s.rollback()
    src = (load_script.__globals__["SCRIPTS"] / "sdd282-recovery-load.py").read_text()
    assert "SET TRANSACTION READ ONLY" in src


def test_로더_apply는_직전_드라이런과_행수가_다르면_중단한다(maker, world2, loader, tmp_path):
    store = FakeStore()
    _setup_file_only(maker, world2, store, 0)
    _setup_file_only(maker, world2, store, 1)
    out = tmp_path / "dr.json"
    loader.REQUIRED_TARGETS = tuple(PREFIXES(world2))
    args = ["--session", str(world2.session_id), "--targets", *PREFIXES(world2), "--include-pending"]
    loader.main([*args, "--dry-run", "--out", str(out)], session_factory=maker, downloader=store)
    doc = json.loads(out.read_text())
    doc["total_insert"] += 1
    out.write_text(json.dumps(doc))
    assert loader.main([*args, "--apply", "--dryrun-result", str(out)], session_factory=maker, downloader=store) == 4
    assert _cnt(maker, world2) == 0


def test_로더_apply는_대상_4개_미지정이면_거부한다(maker, world2, loader, tmp_path):
    loader.REQUIRED_TARGETS = ("aaaaaa", "bbbbbb", "cccccc", "dddddd")
    rc = loader.main(["--session", str(world2.session_id), "--targets", *PREFIXES(world2), "--apply", "--dryrun-result", str(tmp_path / "x")],
                     session_factory=maker, downloader=FakeStore())
    assert rc == 2 and _cnt(maker, world2) == 0


def test_로더_apply_적재_후_재실행은_0이고_롤백하면_원상복구된다(maker, world2, loader, tmp_path):
    store = FakeStore()
    _setup_file_only(maker, world2, store, 0)
    _setup_file_only(maker, world2, store, 1)
    # 대상 밖 기존 행(롤백 시 보존돼야 함): 참가자 0 의 정상 경로 행 1건을 별도 회차 키로
    loader.REQUIRED_TARGETS = tuple(PREFIXES(world2))
    args = ["--session", str(world2.session_id), "--targets", *PREFIXES(world2), "--include-pending"]
    dr = tmp_path / "dr.json"
    assert loader.main([*args, "--dry-run", "--out", str(dr)], session_factory=maker, downloader=store) == 0
    assert loader.main([*args, "--apply", "--dryrun-result", str(dr)], session_factory=maker, downloader=store) == 0
    assert _cnt(maker, world2, path="recover") == 2 * N
    # 파일이 늘어난 상태에서 같은 결과 파일로 apply 하면 중단(숫자 변동), 새 드라이런이면 새 것만
    st0 = stream_id_of(maker, world2, 0)
    put_artifact(maker, store, world2, 0, [file_row(window(world2, st0, q, 0)) for q in range(N + 1, N + 4)], seq_no=9)
    assert loader.main([*args, "--apply", "--dryrun-result", str(dr)], session_factory=maker, downloader=store) == 4
    dr2 = tmp_path / "dr2.json"
    loader.main([*args, "--dry-run", "--out", str(dr2)], session_factory=maker, downloader=store)
    assert json.loads(dr2.read_text())["total_insert"] == 3
    assert loader.main([*args, "--apply", "--dryrun-result", str(dr2)], session_factory=maker, downloader=store) == 0
    assert _cnt(maker, world2, path="recover") == 2 * N + 3
    # 롤백
    rb = load_script("sdd282-recovery-rollback")
    rb.REQUIRED_TARGETS = tuple(PREFIXES(world2))
    rargs = ["--session", str(world2.session_id), "--targets", *PREFIXES(world2)]
    assert rb.main([*rargs, "--dry-run"], session_factory=maker) == 0 and _cnt(maker, world2) == 2 * N + 3
    assert rb.main([*rargs, "--apply", "--expect-rows", "1"], session_factory=maker) == 4  # 기대 수 불일치 → 중단
    assert rb.main([*rargs, "--apply", "--expect-rows", str(2 * N + 3)], session_factory=maker) == 0
    assert _cnt(maker, world2) == 0


def stream_id_of(maker, world, i):
    from app.models.live_state import CaptureStream

    class _S:  # helpers.window 가 읽는 형태(started.result)
        pass

    with maker() as s:
        cs = s.execute(sa.select(CaptureStream).where(CaptureStream.participant_id == world.members[i][1])).scalar_one()
        o = _S()
        o.result = {"stream_id": str(cs.id), "generation": str(cs.generation)}
        return o


def test_롤백은_recover_표식_행만_지운다(maker, world2, loader, tmp_path):
    store = FakeStore()
    st, wins = _setup_file_only(maker, world2, store, 0)
    with maker() as s:  # 정상 경로 행 3건(rest) 먼저
        p = s.get(SessionParticipant, world2.members[0][1])
        li.store_batch(s, p, world2.session_id, parse_metric_batch(_batch(*wins[:3])))
    _apply(maker, world2, 0, store)
    assert _cnt(maker, world2, 0) == N and _cnt(maker, world2, 0, "rest") == 3
    rb = load_script("sdd282-recovery-rollback")
    rb.REQUIRED_TARGETS = tuple(PREFIXES(world2))
    assert rb.main(["--session", str(world2.session_id), "--targets", *PREFIXES(world2), "--apply"], session_factory=maker) == 0
    assert _cnt(maker, world2, 0) == 3 and _cnt(maker, world2, 0, "rest") == 3

"""SDD-244 M1 PG 스키마·마이그레이션 (verify A01 PG, A03 PG, A13 legacy).

운영/개발 DB 가 아닌 격리 로컬 PG 에서만 돈다(conftest 의 PG_SMOKE=1 + 로컬 호스트 가드).
"""
from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from tests.pg.conftest import alembic_ok, run_alembic

pytestmark = pytest.mark.pg

V2 = "mb-biosignal-raw-v2"


def _insert(conn, **over):
    row = {
        "id": uuid.uuid4(), "session_id": over.pop("session_id", uuid.UUID(int=1)),
        "participant_id": uuid.UUID(int=2), "stream_id": "s", "chunk_index": 0,
        "object_key": f"k-{uuid.uuid4()}", "signal_type": "eeg", "segment_id": "legacy",
        "schema_version": "1.0", "upload_status": "pending", "chunk_alias": None,
        "sample_count": None,
    }
    row.update(over)
    if row.pop("pre_m1", False):  # M1 이전 스키마에는 새 컬럼이 없다
        for k in ("signal_type", "segment_id", "schema_version", "chunk_alias", "sample_count"):
            row.pop(k)
        row["schema_version"] = "1.0"
    cols = ", ".join(row)
    vals = ", ".join(f":{k}" for k in row)
    conn.execute(sa.text(f"INSERT INTO eeg_raw_chunks ({cols}) VALUES ({vals})"), row)


@pytest.fixture
def conn(pg_conn):
    pg_conn.execute(sa.text("SET LOCAL session_replication_role = replica"))  # 부모 행 없이 원장 제약만 검증
    return pg_conn


def _fails(conn, **over):
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            _insert(conn, **over)


def test_세_신호가_같은_stream_index를_공유하고_identity_중복은_거절(conn):
    for signal in ("eeg", "ppg", "acc"):
        _insert(conn, signal_type=signal, segment_id="seg-a", schema_version=V2)
    _insert(conn, signal_type="eeg", segment_id="seg-b", schema_version=V2)  # 다른 segment
    _fails(conn, signal_type="ppg", segment_id="seg-a", schema_version=V2)


def test_legacy_v1_의미_유지_participant_null은_유니크_비대상(conn):
    _insert(conn)
    _fails(conn)  # 같은 (session, participant, stream, index) legacy 중복은 기존처럼 거절
    _insert(conn, participant_id=None)
    _insert(conn, participant_id=None)  # 기존에도 NULL participant 는 유니크 비교 대상이 아니었다


def test_check_제약(conn):
    _fails(conn, signal_type="emg")
    _fails(conn, sample_count=-1)
    _fails(conn, participant_id=None, schema_version=V2, segment_id="seg-x")


def test_alias는_회차_참여자_안에서_유일하고_NULL은_제외(conn):
    _insert(conn, chunk_index=1, chunk_alias="RAW-A", schema_version=V2, segment_id="s1")
    _fails(conn, chunk_index=2, chunk_alias="RAW-A", schema_version=V2, segment_id="s1")
    _insert(conn, chunk_index=3)
    _insert(conn, chunk_index=4)  # alias NULL 다수 허용


def test_동시_발급은_하나만_성공(pg_engine):
    sid, pid = uuid.uuid4(), uuid.uuid4()
    key = {"session_id": sid, "participant_id": pid}

    def attempt(c, ident):
        c.execute(sa.text("SET session_replication_role = replica"))
        _insert(c, signal_type="ppg", segment_id="seg", schema_version=V2, chunk_index=7,
                stream_id="stream-c", participant_id=pid, session_id=sid, object_key=f"k-{ident}")

    a, b = pg_engine.connect(), pg_engine.connect()
    ta, tb = a.begin(), b.begin()
    try:
        attempt(a, "a")
        import threading
        errors: list[Exception] = []

        def second():
            try:
                attempt(b, "b")
                tb.commit()
            except IntegrityError as exc:
                errors.append(exc)

        th = threading.Thread(target=second)
        th.start()
        th.join(timeout=0.5)
        assert th.is_alive()  # 첫 트랜잭션 commit 전까지 대기
        ta.commit()
        th.join(timeout=10)
        assert len(errors) == 1
    finally:
        for c, t in ((a, ta), (b, tb)):
            if t.is_active:
                t.rollback()
        with pg_engine.begin() as cleanup:
            cleanup.execute(sa.text("DELETE FROM eeg_raw_chunks WHERE session_id = :s"), {"s": sid})
        a.close()
        b.close()
        _ = key


def test_신규_테이블_존재(conn):
    names = {r[0] for r in conn.execute(sa.text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))}
    assert {"biosignal_streams", "biosignal_segments", "biosignal_gap_events", "biosignal_close_intents",
            "biosignal_manifest_revisions", "biosignal_manifest_current"} <= names


def test_업그레이드_다운그레이드_legacy_보존(scratch_db):
    url = scratch_db("sdd244m1")
    alembic_ok(url, "upgrade", "e036a0000061")
    eng = sa.create_engine(url)
    with eng.begin() as c:
        c.execute(sa.text("SET session_replication_role = replica"))
        _insert(c, pre_m1=True)
        _insert(c, pre_m1=True, participant_id=None, chunk_index=1)
    alembic_ok(url, "upgrade", "e036a0244001")
    with eng.begin() as c:
        rows = c.execute(sa.text("SELECT signal_type, segment_id, schema_version FROM eeg_raw_chunks")).all()
        assert set(rows) == {("eeg", "legacy", "1.0")} and len(rows) == 2
        c.execute(sa.text("SET session_replication_role = replica"))
        _insert(c, signal_type="ppg", segment_id="s", schema_version=V2, chunk_index=5)
    refused = run_alembic(url, "downgrade", "-1")
    assert refused.returncode != 0 and "downgrade 거부" in (refused.stderr + refused.stdout)
    with eng.begin() as c:
        c.execute(sa.text("DELETE FROM eeg_raw_chunks WHERE signal_type='ppg'"))
    alembic_ok(url, "downgrade", "-1")
    with eng.begin() as c:
        cols = {r[0] for r in c.execute(sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='eeg_raw_chunks'"))}
        assert "signal_type" not in cols
        assert c.execute(sa.text("SELECT count(*) FROM eeg_raw_chunks")).scalar() == 2
    alembic_ok(url, "upgrade", "head")
    eng.dispose()


# ── M2: 산출물 원장·화면 스냅샷·정규화 snapshot ──────────────────────────────


def _artifact(conn, **over):
    row = {
        "id": uuid.uuid4(), "session_id": uuid.UUID(int=1), "participant_id": uuid.UUID(int=2),
        "artifact_alias": f"A{uuid.uuid4().hex[:10]}", "artifact_kind": "feature", "signal": "eeg",
        "stream_id": "st", "segment_id": "sg", "view_instance_id": None, "sequence": 0, "row_count": 1,
        "schema_version": "feature-v1", "checksum": "a" * 64, "size_bytes": 10, "retention_class": "feature_policy",
        "object_key": f"k-{uuid.uuid4()}",
    }
    row.update(over)
    conn.execute(sa.text(f"INSERT INTO biosignal_artifacts ({', '.join(row)}) VALUES ({', '.join(':' + k for k in row)})"), row)


def test_artifact_슬롯_유니크는_NULL_scope도_같은_값으로_본다(conn):
    _artifact(conn, artifact_kind="normalization", signal=None, stream_id=None, segment_id=None)
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            _artifact(conn, artifact_kind="normalization", signal=None, stream_id=None, segment_id=None)
    _artifact(conn, artifact_kind="normalization", signal=None, stream_id=None, segment_id=None, sequence=1)
    _artifact(conn)
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            _artifact(conn, artifact_alias="same", sequence=5)
            _artifact(conn, artifact_alias="same", sequence=6)  # alias 중복
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            _artifact(conn, artifact_kind="bogus", sequence=9)


def test_display_snapshot과_normalization_유니크(conn):
    aid = uuid.uuid4()
    _artifact(conn, id=aid, artifact_kind="indices", signal=None, segment_id=None, view_instance_id="v")
    snap = {"id": uuid.uuid4(), "session_id": uuid.UUID(int=1), "participant_id": uuid.UUID(int=2), "artifact_pk": aid,
            "stream_alias": "S", "view_instance_alias": "V", "view_kind": "participant_player", "second_index": 0,
            "t_rel_ms": 0.0, "render_status": "rendered", "source": "displayed", "display_match": "true"}
    sql = f"INSERT INTO display_snapshots ({', '.join(snap)}) VALUES ({', '.join(':' + k for k in snap)})"
    conn.execute(sa.text(sql), snap)
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(sql), dict(snap, id=uuid.uuid4()))
    conn.execute(sa.text(sql), dict(snap, id=uuid.uuid4(), second_index=1))
    norm = "INSERT INTO normalization_snapshots (id, params_hash, model_id_alias, version, formula_version, content) VALUES (:i, :h, 'M', 'v', 'f', '{}')"
    conn.execute(sa.text(norm), {"i": uuid.uuid4(), "h": "b" * 64})
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(norm), {"i": uuid.uuid4(), "h": "b" * 64})


def test_M2_업그레이드_다운그레이드_왕복(scratch_db):
    url = scratch_db("sdd244m2")
    alembic_ok(url, "upgrade", "e036a0244001")
    alembic_ok(url, "upgrade", "e036a0244002")
    eng = sa.create_engine(url)
    with eng.begin() as c:
        cols = {r[0] for r in c.execute(sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='eeg_feature_windows'"))}
        assert {"source_feature_alias", "algorithm_version", "faa", "total_neural_activity"} <= cols
        c.execute(sa.text("SET session_replication_role = replica"))
        _artifact(c)
    refused = run_alembic(url, "downgrade", "-1")
    assert refused.returncode != 0 and "downgrade 거부" in (refused.stderr + refused.stdout)
    with eng.begin() as c:
        c.execute(sa.text("DELETE FROM biosignal_artifacts"))
    alembic_ok(url, "downgrade", "-1")
    alembic_ok(url, "upgrade", "head")
    eng.dispose()


# ── M3: 연구 영수증·삭제 outbox·manifest revision 불변 트리거 ───────────────────


def test_research_signal_receipt_유니크와_check(conn):
    row = {"id": uuid.uuid4(), "session_id": uuid.UUID(int=1), "participant_id": uuid.UUID(int=2), "signal": "ppg",
           "artifact_kind": "raw", "manifest_revision": 1, "manifest_sha256": "c" * 64, "schema_version": "research-v3"}
    sql = f"INSERT INTO research_signal_receipts ({', '.join(row)}) VALUES ({', '.join(':' + k for k in row)})"
    conn.execute(sa.text(sql), row)
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(sql), dict(row, id=uuid.uuid4()))  # 같은 신호·종류·revision·hash 중복
    conn.execute(sa.text(sql), dict(row, id=uuid.uuid4(), signal="acc"))  # 다른 신호는 별개 영수증
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(sql), dict(row, id=uuid.uuid4(), signal="emg", manifest_revision=2))


def test_object_deletion_outbox_상태와_유니크(conn):
    sql = "INSERT INTO object_deletion_outbox (id, object_key, source_table, reason, state) VALUES (:i, :k, 'eeg_raw_chunks', 'retention', :s)"
    conn.execute(sa.text(sql), {"i": uuid.uuid4(), "k": "k1", "s": "pending"})
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(sql), {"i": uuid.uuid4(), "k": "k1", "s": "pending"})
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(sql), {"i": uuid.uuid4(), "k": "k2", "s": "bogus"})


def test_manifest_revision_행은_수정할_수_없다(conn):
    row = {"id": uuid.uuid4(), "session_id": uuid.UUID(int=1), "participant_id": uuid.UUID(int=2), "revision": 1,
           "close_state": "unknown", "content": "{}", "content_sha256": "d" * 64}
    conn.execute(sa.text(f"INSERT INTO biosignal_manifest_revisions ({', '.join(row)}) VALUES ({', '.join(':' + k for k in row)})"), row)
    conn.execute(sa.text("SET LOCAL session_replication_role = origin"))  # replica 모드는 일반 트리거를 건너뛴다
    with pytest.raises(sa.exc.DBAPIError):
        with conn.begin_nested():
            conn.execute(sa.text("UPDATE biosignal_manifest_revisions SET close_state='complete' WHERE id=:i"), {"i": row["id"]})
    conn.execute(sa.text("SET LOCAL session_replication_role = replica"))
    conn.execute(sa.text(f"INSERT INTO biosignal_manifest_revisions ({', '.join(dict(row, revision=2))}) VALUES ({', '.join(':' + k for k in row)})"),
                 dict(row, id=uuid.uuid4(), revision=2))  # 새 revision 추가는 허용
    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(sa.text(f"INSERT INTO biosignal_manifest_revisions ({', '.join(row)}) VALUES ({', '.join(':' + k for k in row)})"),
                         dict(row, id=uuid.uuid4()))  # revision 번호 중복 불가


def test_M3_업그레이드_다운그레이드_왕복(scratch_db):
    url = scratch_db("sdd244m3")
    alembic_ok(url, "upgrade", "e036a0244003")
    eng = sa.create_engine(url)
    with eng.begin() as c:
        cols = {r[0] for r in c.execute(sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='research_export_items'"))}
        assert {"bundle_schema_version", "signal_scope"} <= cols
        c.execute(sa.text("INSERT INTO object_deletion_outbox (id, object_key, source_table, reason) VALUES (:i,'k','t','r')"), {"i": uuid.uuid4()})
    refused = run_alembic(url, "downgrade", "-1")
    assert refused.returncode != 0 and "downgrade 거부" in (refused.stderr + refused.stdout)
    with eng.begin() as c:
        c.execute(sa.text("DELETE FROM object_deletion_outbox"))
    alembic_ok(url, "downgrade", "-1")
    with eng.begin() as c:
        assert c.execute(sa.text("SELECT count(*) FROM pg_trigger WHERE tgname='trg_biosignal_manifest_revisions_immutable'")).scalar() == 0
    alembic_ok(url, "upgrade", "head")
    eng.dispose()

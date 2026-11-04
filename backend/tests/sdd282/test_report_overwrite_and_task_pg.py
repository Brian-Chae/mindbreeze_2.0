"""SDD-282 리포트 덮어쓰기(발송·승인 불변) + SDD-285 S1 정산 태스크 (실제 PostgreSQL)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.eeg_feature import EEGFeatureWindow
from app.models.notification_outbox import NotificationOutbox
from app.models.record import Report
from app.models.session import Session as SessionModel, SessionParticipant
from app.tasks import report_task
from app.tasks import feature_reconcile_task as frt
from tests.sdd282.helpers import FakeStore, file_row, load_script, put_artifact, start_stream, window

N = 10
PRE = lambda w: [str(w.members[i][1])[:6] for i in range(2)]  # noqa: E731


@pytest.fixture
def world2(maker):
    from tests.sdd246.commands.conftest import World
    from app.services import class_participation_service as cps

    w = World(maker, n_participants=2)
    with maker() as s:
        cps.seed_live_state(s, w.session_id)
        sess = s.get(SessionModel, w.session_id)
        for _, pid in w.members:
            p = s.get(SessionParticipant, pid)
            p.report_included = True
        s.commit()
    return w


def _end_session(maker, world):
    """스트림 시작 뒤에 회차를 종료 처리한다(종료 후에는 capture.start 가 거부됨)."""
    with maker() as s:
        sess = s.get(SessionModel, world.session_id)
        sess.started_at = datetime.fromtimestamp(1_760_000_000 - 60, tz=timezone.utc)
        sess.ended_at = datetime.fromtimestamp(1_760_000_000 + 600, tz=timezone.utc)
        sess.status = "completed"
        s.commit()


def _mk_reports(maker, world, *, counselor_status="completed"):
    _end_session(maker, world)
    ids = {}
    with maker() as s:
        for i, (uid, pid) in enumerate(world.members):
            r = Report(session_id=world.session_id, user_id=uid, participant_id=pid, type="client",
                       content={"headline": "빈 리포트"}, status="pending_review", generation_status="ready")
            s.add(r)
            s.flush()
            ids[f"c{i}"] = r.id
        c = Report(session_id=world.session_id, user_id=world.host_id, participant_id=None, type="counselor",
                   content={"headline": "상담사", "counselor_comment": "원본 코멘트"}, status=counselor_status,
                   generation_status="ready", approved_at=datetime.now(timezone.utc) if counselor_status == "completed" else None,
                   approval_source="manual" if counselor_status == "completed" else None)
        s.add(c)
        s.flush()
        ids["cn"] = c.id
        s.commit()
    return ids


def _seed_files(maker, world, store, i):
    st = start_stream(maker, world, i)
    wins = [window(world, st, q, i) for q in range(1, N + 1)]
    put_artifact(maker, store, world, i, [file_row(w) for w in wins], seq_no=1)


def _load_all(maker, world, store):
    from tests.sdd282.test_reconcile_pg import _apply

    for i in range(2):
        _apply(maker, world, i, store)


def _get(maker, rid):
    with maker() as s:
        r = s.get(Report, rid)
        s.expunge(r)
        return r


def _outbox(maker):
    with maker() as s:
        return s.scalar(sa.select(sa.func.count()).select_from(NotificationOutbox))


@pytest.fixture
def ow():
    return load_script("sdd282-report-overwrite")


@pytest.fixture
def ow_run(ow, maker, world2, monkeypatch, tmp_path):
    monkeypatch.setattr(ow, "REQUIRED_TARGETS", tuple(PRE(world2)))

    def run(*extra, **kw):
        return ow.main(["--session", str(world2.session_id), "--targets", *PRE(world2), *extra], session_factory=maker, **kw)
    return run


def test_덮어쓰기_dryrun은_아무것도_쓰지_않는다(maker, world2, ow_run):
    ids = _mk_reports(maker, world2)
    before = {k: _get(maker, v).content for k, v in ids.items()}
    assert ow_run("--dry-run") == 0
    assert {k: _get(maker, v).content for k, v in ids.items()} == before


def test_덮어쓰기는_백업_후_본문만_바꾸고_발송_승인_상태는_불변이다(maker, world2, ow_run, tmp_path, monkeypatch):
    store = FakeStore()
    for i in range(2):
        _seed_files(maker, world2, store, i)
    _load_all(maker, world2, store)
    ids = _mk_reports(maker, world2)
    # 부수 효과 함수가 실제로 호출되면 시험이 실패하도록 감시(무력화돼 있어야 호출 자체가 일어나지 않는다)
    tripped = []
    monkeypatch.setattr("app.services.report_email_service.enqueue_report_email", lambda *a, **k: tripped.append("mail"))
    monkeypatch.setattr(report_task, "_maybe_enqueue_class_narrative_impl", lambda *a, **k: None, raising=False)
    before = {k: _get(maker, v) for k, v in ids.items()}
    ob = _outbox(maker)
    assert ow_run("--apply", "--backup-dir", str(tmp_path / "bk")) == 0
    after = {k: _get(maker, v) for k, v in ids.items()}
    for k in ids:
        assert after[k].content != before[k].content, k  # 본문이 바뀌었다
        assert after[k].sent_at is None and after[k].delivery_status is None
        assert after[k].approved_at == before[k].approved_at and after[k].approval_source == before[k].approval_source
    assert after["c0"].status == "pending_review" and after["c1"].status == "pending_review"
    assert after["cn"].status == "completed"
    assert after["cn"].content.get("counselor_comment") == "원본 코멘트"  # 상담사 코멘트 이월
    assert tripped == [] and _outbox(maker) == ob
    with maker() as s:
        assert all(s.get(SessionParticipant, pid).report_email_sent_at is None for _, pid in world2.members)
    # 백업 파일: 원본 본문, 권한 0600
    files = list((tmp_path / "bk").glob("sdd282-report-backup-*.json"))
    assert len(files) == 1 and oct(files[0].stat().st_mode & 0o777) == "0o600"
    saved = json.loads(files[0].read_text())["reports"]
    assert saved[str(ids["c0"])]["values"]["content"] == before["c0"].content
    assert len(saved) == 3


def test_백업_없이는_apply를_거부한다(maker, world2, ow_run):
    _mk_reports(maker, world2)
    assert ow_run("--apply") == 2


def test_상태가_어긋나면_해당_리포트를_복원하고_중단한다(maker, world2, ow_run, ow, tmp_path):
    ids = _mk_reports(maker, world2)
    before = _get(maker, ids["c0"]).content

    def bad_generate(rid, db):  # 승인·발송을 일으키는 잘못된 생성기 흉내
        r = db.get(Report, uuid.UUID(rid))
        r.content = {"headline": "덮어씀"}
        r.status = "completed"
        r.sent_at = datetime.now(timezone.utc)
        r.generation_status = "ready"
        db.commit()
        return r

    with pytest.raises(SystemExit) as e:
        ow_run("--apply", "--backup-dir", str(tmp_path / "bk"), generate=bad_generate)
    assert e.value.code == 6
    r = _get(maker, ids["c0"])
    assert r.content == before and r.status == "pending_review" and r.sent_at is None


def test_롤백_CLI는_백업으로_리포트를_복원한다(maker, world2, ow_run, tmp_path):
    store = FakeStore()
    for i in range(2):
        _seed_files(maker, world2, store, i)
    _load_all(maker, world2, store)
    ids = _mk_reports(maker, world2)
    before = {k: _get(maker, v).content for k, v in ids.items()}
    assert ow_run("--apply", "--backup-dir", str(tmp_path / "bk")) == 0
    assert _get(maker, ids["c0"]).content != before["c0"]
    bk = next((tmp_path / "bk").glob("*.json"))
    rb = load_script("sdd282-recovery-rollback")
    rb.REQUIRED_TARGETS = tuple(PRE(world2))
    rc = rb.main(["--session", str(world2.session_id), "--targets", *PRE(world2), "--apply", "--report-backup", str(bk)], session_factory=maker)
    assert rc == 0
    assert {k: _get(maker, v).content for k, v in ids.items()} == before
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world2.session_id)) == 0


def test_리포트에_측정자료가_들어간다(maker, world2, ow_run, tmp_path):
    store = FakeStore()
    for i in range(2):
        _seed_files(maker, world2, store, i)
    _load_all(maker, world2, store)
    ids = _mk_reports(maker, world2)
    assert ow_run("--no-counselor", "--apply", "--backup-dir", str(tmp_path / "bk")) == 0
    c = _get(maker, ids["c0"]).content
    assert c != {"headline": "빈 리포트"} and len(json.dumps(c)) > 343


# ---------------- 정산 태스크 ----------------

def test_정산_기본은_쓰기없는_드라이런이다(maker, world2, monkeypatch):
    monkeypatch.delenv("FEATURE_RECONCILE_APPLY", raising=False)
    assert frt.reconcile_apply_enabled() is False
    store = FakeStore()
    _seed_files(maker, world2, store, 0)  # 참가자 1은 stream 없음 → 제외
    _end_session(maker, world2)
    with maker() as s:
        res = frt.reconcile_session(s, world2.session_id, downloader=store)
    assert res["mode"] == "dry-run" and res["would_insert"] == N and res["inserted"] == 0 and res["skipped"] == 1
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world2.session_id)) == 0


def test_정산_적재모드는_recon_표식으로_넣고_재실행은_0이다(maker, world2, monkeypatch):
    monkeypatch.setenv("FEATURE_RECONCILE_APPLY", "true")
    assert frt.reconcile_apply_enabled() is True
    store = FakeStore()
    _seed_files(maker, world2, store, 0)
    _end_session(maker, world2)
    with maker() as s:
        r1 = frt.reconcile_session(s, world2.session_id, downloader=store)
    with maker() as s:
        r2 = frt.reconcile_session(s, world2.session_id, downloader=store)
    assert (r1["mode"], r1["inserted"], r2["inserted"], r2["would_insert"]) == ("apply", N, 0, 0)
    with maker() as s:
        paths = s.execute(sa.select(EEGFeatureWindow.ingest_path, sa.func.count()).where(EEGFeatureWindow.session_id == world2.session_id).group_by(EEGFeatureWindow.ingest_path)).all()
        assert paths == [("recon", N)]
        assert not s.get(SessionParticipant, world2.members[0][1]).band_connected


def test_정산_충돌이_있으면_그_참가자는_적재하지_않는다(maker, world2):
    from tests.sdd246.ingest.test_live_ingest_pg import _batch
    from app.schemas.session_live_ingest import parse_metric_batch
    from app.services import live_ingest_service as li

    store = FakeStore()
    st = start_stream(maker, world2, 0)
    wins = [window(world2, st, q, 0) for q in range(1, N + 1)]
    put_artifact(maker, store, world2, 0, [file_row(w) for w in wins], seq_no=1)
    _end_session(maker, world2)
    with maker() as s:
        p = s.get(SessionParticipant, world2.members[0][1])
        li.store_batch(s, p, world2.session_id, parse_metric_batch(_batch({**wins[0], "feature_hash": "d" * 64})))
    with maker() as s:
        res = frt.reconcile_session(s, world2.session_id, apply=True, downloader=store)
    assert res["blocked"] == 1 and res["inserted"] == 0
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world2.session_id)) == 1


def test_정산_스윕_태스크가_등록돼_있다():
    from app.core.celery_app import celery_app

    assert frt.reconcile_session_features.name == "tasks.feature_reconcile_session"
    assert frt.sweep_ended_sessions_for_reconcile.name == "tasks.feature_reconcile_sweep"

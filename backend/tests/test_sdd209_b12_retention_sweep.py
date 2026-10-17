"""SDD-209 B12 — 기본 DB 삭제 스위프 (verify BT56~BT62, RV1, N-1·N-5, A1).

- 기본 비활성(dry-run): 삭제 0, 후보 건수·바이트·보류 건수 보고, 실행 이력 기록.
- 활성: 세션 종료일 기준 설정 기간 경과 원본 삭제, 비회원 개인정보 스크럽, 연구 동의 건 ack 게이트.
- 기존 cron 2개는 그대로 두되, 새 스위프가 활성이면 스스로 건너뛴다(이중 삭제 방지).
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.eeg_feature import EEGFeatureWindow
from app.models.notification import Notification
from app.models.record import AudioChunk, EEGRawChunk, EEGRecord, Report, SessionRecord, VideoChunk
from app.models.research import ResearchConsent
from app.models.retention_sweep_run import RetentionSweepRun
from app.models.session import Session, SessionParticipant
from app.models.session_email_invite import SessionEmailInvite
from app.models.user import User

NOW = datetime(2026, 12, 1, 12, 0, 0, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=100)  # 보관 90일 경과
RECENT = NOW - timedelta(days=10)


@pytest.fixture
def db(client):
    provider = app.dependency_overrides[get_db]()
    session = next(provider)
    yield session
    provider.close()


@pytest.fixture
def deleted_refs(monkeypatch):
    """스토리지 삭제 호출을 가로채 참조만 모은다(실제 S3·파일 접근 없음)."""
    from app.services import media_cleanup_service

    refs: list[str] = []
    monkeypatch.setattr(media_cleanup_service, "_delete_media_ref", lambda ref: refs.append(ref))
    return refs


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "retention_sweep_enabled", True)
    monkeypatch.setattr(settings, "retention_apply_from", "2026-01-01")
    monkeypatch.setattr(settings, "retention_raw_days", 90)
    monkeypatch.setattr(settings, "retention_guest_pii_days", 90)
    monkeypatch.setattr(settings, "retention_hold_alert_days", 14)


def _host(db):
    host = User(email=f"b12-{uuid.uuid4().hex[:8]}@test.com", name="상담사", role="counselor", password_hash="x")
    db.add(host)
    db.flush()
    return host


def _session_with_originals(db, ended_at=OLD, *, status="completed", hidden=False, tag="a"):
    """원본(EEG raw·음성·영상·병합본·STT)과 비회원/회원 참가자를 가진 클래스."""
    host = _host(db)
    s = Session(
        host_id=host.id, type="meditation", status=status, duration_min=10, participant_mode="group",
        started_at=ended_at - timedelta(minutes=10), ended_at=ended_at, title="B12",
        hidden_at=(NOW if hidden else None),
    )
    db.add(s)
    db.flush()
    guest = SessionParticipant(
        session_id=s.id, guest_name="게스트", gender="female", report_email="g@example.com",
        report_included=True,
    )
    member_user = User(email=f"m-{uuid.uuid4().hex[:6]}@test.com", name="회원", role="client", password_hash="x")
    db.add_all([guest, member_user])
    db.flush()
    member = SessionParticipant(session_id=s.id, user_id=member_user.id, report_included=True)
    db.add(member)
    db.flush()
    for p in (guest, member):
        db.add(EEGRecord(session_id=s.id, participant_id=p.id, s3_key=f"eeg/{p.id}", file_count=2))
        for i in range(2):
            db.add(EEGRawChunk(
                session_id=s.id, participant_id=p.id, chunk_index=i, object_key=f"eeg-raw/{tag}/{p.id}/{i}",
                upload_status="uploaded", size_bytes=1000,
            ))
        db.add(EEGFeatureWindow(session_id=s.id, participant_id=p.id, window_index=0, quality="valid", focus_index=50.0))
    db.add(AudioChunk(session_id=s.id, chunk_index=0, file_path=f"/tmp/mindbreeze_audio/{tag}.webm", size_bytes=500))
    db.add(VideoChunk(session_id=s.id, chunk_index=0, file_path=f"video/{tag}/0.webm", size_bytes=700))
    db.add(SessionRecord(
        session_id=s.id, transcript="전사 원문", status="completed", video_s3_key=f"video/{tag}/merged.webm",
        ai_summary={"segments": [{"speaker": "A", "text": "발화"}], "summary": "요약"},
    ))
    db.add(Report(session_id=s.id, user_id=host.id, type="counselor", status="completed",
                  content={"title": "리포트", "transcript_segments": [{"text": "x"}]}))
    db.commit()
    return host, s, guest, member


def _counts(db, sid):
    return {
        "eeg": db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid).count(),
        "audio": db.query(AudioChunk).filter(AudioChunk.session_id == sid).count(),
        "video": db.query(VideoChunk).filter(VideoChunk.session_id == sid).count(),
        "windows": db.query(EEGFeatureWindow).filter(EEGFeatureWindow.session_id == sid).count(),
    }


def _run(db, **kw):
    from app.services.retention_sweep_service import run_retention_sweep

    return run_retention_sweep(db, now=NOW, **kw)


# ── BT56: dry-run / 비활성 ─────────────────────────────────────────────────────────

def test_BT56_기본은_비활성_삭제_0_후보_출력_이력_기록(db, deleted_refs):
    assert settings.retention_sweep_enabled is False, "배포 기본값은 비활성"
    host, s, guest, member = _session_with_originals(db)
    report = _run(db)
    assert report["mode"] == "dry_run" and report["blocked_reason"] == "sweep_disabled"
    assert report["raw"]["sessions"] == 1
    assert report["raw"]["eeg_raw_chunks"] == 4 and report["raw"]["audio_chunks"] == 1 and report["raw"]["video_chunks"] == 1
    assert report["raw"]["merged_videos"] == 1 and report["raw"]["transcripts"] == 1
    assert report["raw"]["bytes_known"] == 4 * 1000 + 500 + 700
    assert report["raw"]["deleted"] == {"eeg_raw_chunks": 0, "audio_chunks": 0, "video_chunks": 0,
                                         "merged_videos": 0, "transcripts": 0}
    assert report["guest_pii"]["participants"] == 1
    assert _counts(db, s.id) == {"eeg": 4, "audio": 1, "video": 1, "windows": 2}
    assert deleted_refs == []
    db.expire_all()
    rec = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).one()
    assert rec.transcript == "전사 원문" and rec.video_s3_key
    g = db.query(SessionParticipant).filter(SessionParticipant.id == guest.id).one()
    assert g.guest_name == "게스트" and g.pii_scrubbed_at is None
    runs = db.query(RetentionSweepRun).all()
    assert len(runs) == 1 and runs[0].mode == "dry_run" and runs[0].status == "completed"
    assert runs[0].report["raw"]["sessions"] == 1 and runs[0].finished_at is not None


def test_BT56_활성이어도_dry_run_요청이면_삭제_0(db, enabled, deleted_refs):
    host, s, guest, member = _session_with_originals(db)
    report = _run(db, dry_run=True)
    assert report["mode"] == "dry_run" and report["blocked_reason"] == "dry_run_requested"
    assert _counts(db, s.id)["eeg"] == 4


def test_N5_apply_from_미설정이면_활성이어도_삭제_거부(db, monkeypatch, deleted_refs):
    monkeypatch.setattr(settings, "retention_sweep_enabled", True)
    monkeypatch.setattr(settings, "retention_apply_from", "")
    host, s, *_ = _session_with_originals(db)
    report = _run(db)
    assert report["mode"] == "dry_run" and report["blocked_reason"] == "apply_from_unset"
    assert _counts(db, s.id)["eeg"] == 4


# ── 원본 기간 삭제 ─────────────────────────────────────────────────────────────────

def test_원본_기간_삭제_세션_종료일_기준_지표_리포트_보존(db, enabled, deleted_refs):
    host, old, *_ = _session_with_originals(db, ended_at=OLD, tag="old")
    _, recent, *_ = _session_with_originals(db, ended_at=RECENT, tag="recent")
    report = _run(db)
    assert report["mode"] == "execute" and report["blocked_reason"] is None
    assert report["raw"]["deleted"]["eeg_raw_chunks"] == 4
    assert _counts(db, old.id) == {"eeg": 0, "audio": 0, "video": 0, "windows": 2}, "지표(윈도우)는 삭제 대상 아님"
    assert _counts(db, recent.id) == {"eeg": 4, "audio": 1, "video": 1, "windows": 2}, "기간 미경과 클래스는 그대로"
    db.expire_all()
    rec = db.query(SessionRecord).filter(SessionRecord.session_id == old.id).one()
    assert rec.transcript is None and rec.video_s3_key is None and "segments" not in (rec.ai_summary or {})
    assert (rec.ai_summary or {}).get("summary") == "요약", "요약 등 비원본 필드는 유지"
    rep = db.query(Report).filter(Report.session_id == old.id).one()
    assert rep.content["title"] == "리포트", "리포트 본문은 삭제 대상 아님(N-2)"
    assert all(r.file_count == 0 for r in db.query(EEGRecord).filter(EEGRecord.session_id == old.id))
    # 스토리지 참조 삭제(오래된 클래스 것만)
    assert any("/old/" in r or "old" in r for r in deleted_refs)
    assert not any("recent" in r for r in deleted_refs)
    assert len(deleted_refs) == 4 + 1 + 1 + 1  # eeg 4 + audio + video 청크 + 병합본


def test_멱등_두번째_실행은_후보_0(db, enabled, deleted_refs):
    _session_with_originals(db)
    _run(db)
    again = _run(db)
    assert again["raw"]["sessions"] == 0 and again["guest_pii"]["participants"] == 0


def test_N5_apply_from_이전에_종료된_클래스는_대상이_아니다(db, enabled, monkeypatch, deleted_refs):
    monkeypatch.setattr(settings, "retention_apply_from", "2026-09-01")
    host, s, *_ = _session_with_originals(db, ended_at=NOW - timedelta(days=200))  # 2026-05 경 종료
    report = _run(db)
    assert report["raw"]["sessions"] == 0
    assert _counts(db, s.id)["eeg"] == 4


def test_진행중_예정_클래스는_대상이_아니다(db, enabled, deleted_refs):
    host, s, *_ = _session_with_originals(db, status="in_progress")
    assert _run(db)["raw"]["sessions"] == 0
    assert _counts(db, s.id)["eeg"] == 4


def test_BT62_숨긴_클래스도_종료일_기준으로_대상(db, enabled, deleted_refs):
    host, s, *_ = _session_with_originals(db, hidden=True)
    report = _run(db)
    assert report["raw"]["deleted"]["eeg_raw_chunks"] == 4
    assert _counts(db, s.id)["eeg"] == 0


# ── BT57: 비회원 개인정보 스크럽 ───────────────────────────────────────────────────

def test_BT57_비회원_개인정보_스크럽_행과_참조_유지(db, enabled, deleted_refs):
    host, s, guest, member = _session_with_originals(db)
    db.add(SessionEmailInvite(session_id=s.id, email="invitee@example.com", email_norm="invitee@example.com",
                              status="requested"))
    db.commit()
    report = _run(db)
    assert report["guest_pii"]["scrubbed"] == {"participants": 1, "invites": 1}
    db.expire_all()
    g = db.query(SessionParticipant).filter(SessionParticipant.id == guest.id).one()
    assert g.guest_name is None and g.gender is None and g.birth_date is None and g.report_email is None
    assert g.pii_scrubbed_at is not None and g.session_id == s.id and g.user_id is None
    m = db.query(SessionParticipant).filter(SessionParticipant.id == member.id).one()
    assert m.pii_scrubbed_at is None, "회원 참가자는 대상 아님"
    inv = db.query(SessionEmailInvite).filter(SessionEmailInvite.session_id == s.id).one()
    assert inv.email is None and inv.email_norm is None and inv.pii_scrubbed_at is not None
    # 리포트 열람 정상(호스트)
    from app.services import report_service

    rep = db.query(Report).filter(Report.session_id == s.id).one()
    got = report_service.get_report(str(rep.id), str(host.id), db)
    assert got["content"]["title"] == "리포트"


def test_BT57_개인정보_보관기간_미경과는_그대로(db, enabled, monkeypatch, deleted_refs):
    monkeypatch.setattr(settings, "retention_guest_pii_days", 365)
    host, s, guest, member = _session_with_originals(db)
    report = _run(db)
    assert report["guest_pii"]["participants"] == 0
    db.expire_all()
    assert db.query(SessionParticipant).filter(SessionParticipant.id == guest.id).one().guest_name == "게스트"


# ── BT58/BT59: 연구 게이트 ─────────────────────────────────────────────────────────

def _consent(db, session, participant, state, *, consented=True, withdrawn=False):
    row = ResearchConsent(
        session_id=session.id, participant_id=participant.id, consented=consented,
        withdrawn_at=NOW if withdrawn else None, export_state=state,
        research_subject_id="a" * 64 if consented else None,
    )
    db.add(row)
    db.commit()
    return row


def test_BT58_동의_미ack_건은_삭제_보류_다른_참가자는_삭제(db, enabled, deleted_refs):
    host, s, guest, member = _session_with_originals(db)
    _consent(db, s, guest, "pending")
    report = _run(db)
    hold = report["research_hold"]
    assert hold["participants"] == 1 and hold["eeg_raw_chunks"] == 2 and hold["queued_for_export"] == 1
    left = db.query(EEGRawChunk).filter(EEGRawChunk.session_id == s.id).all()
    assert {c.participant_id for c in left} == {guest.id} and len(left) == 2, "보류 참가자 EEG raw 만 남는다"
    assert db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count() == 0, "연구 번들에 없는 음성·영상은 게이트 대상 아님"
    assert report["raw"]["deleted"]["eeg_raw_chunks"] == 2
    rec = db.query(EEGRecord).filter(EEGRecord.participant_id == guest.id).one()
    assert rec.file_count == 2
    assert not any(str(guest.id) in r for r in deleted_refs)


def test_BT58_키_미설정_차단_상태도_보류하고_blocked로_센다(db, enabled, deleted_refs):
    host, s, guest, member = _session_with_originals(db)
    _consent(db, s, guest, "blocked_key_missing")
    hold = _run(db)["research_hold"]
    assert hold["blocked"] == 1 and hold["queued_for_export"] == 0
    assert db.query(EEGRawChunk).filter(EEGRawChunk.participant_id == guest.id).count() == 2


def test_BT59_ack_후에는_삭제_거부_철회는_게이트_없음(db, enabled, deleted_refs):
    host, s, guest, member = _session_with_originals(db, tag="x")
    _consent(db, s, guest, "acked")
    _consent(db, s, member, "withdrawn", withdrawn=True)
    report = _run(db)
    assert report["research_hold"]["participants"] == 0
    assert db.query(EEGRawChunk).filter(EEGRawChunk.session_id == s.id).count() == 0

    host2, s2, guest2, member2 = _session_with_originals(db, tag="y")
    _consent(db, s2, guest2, "not_applicable", consented=False)  # 거부
    _run(db)
    assert db.query(EEGRawChunk).filter(EEGRawChunk.session_id == s2.id).count() == 0


def test_BT59_dry_run은_보류를_세기만_하고_상태를_바꾸지_않는다(db, deleted_refs):
    host, s, guest, member = _session_with_originals(db)
    row = _consent(db, s, guest, "pending")
    report = _run(db)
    assert report["research_hold"]["participants"] == 1
    db.expire_all()
    assert db.query(ResearchConsent).filter(ResearchConsent.id == row.id).one().hold_alerted_at is None


# ── BT60: 임계 알림 1회 ────────────────────────────────────────────────────────────

def test_BT60_보류가_임계를_넘기면_플랫폼_관리자에게_1회_알림(db, enabled, deleted_refs):
    admin = User(email=f"adm-{uuid.uuid4().hex[:6]}@test.com", name="관리자", role="platform_admin", password_hash="x")
    db.add(admin)
    db.commit()
    # 종료 후 90 + 14 = 104일 초과 → 110일 전 종료
    host, s, guest, member = _session_with_originals(db, ended_at=NOW - timedelta(days=110))
    _consent(db, s, guest, "pending")

    def count():
        return db.query(Notification).filter(Notification.user_id == admin.id).count()

    first = _run(db)["research_hold"]
    assert first["overdue"] == 1 and first["alerted"] == 1 and count() == 1
    second = _run(db)["research_hold"]
    assert second["overdue"] == 1 and second["alerted"] == 0 and count() == 1, "중복 알림 0"


def test_BT60_임계_전에는_알리지_않는다(db, enabled, deleted_refs):
    admin = User(email=f"adm-{uuid.uuid4().hex[:6]}@test.com", name="관리자", role="platform_admin", password_hash="x")
    db.add(admin)
    db.commit()
    host, s, guest, member = _session_with_originals(db, ended_at=NOW - timedelta(days=100))
    _consent(db, s, guest, "pending")
    hold = _run(db)["research_hold"]
    assert hold["participants"] == 1 and hold["overdue"] == 0 and hold["alerted"] == 0
    assert db.query(Notification).filter(Notification.user_id == admin.id).count() == 0


# ── BT61: 기존 cron 과의 통합 ──────────────────────────────────────────────────────

def test_BT61_비활성이면_기존_스위프가_그대로_동작(db):
    from app.tasks import eeg_raw_task, media_cleanup_task

    media = media_cleanup_task.run_sweep_stale_media(db)
    eeg = eeg_raw_task.run_sweep_eeg_raw(db)
    assert "audio_deleted" in media and "video_deleted" in media
    assert "pending_deleted" in eeg and "skipped" not in eeg


def test_BT61_활성이면_기존_스위프는_건너뛴다_이중_실행_0(db, enabled):
    from app.tasks import eeg_raw_task, media_cleanup_task

    assert media_cleanup_task.run_sweep_stale_media(db) == {"skipped": "replaced_by_retention_sweep"}
    assert eeg_raw_task.run_sweep_eeg_raw(db) == {"skipped": "replaced_by_retention_sweep"}


def test_BT61_활성_실행은_임시_고아_정리를_함께_수행(db, enabled, deleted_refs):
    host, s, *_ = _session_with_originals(db, ended_at=RECENT)
    stale = EEGRawChunk(
        session_id=s.id, participant_id=None, chunk_index=99, object_key="eeg-raw/orphan/99",
        upload_status="pending", created_at=NOW - timedelta(days=3),
    )
    db.add(stale)
    db.commit()
    report = _run(db)
    assert report["orphan_cleanup"]["eeg_raw"]["pending_deleted"] >= 0
    # 임시(pending) 청크는 지만 기간 미경과 원본(uploaded)은 건드리지 않는다
    assert db.query(EEGRawChunk).filter(EEGRawChunk.session_id == s.id, EEGRawChunk.upload_status == "uploaded").count() == 4


def test_cron_스크립트는_비활성에서_dry_run_보고서를_출력(db, capsys, deleted_refs):
    import retention_sweep_cron

    _session_with_originals(db)
    assert retention_sweep_cron.main([]) == 0
    out = capsys.readouterr().out
    assert "[retention_sweep]" in out and '"mode": "dry_run"' in out
    assert db.query(EEGRawChunk).count() >= 4

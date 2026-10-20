"""SDD-220 TS21·TS22·TS41·TS43 — 탈퇴 후 30일 사용자 영구 삭제 스위프."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.config import settings
from app.core.database import Base, get_db
from app.main import app
from app.models.account_deletion import (
    AccountDeletionLedger,
    AccountDeletionObject,
    SocialRevokeOutbox,
)
from app.models.agent import AgentConversation, AgentMessage
from app.models.chat import ChatMessage, ChatRoom, ChatRoomParticipant
from app.models.client_profile import ClientProfile
from app.models.consent import Consent
from app.models.credential import Credential
from app.models.data_export import DataExportJob
from app.models.device_token import DeviceToken
from app.models.eeg_feature import EEGFeatureWindow
from app.models.normalization_baseline import NormalizationBaseline
from app.models.notification import Notification
from app.models.record import EEGRawChunk, EEGRecord, Report
from app.models.refresh_token import RefreshToken
from app.models.research import ResearchConsent, ResearchConsentEvent, ResearchWithdrawalRequest
from app.models.session import Session as SessionModel, SessionParticipant
from app.models.user import User
from app.services import account_deletion_service as svc
from app.services import account_deletion_sweep_service as sweep
from app.services import storage_service
from tests.sdd220_helpers import VALID_PASSWORD, email_register_payload, ensure_account_routes, make_user

T0 = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
STRICT = {"X-Test-Strict-Signup": "1", "X-Test-Strict-Recording": "1"}


def _db():
    return next(app.dependency_overrides[get_db]())


@pytest.fixture(autouse=True)
def _routes():
    ensure_account_routes()


class Deleter:
    """외부 삭제 호출을 기록하는 가짜 — 실 S3·로컬 파일을 건드리지 않는다."""

    def __init__(self, fail: set[str] | None = None):
        self.calls: list[tuple[str, str]] = []
        self.fail = fail or set()

    def __call__(self, kind: str, key: str) -> None:
        self.calls.append((kind, key))
        if key in self.fail:
            raise RuntimeError("s3 down")


def _seed(db):
    """사용자 A(탈퇴)·B(타인)와 같은 회차에 속한 모든 종류의 개인 데이터."""
    host = make_user(db, "host@x.com", role="counselor")
    a = make_user(db, "a@x.com")
    b = make_user(db, "b@x.com")
    s = SessionModel(type="meditation", host_id=host.id, status="completed", duration_min=30, is_template=False,
                     scheduled_at=T0 - timedelta(days=200))
    db.add(s)
    db.commit()
    parts = {}
    for name, u in (("a", a), ("b", b)):
        p = SessionParticipant(session_id=s.id, user_id=u.id, gender="female", report_email=f"{name}@x.com",
                               recording_consented=True, recording_notice_version="rec-1")
        db.add(p)
        db.flush()
        parts[name] = p
        db.add(EEGRecord(session_id=s.id, user_id=u.id, participant_id=p.id, s3_key=f"eeg/{name}/record"))
        db.add(EEGRawChunk(session_id=s.id, user_id=u.id, participant_id=p.id, chunk_index=0, object_key=f"eeg-raw/{name}/0"))
        db.add(EEGFeatureWindow(session_id=s.id, user_id=u.id, participant_id=p.id, window_index=0))
        db.add(Report(session_id=s.id, user_id=u.id, participant_id=p.id, type="client", content={"quote": f"{name}-secret"},
                      pdf_url=f"reports/{name}.pdf"))
        db.add(ClientProfile(user_id=u.id, concerns=[], interests=[]))
        db.add(Consent(user_id=u.id, type="tos", version="1.0", agreed=True))
        db.add(DeviceToken(user_id=u.id, token=f"tok-{name}", platform="ios"))
        db.add(Notification(user_id=u.id, type="x", title=f"{name} 알림"))
        db.add(Credential(user_id=u.id, type="license", s3_key=f"cred/{name}.pdf"))
        db.add(NormalizationBaseline(user_id=str(u.id), device_id=f"dev-{name}", birth_date="1990-01-01", closed={}, open={}))
        conv = AgentConversation(user_id=u.id)
        db.add(conv)
        db.flush()
        db.add(AgentMessage(conversation_id=conv.id, sender="user", content=f"{name} 대화"))
        db.add(DataExportJob(user_id=u.id, requester_role="client", session_id=s.id, participant_id=p.id, include=[],
                             purpose="p", request_hash="h" * 64, consent_eeg=True, expires_at=T0 + timedelta(days=9),
                             object_key=f"data-exports/{name}/data.zip"))
    room = ChatRoom(room_type="session", host_id=a.id)
    db.add(room)
    db.flush()
    for u in (a, b, host):
        db.add(ChatRoomParticipant(room_id=room.id, user_id=u.id))
    db.add(ChatMessage(room_id=room.id, sender_id=a.id, content="A의 비밀", file_url="chat/a.png"))
    db.add(ChatMessage(room_id=room.id, sender_id=a.id, content="외부", file_url="https://evil.example.com/x.png"))
    db.add(ChatMessage(room_id=room.id, sender_id=b.id, content="B의 말", file_url="chat/b.png"))
    # 연구 동의: A 는 동의, 가명 ID 보유
    db.add(ResearchConsent(session_id=s.id, participant_id=parts["a"].id, consented=True, notice_version="r5-1",
                           research_subject_id="a" * 64, key_version=1, export_state="pending"))
    db.add(ResearchConsent(session_id=s.id, participant_id=parts["b"].id, consented=True, notice_version="r5-1",
                           research_subject_id="b" * 64, key_version=1, export_state="pending"))
    db.add(ResearchConsentEvent(session_id=s.id, participant_id=parts["a"].id, event_type="consented",
                                previous_consented=False, new_consented=True, actor_user_id=a.id))
    db.commit()
    return host, a, b, s, parts


def _count(db, table, where=None):
    t = Base.metadata.tables[table]
    q = sa.select(sa.func.count()).select_from(t)
    return db.execute(q.where(where) if where is not None else q).scalar()


def _fk_dangling(db, uid) -> int:
    total = 0
    for table in Base.metadata.sorted_tables:
        if table.name == "users":
            continue
        for fk in table.foreign_keys:
            if fk.column.table.name == "users":
                total += db.execute(sa.select(sa.func.count()).select_from(table).where(table.c[fk.parent.name] == uid)).scalar()
    return total


def _delete_a(db, a):
    return svc.delete_account(db, a.id, now=T0)


# ── 분류 누락 방지 ─────────────────────────────────────────────────────

def test_ts22_모든_사용자_참조_FK_테이블이_삭제_분류에_있다():
    assert sweep.uncovered_user_references() == []


# ── TS21 ──────────────────────────────────────────────────────────────

def test_ts21_29일_30일직전은_삭제_0_정확히_30일에_삭제(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    deleter = Deleter()
    for delta in (timedelta(days=29), timedelta(days=30) - timedelta(seconds=1)):
        rep = sweep.run_account_deletion_sweep(db, now=T0 + delta, execute=True, deleter=deleter)
        assert rep["due"] == 0 and rep["purged"] == 0
    assert deleter.calls == []
    assert _count(db, "eeg_records", sa.text("user_id = :u").bindparams(u=str(a.id).replace('-', ''))) is not None
    assert db.query(EEGRecord).filter_by(participant_id=parts["a"].id).count() == 1  # 개인 행 보존
    assert db.query(User).filter_by(id=a.id).first() is not None

    rep = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=deleter)
    assert rep["due"] == 1 and rep["purged"] == 1 and rep["failed"] == 0
    assert db.query(AccountDeletionLedger).filter_by(user_id=a.id).first().status == "purged"


def test_ts21_세션_종료가_오래돼도_사용자_기준으로만_삭제된다_90일_설정과_무관(client, monkeypatch):
    db = _db()
    host, a, b, s, parts = _seed(db)  # 회차는 200일 전 종료(기존 90일 보관 기준으로는 이미 대상)
    _delete_a(db, a)
    monkeypatch.setattr(settings, "retention_sweep_enabled", False)
    early = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=10), execute=True, deleter=Deleter())
    assert early["due"] == 0
    done = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=Deleter())
    assert done["purged"] == 1


def test_ts21_purge_전에는_재가입_409_후에는_새_UUID로_가입(client):
    db = _db()
    assert client.post("/api/v1/auth/register/client", json=email_register_payload("again@x.com"), headers=STRICT).status_code == 201
    user = db.query(User).filter_by(email="again@x.com").first()
    old_id = user.id
    _delete_a(db, user)
    blocked = client.post("/api/v1/auth/register/client", json=email_register_payload("again@x.com"), headers=STRICT)
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "ACCOUNT_DELETION_PENDING"

    # 30일이 지나도 purge 가 실패하면 계속 차단
    failing = Deleter(fail={"x"})
    sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=31), execute=True, deleter=failing)
    ledger = db.query(AccountDeletionLedger).filter_by(user_id=old_id).first()
    assert ledger.status == "purged"  # 객체가 없으면 정상 완료 — 아래 실패 케이스는 TS41 에서 확인
    again = client.post("/api/v1/auth/register/client", json=email_register_payload("again@x.com"), headers=STRICT)
    assert again.status_code == 201
    new_id = again.json()["user"]["id"]
    assert new_id != str(old_id)


def test_ts21_실패한_purge는_날짜가_지나도_재가입_불가(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=31), execute=True, deleter=Deleter(fail={"eeg/a/record"}))
    assert db.query(AccountDeletionLedger).filter_by(user_id=a.id).first().status == "failed"
    res = client.post("/api/v1/auth/register/client", json=email_register_payload("a@x.com"), headers=STRICT)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_DELETION_PENDING"


# ── TS22 ──────────────────────────────────────────────────────────────

def test_ts22_A만_삭제_B와_기관_공용_회차_보존(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    before_b = {t: _count(db, t) for t in ("notifications",)}
    _delete_a(db, a)
    deleter = Deleter()
    rep = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=deleter)
    assert rep["purged"] == 1

    pa, pb = parts["a"].id, parts["b"].id
    # A 소유 개인 데이터 0
    assert db.query(EEGRecord).filter_by(participant_id=pa).count() == 0
    assert db.query(EEGRawChunk).filter_by(participant_id=pa).count() == 0
    assert db.query(EEGFeatureWindow).filter_by(participant_id=pa).count() == 0
    assert db.query(Report).filter_by(participant_id=pa).count() == 0
    for model in (ClientProfile, Consent, DeviceToken, Notification, Credential, RefreshToken, AgentConversation, DataExportJob):
        assert db.query(model).filter_by(user_id=a.id).count() == 0, model
    assert db.query(NormalizationBaseline).filter_by(user_id=str(a.id)).count() == 0
    assert db.query(AgentMessage).count() == 1  # B 의 대화 메시지만 남는다
    assert db.query(ChatRoomParticipant).filter_by(user_id=a.id).count() == 0
    mine = db.query(ChatMessage).filter(ChatMessage.content.like("%A의%")).count()
    assert mine == 0
    assert db.query(ChatMessage).filter(ChatMessage.file_url.in_(["chat/a.png"])).count() == 0
    # 참여자 행은 식별 정보만 비우고 보존 (타인 출석·집계 유지)
    row = db.query(SessionParticipant).filter_by(id=pa).first()
    assert row is not None and row.user_id is None and row.report_email is None and row.gender is None
    # B·기관·회차 보존
    assert db.query(EEGRecord).filter_by(participant_id=pb).count() == 1
    assert db.query(Report).filter_by(participant_id=pb).count() == 1
    assert db.query(ClientProfile).filter_by(user_id=b.id).count() == 1
    assert db.query(ChatMessage).filter(ChatMessage.content == "B의 말").count() == 1
    assert db.query(SessionModel).filter_by(id=s.id).first() is not None
    assert db.query(User).filter_by(id=host.id).first() is not None
    assert _count(db, "notifications") == before_b["notifications"] - 1
    # dangling FK 0, users 행 제거
    assert db.query(User).filter_by(id=a.id).first() is None
    assert _fk_dangling(db, a.id) == 0
    # 삭제 호출은 A 의 서비스 소유 키뿐 — B 의 키·외부 URL 은 건드리지 않는다
    deleted = {key for _, key in deleter.calls}
    assert deleted == {"eeg/a/record", "eeg-raw/a/0", "reports/a.pdf", "cred/a.pdf", "data-exports/a/data.zip", "chat/a.png"}
    assert not any("b/" in k or "evil" in k for k in deleted)


def test_ts22_호스트로_진행한_회차는_보존되고_users_행은_익명_자리표시로_남는다(client):
    db = _db()
    host = make_user(db, "gone-host@x.com", role="counselor")
    other = make_user(db, "attendee@x.com")
    s = SessionModel(type="meditation", host_id=host.id, status="completed", duration_min=30, is_template=False)
    db.add(s)
    db.commit()
    p = SessionParticipant(session_id=s.id, user_id=other.id)
    db.add(p)
    db.commit()
    svc.delete_account(db, host.id, now=T0)
    rep = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=Deleter())
    assert rep["purged"] == 1
    kept = db.query(SessionModel).filter_by(id=s.id).execution_options(include_hidden=True).first()
    assert kept is not None  # 타인 회차 보존(진행자 탈퇴로 숨김 처리된 상태)
    tomb = db.query(User).filter_by(id=host.id).first()
    assert tomb is not None and tomb.name == "탈퇴한 사용자" and tomb.phone is None and "host" not in tomb.email.split("@")[0].replace("deleted+", "")
    ledger = db.query(AccountDeletionLedger).filter_by(user_id=host.id).first()
    assert ledger.status == "purged"
    assert sweep.REASON_SHARED_MEDIA in (ledger.retained_reasons or {}) and sweep.REASON_TOMBSTONE in ledger.retained_reasons


def test_ts22_연구_이력은_삭제하지_않고_사용자_식별자만_가명화_철회요청_1건(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    assert db.query(ResearchWithdrawalRequest).filter_by(research_subject_id="a" * 64).count() == 1  # 탈퇴 시점에 이미 생성
    sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=Deleter())
    sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=40), execute=True, deleter=Deleter())
    assert db.query(ResearchWithdrawalRequest).filter_by(research_subject_id="a" * 64).count() == 1  # 중복 0
    ev = db.query(ResearchConsentEvent).filter_by(participant_id=parts["a"].id).all()
    assert ev and all(e.actor_user_id is None for e in ev)              # 이력 보존, 식별자만 제거
    row = db.query(ResearchConsent).filter_by(participant_id=parts["a"].id).first()
    assert row.consented is False and row.export_state == "withdrawn" and row.research_subject_id == "a" * 64
    assert db.query(ResearchConsent).filter_by(participant_id=parts["b"].id).first().consented is True


# ── TS41 ──────────────────────────────────────────────────────────────

def test_ts41_객체_삭제_실패는_행과_원장을_보존하고_재시도로_완료(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    now = T0 + timedelta(days=30)
    flaky = Deleter(fail={"eeg-raw/a/0"})
    rep = sweep.run_account_deletion_sweep(db, now=now, execute=True, deleter=flaky)
    assert rep["failed"] == 1 and rep["purged"] == 0
    ledger = db.query(AccountDeletionLedger).filter_by(user_id=a.id).first()
    assert ledger.status == "failed"
    assert db.query(User).filter_by(id=a.id).first() is not None                      # 사용자 행 보존
    assert db.query(EEGRecord).filter_by(participant_id=parts["a"].id).count() == 1   # DB 행 보존
    failed = db.query(AccountDeletionObject).filter_by(ledger_id=ledger.id, status="failed").all()
    assert [o.object_key for o in failed] == ["eeg-raw/a/0"]                          # 실패 키가 원장에 남는다

    ok = Deleter()
    rep2 = sweep.run_account_deletion_sweep(db, now=now + timedelta(hours=1), execute=True, deleter=ok)
    assert rep2["purged"] == 1
    assert [k for _, k in ok.calls] == ["eeg-raw/a/0"]   # 성공했던 객체는 재삭제하지 않는다(멱등)
    assert db.query(AccountDeletionLedger).filter_by(user_id=a.id).first().status == "purged"
    again = Deleter()
    assert sweep.run_account_deletion_sweep(db, now=now + timedelta(days=2), execute=True, deleter=again)["due"] == 0
    assert again.calls == []


def test_ts41_dry_run은_DB_쓰기_외부호출_0(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    ledger_before = db.query(AccountDeletionLedger).filter_by(user_id=a.id).first()
    attempts, status = ledger_before.attempts, ledger_before.status
    objects_before = db.query(AccountDeletionObject).count()
    deleter = Deleter()
    rep = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), deleter=deleter)  # 기본 execute=False
    assert rep["mode"] == "dry_run" and rep["due"] == 1 and rep["users"][0]["objects"] == 6
    assert rep["users"][0]["would_delete"]
    assert deleter.calls == []
    db.expire_all()
    ledger = db.query(AccountDeletionLedger).filter_by(user_id=a.id).first()
    assert (ledger.attempts, ledger.status) == (attempts, status)
    assert db.query(AccountDeletionObject).count() == objects_before
    assert db.query(EEGRecord).filter_by(participant_id=parts["a"].id).count() == 1
    assert db.query(User).filter_by(id=a.id).first().status == "deleted"


def test_ts41_로컬_경로는_허용_루트_안에서만_삭제하고_밖은_건너뜀(tmp_path, monkeypatch):
    from app.services import audio_service

    root = tmp_path / "audio"
    root.mkdir()
    monkeypatch.setattr(audio_service, "CHUNK_STORAGE_DIR", root)
    inside = root / "a.bin"
    inside.write_bytes(b"x")
    outside = tmp_path / "other" / "secret.txt"
    outside.parent.mkdir()
    outside.write_text("keep")
    sweep._default_deleter("local", str(inside))
    assert not inside.exists()
    with pytest.raises(PermissionError):
        sweep._default_deleter("local", str(outside))
    with pytest.raises(PermissionError):
        sweep._default_deleter("local", str(root / ".." / "other" / "secret.txt"))  # 경로 탈출
    assert outside.exists()


def test_ts41_외부_URL과_B의_키는_수집_대상이_아니다(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    refs = {key for _, key in sweep.collect_objects(db, a.id)}
    assert "https://evil.example.com/x.png" not in refs and not any(r.startswith("http") for r in refs)
    assert not any("/b/" in r or r.endswith("b.png") or r.endswith("b.pdf") for r in refs)


class _FakeS3:
    def __init__(self):
        self.deleted: list[dict] = []
        self.aborted: list[str] = []
        self.plain_deleted: list[str] = []

    def list_object_versions(self, **kw):
        return {
            "Versions": [{"Key": "k", "VersionId": "v1"}, {"Key": "k2", "VersionId": "other"}, {"Key": "k", "VersionId": "v2"}],
            "DeleteMarkers": [{"Key": "k", "VersionId": "dm1"}],
            "IsTruncated": False,
        }

    def delete_objects(self, Bucket, Delete):
        self.deleted += Delete["Objects"]
        return {}

    def delete_object(self, Bucket, Key):
        self.plain_deleted.append(Key)

    def list_multipart_uploads(self, **kw):
        return {"Uploads": [{"Key": "k", "UploadId": "u1"}, {"Key": "kk", "UploadId": "u2"}]}

    def abort_multipart_upload(self, Bucket, Key, UploadId):
        self.aborted.append(UploadId)


def test_ts41_S3_모든_버전과_multipart_잔여물을_지운다(monkeypatch):
    fake = _FakeS3()
    monkeypatch.setattr(storage_service, "_s3_client", lambda: fake)
    assert storage_service.delete_object_everywhere("k") is True
    assert {d["VersionId"] for d in fake.deleted} == {"v1", "v2", "dm1"}   # 다른 키(k2)는 제외
    assert fake.aborted == ["u1"]


# ── TS43 ──────────────────────────────────────────────────────────────

def test_ts43_법정_보관_목록_미확정이면_보고에_표시하고_무기한_보관_없음(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    rep = sweep.run_account_deletion_sweep(db, now=T0 + timedelta(days=30), execute=True, deleter=Deleter())
    assert rep["legal_hold_confirmed"] is False
    assert sweep.LEGAL_HOLD_ITEMS == ()
    assert db.query(User).filter_by(id=a.id).first() is None  # 목록이 비어 있어도 삭제는 진행(무기한 보관 금지)


def test_ts43_탈퇴_API는_연구_철회를_만들고_스위프가_추가요청을_만들지_않는다(client):
    db = _db()
    host, a, b, s, parts = _seed(db)
    res = client.request("DELETE", "/api/v1/users/me", json={"password": VALID_PASSWORD},
                         headers={"Authorization": f"Bearer {__import__('app.core.security', fromlist=['x']).create_access_token(subject=str(a.id))}"})
    assert res.status_code == 204, res.text
    assert db.query(ResearchWithdrawalRequest).filter_by(research_subject_id="a" * 64).count() == 1
    assert db.query(ResearchConsent).filter_by(participant_id=parts["a"].id).first().consented is False


def test_ts43_cron_사이클은_스위프_비활성에서도_알림_연결해제_재시도를_처리하고_삭제는_dry_run(client, monkeypatch):
    from app.tasks.account_deletion_task import run_account_deletion_cycle

    db = _db()
    host, a, b, s, parts = _seed(db)
    _delete_a(db, a)
    out = run_account_deletion_cycle(db, execute=False, now=T0 + timedelta(days=30))
    assert out["sweep"]["mode"] == "dry_run" and out["sweep"]["due"] == 1
    assert "revoke" in out and "notices" in out
    assert db.query(User).filter_by(id=a.id).first() is not None
    assert settings.account_deletion_sweep_enabled is False

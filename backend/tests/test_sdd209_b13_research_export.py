"""SDD-209 B13 — 연구 DB 내보내기 배치 (verify BT63~BT72, RV8, N-4).

Spark 실접속·실전송 없음 — 스테이징 S3 는 메모리 더블로 대체하고 포맷·검증·ack 계약만 확인한다.
"""

import hashlib
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pyarrow.parquet as pq
import pytest

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.research import ResearchConsent, ResearchWithdrawalRequest
from app.models.research_export import ResearchExportBatch, ResearchExportItem
from app.models.session import Session, SessionParticipant
from app.models.user import User

T0 = datetime(2026, 10, 17, 10, 0, 0, tzinfo=timezone.utc)
TOKEN = "unit-test-ack-token-not-a-secret"
GUEST_NAME = "홍길동연구"
GUEST_EMAIL = "gildong.research@example.com"
SESSION_TITLE = "비밀제목클래스"


@pytest.fixture
def db(client):
    provider = app.dependency_overrides[get_db]()
    session = next(provider)
    yield session
    provider.close()


@pytest.fixture
def staging(monkeypatch):
    """스테이징 S3 메모리 더블 — 쓰기/삭제/읽기를 기록한다."""
    from app.services import storage_service

    from types import SimpleNamespace

    store: dict[str, bytes] = {}
    calls = {"upload": [], "delete": []}
    raw_objects: dict[str, bytes] = {}
    holder = SimpleNamespace(fail_on=None, store=store, calls=calls, raw=raw_objects)

    def upload(key, content, *, content_type="application/octet-stream"):
        calls["upload"].append(key)
        if holder.fail_on and holder.fail_on in key:
            return False
        store[key] = content
        return True

    def download(key):
        return raw_objects.get(key)

    def delete(key):
        calls["delete"].append(key)
        store.pop(key, None)
        return True

    monkeypatch.setattr(storage_service, "upload_bytes", upload)
    monkeypatch.setattr(storage_service, "download_bytes", download)
    monkeypatch.setattr(storage_service, "delete_object", delete)
    return holder


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "research_export_enabled", True)
    monkeypatch.setattr(settings, "research_id_key_v1", "k" * 32)
    monkeypatch.setattr(settings, "research_export_ack_token", TOKEN)
    monkeypatch.setattr(settings, "research_export_prefix", "research-export/")


def _research_user(db, name=GUEST_NAME, email=None):
    """연구 검증은 동의 주체인 회원으로 구성한다. 비회원 제외는 별도 회귀에서 검증한다."""
    user = User(email=email or f"research-{uuid.uuid4().hex}@test.com", name=name, role="client", password_hash="x")
    db.add(user)
    db.flush()
    return user


def _setup(db, *, state="pending", consented=True, with_data=True, status="completed"):
    host = User(email=f"b13-{uuid.uuid4().hex[:8]}@test.com", name="호스트이름", role="counselor", password_hash="x")
    db.add(host)
    db.flush()
    s = Session(
        host_id=host.id, type="meditation", status=status, duration_min=10, participant_mode="group",
        location_type="online", linkband_mode="optional", title=SESSION_TITLE, notes="자유메모",
        started_at=T0, ended_at=T0 + timedelta(minutes=10),
    )
    db.add(s)
    db.flush()
    subject = _research_user(db)
    p = SessionParticipant(
        session_id=s.id, user_id=subject.id, guest_name=GUEST_NAME, report_email=GUEST_EMAIL, gender="female",
        birth_date=date(1990, 5, 17), report_included=True,
    )
    db.add(p)
    db.flush()
    consent = ResearchConsent(
        session_id=s.id, participant_id=p.id, consented=consented, export_state=state,
        research_subject_id=("a" * 64) if consented else None, key_version=1 if consented else None,
        gender="female", birth_year_month="1990-05",
    )
    db.add(consent)
    if with_data:
        base = int(T0.timestamp() * 1000)
        for i in range(3):
            db.add(EEGFeatureWindow(
                session_id=s.id, participant_id=p.id, window_index=i, quality="valid",
                device_timestamp_ms=float(base + i * 1000), focus_index=50.0 + i, heart_rate=70.0, motion=0.1,
                sdnn=40.0,
            ))
        for i in range(2):
            key = f"eeg-raw/{s.id}/{p.id}/{i}"
            db.add(EEGRawChunk(
                session_id=s.id, participant_id=p.id, chunk_index=i, object_key=key, upload_status="uploaded",
                start_ms=float(base + i * 4000), end_ms=float(base + (i + 1) * 4000), sample_rate=250,
                channel_count=2, unit="uV", schema_version="1.0", size_bytes=16,
            ))
    db.commit()
    return s, p, consent


def _put_raw(staging, s, p):
    for i in range(2):
        staging.raw[f"eeg-raw/{s.id}/{p.id}/{i}"] = bytes([i]) * 16


def _bundle(staging, batch_id):
    prefix = f"research-export/{batch_id}/"
    files = {k[len(prefix):]: v for k, v in staging.store.items() if k.startswith(prefix)}
    return files


def _export(db, s):
    from app.services import research_export_service as svc

    return svc.export_session(db, s.id)


# ── BT63 / BT64: 번들 생성·허용 필드·비식별 스캔 ─────────────────────────────────────

def test_BT63_동의_건만_번들_허용_필드_외_컬럼_0_생년월은_YYYY_MM(db, enabled, staging):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    # 동의하지 않은 다른 참가자 — 번들에 들어가면 안 된다
    other = SessionParticipant(session_id=s.id, guest_name="거부참가자", report_included=True)
    db.add(other)
    db.flush()
    db.add(ResearchConsent(session_id=s.id, participant_id=other.id, consented=False, export_state="not_applicable"))
    db.add(EEGFeatureWindow(session_id=s.id, participant_id=other.id, window_index=0, quality="valid", focus_index=1.0))
    db.commit()

    result = _export(db, s)
    assert result["status"] == "uploaded", result
    files = _bundle(staging, result["batch_id"])
    assert set(files) == {"sessions.parquet", "subjects.parquet", "eeg_raw.parquet", "features.parquet", "facilitators.parquet", "manifest.json"}

    from app.services.research_export_service import ALLOWED_COLUMNS

    for name, cols in ALLOWED_COLUMNS.items():
        table = pq.read_table(io.BytesIO(files[f"{name}.parquet"]))
        assert tuple(table.schema.names) == cols, f"{name}: 허용 필드 외 컬럼 0"
    subjects = pq.read_table(io.BytesIO(files["subjects.parquet"])).to_pylist()
    assert len(subjects) == 1 and subjects[0]["research_subject_id"] == "a" * 64
    assert subjects[0]["birth_year_month"] == "1990-05" and subjects[0]["gender"] == "female"
    assert len(subjects[0]["birth_year_month"]) == 7, "일(日) 값 0"
    features = pq.read_table(io.BytesIO(files["features.parquet"])).to_pylist()
    assert len(features) == 3, "동의 건의 지표만(거부 참가자 행 0)"
    assert {f["t_rel_ms"] for f in features} == {0.0, 1000.0, 2000.0}, "상대 시각"
    assert features[0]["heart_rate"] == 70.0 and features[0]["sdnn"] == 40.0, "PPG/ACC 는 파생 지표만"
    raw = pq.read_table(io.BytesIO(files["eeg_raw.parquet"])).to_pylist()
    assert len(raw) == 2 and raw[1]["payload"] == bytes([1]) * 16 and raw[1]["start_rel_ms"] == 4000.0
    sessions = pq.read_table(io.BytesIO(files["sessions.parquet"])).to_pylist()
    assert sessions[0]["participant_mode"] == "group" and sessions[0]["duration_min"] == 10


def test_BT64_비식별_스캔_이름_이메일_전화_STT_원본ID_절대시각_0(db, enabled, staging):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    files = _bundle(staging, result["batch_id"])
    blob = b"".join(v for k, v in files.items() if k != "manifest.json")
    haystacks = [blob, files["manifest.json"]]
    for needle in (GUEST_NAME, GUEST_EMAIL, SESSION_TITLE, "자유메모", "호스트이름", str(s.id), str(p.id),
                   str(s.host_id), str(consent.id), "transcript", "audio", "video"):
        for h in haystacks:
            assert needle.encode() not in h, f"번들에 {needle!r} 가 있다"
    # 절대 시각(epoch ms 13자리 값 / ISO 날짜) 0 — 지표·raw 시각은 모두 상대
    for name in ("features", "eeg_raw"):
        table = pq.read_table(io.BytesIO(files[f"{name}.parquet"]))
        for col in ("t_rel_ms", "start_rel_ms", "end_rel_ms"):
            if col in table.schema.names:
                assert all(v is None or v < 10**9 for v in table.column(col).to_pylist())
    manifest = json.loads(files["manifest.json"])
    assert "2026" not in json.dumps(manifest), "manifest 에 절대 시각 없음"


def test_BT63_허용_목록_밖_컬럼이_있으면_업로드_0(db, enabled, staging, monkeypatch):
    from app.services import research_export_service as svc

    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    monkeypatch.setitem(svc.ALLOWED_COLUMNS, "sessions", svc.ALLOWED_COLUMNS["sessions"])
    real = svc._table

    def leaky(name, rows):
        table = real(name, rows)
        if name == "subjects":
            import pyarrow as pa

            table = table.append_column("guest_name", pa.array([GUEST_NAME] * table.num_rows))
        return table

    monkeypatch.setattr(svc, "_table", leaky)
    result = _export(db, s)
    assert result["status"] == "failed" and "disallowed_columns" in result["error"]
    assert staging.calls["upload"] == [], "검증 실패 시 업로드 0"
    db.expire_all()
    assert db.query(ResearchConsent).one().export_state == "pending", "상태 유지 — 다음 실행에서 재시도"


def test_BT64_문자열_값에_개인정보가_섞이면_업로드_0(db, enabled, staging, monkeypatch):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    consent.gender = GUEST_NAME  # 비정상 값이 gender 로 새는 상황
    db.commit()
    result = _export(db, s)
    assert result["status"] == "failed" and "pii_literal" in result["error"]
    assert staging.calls["upload"] == []


# ── BT65: manifest ──────────────────────────────────────────────────────────────

def test_BT65_manifest_해시_바이트_행수_일치_변조_시_ack_거부(db, enabled, staging, client):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    files = _bundle(staging, result["batch_id"])
    manifest = json.loads(files["manifest.json"])
    assert manifest["batch_id"] == result["batch_id"] and manifest["key_version"] == 1
    assert manifest["schema_version"] == "2.0" and len(manifest["field_list_sha256"]) == 64
    for f in manifest["files"]:
        blob = files[f["name"]]
        assert f["bytes"] == len(blob) and f["sha256"] == hashlib.sha256(blob).hexdigest()
        assert f["rows"] == pq.read_table(io.BytesIO(blob)).num_rows
    batch = db.query(ResearchExportBatch).one()
    assert batch.manifest_sha256 == hashlib.sha256(files["manifest.json"]).hexdigest()

    bad = client.post("/api/v1/research-export/ack", json={"batch_id": result["batch_id"], "sha256": "0" * 64},
                      headers={"X-Research-Export-Token": TOKEN})
    assert bad.status_code == 409
    db.expire_all()
    assert db.query(ResearchConsent).one().export_state == "exported"


# ── BT66: 누적 ──────────────────────────────────────────────────────────────────

def test_BT66_재내보내기는_새_revision_기존_항목_불변_중복_제거(db, enabled, staging, client):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    first = _export(db, s)
    batch_id = first["batch_id"]
    ack = client.post("/api/v1/research-export/ack",
                      json={"batch_id": batch_id, "sha256": db.query(ResearchExportBatch).one().manifest_sha256},
                      headers={"X-Research-Export-Token": TOKEN})
    assert ack.status_code == 200
    item1 = db.query(ResearchExportItem).one()
    h1, rev1 = item1.content_sha256, item1.revision
    assert rev1 == 1

    # 같은 내용으로 다시 큐에 올려도 내용 해시가 같으면 내보내지 않는다(중복 제거)
    c = db.query(ResearchConsent).one()
    c.export_state = "pending"
    db.commit()
    assert _export(db, s)["status"] == "nothing_to_export"

    # 지표가 늘면 새 revision 으로 누적
    db.add(EEGFeatureWindow(session_id=s.id, participant_id=p.id, window_index=9, quality="valid",
                            device_timestamp_ms=float(int(T0.timestamp() * 1000) + 9000), focus_index=9.0))
    db.commit()
    second = _export(db, s)
    assert second["status"] == "uploaded"
    items = db.query(ResearchExportItem).order_by(ResearchExportItem.revision).all()
    assert [i.revision for i in items] == [1, 2]
    db.expire_all()
    first_item = db.query(ResearchExportItem).filter(ResearchExportItem.revision == 1).one()
    assert first_item.content_sha256 == h1, "기존 항목 해시 불변"
    assert first_item.batch_id == uuid.UUID(batch_id)


# ── BT67: 전송 계약(모의 S3) ────────────────────────────────────────────────────────

def test_BT67_스테이징_prefix_아래에만_쓰고_manifest가_마지막(db, enabled, staging):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    keys = staging.calls["upload"]
    assert keys and all(k.startswith(f"research-export/{result['batch_id']}/") for k in keys)
    assert keys[-1].endswith("/manifest.json"), "manifest 가 마지막 — Spark 는 manifest 가 있는 배치만 처리"
    assert not any(k.startswith("eeg-raw/") or k.startswith("video/") for k in keys), "원본 prefix 에 쓰지 않는다"
    assert staging.calls["delete"] == []


# ── BT68: ack API ──────────────────────────────────────────────────────────────

def _ack(client, batch_id, sha, token=TOKEN):
    headers = {"X-Research-Export-Token": token} if token is not None else {}
    return client.post("/api/v1/research-export/ack", json={"batch_id": batch_id, "sha256": sha}, headers=headers)


def test_BT68_ack_서비스_토큰_검증_멱등_상태_전이(db, enabled, staging, client):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    sha = db.query(ResearchExportBatch).one().manifest_sha256

    assert _ack(client, result["batch_id"], sha, token=None).status_code == 401
    assert _ack(client, result["batch_id"], sha, token="wrong-token").status_code == 401
    listed = client.get("/api/v1/research-export/batches", headers={"X-Research-Export-Token": TOKEN})
    assert listed.status_code == 200 and listed.json()["batches"][0]["manifest_sha256"] == sha

    ok = _ack(client, result["batch_id"], sha)
    assert ok.status_code == 200 and ok.json()["status"] == "acked" and ok.json()["already"] is False
    db.expire_all()
    assert db.query(ResearchConsent).one().export_state == "acked"
    again = _ack(client, result["batch_id"], sha)
    assert again.status_code == 200 and again.json()["already"] is True
    assert _ack(client, str(uuid.uuid4()), sha).status_code == 404
    assert _ack(client, result["batch_id"], "f" * 64).status_code == 409


def test_BT68_토큰_미설정이면_ack_API는_503(db, client, monkeypatch):
    monkeypatch.setattr(settings, "research_export_ack_token", "")
    res = _ack(client, str(uuid.uuid4()), "a" * 64, token="anything")
    assert res.status_code == 503


# ── BT69: 종료 후·삭제 전 큐 ────────────────────────────────────────────────────────

def test_BT69_종료_후_큐_등록과_중도_이탈자_포함(db, enabled, staging):
    from app.services import research_export_service as svc

    s, p, consent = _setup(db, state="not_applicable")
    _put_raw(staging, s, p)
    # 중도 이탈(호스트가 제거 = removed_at) 참가자도 데이터가 있으면 내보낸다
    p.removed_at = T0 + timedelta(minutes=3)
    db.commit()
    assert svc.on_session_completed(s.id, db) == 1
    db.expire_all()
    assert db.query(ResearchConsent).one().export_state == "pending"
    result = svc.run_export(db)
    assert result["results"][0]["status"] == "uploaded"
    subjects = pq.read_table(io.BytesIO(_bundle(staging, result["results"][0]["batch_id"])["subjects.parquet"])).to_pylist()
    assert len(subjects) == 1, "중도 이탈자 포함"


def test_BT69_진행중_클래스는_내보내지_않는다(db, enabled, staging):
    s, p, consent = _setup(db, status="in_progress")
    _put_raw(staging, s, p)
    assert _export(db, s)["status"] == "nothing_to_export"
    assert staging.calls["upload"] == []


def test_BT69_종료_API가_큐_등록_훅을_호출한다(client, db, enabled):
    from app.models.research import ResearchConsent as RC
    from tests.test_sdd015_class_code import _create_class, _open_class, _register
    from tests.entry_helpers import enter_guest

    host = _register(client, "b13end@test.com")
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=10, location_type="online")
    _open_class(client, cls, host["h"])
    res = enter_guest(client, cls["access_code"], "종료게스트")
    pid = res.json()["participant_id"]
    db.get(SessionParticipant, uuid.UUID(pid)).user_id = _research_user(db, "종료회원").id
    db.add(RC(session_id=uuid.UUID(cls["id"]), participant_id=uuid.UUID(pid), consented=True,
              research_subject_id="b" * 64, key_version=1, export_state="not_applicable"))
    db.commit()
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"]).status_code == 200
    assert client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"]).status_code == 200
    db.expire_all()
    assert db.query(RC).filter(RC.participant_id == uuid.UUID(pid)).one().export_state == "pending"


# ── BT70: 실패 재시도·알림 ───────────────────────────────────────────────────────

def test_BT70_업로드_실패는_부분_업로드_정리_배치_failed_상태_유지(db, enabled, staging):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    staging.fail_on = "features.parquet"
    result = _export(db, s)
    assert result["status"] == "failed"
    assert staging.store == {}, "부분 업로드 정리"
    db.expire_all()
    assert db.query(ResearchConsent).one().export_state == "pending"
    batch = db.query(ResearchExportBatch).one()
    assert batch.status == "failed" and batch.attempt == 1

    staging.fail_on = None
    retry = _export(db, s)
    assert retry["status"] == "uploaded"
    assert db.query(ResearchExportBatch).filter(ResearchExportBatch.status == "uploaded").count() == 1


def test_BT70_연속_실패가_임계에_닿으면_관리자에게_1회_알림(db, enabled, staging, monkeypatch):
    from app.models.notification import Notification

    monkeypatch.setattr(settings, "research_export_max_attempts", 3)
    admin = User(email=f"adm-{uuid.uuid4().hex[:6]}@test.com", name="관리자", role="platform_admin", password_hash="x")
    db.add(admin)
    db.commit()
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    staging.fail_on = "sessions.parquet"
    for _ in range(5):
        assert _export(db, s)["status"] == "failed"
    assert db.query(Notification).filter(Notification.user_id == admin.id).count() == 1


def test_BT70_raw_객체를_읽지_못하면_일부만_올리지_않고_실패(db, enabled, staging):
    s, p, consent = _setup(db)  # raw 객체 미적재
    result = _export(db, s)
    assert result["status"] == "failed" and "raw_object_unreadable" in result["error"]
    assert staging.calls["upload"] == []


# ── BT71: 철회와 배치 경합 ──────────────────────────────────────────────────────────

def test_BT71_철회되면_대기_중_배치는_취소되고_적재에서_제외(db, enabled, staging, client):
    from app.services import research_export_service as svc

    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    sha = db.query(ResearchExportBatch).one().manifest_sha256
    assert staging.store, "스테이징에 올라가 있음"

    c = db.query(ResearchConsent).one()
    c.withdrawn_at = T0
    c.export_state = "withdrawn"
    db.commit()
    assert svc.cancel_batches_for_withdrawn(db) == 1
    db.expire_all()
    assert db.query(ResearchExportBatch).one().status == "cancelled"
    assert staging.store == {}, "스테이징 객체 삭제"
    assert _ack(client, result["batch_id"], sha).status_code == 409
    assert db.query(ResearchConsent).one().export_state == "withdrawn"
    assert svc.run_export(db)["results"] == []


def test_BT71_ack_직전_철회도_배치를_취소한다(db, enabled, staging, client):
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    result = _export(db, s)
    sha = db.query(ResearchExportBatch).one().manifest_sha256
    c = db.query(ResearchConsent).one()
    c.consented = False
    c.export_state = "not_applicable"
    db.commit()
    assert _ack(client, result["batch_id"], sha).status_code == 409
    db.expire_all()
    assert db.query(ResearchExportBatch).one().status == "cancelled"


def test_BT71_다른_사람이_철회되면_유효한_건은_다음_배치로_다시_큐(db, enabled, staging):
    from app.services import research_export_service as svc

    s, p, c1 = _setup(db)
    _put_raw(staging, s, p)
    p2 = SessionParticipant(session_id=s.id, user_id=_research_user(db, "두번째").id, guest_name="두번째", report_included=True)
    db.add(p2)
    db.flush()
    c2 = ResearchConsent(session_id=s.id, participant_id=p2.id, consented=True, research_subject_id="c" * 64,
                         key_version=1, export_state="pending", gender="male", birth_year_month="1985-01")
    db.add(c2)
    db.add(EEGFeatureWindow(session_id=s.id, participant_id=p2.id, window_index=0, quality="valid",
                            device_timestamp_ms=float(int(T0.timestamp() * 1000)), focus_index=3.0))
    db.commit()
    _export(db, s)
    c2 = db.query(ResearchConsent).filter(ResearchConsent.participant_id == p2.id).one()
    c2.withdrawn_at = T0
    c2.export_state = "withdrawn"
    db.commit()
    svc.cancel_batches_for_withdrawn(db)
    db.expire_all()
    c1 = db.query(ResearchConsent).filter(ResearchConsent.participant_id == p.id).one()
    assert c1.export_state == "pending", "유효한 건은 다음 배치 대상으로 복귀"


# ── 비활성·마이그레이션 ─────────────────────────────────────────────────────────────

def test_기본은_비활성이라_run_export는_아무것도_하지_않는다(db, staging):
    from app.services import research_export_service as svc

    assert settings.research_export_enabled is False
    s, p, consent = _setup(db)
    _put_raw(staging, s, p)
    assert svc.run_export(db) == {"skipped": "research_export_disabled"}
    assert staging.calls["upload"] == []


def test_BT72_마이그레이션_체인과_중복_테이블_없음():
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    base = Path(__file__).resolve().parents[1]
    cfg = Config(str(base / "alembic.ini"))
    cfg.set_main_option("script_location", str(base / "alembic"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert len(heads) == 1, f"alembic head 단일: {heads}"
    b13 = (base / "alembic" / "versions" / "e036a0000050_sdd_209_b13_research_export.py").read_text()
    assert "create_table(\n        \"research_withdrawal_requests\"" not in b13, "철회 요청 테이블은 B11 에서 이미 생성(중복 금지)"
    assert "research_export_batches" in b13 and "research_export_items" in b13

"""SDD-260 S1 — POST /sessions/{id}/features/batch (정본 저장 경로) · verify V-A1·A3·A4·A9·V-S1~S3·S7 (PG + Redis 실제)."""
from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.models.eeg_feature import EEGFeatureWindow
from app.models.live_state import CaptureStream
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import class_participation_service as cps
from app.services import live_ingest_service as li
from tests.sdd246.ingest.test_live_ingest_pg import HASH, MET, _anchor, _env, _start
from tests.sdd246.transport.harness import SECRET, token_for


@pytest.fixture
def started(maker, world):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    now = datetime.now(timezone.utc)
    r = _start(maker, world, now=now)
    assert r.status == "applied"
    _anchor(maker, r.result["stream_id"], at=now, mono_us=0)
    return r


@pytest.fixture
def api(maker, monkeypatch):
    from app.config import settings
    from app.core.database import get_db
    from app.main import app

    monkeypatch.setattr(settings, "jwt_secret_key", SECRET)

    def _db():
        s = maker()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def _auth(uid):
    return {"Authorization": f"Bearer {token_for(uid)}"}


def _url(world, tail="features/batch"):
    return f"/api/v1/sessions/{world.session_id}/{tail}"


def _post(api, world, windows, i=0, **extra):
    uid, pid = world.members[i]
    body = {"participant_id": str(pid), "windows": windows, **extra}
    return api.post(_url(world), json=body, headers=_auth(uid))


def _rows(maker, world, i=0):
    with maker() as s:
        return s.execute(sa.select(EEGFeatureWindow).where(
            EEGFeatureWindow.session_id == world.session_id, EEGFeatureWindow.participant_id == world.members[i][1])
            .order_by(EEGFeatureWindow.window_index)).scalars().all()


# ---------------- V-A1 소켓 없이 저장 ----------------

def test_V_A1_소켓_없이_REST로_60창이_accepted_durable로_저장된다(api, maker, world, started):
    wins = [_env(world, started, n) for n in range(1, 61)]
    r = _post(api, world, wins)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"accepted": 60, "duplicate": 0, "rejected": 0}
    assert [x["status"] for x in body["results"]] == ["accepted"] * 60 and all(x["durable"] for x in body["results"])
    assert [x["sequence"] for x in body["results"]] == [str(n) for n in range(1, 61)]  # 요청과 같은 순서
    rows = _rows(maker, world)
    assert len(rows) == 60
    assert all(r.ingest_path == "rest" and r.device_timestamp_ms == 1760000000000.0 for r in rows)
    assert all(r.late is False for r in rows)
    assert rows[0].play_group_id == started.result["stream_id"] and rows[0].source_feature_alias == HASH


# ---------------- V-A3 저장 판정 4종 ----------------

def test_V_A3_저장_판정은_4종뿐이다(api, maker, world, started):
    other = _start(maker, world, i=1)
    forged = _env(world, started, 1)
    forged["participant_id"] = str(world.members[1][1])           # ① 타 participant 창
    steal = _env(world, other, 2)
    steal["participant_id"] = str(world.members[0][1])            # ② 타인 소유 stream
    ok = _env(world, started, 3)
    wrong_session = _env(world, started, 4)
    wrong_session["session_id"] = str(uuid.uuid4())               # 세션 불일치도 participant_mismatch
    r = _post(api, world, [forged, steal, ok, wrong_session])
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert [(x["status"], x.get("code")) for x in res] == [
        ("rejected", "participant_mismatch"), ("rejected", "stream_not_owned"), ("accepted", None), ("rejected", "participant_mismatch")]
    # ④ 같은 키 다른 hash — 첫 저장 보존
    bad = _env(world, started, 3, h="b" * 64, metrics={"focus_raw": MET(9.9)})
    r = _post(api, world, [bad])
    assert r.json()["results"][0]["code"] == "hash_conflict"
    # ③ 동의 철회 stream
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(started.result["stream_id"]))
        st.cutoff_code, st.cutoff_at, st.status = "consent_withdrawn", datetime.now(timezone.utc), "ended"
        s.commit()
    r = _post(api, world, [_env(world, started, 5)])
    assert r.json()["results"][0] == {"stream_id": started.result["stream_id"], "sequence": "5", "status": "rejected", "code": "consent_withdrawn", "durable": False}
    rows = _rows(maker, world)
    assert [x.window_index for x in rows] == [3] and rows[0].focus_index == 1.5


def test_V_A3_lease_offline_24h_cutoff_후에도_저장된다(api, maker, world, started):
    """lease 만료·종료 cutoff 이후·24h 경과 stream 도 거절하지 않는다(late 표식만)."""
    now = datetime.now(timezone.utc)
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(started.result["stream_id"]))
        st.lease_expires_at = now - timedelta(hours=30)
        st.offline_bound_until = now - timedelta(hours=29)
        st.cutoff_at, st.cutoff_code, st.status = now - timedelta(hours=28), "completed", "ended"
        st.close_deadline_at = now - timedelta(hours=4)
        s.commit()
    r = _post(api, world, [_env(world, started, 700), _env(world, started, 701)])
    assert [x["status"] for x in r.json()["results"]] == ["accepted", "accepted"]


# ---------------- V-A4 지각 저장 ----------------

def test_V_A4_세션_종료_48시간_뒤에도_late로_저장되고_리포트_구간_안에_들어간다(api, maker, world, started):
    ended = datetime.now(timezone.utc) - timedelta(days=3)
    with maker() as s:
        s.get(SessionModel, world.session_id).ended_at = ended
        s.commit()
    obs = int((ended + timedelta(hours=48)).timestamp() * 1000)
    early = int((ended - timedelta(minutes=5)).timestamp() * 1000)
    w_late, w_ok = _env(world, started, 1), _env(world, started, 2)
    w_late["observed_at_ms"], w_ok["observed_at_ms"] = obs, early
    r = _post(api, world, [w_late, w_ok])
    assert [x["status"] for x in r.json()["results"]] == ["accepted", "accepted"]
    rows = _rows(maker, world)
    assert [(x.window_index, x.late) for x in rows] == [(1, True), (2, False)]
    assert rows[0].device_timestamp_ms == float(obs) and rows[1].device_timestamp_ms == float(early)


# ---------------- V-A9 한도·성능·멱등 ----------------

def test_V_A9_300창은_2초_안에_저장되고_301창_0창은_422다(api, maker, world, started):
    wins = [_env(world, started, n) for n in range(1, 301)]
    t0 = time.perf_counter()
    r = _post(api, world, wins)
    dt = time.perf_counter() - t0
    assert r.status_code == 200 and r.json()["counts"]["accepted"] == 300, r.text
    assert dt < 2.0, f"300창 {dt:.2f}s"
    over = _post(api, world, wins + [_env(world, started, 301)])
    assert over.status_code == 422 and over.json()["detail"] == {"code": "invalid_message", "field": "windows"}
    empty = _post(api, world, [])
    assert empty.status_code == 422 and empty.json()["detail"]["code"] == "invalid_message"
    assert len(_rows(maker, world)) == 300


def test_V_A9_같은_300창_20회_동시_요청해도_물리_행은_300이다(maker, world, started):
    pid = world.members[0][1]
    from app.schemas.session_live_ingest import parse_metric_window
    wins = [parse_metric_window(_env(world, started, n)) for n in range(1, 301)]

    def call(_):
        with maker() as s:
            p = s.get(SessionParticipant, pid)
            return li.store_batch(s, p, world.session_id, wins)

    with ThreadPoolExecutor(max_workers=20) as ex:
        outs = list(ex.map(call, range(20)))
    assert len(_rows(maker, world)) == 300
    flat = [x["status"] for o in outs for x in o]
    assert flat.count("accepted") == 300 and flat.count("duplicate") == 20 * 300 - 300 and "rejected" not in flat


def test_V_S1_V_S2_동일_hash_재전송은_duplicate_다른_hash는_첫_저장_보존(api, maker, world, started):
    w = _env(world, started, 1)
    assert _post(api, world, [w]).json()["results"][0]["status"] == "accepted"
    assert _post(api, world, [w]).json()["results"][0] == {"stream_id": started.result["stream_id"], "sequence": "1", "status": "duplicate", "durable": True}
    r = _post(api, world, [_env(world, started, 1, h="c" * 64, metrics={"focus_raw": MET(7.7)})])
    assert r.json()["results"][0]["code"] == "hash_conflict"
    rows = _rows(maker, world)
    assert len(rows) == 1 and rows[0].focus_index == 1.5 and rows[0].source_feature_alias == HASH


# ---------------- V-S7 투영 실패 ≠ 저장 / 투영 없음 ----------------

def test_V_S7_REST_저장은_투영을_호출하지_않는다_투영이_깨져도_저장된다(api, maker, world, started, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("REST 저장은 투영/방송을 호출하지 않는다")

    monkeypatch.setattr(li, "_project_latest", boom)
    r = _post(api, world, [_env(world, started, n) for n in range(1, 6)])
    assert r.status_code == 200 and r.json()["counts"]["accepted"] == 5
    from app.models.live_state import LiveOutbox
    with maker() as s:
        n = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "metrics"))
    assert n == 0


# ---------------- 인증·검증 ----------------

def test_인증_타인_대리_401_403_스키마_위반_422(api, maker, world, started):
    w = _env(world, started, 1)
    assert api.post(_url(world), json={"windows": [w]}).status_code == 401
    uid1 = world.members[1][0]
    r = api.post(_url(world), json={"participant_id": str(world.members[0][1]), "windows": [w]}, headers=_auth(uid1))
    assert r.status_code == 403
    r = api.post(_url(world), json={"windows": [{**w, "extra": 1}]}, headers=_auth(world.members[0][0]))  # 본인 행 확정, participant_id 생략 허용
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_message"
    r = api.post(_url(world), json={"windows": [w]}, headers=_auth(world.members[0][0]))
    assert r.status_code == 200 and r.json()["counts"]["accepted"] == 1
    assert api.post(f"/api/v1/sessions/{uuid.uuid4()}/features/batch", json={"windows": [w]}, headers=_auth(uid1)).status_code in (403, 404)


def test_V_D9_구_v1_features_엔드포인트는_삭제됐다(api, world, started):
    r = api.post(f"/api/v1/sessions/{world.session_id}/features", json={"features": [{"second_offset": 0}]}, headers=_auth(world.members[0][0]))
    assert r.status_code in (404, 405)


# ---------------- V-A2 / S3 소켓은 저장하지 않는다 ----------------

def test_V_A2_소켓_live_metric은_저장하지_않고_방송만_한다(api, maker, world, started):
    from sqlalchemy import func
    from app.models.live_state import LiveOutbox

    wins = [_env(world, started, n) for n in range(1, 61)]
    with maker() as s:
        out = li.ingest_metrics(s, world.member(0), world.session_id, {"protocol_version": 2, "schema_version": 1, "windows": wins})
    acks = out.response["acks"]
    assert len(acks) == 60 and {a["status"] for a in acks} <= {"projected", "ignored"}
    assert all("durable" not in a for a in acks)
    assert acks[-1]["status"] == "projected" and out.projected
    with maker() as s:
        assert s.scalar(sa.select(func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)) == 0
        assert s.scalar(sa.select(func.count()).select_from(LiveOutbox).where(
            LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "metrics")) == 1
    # 그 뒤 같은 60창을 REST 로 보내면 전부 accepted
    r = _post(api, world, wins)
    assert r.json()["counts"] == {"accepted": 60, "duplicate": 0, "rejected": 0}


def test_S3_소켓_검증_거절은_ignored_코드이고_저장이_없다(maker, world, started):
    forged = _env(world, started, 1)
    forged["participant_id"] = str(world.members[1][1])
    stale = _env(world, started, 2, gen="9")
    with maker() as s:
        out = li.ingest_metrics(s, world.member(0), world.session_id, {"protocol_version": 2, "schema_version": 1, "windows": [forged, stale]})
    assert [(a["status"], a["code"]) for a in out.response["acks"]] == [("ignored", "participant_mismatch"), ("ignored", "stale_owner_generation")]
    assert len(_rows(maker, world)) == 0


# ---------------- S7 계측 ----------------

def test_S7_배치_접수가_계측에_집계되고_admin_엔드포인트로_조회된다(api, maker, world, started):
    from app.core import ingest_metrics
    from app.models.user import User

    ingest_metrics.reset()
    bad = _env(world, started, 3)
    bad["participant_id"] = str(world.members[1][1])
    _post(api, world, [_env(world, started, 1), _env(world, started, 2), bad])
    _post(api, world, [_env(world, started, 1)])  # duplicate
    snap = ingest_metrics.snapshot()
    assert snap["batches"] == 2 and snap["windows"] == {"accepted": 2, "rejected": 1, "duplicate": 1}
    assert snap["rejected_codes"] == {"participant_mismatch": 1} and snap["batch_ms"]["count"] == 2 and snap["batch_ms"]["p95"] is not None
    with maker() as s:  # 관리자 계정 생성 후 조회, 일반 참가자는 403
        adm = User(email=f"adm-{uuid.uuid4().hex[:8]}@example.test", password_hash="x", name="a", role="platform_admin")
        s.add(adm)
        s.commit()
        adm_id = adm.id
    r = api.get("/api/v1/admin/ingest-metrics", headers=_auth(adm_id))
    assert r.status_code == 200 and r.json()["windows"]["accepted"] == 2
    assert api.get("/api/v1/admin/ingest-metrics", headers=_auth(world.members[0][0])).status_code == 403


def test_V_S2_같은_키_다른_hash_동시_2건은_한쪽만_저장되고_다른쪽은_hash_conflict(maker, world, started):
    from app.schemas.session_live_ingest import parse_metric_window
    pid = world.members[0][1]
    a = parse_metric_window(_env(world, started, 1, h="a" * 64, metrics={"focus_raw": MET(1.0)}))
    b = parse_metric_window(_env(world, started, 1, h="b" * 64, metrics={"focus_raw": MET(2.0)}))

    def call(w):
        with maker() as s:
            return li.store_batch(s, s.get(SessionParticipant, pid), world.session_id, [w])[0]

    with ThreadPoolExecutor(max_workers=2) as ex:
        ra, rb = list(ex.map(call, [a, b]))
    statuses = sorted([ra["status"], rb["status"]])
    assert statuses == ["accepted", "rejected"], (ra, rb)
    loser = ra if ra["status"] == "rejected" else rb
    assert loser["code"] == "hash_conflict"
    rows = _rows(maker, world)
    assert len(rows) == 1

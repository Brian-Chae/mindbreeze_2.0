"""SDD-261 BE-1 — 회차 업로드 현황 집계 API (V-U01~U37, U39~U41, U55, U60~U62).

서버 수신 기준 집계만 검증한다. 정답은 독립 SQL/파이썬 계산으로 만들고 기존 summary API 는 쓰지 않는다.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.class_program import Class, ClassInstructor
from app.models.eeg_feature import EEGFeatureWindow
from app.models.organization import Organization
from app.models.record import EEGRawChunk
from app.models.session import Session, SessionParticipant
from app.services import upload_status_service as svc
from tests.sdd237_helpers import auth_for, build_class_world, make_user

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch):
    svc.clear_cache()
    monkeypatch.setattr(svc, "CACHE_TTL_SEC", 0.0)
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    yield
    svc.clear_cache()


@pytest.fixture
def world(client, db):
    w = build_class_world(db, members=3, status="in_progress", ended=False)
    return w


def url(w, class_id=None, session_id=None):
    return f"/api/v1/classes/{class_id or w['cls'].id}/sessions/{session_id or w['session'].id}/upload-status"


def add_features(db, session, participant, indexes, *, pg="pg-1", created=NOW):
    for i in indexes:
        db.add(EEGFeatureWindow(
            id=uuid.uuid4(), session_id=session.id, participant_id=participant.id,
            user_id=participant.user_id, play_group_id=pg, window_index=i, quality="valid",
            created_at=created))
    db.commit()


def add_raw(db, session, participant, signal, indexes, *, status="uploaded", stream="s1", segment="seg1",
            created=NOW - timedelta(seconds=30), uploaded=NOW - timedelta(seconds=20)):
    for i in indexes:
        db.add(EEGRawChunk(
            id=uuid.uuid4(), session_id=session.id, participant_id=participant.id, user_id=participant.user_id,
            stream_id=stream, segment_id=segment, signal_type=signal, chunk_index=i,
            object_key=f"k/{uuid.uuid4().hex}", upload_status=status, created_at=created,
            uploaded_at=uploaded if status == "uploaded" else None))
    db.commit()


def get_body(client, w, headers=None, **kw):
    r = client.get(url(w, **kw), headers=headers or w["auth"])
    assert r.status_code == 200, r.text
    return r.json()


def row(body, participant):
    return next(p for p in body["participants"] if p["participant_id"] == str(participant.id))


def sig(p, name):
    return next(s for s in p["raw"]["signals"] if s["signal_type"] == name)


# ── 권한 (V-U01~U21, U60) ─────────────────────────────────────────
def test_V_U09_담당_코치는_200(client, world):
    assert client.get(url(world), headers=world["auth"]).status_code == 200


def test_V_U03_자기_기관_org_admin_200(client, world, db):
    admin = make_user(db, role="org_admin", org=world["org"])
    db.commit()
    assert client.get(url(world), headers=auth_for(admin)).status_code == 200


def test_V_U06_platform_admin_200_타기관도(client, world, db):
    pa = make_user(db, role="platform_admin")
    db.commit()
    assert client.get(url(world), headers=auth_for(pa)).status_code == 200


def test_V_U12_비담당_코치_403_같은기관_lead와_assistant(client, world, db):
    other = make_user(db, org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=other.id, role="lead"))
    asst = make_user(db, org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=asst.id, role="assistant"))
    plain = make_user(db, org=world["org"])  # 클래스 강사도 아님
    db.commit()
    for u in (other, asst, plain):
        r = client.get(url(world), headers=auth_for(u))
        assert r.status_code == 403, r.text
        assert r.json()["detail"] == {"code": "upload_status_forbidden"}


def test_V_U15_타기관_org_admin과_코치는_404(client, world, db):
    other_org = Organization(id=uuid.uuid4(), name="타기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(other_org)
    db.flush()
    admin = make_user(db, role="org_admin", org=other_org)
    coach = make_user(db, org=other_org)
    db.commit()
    for u in (admin, coach):
        r = client.get(url(world), headers=auth_for(u))
        assert r.status_code == 404
        assert r.json()["detail"] == {"code": "upload_status_not_found"}
        assert "participants" not in r.text


def test_V_U18_client_403(client, world):
    from app.core.security import create_access_token

    uid = world["participants"][0].user_id
    h = {"Authorization": f"Bearer {create_access_token(str(uid))}"}
    assert client.get(url(world), headers=h).status_code == 403


def test_미인증_401(client, world):
    assert client.get(url(world)).status_code == 401


def test_V_U20_삭제_정지_사용자_차단(client, world, db):
    host = world["host"]
    host.status = "suspended"
    db.commit()
    assert client.get(url(world), headers=world["auth"]).status_code in (401, 403)
    host.status = "deleted"
    db.commit()
    assert client.get(url(world), headers=world["auth"]).status_code in (401, 403)


def test_V_U20_탈퇴한_기관_멤버십은_404(client, world, db):
    from app.models.user_org_membership import UserOrgMembership

    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == world["host"].id).update({"status": "removed"})
    db.commit()
    assert client.get(url(world), headers=world["auth"]).status_code == 404


def test_V_U21_잘못된_UUID는_422_불일치는_404(client, world, db):
    assert client.get("/api/v1/classes/not-a-uuid/sessions/x/upload-status", headers=world["auth"]).status_code == 422
    assert client.get(url(world, session_id=uuid.uuid4()), headers=world["auth"]).status_code == 404
    assert client.get(url(world, class_id=uuid.uuid4()), headers=world["auth"]).status_code == 404
    # 다른 클래스의 회차
    cls2 = Class(id=uuid.uuid4(), organization_id=world["org"].id, created_by=world["host"].id, title="다른 클래스",
                 status="active", organization_attribution_known=True, default_duration_min=45)
    db.add(cls2)
    db.flush()
    s2 = Session(id=uuid.uuid4(), type="meditation", status="in_progress", host_id=world["host"].id,
                 class_id=cls2.id, seq=1, duration_min=45)
    db.add(s2)
    db.commit()
    r = client.get(url(world, session_id=s2.id), headers=world["auth"])  # world 클래스 + s2 회차
    assert r.status_code == 404 and str(s2.id) not in r.text


def test_V_U60_숨김_회차는_404(client, world, db):
    world["session"].hidden_at = NOW
    db.commit()
    assert client.get(url(world), headers=world["auth"]).status_code == 404


# ── 정확성 (V-U22~U37) ───────────────────────────────────────────
def test_V_U22_feature_건수와_최신시각이_독립_COUNT와_일치(client, world, db):
    p1, p2, p3 = world["participants"]
    add_features(db, world["session"], p1, range(1, 11), created=NOW - timedelta(seconds=5))
    add_features(db, world["session"], p2, range(1, 4), created=NOW - timedelta(seconds=9))
    body = get_body(client, world)
    for p in (p1, p2, p3):
        n, last = db.execute(sa.text(
            "SELECT count(*), max(created_at) FROM eeg_feature_windows WHERE session_id=:s AND participant_id=:p"),
            {"s": str(world["session"].id), "p": str(p.id)}).one()
        r = row(body, p)
        assert r["feature"]["received"] == n
        assert (r["feature"]["last_received_at"] is not None) == (n > 0)
    assert row(body, p1)["feature"]["received"] == 10
    assert row(body, p1)["feature"]["last_received_at"] == "2026-11-04T05:09:55Z"
    assert row(body, p3)["feature"]["received"] == 0 and row(body, p3)["feature"]["last_received_at"] is None


def test_V_U23_raw_3신호_uploaded_pending_failed(client, world, db):
    p1 = world["participants"][0]
    add_raw(db, world["session"], p1, "eeg", range(1, 8), status="uploaded")
    add_raw(db, world["session"], p1, "eeg", range(8, 10), status="pending", uploaded=None)
    add_raw(db, world["session"], p1, "eeg", [10], status="failed")
    add_raw(db, world["session"], p1, "ppg", range(1, 4), status="uploaded")
    body = get_body(client, world)
    r = row(body, p1)
    assert [s["signal_type"] for s in r["raw"]["signals"]] == ["eeg", "ppg", "acc"]
    eeg, ppg, acc = (sig(r, k) for k in ("eeg", "ppg", "acc"))
    assert (eeg["registered"], eeg["uploaded"], eeg["pending"], eeg["failed"]) == (10, 7, 2, 1)
    assert (ppg["registered"], ppg["uploaded"], ppg["pending"], ppg["failed"]) == (3, 3, 0, 0)
    assert (acc["registered"], acc["uploaded"], acc["pending"], acc["failed"]) == (0, 0, 0, 0)
    assert acc["oldest_pending_at"] is None
    assert eeg["oldest_pending_at"] == "2026-11-04T05:09:30Z"


def test_V_U24_다중_stream_내부_결측은_stream별_합산(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1, 2, 4], pg="a")      # 결측 1 (3)
    add_features(db, world["session"], p1, [1, 3], pg="b")         # 결측 1 (2)
    f = row(get_body(client, world), p1)["feature"]
    assert f["received"] == 5 and f["internal_missing"] == 2


def test_V_U25_1부터_시작_연속이면_결측_0(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1, 2, 3])
    f = row(get_body(client, world), p1)["feature"]
    assert f["internal_missing"] == 0 and f["expected"] is None


def test_V_U24_앞뒤_미상은_결측에_포함하지_않는다(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [5, 6, 9])  # 5 앞(0~4), 9 뒤 모두 미상
    assert row(get_body(client, world), p1)["feature"]["internal_missing"] == 2  # 7,8 만


def test_V_U26_legacy_NULL_play_group은_legacy_count만(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1, 2, 10], pg=None)
    f = row(get_body(client, world), p1)["feature"]
    assert f["received"] == 3 and f["legacy_count"] == 3 and f["internal_missing"] == 0


def test_V_U27_같은_창_재전송은_DB_유일제약으로_건수_불변(db, world):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1])
    with pytest.raises(sa.exc.IntegrityError):
        add_features(db, world["session"], p1, [1])
    db.rollback()


def test_V_U28_pending에서_uploaded_전이가_다음_조회에_반영(client, world, db):
    p1 = world["participants"][0]
    add_raw(db, world["session"], p1, "eeg", [1, 2], status="pending", uploaded=None)
    e1 = sig(row(get_body(client, world), p1), "eeg")
    assert (e1["pending"], e1["uploaded"]) == (2, 0)
    db.query(EEGRawChunk).filter(EEGRawChunk.chunk_index == 1).update(
        {"upload_status": "uploaded", "uploaded_at": NOW - timedelta(seconds=1)})
    db.commit()
    e2 = sig(row(get_body(client, world), p1), "eeg")
    assert (e2["pending"], e2["uploaded"]) == (1, 1)


def test_raw_내부_결측은_stream_segment별(client, world, db):
    p1 = world["participants"][0]
    add_raw(db, world["session"], p1, "eeg", [1, 2, 4], stream="s1", segment="g1")
    add_raw(db, world["session"], p1, "eeg", [1, 3], stream="s2", segment="g1")
    add_raw(db, world["session"], p1, "acc", [1, 2, 3], stream="s1", segment="g1")
    r = row(get_body(client, world), p1)
    assert sig(r, "eeg")["internal_missing"] == 2 and sig(r, "acc")["internal_missing"] == 0


def test_V_U29_밴드미연결_0건은_no_data_미착용_확정_없음(client, world):
    body = get_body(client, world)
    for p in body["participants"]:
        assert p["band_connected"] is False
        assert p["status"] == "no_data" and p["reasons"] == []
        assert "worn" not in str(p) and "not_worn" not in str(p)


def test_V_U30_0건_참여자와_게스트_유지_대기열_구분(client, world, db):
    guest = SessionParticipant(id=uuid.uuid4(), session_id=world["session"].id, guest_name="게스트 하나")
    wl = SessionParticipant(id=uuid.uuid4(), session_id=world["session"].id, guest_name="대기자", is_waitlisted=True)
    gone = SessionParticipant(id=uuid.uuid4(), session_id=world["session"].id, guest_name="제거",
                              removed_at=NOW)
    db.add_all([guest, wl, gone])
    db.commit()
    body = get_body(client, world)
    ids = {p["participant_id"] for p in body["participants"]}
    assert str(guest.id) in ids and str(wl.id) in ids and str(gone.id) not in ids
    g = row(body, guest)
    assert g["is_guest"] is True and g["display_name"] == "게스트 하나" and g["participation_status"] == "active"
    w = row(body, wl)
    assert w["participation_status"] == "waitlisted" and w["collection_state"] == "excluded"
    assert w["status"] == "excluded" and w["reasons"] == ["waitlisted"]


def test_V_U31_feature_N_x_raw_M이_곱해지지_않는다(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, range(1, 31))
    add_raw(db, world["session"], p1, "eeg", range(1, 8))
    r = row(get_body(client, world), p1)
    assert r["feature"]["received"] == 30 and sig(r, "eeg")["registered"] == 7 and sig(r, "eeg")["uploaded"] == 7


def test_V_U32_기대수_폰대기량_완결표현_null_고정(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, range(1, 5))
    add_raw(db, world["session"], p1, "eeg", range(1, 11))  # 10/10
    body = get_body(client, world)
    r = row(body, p1)
    assert r["feature"]["expected"] is None and r["feature"]["expected_basis"] == "unknown"
    assert r["feature"]["completeness"] == "unknown" and r["raw"]["completeness"] == "unknown"
    assert r["phone_report"] is None
    assert body["basis"] == "server_received"
    assert r["status"] == "received_unreconciled"  # 10/10 이어도 완료로 승격하지 않는다
    text = str(body).lower()
    for forbidden in ("complete\"", "100%", "score", "good", "bad"):
        assert forbidden not in text.replace("completeness", "")


def test_V_U34_수집제외_동의없음과_수신기록_있는_경우(client, world, db):
    p1, p2, _ = world["participants"]
    p1.eeg_collection_consented = False
    p2.eeg_collection_consented = False
    p2.consent_eeg = True  # 리포트 동의로 대체되지 않음
    db.commit()
    add_features(db, world["session"], p2, [1, 2])
    body = get_body(client, world)
    a, b = row(body, p1), row(body, p2)
    assert a["collection_state"] == "excluded" and a["status"] == "excluded" and a["reasons"] == ["collection_excluded"]
    assert b["collection_state"] == "excluded" and b["status"] == "received_unreconciled"
    assert b["reasons"] == ["collection_excluded_now"] and b["feature"]["received"] == 2


def test_collection_state_eligible_unknown(client, world, db):
    p1, p2, _ = world["participants"]
    p1.eeg_collection_consented = True
    db.commit()
    body = get_body(client, world)
    assert row(body, p1)["collection_state"] == "eligible" and row(body, p2)["collection_state"] == "unknown"


def test_V_U35_상태_우선순위_failed_가_pending_stale_보다_먼저(client, world, db):
    p1 = world["participants"][0]
    add_raw(db, world["session"], p1, "eeg", [1], status="failed")
    add_raw(db, world["session"], p1, "eeg", [2], status="pending", uploaded=None,
            created=NOW - timedelta(seconds=120))
    r = row(get_body(client, world), p1)
    assert r["status"] == "needs_attention"
    assert r["reasons"] == ["raw_failed", "raw_pending_stale"]


def test_pending_60초_미만은_uploading_이상은_needs_attention(client, world, db):
    p1, p2, _ = world["participants"]
    add_raw(db, world["session"], p1, "eeg", [1], status="pending", uploaded=None, created=NOW - timedelta(seconds=59))
    add_raw(db, world["session"], p2, "eeg", [1], status="pending", uploaded=None, created=NOW - timedelta(seconds=60))
    body = get_body(client, world)
    assert row(body, p1)["status"] == "uploading" and row(body, p1)["reasons"] == ["raw_pending"]
    assert row(body, p2)["status"] == "needs_attention" and row(body, p2)["reasons"] == ["raw_pending_stale"]


def test_결측은_needs_attention_사유_순서(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1, 3])
    add_raw(db, world["session"], p1, "ppg", [1, 3])
    r = row(get_body(client, world), p1)
    assert r["status"] == "needs_attention" and r["reasons"] == ["feature_internal_gap", "raw_internal_gap"]


def test_summary_건수_합은_참여자수(client, world, db):
    p1, p2, p3 = world["participants"]
    add_features(db, world["session"], p1, [1, 3])
    add_features(db, world["session"], p2, [1, 2])
    p3.eeg_collection_consented = False
    db.commit()
    s = get_body(client, world)["summary"]
    assert s == {"participants": 3, "needs_attention": 1, "uploading": 0, "received_unreconciled": 1,
                 "no_data": 0, "excluded": 1}
    assert sum(v for k, v in s.items() if k != "participants") == s["participants"]


def test_V_U37_이름_규칙_name_없으면_null(client, world, db):
    from app.models.user import User

    p1 = world["participants"][0]
    db.query(User).filter(User.id == p1.user_id).update({"name": ""})
    db.commit()
    body = get_body(client, world)
    assert row(body, p1)["display_name"] is None
    assert row(body, world["participants"][1])["display_name"] == "회원2"


def test_V_U61_응답에_개인정보_키_없음(client, world, db):
    add_raw(db, world["session"], world["participants"][0], "eeg", [1])
    text = client.get(url(world), headers=world["auth"]).text
    for k in ("email", "phone_number", "birth", "gender", "object_key", "s3", "http", "checksum", "report_email"):
        assert k not in text.lower(), k


# ── 헤더·ETag·304·폴링 주기 (V-U39~U41, U62) ──────────────────────
def test_V_U62_캐시_헤더와_ETag_폴링_헤더(client, world):
    r = client.get(url(world), headers=world["auth"])
    assert r.headers["cache-control"] == "no-store, private"
    assert r.headers["etag"].startswith('W/"') and r.headers["etag"].endswith('"')
    assert r.headers["x-poll-interval"] == "3"
    assert r.json()["poll_interval_sec"] == 3 and r.json()["etag"] == r.headers["etag"]
    assert r.json()["as_of"] == "2026-11-04T05:10:00Z"


def test_V_U39_같은_ETag면_304_본문없음(client, world):
    r1 = client.get(url(world), headers=world["auth"])
    h = {**world["auth"], "If-None-Match": r1.headers["etag"]}
    r2 = client.get(url(world), headers=h)
    assert r2.status_code == 304 and r2.content == b""
    assert r2.headers["etag"] == r1.headers["etag"]
    assert r2.headers["cache-control"] == "no-store, private" and r2.headers["x-poll-interval"] == "3"
    assert client.get(url(world), headers={**world["auth"], "If-None-Match": "*"}).status_code == 304
    assert client.get(url(world), headers={**world["auth"], "If-None-Match": f'W/"zzz", {r1.headers["etag"]}'}
                      ).status_code == 304


def test_304가_권한오류를_가리지_않는다(client, world, db):
    etag = client.get(url(world), headers=world["auth"]).headers["etag"]
    stranger = make_user(db, org=world["org"])
    db.commit()
    r = client.get(url(world), headers={**auth_for(stranger), "If-None-Match": etag})
    assert r.status_code == 403


def test_V_U40_행_추가시_ETag_변경_200(client, world, db):
    p1 = world["participants"][0]
    add_features(db, world["session"], p1, [1])
    r1 = client.get(url(world), headers=world["auth"])
    add_features(db, world["session"], p1, [2])
    r2 = client.get(url(world), headers={**world["auth"], "If-None-Match": r1.headers["etag"]})
    assert r2.status_code == 200 and r2.headers["etag"] != r1.headers["etag"]
    assert row(r2.json(), p1)["feature"]["received"] == 2


def test_ETag_raw_상태전이와_밴드연결_변화에도_바뀐다(client, world, db):
    p1 = world["participants"][0]
    add_raw(db, world["session"], p1, "eeg", [1], status="pending", uploaded=None)
    e1 = client.get(url(world), headers=world["auth"]).headers["etag"]
    db.query(EEGRawChunk).update({"upload_status": "uploaded", "uploaded_at": NOW})
    db.commit()
    e2 = client.get(url(world), headers=world["auth"]).headers["etag"]
    p1.band_connected = True
    db.commit()
    e3 = client.get(url(world), headers=world["auth"]).headers["etag"]
    assert len({e1, e2, e3}) == 3


def test_V_U41_시각만_달라지면_같은_ETag(client, world, monkeypatch):
    e1 = client.get(url(world), headers=world["auth"]).headers["etag"]
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW + timedelta(seconds=5))
    r2 = client.get(url(world), headers=world["auth"])
    assert r2.headers["etag"] == e1 and r2.json()["as_of"] == "2026-11-04T05:10:05Z"


def test_ETag는_pending이_60초_넘어_stale이_되는_순간_바뀐다(client, world, db, monkeypatch):
    add_raw(db, world["session"], world["participants"][0], "eeg", [1], status="pending", uploaded=None,
            created=NOW - timedelta(seconds=10))
    e1 = client.get(url(world), headers=world["auth"]).headers["etag"]
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW + timedelta(seconds=100))
    r2 = client.get(url(world), headers=world["auth"])
    assert r2.headers["etag"] != e1
    assert row(r2.json(), world["participants"][0])["status"] == "needs_attention"


@pytest.mark.parametrize("status,ended_offset,expected", [
    ("in_progress", None, "3"), ("open", None, "5"), ("scheduled", None, "10"), ("cancelled", None, "60"),
    ("completed", -10, "7"),      # 종료 10초 전(30분 이내), 직전 수신 없음 → 완결 전 아님? 아래 케이스에서 분기
])
def test_폴링_주기_세션상태(client, world, db, status, ended_offset, expected):
    s = world["session"]
    s.status = status
    s.ended_at = (NOW + timedelta(seconds=ended_offset)) if ended_offset is not None else None
    db.commit()
    got = client.get(url(world), headers=world["auth"]).headers["x-poll-interval"]
    if status == "completed":
        # 수신 기록 없음 + pending 없음 → 완결로 간주, 60
        assert got == "60"
    else:
        assert got == expected


def test_폴링_주기_종료직후_수신_90초_이내는_7초(client, world, db):
    s = world["session"]
    s.status = "completed"
    s.ended_at = NOW - timedelta(minutes=5)
    db.commit()
    add_features(db, s, world["participants"][0], [1], created=NOW - timedelta(seconds=30))
    assert client.get(url(world), headers=world["auth"]).headers["x-poll-interval"] == "7"


def test_폴링_주기_종료직후_pending이_있으면_7초(client, world, db):
    s = world["session"]
    s.status = "completed"
    s.ended_at = NOW - timedelta(minutes=5)
    db.commit()
    add_raw(db, s, world["participants"][0], "eeg", [1], status="pending", uploaded=None,
            created=NOW - timedelta(minutes=4))
    assert client.get(url(world), headers=world["auth"]).headers["x-poll-interval"] == "7"


def test_폴링_주기_종료_30분_지나면_60초(client, world, db):
    s = world["session"]
    s.status = "completed"
    s.ended_at = NOW - timedelta(minutes=31)
    db.commit()
    add_raw(db, s, world["participants"][0], "eeg", [1], status="pending", uploaded=None,
            created=NOW - timedelta(minutes=30))
    assert client.get(url(world), headers=world["auth"]).headers["x-poll-interval"] == "60"


# ── SQL 횟수·캐시 (V-U55, 서비스 1초 TTL) ─────────────────────────
class _Counter:
    def __init__(self, engine):
        self.engine, self.n = engine, 0

    def __enter__(self):
        sa.event.listen(self.engine, "before_cursor_execute", self._hit)
        return self

    def __exit__(self, *a):
        sa.event.remove(self.engine, "before_cursor_execute", self._hit)

    def _hit(self, *a, **k):
        self.n += 1


def _seed_many(db, w, n_part):
    parts = list(w["participants"])
    for i in range(n_part - len(parts)):
        parts.append(SessionParticipant(id=uuid.uuid4(), session_id=w["session"].id, guest_name=f"게스트{i}"))
        db.add(parts[-1])
    db.commit()
    for p in parts:
        add_features(db, w["session"], p, range(1, 6))
        add_raw(db, w["session"], p, "eeg", range(1, 4))
    return parts


@pytest.mark.parametrize("n_part", [3, 40])
def test_V_U55_SQL_횟수는_인원수와_무관_200은_8이하_304는_2이하(client, world, db, n_part):
    _seed_many(db, world, n_part)
    engine = db.get_bind()
    actor = {"id": str(world["host"].id), "role": "counselor"}
    cid, sid = world["cls"].id, world["session"].id
    with _Counter(engine) as c200:
        res = svc.load_upload_status(db, actor, cid, sid)
    assert res.body is not None and len(res.body.participants) == n_part
    assert c200.n <= 8, c200.n
    with _Counter(engine) as c304:
        res2 = svc.load_upload_status(db, actor, cid, sid, res.etag)
    assert res2.body is None and c304.n <= 2, c304.n
    # HTTP 경로도 인증 사용자 조회 1회를 더한 수 이내
    with _Counter(engine) as chttp:
        assert client.get(url(world), headers={**world["auth"], "If-None-Match": res.etag}).status_code == 304
    assert chttp.n <= 3


def test_1초_TTL_캐시는_같은_회차_반복조회시_계산을_생략(client, world, db, monkeypatch):
    monkeypatch.setattr(svc, "CACHE_TTL_SEC", 1.0)
    _seed_many(db, world, 5)
    monotonic = [100.0]
    monkeypatch.setattr(svc, "_monotonic", lambda: monotonic[0])
    engine = db.get_bind()
    with _Counter(engine) as c1:
        r1 = client.get(url(world), headers=world["auth"])
    with _Counter(engine) as c2:
        r2 = client.get(url(world), headers=world["auth"])
    assert c2.n < c1.n and c2.n <= 2  # 인증 사용자 조회 1 + 권한 확인 1 (집계 쿼리 0)
    assert r1.json() == r2.json() and r1.headers["etag"] == r2.headers["etag"]
    # 캐시 중에도 권한은 먼저 검사한다
    stranger = make_user(db, org=world["org"])
    db.commit()
    assert client.get(url(world), headers=auth_for(stranger)).status_code == 403
    # TTL 경과 후엔 새 데이터
    add_features(db, world["session"], world["participants"][0], [99])
    assert client.get(url(world), headers=world["auth"]).json() == r1.json()
    monotonic[0] += 1.5
    assert row(client.get(url(world), headers=world["auth"]).json(), world["participants"][0])["feature"]["received"] == 6


def test_기존_summary_엔드포인트_라우트가_그대로(client, world):
    r = client.get(f"/api/v1/sessions/{world['session'].id}/features/summary", headers=world["auth"])
    assert r.status_code in (200, 422)  # 라우트 충돌 없음(기존 summary 동작 유지)

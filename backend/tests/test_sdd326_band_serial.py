"""SDD-326 BE — 밴드 시리얼 보고(PUT)·이력·역조회·업로드 현황 가산·소거·마이그레이션."""

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.core.database import get_db
from app.main import app
from app.models.live_state import CaptureStream
from app.models.session import SessionBandDevice, SessionParticipant
from app.schemas.band_device import BandDeviceReportRequest
from app.services import band_device_service as svc
from tests.entry_helpers import guest_body
from tests.sdd237_helpers import auth_for, build_class_world, make_user
from tests.test_sdd024_session_live_ws import _create_group_class, _register

SERIAL = "LXB-0263008A"


def _db():
    return next(app.dependency_overrides[get_db]())


@pytest.fixture
def cls(client):
    counselor = _register(client, "band-host@test.com")
    return {**_create_group_class(client, counselor["h"]), "host_h": counselor["h"]}


def _enter(client, cls, name="게스트1", email=None):
    res = client.post("/api/v1/sessions/enter", json=guest_body(cls["access_code"], name, **({"email": email} if email else {})))
    assert res.status_code == 200, res.text
    return {"pid": res.json()["participant_id"], "cred": res.json()["entry_credential"]}


def _put(client, cls, who, body, **kw):
    return client.put(f"/api/v1/sessions/{cls['id']}/entry/band-device", json=body,
                      headers={"X-Entry-Credential": who["cred"]}, **kw)


def _rows(pid):
    return _db().query(SessionBandDevice).filter(SessionBandDevice.participant_id == pid).order_by(SessionBandDevice.first_seen_at).all()


# ── 계약 스키마 (TS8) ──────────────────────────────────────────────
@pytest.mark.parametrize("bad", ["a@b.com", "LXB 0263", "L" * 65, "한글", "<script>", "ABC", "", "LXB-" + "A" * 70, "LXB-0263008A\n<x>"])
def test_ts8_잘못된_시리얼은_스키마에서_거부(bad):
    with pytest.raises(Exception):
        BandDeviceReportRequest(serial=bad, platform="web")


def test_시리얼_정규화_trim_대문자_표준형_이외_LXB도_허용():
    assert BandDeviceReportRequest(serial=" lxb-0263008a ", platform="web").serial == SERIAL
    assert BandDeviceReportRequest(serial="LXB_x.1:2", platform="ios").serial == "LXB_X.1:2"


def test_플랫폼_enum_and_extra_금지():
    with pytest.raises(Exception):
        BandDeviceReportRequest(serial=SERIAL, platform="desktop")
    with pytest.raises(Exception):
        BandDeviceReportRequest(serial=SERIAL, platform="web", foo=1)


# ── TS1/TS3/TS4: 저장·멱등·교체 ────────────────────────────────────
def test_ts1_게스트_본인_보고시_현재값과_이력_저장(client, cls):
    who = _enter(client, cls)
    res = _put(client, cls, who, {"serial": "lxb-0263008a", "firmware": "1.2.3", "platform": "web"})
    assert res.status_code == 200 and res.json() == {"ok": True}
    p = _db().get(SessionParticipant, uuid.UUID(who["pid"]))
    assert p.linkband_device_id == SERIAL
    (r,) = _rows(p.id)
    assert (r.serial, r.firmware, r.platform) == (SERIAL, "1.2.3", "web")


def test_ts3_재연결_5회_멱등_1행_last_seen만_갱신(client, cls):
    who = _enter(client, cls)
    for _ in range(5):
        assert _put(client, cls, who, {"serial": SERIAL, "platform": "android"}).status_code == 200
    (r,) = _rows(uuid.UUID(who["pid"]))
    assert r.last_seen_at >= r.first_seen_at


def test_펌웨어는_나중에_읽히면_채우고_없으면_기존값_유지(client, cls):
    who = _enter(client, cls)
    _put(client, cls, who, {"serial": SERIAL, "platform": "web"})
    assert _rows(uuid.UUID(who["pid"]))[0].firmware is None
    _put(client, cls, who, {"serial": SERIAL, "firmware": "2.0", "platform": "web"})
    _put(client, cls, who, {"serial": SERIAL, "platform": "web"})
    assert _rows(uuid.UUID(who["pid"]))[0].firmware == "2.0"


def test_ts4_회차중_교체_이력_2행_현재값은_B(client, cls):
    who = _enter(client, cls)
    _put(client, cls, who, {"serial": "LXB-AAAAAAAA", "platform": "ios"})
    _put(client, cls, who, {"serial": "LXB-BBBBBBBB", "platform": "ios"})
    rows = _rows(uuid.UUID(who["pid"]))
    assert {r.serial for r in rows} == {"LXB-AAAAAAAA", "LXB-BBBBBBBB"}
    assert _db().get(SessionParticipant, uuid.UUID(who["pid"])).linkband_device_id == "LXB-BBBBBBBB"
    # A 로 되돌아오면 현재값 A, 행은 늘지 않는다
    _put(client, cls, who, {"serial": "LXB-AAAAAAAA", "platform": "ios"})
    assert len(_rows(uuid.UUID(who["pid"]))) == 2
    assert _db().get(SessionParticipant, uuid.UUID(who["pid"])).linkband_device_id == "LXB-AAAAAAAA"


def test_같은_시리얼_다른_참가자_돌려쓰기_각자_행(client, cls):
    a, b = _enter(client, cls, "가", "a@x.com"), _enter(client, cls, "나", "b@x.com")
    _put(client, cls, a, {"serial": SERIAL, "platform": "web"})
    _put(client, cls, b, {"serial": SERIAL, "platform": "web"})
    assert len(_rows(uuid.UUID(a["pid"]))) == 1 and len(_rows(uuid.UUID(b["pid"]))) == 1


# ── 입력 검증·인증 (TS8) ────────────────────────────────────────────
@pytest.mark.parametrize("bad", ["a@b.com", " ", "L" * 65, "한글", "<script>"])
def test_ts8_API_422_저장없음_원문_에코없음(client, cls, bad):
    who = _enter(client, cls)
    res = _put(client, cls, who, {"serial": bad, "platform": "web"})
    assert res.status_code == 422
    assert bad.strip() == "" or bad not in res.text
    assert _rows(uuid.UUID(who["pid"])) == []


def test_422_응답에_이메일_원문이_다시_나오지_않는다(client, cls):
    who = _enter(client, cls)
    res = _put(client, cls, who, {"serial": "secret@mail.com", "platform": "web"})
    assert res.status_code == 422
    assert "secret@mail.com" not in res.text


def test_자격없으면_401_타인_대리_불가(client, cls):
    res = client.put(f"/api/v1/sessions/{cls['id']}/entry/band-device",
                     json={"serial": SERIAL, "platform": "web"}, headers={"X-Entry-Credential": ""})
    assert res.status_code in (401, 403)
    other = _register(client, "band-other@test.com")
    other_cls = _create_group_class(client, other["h"])
    who = _enter(client, cls)
    # 다른 회차에 내 자격으로 보고 → 거부
    res2 = client.put(f"/api/v1/sessions/{other_cls['id']}/entry/band-device",
                      json={"serial": SERIAL, "platform": "web"}, headers={"X-Entry-Credential": who["cred"]})
    assert res2.status_code in (401, 403, 404)


def test_회차_없으면_404(client, cls):
    who = _enter(client, cls)
    res = client.put(f"/api/v1/sessions/{uuid.uuid4()}/entry/band-device",
                     json={"serial": SERIAL, "platform": "web"}, headers={"X-Entry-Credential": who["cred"]})
    assert res.status_code == 404


def test_로그_마스킹_원문_시리얼이_로그에_없다(client, cls, caplog):
    who = _enter(client, cls)
    with caplog.at_level("INFO"):
        _put(client, cls, who, {"serial": SERIAL, "platform": "web"})
    text = "\n".join(r.getMessage() for r in caplog.records if "band-device" in r.getMessage())
    assert "[band-device]" in text and "008A" in text and SERIAL not in text


def test_mask_serial():
    assert svc.mask_serial(SERIAL) == "LXB…008A"
    assert svc.mask_serial("LXB") == "***" and svc.mask_serial(None) == "-"


# ── TS5: 구 클라이언트 = 호출 없음 ─────────────────────────────────
def test_ts5_보고_없으면_NULL_기존_입장_동작_불변(client, cls):
    who = _enter(client, cls)
    p = _db().get(SessionParticipant, uuid.UUID(who["pid"]))
    assert p.linkband_device_id is None and _rows(p.id) == []


# ── TS6: 업로드 현황 가산 필드 ─────────────────────────────────────
@pytest.fixture
def db(app_client):
    session = _db()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="in_progress", ended=False)


def _status(client, w):
    r = client.get(f"/api/v1/classes/{w['cls'].id}/sessions/{w['session'].id}/upload-status", headers=w["auth"])
    assert r.status_code == 200, r.text
    return r.json()


def _add_dev(db, w, p, serial, fw=None, platform="web", when=None):
    when = when or datetime.now(timezone.utc)
    db.add(SessionBandDevice(id=uuid.uuid4(), session_id=w["session"].id, participant_id=p.id, serial=serial,
                             firmware=fw, platform=platform, first_seen_at=when, last_seen_at=when))


def test_ts6_업로드_현황에_band_serial_firmware_가산_미보고는_None(client, world, db):
    p0, p1, p2 = world["participants"]
    p0 = db.get(SessionParticipant, p0.id)
    p0.linkband_device_id = SERIAL
    _add_dev(db, world, p0, SERIAL, "1.2.3")
    db.commit()
    body = _status(client, world)
    rows = {r["participant_id"]: r for r in body["participants"]}
    assert rows[str(p0.id)]["band_serial"] == SERIAL and rows[str(p0.id)]["band_firmware"] == "1.2.3"
    assert rows[str(p1.id)]["band_serial"] is None and rows[str(p1.id)]["band_firmware"] is None
    # 기존 필드 불변
    for k in ("participant_id", "display_name", "band_connected", "status", "feature", "raw"):
        assert k in rows[str(p0.id)]


def test_ts6_교체_이력이_있어도_행_중복_없이_현재_기기_펌웨어(client, world, db):
    p0 = db.get(SessionParticipant, world["participants"][0].id)
    _add_dev(db, world, p0, "LXB-AAAAAAAA", "1.0")
    _add_dev(db, world, p0, "LXB-BBBBBBBB", "2.0")
    p0.linkband_device_id = "LXB-BBBBBBBB"
    db.commit()
    body = _status(client, world)
    assert len(body["participants"]) == 3
    row = next(r for r in body["participants"] if r["participant_id"] == str(p0.id))
    assert (row["band_serial"], row["band_firmware"]) == ("LXB-BBBBBBBB", "2.0")


def test_ts6_SQL_횟수_증가_없음_인원수_무관(client, world, db):
    from tests.test_upload_status import _Counter, _seed_many
    from app.services import upload_status_service as ussvc

    parts = _seed_many(db, world, 20)
    actor = {"id": str(world["host"].id), "role": "counselor"}

    def count():
        ussvc.clear_cache()
        with _Counter(db.get_bind()) as c:
            res = ussvc.load_upload_status(db, actor, world["cls"].id, world["session"].id)
        assert len(res.body.participants) == 20
        return c.n

    base = count()  # 시리얼 미보고 기준선
    for i, p in enumerate(parts):
        pp = db.get(SessionParticipant, p.id)
        pp.linkband_device_id = f"LXB-{i:08X}"
        _add_dev(db, world, pp, f"LXB-{i:08X}", "1.0")
    db.commit()
    assert count() == base, (count(), base)


# ── TS7: 역조회 권한·범위 ──────────────────────────────────────────
def test_ts7_역조회_코치_기관관리자_플랫폼_범위와_권한(client, world, db):
    p0 = db.get(SessionParticipant, world["participants"][0].id)
    p0.linkband_device_id = SERIAL
    _add_dev(db, world, p0, SERIAL, "1.2.3")
    # 스트림: 3세대 중 2개 superseded
    for g, st in enumerate(("superseded", "superseded", "active"), start=1):
        db.add(CaptureStream(id=uuid.uuid4(), session_id=world["session"].id, participant_id=p0.id,
                             owner_actor_id=uuid.uuid4(), generation=g, status=st,
                             device_profile="linkband2-v1", algorithm_version="a", model_version="m",
                             opened_at=datetime.now(timezone.utc)))
    # 다른 기관의 회차(타 기관 코치 데이터) — 같은 시리얼
    other = build_class_world(db, members=1, status="in_progress", ended=False)
    op = db.get(SessionParticipant, other["participants"][0].id)
    _add_dev(db, other, op, SERIAL)
    outsider_admin = make_user(db, role="org_admin", org=other["org"])
    org_admin = make_user(db, role="org_admin", org=world["org"])
    pa = make_user(db, role="platform_admin")
    db.commit()
    url = f"/api/v1/band-devices/{SERIAL.lower()}/usage"

    r = client.get(url, headers=world["auth"])  # 담당 코치
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["serial"] == SERIAL and len(body["items"]) == 1
    it = body["items"][0]
    assert it["session_id"] == str(world["session"].id) and it["participant_id"] == str(p0.id)
    assert (it["stream_count"], it["superseded_count"], it["is_current"], it["firmware"]) == (3, 2, True, "1.2.3")
    assert it["session_title"] is None or isinstance(it["session_title"], str)

    assert len(client.get(url, headers=auth_for(org_admin)).json()["items"]) == 1      # 자기 기관만
    assert len(client.get(url, headers=auth_for(outsider_admin)).json()["items"]) == 1  # 타 기관은 자기 것만(IDOR 없음)
    assert client.get(url, headers=auth_for(outsider_admin)).json()["items"][0]["session_id"] == str(other["session"].id)
    assert len(client.get(url, headers=auth_for(pa)).json()["items"]) == 2             # 플랫폼은 전체

    member = world["participants"][0]
    from app.models.user import User
    mu = db.get(User, member.user_id)
    assert client.get(url, headers=auth_for(mu)).status_code == 403                    # 회원
    assert client.get(url).status_code == 401                                          # 비로그인


def test_ts7_다른_코치_담당_회차는_안_보인다(client, world, db):
    p0 = db.get(SessionParticipant, world["participants"][0].id)
    _add_dev(db, world, p0, SERIAL)
    other_coach = make_user(db, org=world["org"])
    db.commit()
    r = client.get(f"/api/v1/band-devices/{SERIAL}/usage", headers=auth_for(other_coach))
    assert r.status_code == 200 and r.json()["items"] == []


def test_역조회_잘못된_시리얼_422(client, world):
    r = client.get("/api/v1/band-devices/a@b.com/usage", headers=world["auth"])
    assert r.status_code == 422 and "a@b.com" not in r.text


def test_역조회_교체_후_is_current_false(client, world, db):
    p0 = db.get(SessionParticipant, world["participants"][0].id)
    _add_dev(db, world, p0, "LXB-AAAAAAAA")
    _add_dev(db, world, p0, "LXB-BBBBBBBB")
    p0.linkband_device_id = "LXB-BBBBBBBB"
    db.commit()
    a = client.get("/api/v1/band-devices/LXB-AAAAAAAA/usage", headers=world["auth"]).json()["items"][0]
    b = client.get("/api/v1/band-devices/LXB-BBBBBBBB/usage", headers=world["auth"]).json()["items"][0]
    assert a["is_current"] is False and b["is_current"] is True


# ── TS10: 탈퇴 소거 분류 ───────────────────────────────────────────
def test_ts10_탈퇴_sweep_분류에_이력_테이블이_포함되고_누락_FK_없음():
    from app.services import account_deletion_sweep_service as sweep

    assert "session_band_devices" in sweep.PARTICIPANT_OWNED
    assert "session_band_devices" not in sweep.uncovered_user_references()
    assert sweep.PARTICIPANT_SCRUB["linkband_device_id"] is None


def test_ts10_이력_행은_저장되고_참가자_소유_분류_열이_참가자_FK(client, cls, db):
    from app.services import account_deletion_sweep_service as sweep

    who = _enter(client, cls)
    _put(client, cls, who, {"serial": SERIAL, "platform": "web"})
    assert db.query(SessionBandDevice).count() == 1
    cols, _ = sweep.PARTICIPANT_OWNED["session_band_devices"]
    assert cols == ("participant_id",)


# ── TS11: 마이그레이션 ──────────────────────────────────────────────
def test_ts11_마이그레이션_단일_헤드_체인_포함_오프라인_SQL():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    assert len(script.get_heads()) == 1
    chain = {r.revision: r for r in script.walk_revisions()}
    rev = chain["e326a1band001"]
    assert rev.down_revision == "d305a1rot001"
    src = (root / "alembic/versions/e326a1band001_sdd326_session_band_devices.py").read_text()
    assert "create_table" in src and "uq_session_band_devices_participant_serial" in src and "drop_table" in src


def test_모델_UNIQUE_제약():
    uqs = {c.name for c in SessionBandDevice.__table__.constraints if isinstance(c, sa.UniqueConstraint)}
    assert "uq_session_band_devices_participant_serial" in uqs

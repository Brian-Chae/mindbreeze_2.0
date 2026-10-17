"""SDD-209 B5a — 입장 자격 발급·복귀·초대 회원 편의 경로 (verify BT21~BT24, BT75, AZ1~AZ4·AZ9, RV3-3·9·10 일부).

코드 확인 → 코드+개인정보로 입장 → 클래스/참여자 범위 입장 자격 발급. 로그인·초대 행·이메일 OTP 불요.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from tests.test_sdd015_class_code import _create_class, _open_class, _register

GUEST = {"name": "손님", "gender": "female", "birth_date": "1990-05-01", "email": "Guest@Example.com"}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _open(client, host, **kw):
    cls = _create_class(client, host["h"], **kw)
    _open_class(client, cls, host["h"])
    return cls


def _enter(client, cls, headers=None, **over):
    body = {"code": cls["access_code"], **GUEST, **over}
    return client.post("/api/v1/sessions/enter", json=body, headers=headers or {})


def _participant(pid):
    from app.models.session import SessionParticipant

    db = _db()
    try:
        p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).first()
        return {
            "user_id": p.user_id, "name": p.guest_name, "gender": p.gender, "birth": p.birth_date,
            "email": p.report_email, "consent_eeg": p.consent_eeg, "ver": p.entry_ver,
            "report_included": p.report_included,
        }
    finally:
        db.close()


# ── AZ1 / BT21 / BT75 비회원 입장 ───────────────────────────────────────


def test_AZ1_비회원_코드와_개인정보로_입장_로그인_초대_불요(client):
    host = _register(client, "b5ah1@test.com")
    cls = _open(client, host)

    v = client.post("/api/v1/sessions/enter/verify", json={"code": cls["access_code"]})
    assert v.status_code == 200
    assert set(v.json()) == {"title", "scheduled_at", "host_name"}, "제목·시각·진행자명 외 비노출"

    r = _enter(client, cls)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entry_credential"] and body["participant_id"] and body["is_guest"] is True
    assert body["session"]["id"] == cls["id"]
    p = _participant(body["participant_id"])
    assert p["user_id"] is None and p["name"] == "손님" and p["gender"] == "female"
    assert str(p["birth"]) == "1990-05-01" and p["email"] == "guest@example.com"
    assert p["report_included"] is False, "리포트 반영은 기본 제외"
    # 응답에 참여자 PII 없음
    for part in body["session"]["participants"]:
        assert part["gender"] is None and part["birth_date"] is None


def test_BT75_개인정보_필수_누락_422_OTP_호출_없음(client, monkeypatch):
    from app.services import email_verify_service

    called = []
    for name in ("send_otp", "verify_email_token", "generate_email_verify_token"):
        if hasattr(email_verify_service, name):
            monkeypatch.setattr(email_verify_service, name, lambda *a, **k: called.append(name))
    host = _register(client, "b5ah2@test.com")
    cls = _open(client, host)
    for missing in ("name", "gender", "birth_date", "email"):
        body = {"code": cls["access_code"], **GUEST}
        body.pop(missing)
        assert client.post("/api/v1/sessions/enter", json=body).status_code == 422, missing
    assert client.post("/api/v1/sessions/enter", json={"code": cls["access_code"], **GUEST, "email": "not-an-email"}
                       ).status_code == 422
    assert called == []


def test_사전_입장_ready_클래스도_코드로_입장_가능_대기실_진입(client):
    host = _register(client, "b5ah3@test.com")
    cls = _create_class(client, host["h"])  # ready (오픈 전)
    r = _enter(client, cls)
    assert r.status_code == 200 and r.json()["session"]["status"] == "ready"


def test_정원_초과는_대기열로_입장(client):
    host = _register(client, "b5ah4@test.com")
    cls = _open(client, host, participant_mode="group", max_participants=1)
    first = _enter(client, cls, name="첫째").json()
    second = _enter(client, cls, name="둘째").json()
    assert first["is_waitlisted"] is False and second["is_waitlisted"] is True


# ── AZ2 로그인 회원 ─────────────────────────────────────────────────────


def test_AZ2_로그인_회원은_계정값으로_입장_user_id_연결(client):
    from app.models.client_profile import ClientProfile

    host = _register(client, "b5ah5@test.com")
    member = _register(client, "b5am5@test.com", role="client")
    db = _db()
    try:
        db.add(ClientProfile(user_id=uuid.UUID(member["id"]), gender="male", birth_date=datetime(1988, 3, 4).date()))
        db.commit()
    finally:
        db.close()
    cls = _open(client, host)
    r = client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=member["h"])
    assert r.status_code == 200, r.text
    p = _participant(r.json()["participant_id"])
    assert str(p["user_id"]) == member["id"] and p["gender"] == "male" and str(p["birth"]) == "1988-03-04"
    assert r.json()["is_guest"] is False and r.json()["entry_credential"]
    # 같은 회원이 다시 입장하면 같은 참여자(멱등)
    r2 = client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=member["h"])
    assert r2.json()["participant_id"] == r.json()["participant_id"]


def test_호스트가_자기_클래스_코드로_입장하면_참여자_미생성(client):
    host = _register(client, "b5ah6@test.com")
    cls = _open(client, host)
    r = client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=host["h"])
    assert r.status_code == 200 and r.json()["participant_id"] is None and r.json()["entry_credential"] is None


# ── AZ3 / BT22 초대 회원 편의 경로 ──────────────────────────────────────


def test_AZ3_초대된_회원_편의_입장_초대_없으면_403_코드_안내(client):
    host = _register(client, "b5ah7@test.com")
    invited = _register(client, "b5ai7@test.com", role="client")
    stranger = _register(client, "b5as7@test.com", role="client")
    cls = _open(client, host)
    assert client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": invited["id"]},
                       headers=host["h"]).status_code == 200

    ok = client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=invited["h"])
    assert ok.status_code == 200, ok.text
    assert ok.json()["entry_credential"] and ok.json()["participant_id"]
    assert _participant(ok.json()["participant_id"])["user_id"] is not None

    no = client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=stranger["h"])
    assert no.status_code == 403 and "코드" in no.json()["detail"]
    assert client.post(f"/api/v1/sessions/{cls['id']}/enter").status_code == 401
    # 호스트는 불가
    assert client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=host["h"]).status_code == 403
    # 편의 경로가 없어도 코드로는 입장 가능(입장 조건 아님)
    assert client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=stranger["h"]).status_code == 200


def test_AZ15_종료_취소_클래스_편의_입장_409_코드_입장_404(client):
    host = _register(client, "b5ah8@test.com")
    invited = _register(client, "b5ai8@test.com", role="client")
    cls = _open(client, host)
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": invited["id"]}, headers=host["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"])
    assert client.post(f"/api/v1/sessions/{cls['id']}/enter", headers=invited["h"]).status_code == 409
    assert _enter(client, cls).status_code == 404


# ── AZ4 / BT16 동일 응답 + 제한 ─────────────────────────────────────────


def test_AZ4_틀린_코드_verify_enter_모두_동일_404(client):
    host = _register(client, "b5ah9@test.com")
    cls = _open(client, host)
    wrong = "0000" if cls["access_code"] != "0000" else "0001"
    a = client.post("/api/v1/sessions/enter/verify", json={"code": wrong})
    b = client.post("/api/v1/sessions/enter/verify", json={"code": "abc"})
    c = client.post("/api/v1/sessions/enter", json={"code": wrong, **GUEST})
    assert (a.status_code, b.status_code, c.status_code) == (404, 404, 404)
    assert a.text == b.text == c.text


def test_BT17_실패_누적_후_올바른_코드도_429_다른_IP_영향없음(client, redis):
    from app.services import class_code_attempt_service as svc

    host = _register(client, "b5ah10@test.com")
    cls = _open(client, host)
    wrong = "0000" if cls["access_code"] != "0000" else "0001"
    for _ in range(svc.IP_MAX_FAILURES):
        assert client.post("/api/v1/sessions/enter/verify", json={"code": wrong}).status_code == 404
    assert client.post("/api/v1/sessions/enter/verify", json={"code": cls["access_code"]}).status_code == 429
    assert _enter(client, cls).status_code == 429
    # 성공 요청을 끼워도 카운터는 풀리지 않는다(위 429 가 증명) — 잠금 해제 후 정상
    import asyncio

    asyncio.new_event_loop().run_until_complete(redis.delete(svc._ip_lock_key("testclient")))
    assert client.post("/api/v1/sessions/enter/verify", json={"code": cls["access_code"]}).status_code == 200


# ── BT23 자격 속성 ──────────────────────────────────────────────────────


def test_BT23_자격은_클래스_참여자_범위_서명위조_변조_거부(client):
    from app.config import settings
    from app.services import entry_credential_service as ec

    host = _register(client, "b5ah11@test.com")
    cls = _open(client, host)
    cls2 = _open(client, host)
    j = _enter(client, cls).json()
    token, pid = j["entry_credential"], j["participant_id"]

    claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert claims["type"] == "class_entry" and claims["sub"] == pid and claims["sid"] == cls["id"]

    db = _db()
    try:
        assert str(ec.resolve_participant(db, token, cls["id"]).id) == pid
        with pytest.raises(Exception) as other:
            ec.resolve_participant(db, token, cls2["id"])  # 타 클래스
        assert other.value.status_code == 403
        # 변조(서명 훼손) / 다른 키로 위조 / 다른 type
        for bad in (
            token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb"),
            jwt.encode({**claims, "exp": claims["exp"]}, "wrong-key", algorithm="HS256"),
            jwt.encode({**claims, "type": "access"}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm),
            jwt.encode({**claims, "type": "report_participant"}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm),
            "",
        ):
            with pytest.raises(Exception) as exc:
                ec.resolve_participant(db, bad, cls["id"])
            assert exc.value.status_code == 401
    finally:
        db.close()


def test_AZ9_만료_폐기된_자격은_401_재입장은_신규_자격(client):
    from app.config import settings
    from app.services import entry_credential_service as ec

    host = _register(client, "b5ah12@test.com")
    cls = _open(client, host)
    j = _enter(client, cls).json()
    token, pid = j["entry_credential"], j["participant_id"]
    claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

    expired = jwt.encode({**claims, "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
                         settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    db = _db()
    try:
        with pytest.raises(Exception) as exc:
            ec.resolve_participant(db, expired, cls["id"])
        assert exc.value.status_code == 401
    finally:
        db.close()

    # 폐기(로그아웃)
    assert client.post("/api/v1/sessions/entry/revoke", headers={"X-Entry-Credential": token}).status_code == 204
    assert _participant(pid)["ver"] == 1
    db = _db()
    try:
        with pytest.raises(Exception) as exc:
            ec.resolve_participant(db, token, cls["id"])
        assert exc.value.status_code == 401
    finally:
        db.close()
    assert client.post("/api/v1/sessions/entry/revoke", headers={"X-Entry-Credential": token}).status_code == 401

    # 재입장(자격 없이) → 새 참여자 + 새 자격
    j2 = _enter(client, cls).json()
    assert j2["participant_id"] != pid and j2["entry_credential"]


def test_제거된_참여자의_자격은_무효(client):
    from app.services import entry_credential_service as ec

    host = _register(client, "b5ah13@test.com")
    member = _register(client, "b5am13@test.com", role="client")
    cls = _open(client, host)
    j = client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=member["h"]).json()
    assert client.delete(f"/api/v1/sessions/{cls['id']}/participants/{member['id']}", headers=host["h"]).status_code == 200
    db = _db()
    try:
        with pytest.raises(Exception) as exc:
            ec.resolve_participant(db, j["entry_credential"], cls["id"])
        assert exc.value.status_code == 401
    finally:
        db.close()


# ── BT24 복귀 ───────────────────────────────────────────────────────────


def test_BT24_자격으로_본인_복귀_이름_일치만으로_인계_없음(client):
    host = _register(client, "b5ah14@test.com")
    cls = _open(client, host, participant_mode="group", max_participants=10)
    first = _enter(client, cls).json()

    # 같은 이름·정보로 새 브라우저(자격 없음) → 기존 참여자를 인계받지 않는다
    other_browser = _enter(client, cls).json()
    assert other_browser["participant_id"] != first["participant_id"]

    # 자격(헤더/바디)으로 복귀 → 같은 참여자, 갱신 입력 반영
    via_header = _enter(client, cls, headers={"X-Entry-Credential": first["entry_credential"]}, name="손님2").json()
    assert via_header["participant_id"] == first["participant_id"]
    assert _participant(first["participant_id"])["name"] == "손님2"
    via_body = _enter(client, cls, entry_credential=first["entry_credential"]).json()
    assert via_body["participant_id"] == first["participant_id"]
    assert via_body["entry_credential"]

    # 다른 클래스에서 받은 자격은 무시되고 새 참여자
    cls2 = _open(client, host, participant_mode="group", max_participants=10)
    cross = _enter(client, cls2, entry_credential=first["entry_credential"]).json()
    assert cross["participant_id"] != first["participant_id"]


def test_코드는_인증수단이_아니다_자격없는_상태조회_거부(client):
    # B5b 에서 by-code state 가 제거되기 전이라도 신규 경로는 자격 없이 아무것도 돌려주지 않는다.
    host = _register(client, "b5ah15@test.com")
    cls = _open(client, host)
    assert client.post("/api/v1/sessions/entry/revoke").status_code == 401
    assert client.post("/api/v1/sessions/entry/revoke", headers={"X-Entry-Credential": cls["access_code"]}).status_code == 401

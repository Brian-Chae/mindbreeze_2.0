"""SDD-209 B11 — 연구 동의 모델·API (BE-R1 · MG-5) (verify BT50~BT55, RV8-2·4·8~10, AZ18·AZ19, LG13, ST26·ST27).

- 연구 동의는 입장·업로드·리포트 생성의 게이트가 아니다(기본 미동의).
- 가명 ID = HMAC-SHA256(키, NFC(trim(이름)) + "|" + 생년월일). 키는 .env 전용(값 비출력). 이름 원문·생년월일 일(日)은 저장하지 않는다(N-4: 연·월만).
- 동의 이력은 불변(append-only). 철회는 플랫폼 관리자 경로만(사유 필수).
"""

import hashlib
import hmac
import logging
import unicodedata
import uuid

import pytest

from tests.entry_helpers import enter_guest, enter_member
from tests.test_sdd015_class_code import _create_class, _open_class, _promote, _register

KEY = "unit-test-research-key-v1-0123456789abcdef"  # 테스트 전용 더미 키


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


@pytest.fixture(autouse=True)
def research_key(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "research_id_key_v1", KEY, raising=False)
    monkeypatch.setattr(settings, "research_id_key_version", 1, raising=False)


def _expected_id(name: str, birth: str, key: str = KEY) -> str:
    norm = " ".join(unicodedata.normalize("NFC", name).split())
    return hmac.new(key.encode(), f"{norm}|{birth}".encode(), hashlib.sha256).hexdigest()


def _group(client, host, cap=10):
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=cap)
    _open_class(client, cls, host["h"])
    return cls


def _guest(client, cls, name="김연구", birth="1990-05-17", **kw):
    r = enter_guest(client, cls["access_code"], name, birth_date=birth, **kw)
    assert r.status_code == 200, r.text
    result = r.json()
    # 기존 연구 도메인 검증의 이름·생일 입력은 보존하되 회원 동의 주체로 구성한다.
    from app.models.user import User
    from app.models.session import SessionParticipant
    db = _db()
    try:
        user = User(email=f"subject-{uuid.uuid4().hex}@test.com", name=name, role="client", password_hash="x")
        db.add(user)
        db.flush()
        db.get(SessionParticipant, uuid.UUID(result['participant_id'])).user_id = user.id
        db.commit()
    finally:
        db.close()
    return result


def _cred(j):
    return {"X-Entry-Credential": j["entry_credential"]}


def _put(client, cls, headers, consented=True, **extra):
    return client.put(
        f"/api/v1/sessions/{cls['id']}/research-consent",
        json={"consented": consented, **extra},
        headers=headers,
    )


def _consent_row(participant_id):
    from app.models.research import ResearchConsent

    db = _db()
    try:
        r = db.query(ResearchConsent).filter(ResearchConsent.participant_id == uuid.UUID(participant_id)).first()
        return None if r is None else {c.name: getattr(r, c.name) for c in ResearchConsent.__table__.columns}
    finally:
        db.close()


def _events(participant_id):
    from app.models.research import ResearchConsentEvent

    db = _db()
    try:
        rows = (
            db.query(ResearchConsentEvent)
            .filter(ResearchConsentEvent.participant_id == uuid.UUID(participant_id))
            .order_by(ResearchConsentEvent.created_at, ResearchConsentEvent.id)
            .all()
        )
        return [{c.name: getattr(r, c.name) for c in ResearchConsentEvent.__table__.columns} for r in rows]
    finally:
        db.close()


def _admin(client, email="b11admin@test.com"):
    a = _register(client, email)
    _promote(a["id"], "platform_admin")
    return a


# ── BT50: 본인만·종료 409·멱등·기본 미동의 ─────────────────────────────


def test_BT50_기본은_미동의_기록_없음_조회는_본인만(client):
    host = _register(client, "b11h1@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    assert _consent_row(me["participant_id"]) is None
    got = client.get(f"/api/v1/sessions/{cls['id']}/research-consent", headers=_cred(me))
    assert got.status_code == 200 and got.json()["consented"] is False
    assert client.get(f"/api/v1/sessions/{cls['id']}/research-consent").status_code == 401


def test_BT50_동의_저장_멱등_변경_이력(client):
    host = _register(client, "b11h2@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    r = _put(client, cls, _cred(me), True, notice_version="r5-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["consented"] is True and body["changed"] is True and body["notice_version"] == "r5-1"
    assert body["export_state"] == "pending"
    assert set(body) >= {"participant_id", "consented", "changed", "notice_version", "export_state"}

    again = _put(client, cls, _cred(me), True).json()
    assert again["changed"] is False
    assert len(_events(me["participant_id"])) == 1, "멱등 재요청은 이력을 늘리지 않는다"

    off = _put(client, cls, _cred(me), False).json()
    assert off["consented"] is False and off["changed"] is True and off["export_state"] == "not_applicable"
    ev = _events(me["participant_id"])
    # (SQLite 은 created_at 초 단위라 순서 대신 집합으로 확인)
    assert sorted((e["previous_consented"], e["new_consented"], e["actor_kind"], e["event_type"]) for e in ev) == [
        (False, True, "self", "consented"),
        (True, False, "self", "declined"),
    ]


def test_BT50_거부_첫_요청은_기록을_만들지_않는다(client):
    host = _register(client, "b11h3@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    r = _put(client, cls, _cred(me), False)
    assert r.status_code == 200 and r.json()["changed"] is False
    assert _consent_row(me["participant_id"]) is None and _events(me["participant_id"]) == []


def test_BT50_타인_자격_무자격_종료_클래스(client):
    host = _register(client, "b11h4@test.com")
    cls = _group(client, host)
    a = _guest(client, cls, "에이")
    b = _guest(client, cls, "비이", email="b@example.com")
    assert _put(client, cls, {"X-Entry-Credential": ""}).status_code == 401
    # 타인의 participant_id 를 지정하면 403, 본인 자격이면 본인 행에만 작용
    r = _put(client, cls, _cred(a), True, participant_id=b["participant_id"])
    assert r.status_code == 403
    assert _put(client, cls, _cred(a), True).status_code == 200
    assert _consent_row(a["participant_id"]) is not None and _consent_row(b["participant_id"]) is None
    # 호스트는 대신 동의할 수 없다(참여자 행이 없어 403)
    assert _put(client, cls, host["h"], True).status_code == 403
    # 종료 클래스 409 (변경은 관리자 철회 경로만)
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"])
    assert _put(client, cls, _cred(a), False).status_code == 409


def test_BT50_로그인_회원도_계정_이름과_프로필_생년월일로_동의(client):
    from datetime import date

    from app.models.client_profile import ClientProfile

    host = _register(client, "b11h5@test.com")
    m = _register(client, "b11m5@test.com", role="client")
    db = _db()
    try:
        db.add(ClientProfile(user_id=uuid.UUID(m["id"]), gender="male", birth_date=date(1988, 3, 4)))
        db.commit()
        from app.models.user import User

        name = db.query(User).filter(User.id == uuid.UUID(m["id"])).first().name
    finally:
        db.close()
    cls = _group(client, host)
    pid = enter_member(client, cls["access_code"], m["h"]).json()["participant_id"]
    assert _put(client, cls, m["h"], True).status_code == 200
    row = _consent_row(pid)
    assert row["research_subject_id"] == _expected_id(name, "1988-03-04")
    assert row["birth_year_month"] == "1988-03" and row["gender"] == "male"


def test_BT50_연구_동의는_입장_업로드_리포트_게이트가_아니다(client):
    host = _register(client, "b11h6@test.com")
    cls = _group(client, host)
    no = _guest(client, cls, "미응답")
    yes = _guest(client, cls, "동의", email="y@example.com")
    _put(client, cls, _cred(yes), True)
    declined = _guest(client, cls, "거부", email="n@example.com")
    _put(client, cls, _cred(declined), True)
    _put(client, cls, _cred(declined), False)
    url = f"/api/v1/sessions/{cls['id']}/features"
    batch = [{"second_offset": 0, "relaxation_index": 0.5}]
    for who in (no, yes, declined):
        assert client.post(url, json={"features": batch}, headers=_cred(who)).status_code == 200
        assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(who)).status_code == 200


# ── BT51: 이력 불변·분리 저장 ───────────────────────────────────────────


def test_BT51_동의_이력은_불변_수정_삭제_차단(client):
    from app.models.research import ResearchConsentEvent

    host = _register(client, "b11h7@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    _put(client, cls, _cred(me), True)
    db = _db()
    try:
        ev = db.query(ResearchConsentEvent).first()
        ev.new_consented = False
        with pytest.raises(Exception):
            db.commit()
        db.rollback()
        ev = db.query(ResearchConsentEvent).first()
        db.delete(ev)
        with pytest.raises(Exception):
            db.commit()
        db.rollback()
    finally:
        db.close()
    assert len(_events(me["participant_id"])) == 1


def test_BT51_리포트_선택_고지_증빙과_저장소가_다르다(client):
    from app.models.research import ResearchConsent
    from app.models.session import ReportChoiceEvent, SessionParticipant

    assert ResearchConsent.__tablename__ not in (SessionParticipant.__tablename__, ReportChoiceEvent.__tablename__)
    host = _register(client, "b11h8@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    client.put(
        f"/api/v1/sessions/{cls['id']}/report-choice",
        json={"participant_id": me["participant_id"], "report_included": True, "notice_acknowledged": True, "notice_version": "r5-1"},
        headers=_cred(me),
    )
    _put(client, cls, _cred(me), True)
    # 한쪽 변경이 다른 쪽 값을 바꾸지 않는다
    _put(client, cls, _cred(me), False)
    assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(me)).json()["report_included"] is True
    assert {c.name for c in ResearchConsent.__table__.columns}.isdisjoint({"report_included", "report_notice_ack_at"})


# ── BT52: 가명 ID ───────────────────────────────────────────────────────


def test_BT52_같은_이름_생년월일은_세션이_달라도_같은_ID_다르면_다른_ID(client):
    host = _register(client, "b11h9@test.com")
    c1, c2 = _group(client, host), _group(client, host)
    a1 = _guest(client, c1, "홍길동", "1990-05-17")
    a2 = _guest(client, c2, "홍길동", "1990-05-17", email="other@example.com")
    b = _guest(client, c1, "홍길동", "1990-05-18", email="b@example.com")
    c = _guest(client, c1, "홍길순", "1990-05-17", email="c@example.com")
    for cls, who in ((c1, a1), (c2, a2), (c1, b), (c1, c)):
        assert _put(client, cls, _cred(who), True).status_code == 200
    ids = [_consent_row(x["participant_id"])["research_subject_id"] for x in (a1, a2, b, c)]
    assert ids[0] == ids[1] == _expected_id("홍길동", "1990-05-17")
    assert len({ids[0], ids[2], ids[3]}) == 3
    assert all(len(i) == 64 for i in ids)


def test_BT52_공백_유니코드_정규화(client):
    host = _register(client, "b11h10@test.com")
    c1 = _group(client, host)
    nfd = unicodedata.normalize("NFD", "한글 이름")
    a = _guest(client, c1, "  한글   이름 ", "1991-01-02")
    b = _guest(client, c1, nfd, "1991-01-02", email="b@example.com")
    _put(client, c1, _cred(a), True)
    _put(client, c1, _cred(b), True)
    assert (
        _consent_row(a["participant_id"])["research_subject_id"]
        == _consent_row(b["participant_id"])["research_subject_id"]
        == _expected_id("한글 이름", "1991-01-02")
    )


def test_BT52_key_version_기록_이름_원문_일_값은_저장하지_않는다(client):
    host = _register(client, "b11h11@test.com")
    cls = _group(client, host)
    me = _guest(client, cls, "비밀이름", "1992-07-23")
    _put(client, cls, _cred(me), True)
    row = _consent_row(me["participant_id"])
    assert row["key_version"] == 1 and row["birth_year_month"] == "1992-07"
    blob = " ".join(str(v) for v in row.values()) + " " + " ".join(str(v) for e in _events(me["participant_id"]) for v in e.values())
    assert "비밀이름" not in blob and "1992-07-23" not in blob
    assert len(row["birth_year_month"]) == 7, "연-월만 보관(일 없음)"


# ── BT53: 키 취급 ───────────────────────────────────────────────────────


def test_BT53_키_미설정이면_동의는_저장되고_내보내기만_보류_명시_사유(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "research_id_key_v1", "", raising=False)
    host = _register(client, "b11h12@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    r = _put(client, cls, _cred(me), True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["consented"] is True
    assert body["export_state"] == "blocked_key_missing" and body["export_block_reason"] == "research_key_not_configured"
    row = _consent_row(me["participant_id"])
    assert row["consented"] is True and row["research_subject_id"] is None


def test_BT53_키_값은_로그_응답_DB_이벤트에_나오지_않는다(client, caplog):
    caplog.set_level(logging.DEBUG)
    host = _register(client, "b11h13@test.com")
    cls = _group(client, host)
    me = _guest(client, cls, "로그검사", "1993-08-09")
    r = _put(client, cls, _cred(me), True)
    admin = _admin(client, "b11admin13@test.com")
    w = client.post(
        "/api/v1/admin/research-consents/withdraw",
        json={"name": "로그검사", "birth_date": "1993-08-09", "reason": "본인 요청"},
        headers=admin["h"],
    )
    assert w.status_code == 200, w.text
    haystack = r.text + w.text + caplog.text + str(_consent_row(me["participant_id"])) + str(_events(me["participant_id"]))
    assert KEY not in haystack
    for secret in ("로그검사", "1993-08-09", "08-09"):
        assert secret not in caplog.text and secret not in r.text and secret not in w.text, secret


# ── BT54: 관리자 철회 ───────────────────────────────────────────────────


def test_BT54_철회는_플랫폼_관리자만_사유_필수(client):
    host = _register(client, "b11h14@test.com")
    org_admin = _register(client, "b11oa@test.com")
    payload = {"name": "누구", "birth_date": "1990-01-01", "reason": "철회 요청"}
    url = "/api/v1/admin/research-consents/withdraw"
    assert client.post(url, json=payload).status_code == 401
    assert client.post(url, json=payload, headers=host["h"]).status_code == 403  # 상담사
    _promote(org_admin["id"], "org_admin")
    assert client.post(url, json=payload, headers=org_admin["h"]).status_code == 403
    admin = _admin(client, "b11admin14@test.com")
    assert client.post(url, json={**payload, "reason": ""}, headers=admin["h"]).status_code == 422
    assert client.post(url, json={k: v for k, v in payload.items() if k != "reason"}, headers=admin["h"]).status_code == 422


def test_BT54_철회는_재계산_대조로_동의_건을_철회하고_PII_스크럽_후에도_동작(client):
    from app.models.research import ResearchWithdrawalRequest
    from app.models.session import SessionParticipant

    host = _register(client, "b11h15@test.com")
    c1, c2 = _group(client, host), _group(client, host)
    a1 = _guest(client, c1, "철회자", "1985-12-31")
    a2 = _guest(client, c2, "철회자", "1985-12-31")
    other = _guest(client, c1, "다른사람", "1985-12-31", email="o@example.com")
    for cls, who in ((c1, a1), (c2, a2), (c1, other)):
        _put(client, cls, _cred(who), True)

    # 기본 DB 개인정보 스크럽을 흉내: 비회원 이름·생년월일 값 비움
    db = _db()
    try:
        for pid in (a1["participant_id"], a2["participant_id"]):
            p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).first()
            p.guest_name, p.birth_date, p.report_email = None, None, None
        db.commit()
    finally:
        db.close()

    admin = _admin(client, "b11admin15@test.com")
    w = client.post(
        "/api/v1/admin/research-consents/withdraw",
        json={"name": "철회자", "birth_date": "1985-12-31", "reason": "본인 요청 접수"},
        headers=admin["h"],
    )
    assert w.status_code == 200, w.text
    assert w.json()["withdrawn_count"] == 2
    for x in (a1, a2):
        row = _consent_row(x["participant_id"])
        assert row["consented"] is False and row["withdrawn_at"] is not None and row["export_state"] == "withdrawn"
        last = next(e for e in _events(x["participant_id"]) if e["event_type"] == "withdrawn")
        assert last["actor_kind"] == "platform_admin" and last["reason"] == "본인 요청 접수"
        assert str(last["actor_user_id"]) == admin["id"]
    assert _consent_row(other["participant_id"])["consented"] is True, "다른 사람은 불변"

    db = _db()
    try:
        reqs = db.query(ResearchWithdrawalRequest).all()
        assert len(reqs) == 1
        assert reqs[0].research_subject_id == _expected_id("철회자", "1985-12-31")
        assert reqs[0].requested_by == uuid.UUID(admin["id"]) and reqs[0].spark_confirmed_at is None
        assert reqs[0].affected_count == 2 and reqs[0].reason == "본인 요청 접수"
    finally:
        db.close()


def test_BT54_철회된_사람의_새_동의는_적재_대상이_아니다(client):
    host = _register(client, "b11h16@test.com")
    c1, c2 = _group(client, host), _group(client, host)
    a1 = _guest(client, c1, "재참여", "1980-02-03")
    _put(client, c1, _cred(a1), True)
    admin = _admin(client, "b11admin16@test.com")
    client.post(
        "/api/v1/admin/research-consents/withdraw",
        json={"name": "재참여", "birth_date": "1980-02-03", "reason": "철회"},
        headers=admin["h"],
    )
    a2 = _guest(client, c2, "재참여", "1980-02-03")
    r = _put(client, c2, _cred(a2), True)
    assert r.status_code == 200 and r.json()["export_state"] == "blocked_withdrawn"


def test_BT54_일치하는_동의가_없으면_0건_요청_레코드는_남긴다(client):
    admin = _admin(client, "b11admin17@test.com")
    w = client.post(
        "/api/v1/admin/research-consents/withdraw",
        json={"name": "없는사람", "birth_date": "1970-01-01", "reason": "문의 접수"},
        headers=admin["h"],
    )
    assert w.status_code == 200 and w.json()["withdrawn_count"] == 0


# ── 관리자 조회 · BT55 익명 집계 · AZ19 ────────────────────────────────


def test_AZ19_상담사는_개별_동의를_조회할_수_없고_익명_인원만_본다(client):
    host = _register(client, "b11h18@test.com")
    other = _register(client, "b11o18@test.com")
    cls = _group(client, host)
    a = _guest(client, cls, "에이")
    b = _guest(client, cls, "비이", email="b@example.com")
    _guest(client, cls, "씨이", email="c@example.com")
    _put(client, cls, _cred(a), True)
    _put(client, cls, _cred(b), True)

    s = client.get(f"/api/v1/sessions/{cls['id']}/research-consent/summary", headers=host["h"])
    assert s.status_code == 200
    assert s.json() == {"consented": 2, "total": 3}, "인원 수만 — 개별 상태·ID 없음"
    assert client.get(f"/api/v1/sessions/{cls['id']}/research-consent/summary", headers=other["h"]).status_code in (403, 404)
    assert client.get(f"/api/v1/sessions/{cls['id']}/research-consent/summary", headers=_cred(a)).status_code in (401, 403)
    # 상담사의 개별 조회 경로 없음 — 호스트 자격으로 본인 동의 조회는 참여자 행이 없어 403
    assert client.get(f"/api/v1/sessions/{cls['id']}/research-consent", headers=host["h"]).status_code == 403
    # 클래스 응답(참여자 DTO·목록)에는 연구 동의 정보가 없다
    dump = str(client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json())
    assert "research" not in dump and "consent_research" not in dump


def test_관리자_조회는_동의_목록을_돌려주고_비관리자는_403(client):
    host = _register(client, "b11h19@test.com")
    cls = _group(client, host)
    a = _guest(client, cls, "에이")
    _put(client, cls, _cred(a), True)
    admin = _admin(client, "b11admin19@test.com")
    url = f"/api/v1/admin/sessions/{cls['id']}/research-consents"
    assert client.get(url, headers=host["h"]).status_code == 403
    r = client.get(url, headers=admin["h"])
    assert r.status_code == 200
    item = r.json()["items"][0]
    assert item["participant_id"] == a["participant_id"] and item["consented"] is True
    assert item["key_version"] == 1 and item["research_subject_id"] == _expected_id("에이", "1990-05-17")
    assert "birth_date" not in item and "name" not in item


def test_LG13_기존_참여자는_기록이_없으면_미동의_마이그레이션이_행을_바꾸지_않는다(client):
    host = _register(client, "b11h20@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    assert _consent_row(me["participant_id"]) is None
    assert client.get(f"/api/v1/sessions/{cls['id']}/research-consent", headers=_cred(me)).json()["consented"] is False


def test_생년월일_모를때는_동의는_저장되고_내보내기_보류(client):
    from app.models.session import SessionParticipant

    host = _register(client, "b11h21@test.com")
    cls = _group(client, host)
    me = _guest(client, cls)
    db = _db()
    try:
        p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(me["participant_id"])).first()
        p.birth_date = None
        db.commit()
    finally:
        db.close()
    r = _put(client, cls, _cred(me), True).json()
    assert r["consented"] is True and r["export_state"] == "blocked_identity_missing"

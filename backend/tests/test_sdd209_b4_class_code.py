"""SDD-209 B4 — 4자리 클래스 코드 (verify BT15~BT20, RV3-1·2·4·5·6·11·12, LG1·LG2·LG9).

코드는 선행 0 을 보존하는 4자리 숫자 문자열이며, 활성 클래스 사이에서만 유일하고,
종료·취소·숨김이면 즉시 무효다. 과거 값은 보존되지만 입장에는 쓰이지 않는다.
"""

import asyncio
import logging
import uuid

import pytest

from tests.test_sdd015_class_code import _create_class, _register


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _set(sid: str, **fields):
    from app.models.session import Session as S

    db = _db()
    try:
        s = db.query(S).filter(S.id == uuid.UUID(sid)).execution_options(include_hidden=True).first()
        for k, v in fields.items():
            setattr(s, k, v)
        db.commit()
    finally:
        db.close()


def _get(sid: str):
    from app.models.session import Session as S

    db = _db()
    try:
        s = db.query(S).filter(S.id == uuid.UUID(sid)).execution_options(include_hidden=True).first()
        return {"code": s.access_code, "legacy": s.legacy_access_code, "status": s.status}
    finally:
        db.close()


# ── BT15 코드 생성 ───────────────────────────────────────────────────────


def test_BT15_생성은_4자리_숫자_문자열(client):
    host = _register(client, "b4h1@test.com")
    codes = [_create_class(client, host["h"])["access_code"] for _ in range(5)]
    assert all(isinstance(c, str) and len(c) == 4 and c.isdigit() for c in codes)
    assert len(set(codes)) == 5, "활성 클래스 사이 중복 없음"


def test_RV3_1_선행_0_코드_문자열_보존(client, monkeypatch):
    from app.services import class_code_service

    monkeypatch.setattr(class_code_service.secrets, "randbelow", lambda n: 42)
    host = _register(client, "b4h2@test.com")
    cls = _create_class(client, host["h"])
    assert cls["access_code"] == "0042"
    assert _get(cls["id"])["code"] == "0042"
    # 입장 조회도 "0042" 로 된다(정수 변환 0)
    assert client.get("/api/v1/sessions/by-code/0042").status_code == 200
    assert client.get("/api/v1/sessions/by-code/42").status_code == 404


def test_BT15_동시_발급_경합_충돌_0_재발급_재시도(client, monkeypatch):
    from app.services import class_code_service

    seq = iter(["1111", "1111", "2222"])
    monkeypatch.setattr(class_code_service, "generate_class_code", lambda db: next(seq))
    host = _register(client, "b4h3@test.com")
    a = _create_class(client, host["h"])
    b = _create_class(client, host["h"])  # 첫 시도 1111 이 부분 unique 로 충돌 → 재발급
    assert a["access_code"] == "1111" and b["access_code"] == "2222"


def test_BT15_종료_클래스의_코드는_재사용_가능_값은_보존(client, monkeypatch):
    from app.services import class_code_service

    host = _register(client, "b4h4@test.com")
    a = _create_class(client, host["h"])
    code = a["access_code"]
    _set(a["id"], status="completed")
    monkeypatch.setattr(class_code_service, "generate_class_code", lambda db: code)
    b = _create_class(client, host["h"])
    assert b["access_code"] == code
    assert _get(a["id"])["code"] == code, "종료 클래스의 값은 그대로 보존"


def test_BT15_코드_공간_소진은_명시적_오류(client, monkeypatch):
    from app.services import class_code_service

    monkeypatch.setattr(class_code_service, "CLASS_CODE_SPACE", 3)
    host = _register(client, "b4h5@test.com")
    for _ in range(3):
        _create_class(client, host["h"])
    res = client.post("/api/v1/sessions", json={"type": "meditation", "duration_min": 30, "title": "x"},
                      headers=host["h"])
    assert res.status_code == 503
    assert "코드" in res.json()["detail"]


def test_generate_class_code_높은_점유율에서도_남은_코드만_고른다(client, monkeypatch):
    from app.services import class_code_service
    from app.models.session import Session as S

    monkeypatch.setattr(class_code_service, "CLASS_CODE_SPACE", 10)
    # 점유 6/10 → 목록 선택 분기. 남은 4개 중에서만 나온다.
    host = _register(client, "b4h6@test.com")
    held = {f"{n:04d}" for n in range(6)}
    db = _db()
    try:
        for c in sorted(held):
            db.add(S(type="meditation", status="ready", host_id=uuid.UUID(host["id"]), duration_min=30,
                     access_code=c))
        db.commit()
        for _ in range(30):
            assert class_code_service.generate_class_code(db) not in held
    finally:
        db.close()


# ── BT16 검증·정보 비노출 / RV3-2·6·12 ───────────────────────────────────


def test_BT16_잘못된_코드_모두_동일_응답(client):
    host = _register(client, "b4h7@test.com")
    active = _create_class(client, host["h"])
    ended = _create_class(client, host["h"])
    _set(ended["id"], status="completed")
    cancelled = _create_class(client, host["h"])
    _set(cancelled["id"], status="cancelled")
    hidden = _create_class(client, host["h"])
    client.delete(f"/api/v1/sessions/{hidden['id']}", headers=host["h"])
    # 과거 6자리 값이 남은 활성 클래스(재발급 전) — 입장 불가
    legacy = _create_class(client, host["h"])
    _set(legacy["id"], access_code="AB12CD")

    free = next(f"{n:04d}" for n in range(10000) if f"{n:04d}" != active["access_code"]
                and f"{n:04d}" not in (ended["access_code"], cancelled["access_code"], hidden["access_code"]))
    probes = ["123", "12345", "abcd", "12 4", "٠٠٤٢", free, ended["access_code"], cancelled["access_code"],
              hidden["access_code"], "AB12CD"]
    bodies = set()
    for p in probes:
        r = client.get(f"/api/v1/sessions/by-code/{p}")
        assert r.status_code == 404, (p, r.status_code)
        bodies.add(r.text)
    assert len(bodies) == 1, "없는/형식오류/종료/취소/숨김/과거 6자리 응답은 동일해야 한다"

    ok = client.get(f"/api/v1/sessions/by-code/{active['access_code']}")
    assert ok.status_code == 200


def test_RV3_6_종료_취소_후_입장_거부_값_보존(client):
    host = _register(client, "b4h8@test.com")
    cls = _create_class(client, host["h"])
    code = cls["access_code"]
    client.post(f"/api/v1/sessions/{cls['id']}/open", headers=host["h"])
    assert client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": "손님"}).status_code == 200
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"])
    assert client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": "지각"}).status_code == 404
    assert _get(cls["id"])["code"] == code


# ── BT17 시도 제한 ───────────────────────────────────────────────────────


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


@pytest.fixture
def fake_redis():
    import fakeredis.aioredis

    return fakeredis.aioredis.FakeRedis(decode_responses=True)


def test_BT17_IP_단위_실패_누적_후_올바른_코드도_거부_해제(fake_redis):
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as svc

    async def scenario():
        for _ in range(svc.IP_MAX_FAILURES):
            await svc.check_allowed(fake_redis, "1.1.1.1")
            await svc.record_failure(fake_redis, "1.1.1.1")
        with pytest.raises(HTTPException) as exc:
            await svc.check_allowed(fake_redis, "1.1.1.1")  # 올바른 코드여도 도달 전에 거부
        assert exc.value.status_code == 429
        await svc.check_allowed(fake_redis, "2.2.2.2")  # 다른 IP 는 영향 없음
        # 해제(잠금 TTL 만료를 모사)
        await fake_redis.delete(svc._ip_lock_key("1.1.1.1"))
        await svc.check_allowed(fake_redis, "1.1.1.1")

    _run(scenario())


def test_BT17_올바른_코드를_끼워도_실패_카운터는_초기화되지_않는다(fake_redis):
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as svc

    assert not hasattr(svc, "record_success"), "성공 시 초기화는 제한 우회 수단이 된다"

    async def scenario():
        for _ in range(svc.IP_MAX_FAILURES):
            await svc.record_failure(fake_redis, "3.3.3.3")  # 사이사이 성공 요청이 있어도 카운트 유지
        with pytest.raises(HTTPException):
            await svc.check_allowed(fake_redis, "3.3.3.3")

    _run(scenario())


def test_BT17_코드_단위_분당_제한_키에_코드_원문_없음(fake_redis):
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as svc

    async def scenario():
        for _ in range(svc.CODE_MAX_PER_MINUTE):
            await svc.note_code_request(fake_redis, "4321")
        with pytest.raises(HTTPException) as exc:
            await svc.note_code_request(fake_redis, "4321")
        assert exc.value.status_code == 429
        await svc.note_code_request(fake_redis, "4322")  # 다른 코드는 영향 없음
        keys = [k async for k in fake_redis.scan_iter("clscode:*")]
        assert keys and all("4321" not in k for k in keys)

    _run(scenario())


def test_BT17_전체_유입_분산_대입_시_전체_일시_거부(fake_redis):
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as svc

    async def scenario():
        for i in range(svc.GLOBAL_MAX_FAILURES):
            await svc.record_failure(fake_redis, f"10.0.{i // 250}.{i % 250}")  # 서로 다른 IP
        with pytest.raises(HTTPException) as exc:
            await svc.check_allowed(fake_redis, "99.99.99.99")
        assert exc.value.status_code == 429
        assert exc.value.detail == svc.THROTTLE_DETAIL

    _run(scenario())


# ── BT18 무효화(종료·취소·숨김) ─────────────────────────────────────────


def test_BT18_취소_숨김은_조회_불가_값_보존(client):
    host = _register(client, "b4h9@test.com")
    a = _create_class(client, host["h"])
    assert client.get(f"/api/v1/sessions/by-code/{a['access_code']}").status_code == 200
    client.post(f"/api/v1/sessions/{a['id']}/cancel", headers=host["h"])
    assert client.get(f"/api/v1/sessions/by-code/{a['access_code']}").status_code == 404
    assert _get(a["id"])["code"] == a["access_code"]


# ── BT19 로그 마스킹 / RV3-11 ────────────────────────────────────────────


def test_BT19_코드_원문이_로그에_남지_않는다(client, caplog):
    import app.main  # noqa: F401 — 로그 마스킹 설치

    logger = logging.getLogger("uvicorn.access")
    with caplog.at_level(logging.INFO):
        logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", "/api/v1/sessions/by-code/4821/state", "1.1", 200)
        logging.getLogger("app.test").warning("입장 실패 access_code=4821 session=abc")
        logging.getLogger("app.test").warning("failed: /by-code/0042/join")
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "4821" not in text and "0042" not in text
    assert "[REDACTED]" in text


# ── BT20 마이그레이션·재발급(DS-1) ──────────────────────────────────────


def test_BT20_alembic_head_단일():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config("alembic.ini")
    assert len(ScriptDirectory.from_config(cfg).get_heads()) == 1


def test_DS1_재발급_dry_run_멱등_이전값_보존_종료분_불변(client):
    from app.models.session import Session as S
    from app.services.class_code_reissue import reissue_active_class_codes

    host = _register(client, "b4h10@test.com")
    ids = {}
    db = _db()
    try:
        def mk(name, **kw):
            s = S(type="meditation", status=kw.pop("status", "ready"), host_id=uuid.UUID(host["id"]),
                  duration_min=30, **kw)
            db.add(s)
            db.flush()
            ids[name] = str(s.id)

        mk("act1", access_code="AAAA11")
        mk("act2", access_code="BBBB22", status="in_progress")
        mk("act4", access_code="0007")
        mk("done", access_code="CCCC33", status="completed")
        mk("cancel", access_code="DDDD44", status="cancelled")
        mk("nocode", access_code=None)
        db.commit()

        before = {k: _get(v) for k, v in ids.items()}
        dry = reissue_active_class_codes(db, dry_run=True)
        assert dry == {"dry_run": True, "active_total": 3, "already_4digit": 1, "to_reissue": 2, "reissued": 0}
        assert {k: _get(v) for k, v in ids.items()} == before, "dry-run 은 쓰지 않는다"

        applied = reissue_active_class_codes(db, dry_run=False)
        assert applied["reissued"] == 2
        after = {k: _get(v) for k, v in ids.items()}
        for name, legacy in (("act1", "AAAA11"), ("act2", "BBBB22")):
            assert len(after[name]["code"]) == 4 and after[name]["code"].isdigit()
            assert after[name]["legacy"] == legacy
        assert after["act1"]["code"] != after["act2"]["code"] != "0007"
        assert after["act4"] == before["act4"]
        for name in ("done", "cancel", "nocode"):
            assert after[name] == before[name], "종료·취소·코드 없음은 불변(LG1)"

        again = reissue_active_class_codes(db, dry_run=False)
        assert again["reissued"] == 0 and {k: _get(v) for k, v in ids.items()} == after, "멱등"
        assert all(isinstance(v, (int, bool)) for v in applied.values()), "요약에는 건수만(코드 값 없음)"
    finally:
        db.close()


def test_DS1_코드_공간_부족이면_전체_롤백(client, monkeypatch):
    from app.models.session import Session as S
    from app.services import class_code_service
    from app.services.class_code_reissue import reissue_active_class_codes

    monkeypatch.setattr(class_code_service, "CLASS_CODE_SPACE", 1)
    host = _register(client, "b4h11@test.com")
    db = _db()
    try:
        for c in ("AAAA11", "BBBB22"):
            db.add(S(type="meditation", status="ready", host_id=uuid.UUID(host["id"]), duration_min=30, access_code=c))
        db.commit()
        with pytest.raises(class_code_service.ClassCodeExhausted):
            reissue_active_class_codes(db, dry_run=False)
        codes = sorted(c for (c,) in db.query(S.access_code).filter(S.access_code.in_(["AAAA11", "BBBB22"])).all())
        assert codes == ["AAAA11", "BBBB22"]
    finally:
        db.close()

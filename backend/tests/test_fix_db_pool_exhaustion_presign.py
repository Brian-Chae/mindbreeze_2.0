"""FIX db-pool-exhaustion-presign — presign/ack 폭주 시 DB 풀 고갈 방지 (verify V1~V9).

dev 사고: 앱 복귀 시 raw presign/ack 가 폭주하고, ack 가 DB 트랜잭션을 쥔 채 S3 검증을 기다려
QueuePool(10+10)이 고갈 → 로그인 불가. 실제 S3 는 쓰지 않는다(모의).
"""
import asyncio
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import session as sa_session

from app.api import deps
from app.config import settings
from app.core import database
from app.services import outbox_worker, storage_service
from tests.test_sdd244_ingest import SIGNALS, _ack, _ack_items, _meta, _presign, ctx, verified  # noqa: F401


def _open_transactions() -> int:
    return sum(1 for s in list(sa_session._sessions.values()) if s.in_transaction())


# ── V1: ack 의 S3 검증은 DB 트랜잭션 밖에서 ─────────────────────────────────
def test_v1_raw_ack는_S3_검증_중_DB_트랜잭션을_쥐지_않는다(ctx, monkeypatch):
    p = _presign(ctx, [_meta(s) for s in SIGNALS]).json()["chunks"]
    seen: list[int] = []

    def spy(*a, **k):
        seen.append(_open_transactions())
        return True, "ver-1"

    monkeypatch.setattr(storage_service, "verify_object_sha256", spy)
    body = _ack(ctx, _ack_items(p)).json()
    assert len(seen) == 3 and max(seen) == 0, f"검증 중 열린 트랜잭션: {seen}"
    assert body["acked"] == 3 and body["failed"] == 0
    assert [c["upload_status"] for c in body["chunks"]] == ["uploaded"] * 3
    assert body["file_count"] == 1  # EEG 레코드만 집계(기존 동작)


def test_v1_raw_ack_검증실패_반영_회귀(ctx, monkeypatch):
    p = _presign(ctx, [_meta("eeg")]).json()["chunks"]
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (False, None))
    item = _ack(ctx, _ack_items(p)).json()["chunks"][0]
    assert item["upload_status"] == "failed" and item["failure_reason"] == "object_verification_failed"


# ── V4: presign 전용 S3 클라이언트 캐시·timeout ─────────────────────────────
def test_v4_presign_클라이언트는_재사용되고_timeout이_적용된다(monkeypatch):
    import boto3

    created: list[dict] = []

    def fake_client(*a, **k):
        created.append(k)
        return SimpleNamespace(generate_presigned_url=lambda *aa, **kk: "https://signed")

    monkeypatch.setattr(boto3, "client", fake_client)
    monkeypatch.setattr(storage_service, "storage_configured", lambda: True)
    monkeypatch.setattr(storage_service, "_presign_client_state", None)
    for _ in range(5):
        storage_service.generate_presigned_put_checksummed("k", checksum_sha256_hex="a" * 64)
    assert len(created) == 1
    cfg = created[0]["config"]
    assert cfg.connect_timeout == 3 and cfg.read_timeout == 10
    # 설정 지문이 바뀌면 재생성
    monkeypatch.setattr(settings, "s3_region", "ap-northeast-2")
    storage_service.generate_presigned_put_checksummed("k", checksum_sha256_hex="a" * 64)
    assert len(created) == 2


# ── V5: 동시 처리 상한 ──────────────────────────────────────────────────────
def test_v5_archive_slot_한도_초과는_429_RetryAfter(monkeypatch):
    monkeypatch.setattr(deps, "_archive_slots", threading.BoundedSemaphore(2))
    monkeypatch.setattr(settings, "archive_slot_wait_sec", 0.1)
    gate = threading.Event()
    app = FastAPI()

    @app.get("/slow", dependencies=[Depends(deps.archive_upload_slot)])
    def slow():
        gate.wait(5)
        return {"ok": True}

    results: list[int] = []
    headers: list[dict] = []
    lock = threading.Lock()

    def call():
        r = TestClient(app).get("/slow")
        with lock:
            results.append(r.status_code)
            if r.status_code == 429:
                headers.append(dict(r.headers))

    threads = [threading.Thread(target=call) for _ in range(4)]
    for t in threads:
        t.start()
    time.sleep(0.8)  # 초과분(2건)은 0.1s 후 429 로 먼저 끝난다
    gate.set()
    for t in threads:
        t.join(10)
    assert sorted(results) == [200, 200, 429, 429]
    assert all(h.get("retry-after") == "3" for h in headers)
    # 해제 후 재통과
    assert TestClient(app).get("/slow").status_code == 200


# ── V6: 느린 S3 에 걸린 동시 ack 폭주 중에도 풀이 고갈되지 않는다 ───────────
def test_v6_느린_S3_ack_폭주에도_DB_풀이_고갈되지_않는다(ctx, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import QueuePool

    p = _presign(ctx, [_meta("eeg")]).json()["chunks"]
    held: list[int] = []
    release = threading.Event()

    def slow_verify(*a, **k):
        held.append(_open_transactions())  # 느린 검증 중 열린 트랜잭션(=점유 커넥션) 수
        release.wait(3)
        return True, "v"

    monkeypatch.setattr(storage_service, "verify_object_sha256", slow_verify)
    monkeypatch.setattr(deps, "_archive_slots", threading.BoundedSemaphore(3))
    monkeypatch.setattr(settings, "archive_slot_wait_sec", 0.1)

    codes: list[int] = []
    lock = threading.Lock()

    def fire():
        r = ctx["client"].post(
            f"/api/v1/sessions/{ctx['sid']}/biosignal-raw/ack",
            json={"participant_id": ctx["pid"], "chunks": _ack_items(p)},
        )
        with lock:
            codes.append(r.status_code)

    threads = [threading.Thread(target=fire) for _ in range(12)]
    for t in threads:
        t.start()
    time.sleep(0.8)
    # 느린 검증이 걸린 동안에도 일반 엔드포인트는 응답한다(풀 점유 없음)
    assert ctx["client"].get("/health").status_code in (200, 404)
    blocked_open_tx = _open_transactions()  # 슬롯 3건이 모두 S3 대기 중인 시점의 열린 트랜잭션 수
    release.set()
    for t in threads:
        t.join(15)
    assert len(held) == 3, f"슬롯 한도(3)만큼만 검증에 진입해야 함: {held}"
    assert blocked_open_tx == 0, f"S3 대기 중 DB 트랜잭션(커넥션) 점유: {blocked_open_tx}"
    assert codes.count(429) >= 1  # 한도 초과분은 429
    assert set(codes) <= {200, 429}


# ── V7: outbox 폴링이 DB 대기 중에도 이벤트 루프를 막지 않는다 ───────────────
def test_v7_outbox_poll은_DB가_느려도_이벤트루프를_막지_않는다(monkeypatch):
    real = database.SessionLocal

    class SlowSession:
        def __init__(self):
            self._s = real()

        def __getattr__(self, name):
            attr = getattr(self._s, name)
            if name in ("commit", "rollback", "close"):
                return attr
            return attr

        def query(self, *a, **k):
            time.sleep(0.6)  # 풀 대기를 흉내 — 루프 스레드에서 호출되면 틱이 멈춘다
            return self._s.query(*a, **k)

    monkeypatch.setattr(database, "SessionLocal", SlowSession)

    async def scenario():
        ticks: list[float] = []

        async def ticker():
            for _ in range(10):
                ticks.append(time.monotonic())
                await asyncio.sleep(0.05)

        t = asyncio.create_task(ticker())
        await outbox_worker.poll_and_deliver_ws()
        await t
        return ticks

    # query() 자체는 컨텍스트 구성(루프 스레드)이라 .all() 대기만 스레드로 보낸다 — 여기서는 .all() 지연으로 검증
    class SlowQuery:
        def __init__(self, q):
            self.q = q

        def filter(self, *a, **k):
            return SlowQuery(self.q.filter(*a, **k))

        def with_for_update(self, **k):
            return SlowQuery(self.q.with_for_update(**k))

        def order_by(self, *a, **k):
            return SlowQuery(self.q.order_by(*a, **k))

        def limit(self, n):
            return SlowQuery(self.q.limit(n))

        def all(self):
            time.sleep(0.6)
            return self.q.all()

    class Sess2:
        def __init__(self):
            self._s = real()

        def query(self, *a, **k):
            return SlowQuery(self._s.query(*a, **k))

        def get_bind(self):
            return self._s.get_bind()

        def commit(self):
            return self._s.commit()

        def rollback(self):
            return self._s.rollback()

        def close(self):
            return self._s.close()

    monkeypatch.setattr(database, "SessionLocal", Sess2)
    ticks = asyncio.run(scenario())
    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    assert len(ticks) == 10
    assert max(gaps) < 0.4, f"이벤트 루프가 DB 대기 동안 멈춤: max gap {max(gaps):.2f}s"


# ── V9: postgres 연결 옵션 ──────────────────────────────────────────────────
def test_v9_postgres_연결옵션에_lock_statement_timeout이_들어간다(monkeypatch):
    kw = database.build_engine_kwargs("postgresql://localhost:5432/x")
    opts = kw["connect_args"]["options"]
    assert "lock_timeout=10000" in opts and "statement_timeout=120000" in opts
    assert "connect_args" not in database.build_engine_kwargs("sqlite://")
    monkeypatch.setattr(settings, "db_lock_timeout_ms", 0)
    monkeypatch.setattr(settings, "db_statement_timeout_ms", 0)
    assert "connect_args" not in database.build_engine_kwargs("postgresql://localhost:5432/x")

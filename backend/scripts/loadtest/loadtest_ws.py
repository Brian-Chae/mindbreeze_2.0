"""MB 2.0 dev 서버 WS 부하 테스트 — /session-live 네임스페이스.

시나리오:
1. WS 동시 연결: N개 소켓 연결 + join → 연결 성공률/시간
2. feature emit 처리량: N개 소켓이 feature 연속 emit → 초당 처리량 + feature_ack 지연

주의: dev 서버는 단일 워커(프로세스) 전제. feature 저장은 DB insert 1건 + 조회 2~3건.
"""

import asyncio
import time

import httpx
import socketio

BASE = "https://dev-api.mindbreeze.looxidlabs.com/api/v1"
WS_URL = "https://dev-api.mindbreeze.looxidlabs.com"
SID = "a8f9b6f3-cc33-4e2b-9708-71fb240c7c20"  # in_progress 테스트 세션


def login(email: str, password: str, role: str) -> str:
    r = httpx.post(
        f"{BASE}/auth/login",
        json={"email": email, "password": password, "role": role},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def make_client(token: str):
    sio = socketio.AsyncClient(
        reconnection=False, logger=False, engineio_logger=False
    )
    await sio.connect(
        WS_URL,
        namespaces=["/session-live"],
        auth={"token": token},
        transports=["websocket"],
        wait_timeout=20,
    )
    return sio


async def scenario_connect(token: str, n: int) -> dict:
    """N개 소켓 동시 연결 + join. 연결 성공률·시간 측정."""
    t0 = time.perf_counter()
    clients = []
    ok = 0
    join_ok = 0
    errors = 0

    async def one():
        nonlocal ok, join_ok, errors
        try:
            c = await make_client(token)
            ok += 1
            clients.append(c)
            await c.emit("join", {"session_id": SID}, namespace="/session-live")
            join_ok += 1
        except Exception:
            errors += 1

    await asyncio.gather(*(one() for _ in range(n)))
    elapsed = time.perf_counter() - t0

    # 정리
    await asyncio.gather(*(c.disconnect() for c in clients), return_exceptions=True)
    return {
        "n": n,
        "connected": ok,
        "joined": join_ok,
        "errors": errors,
        "elapsed": round(elapsed, 2),
        "conn_per_sec": round(ok / elapsed, 1) if elapsed else 0,
    }


async def scenario_feature(token: str, n: int, per_conn: int) -> dict:
    """N개 소켓이 각각 feature를 연속 emit. 처리량·ACK 지연 측정."""
    clients = []
    for _ in range(n):
        clients.append(await make_client(token))

    # join 먼저
    await asyncio.gather(
        *(c.emit("join", {"session_id": SID}, namespace="/session-live") for c in clients)
    )
    await asyncio.sleep(0.5)

    ack_latencies = []
    ack_count = 0
    sent = 0

    async def one_conn(c: socketio.AsyncClient, idx: int):
        nonlocal sent, ack_count
        ack_fut = None

        def on_ack(data):
            nonlocal ack_fut
            if ack_fut and not ack_fut.done():
                ack_fut.set_result(time.perf_counter())

        c.on("feature_ack", on_ack, namespace="/session-live")
        for i in range(per_conn):
            seq = idx * 100000 + i + int(time.time() * 100) % 10000
            ack_fut = asyncio.get_running_loop().create_future()
            t0 = time.perf_counter()
            await c.emit(
                "feature",
                {
                    "session_id": SID,
                    "stream_id": f"lt-{idx}",
                    "sequence": seq,
                    "feature": {
                        "second_offset": seq,
                        "focus_index": 0.5,
                        "relaxation_index": 0.6,
                    },
                },
                namespace="/session-live",
            )
            sent += 1
            try:
                t_ack = await asyncio.wait_for(ack_fut, timeout=5)
                ack_latencies.append(t_ack - t0)
                ack_count += 1
            except asyncio.TimeoutError:
                pass

    t0 = time.perf_counter()
    await asyncio.gather(*(one_conn(c, i) for i, c in enumerate(clients)))
    elapsed = time.perf_counter() - t0

    await asyncio.gather(*(c.disconnect() for c in clients), return_exceptions=True)

    ack_latencies.sort()
    p50 = ack_latencies[int(len(ack_latencies) * 0.5)] if ack_latencies else 0
    p95 = ack_latencies[int(len(ack_latencies) * 0.95)] if ack_latencies else 0
    return {
        "n": n,
        "per_conn": per_conn,
        "sent": sent,
        "acked": ack_count,
        "elapsed": round(elapsed, 2),
        "emit_per_sec": round(sent / elapsed, 1) if elapsed else 0,
        "ack_p50_ms": round(p50 * 1000, 1),
        "ack_p95_ms": round(p95 * 1000, 1),
    }


async def main():
    token = login("client@test.com", "test1234", "client")
    print("client 토큰 발급 완료\n")

    print("=== 시나리오 1: WS 동시 연결 ===")
    for n in (50, 100, 200):
        r = await scenario_connect(token, n)
        print(
            f"N={r['n']:3d} connected={r['connected']:3d} joined={r['joined']:3d} "
            f"err={r['errors']:3d} elapsed={r['elapsed']}s ({r['conn_per_sec']}/s)"
        )
        await asyncio.sleep(1)

    print("\n=== 시나리오 2: feature emit 처리량 ===")
    for n, per in ((10, 20), (30, 20), (50, 20)):
        r = await scenario_feature(token, n, per)
        print(
            f"N={r['n']:3d}×{r['per_conn']} sent={r['sent']:4d} acked={r['acked']:4d} "
            f"emit={r['emit_per_sec']}/s ack_p50={r['ack_p50_ms']}ms ack_p95={r['ack_p95_ms']}ms"
        )
        await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())

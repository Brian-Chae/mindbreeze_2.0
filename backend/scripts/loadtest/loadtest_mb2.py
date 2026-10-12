"""MB 2.0 dev 서버 부하 테스트 — REST 조회 + EEG feature 쓰기.

시나리오:
1. GET /sessions  (counselor 토큰) — 목록 조회 처리량/레이턴시
2. POST /sessions/{id}/features (client 토큰) — EEG 실시간 스트리밍 쓰기 처리량

각 시나리오 동시성 10/50/100 단계로 측정 (RPS, P50/P95/P99, 에러율).
"""

import asyncio
import json
import statistics
import time

import httpx

BASE = "https://dev-api.mindbreeze.looxidlabs.com/api/v1"
SID = "a8f9b6f3-cc33-4e2b-9708-71fb240c7c20"  # in_progress 테스트 세션


def login(email: str, password: str, role: str) -> str:
    r = httpx.post(
        f"{BASE}/auth/login",
        json={"email": email, "password": password, "role": role},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def bench(name: str, client: httpx.AsyncClient, fn, total: int, concurrency: int):
    sem = asyncio.Semaphore(concurrency)
    latencies: list[float] = []
    errors = 0

    async def worker():
        nonlocal errors
        for _ in range(total // concurrency):
            async with sem:
                t0 = time.perf_counter()
                try:
                    await fn(client)
                except Exception:
                    errors += 1
                latencies.append(time.perf_counter() - t0)

    t0 = time.perf_counter()
    await asyncio.gather(*(worker() for _ in range(concurrency)))
    elapsed = time.perf_counter() - t0

    n = len(latencies)
    latencies.sort()
    p50 = latencies[int(n * 0.50)] if n else 0
    p95 = latencies[int(n * 0.95)] if n else 0
    p99 = latencies[int(n * 0.99)] if n else 0
    rps = n / elapsed if elapsed else 0
    print(
        f"[{name}] conc={concurrency:3d} req={n:4d} "
        f"rps={rps:6.1f} p50={p50*1000:6.1f}ms p95={p95*1000:6.1f}ms "
        f"p99={p99*1000:6.1f}ms err={errors}"
    )


async def main():
    counselor = login("counselor@test.com", "test1234", "counselor")
    client_tok = login("client@test.com", "test1234", "client")
    print("토큰 발급 완료")

    h_c = {"Authorization": f"Bearer {counselor}"}
    h_cl = {"Authorization": f"Bearer {client_tok}"}

    async def get_sessions(c):
        await c.get(f"{BASE}/sessions?limit=20", headers=h_c)

    async def post_feature(c):
        body = {
            "features": [
                {
                    "second_offset": int(time.time() * 10) % 100000,
                    "focus_index": 0.5,
                    "relaxation_index": 0.6,
                    "stress_index": 0.3,
                }
            ]
        }
        await c.post(f"{BASE}/sessions/{SID}/features", json=body, headers=h_cl)

    limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
    async with httpx.AsyncClient(timeout=30, limits=limits) as client:
        print("\n=== 시나리오 1: GET /sessions (목록 조회) ===")
        for conc in (10, 50, 100):
            await bench("GET /sessions", client, get_sessions, 300, conc)
            await asyncio.sleep(1)

        print("\n=== 시나리오 2: POST /features (EEG 스트리밍 쓰기) ===")
        for conc in (10, 50, 100):
            await bench("POST features", client, post_feature, 300, conc)
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())

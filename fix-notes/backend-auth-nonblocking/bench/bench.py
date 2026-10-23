"""홈 화면 동시 호출 측정 — 인증 필요한 GET API 를 동시에 보내 전체 완료 시간·개별 지연을 잰다.

사용: python bench.py <base_url> <token> [screens=1] [rounds=5]
  screens: 동시에 홈 화면을 여는 사용자 수(각 화면 = 아래 엔드포인트 12건 동시)
"""

import asyncio
import statistics
import sys
import time

import httpx

ENDPOINTS = [
    "/api/v1/dashboard/counselor",
    "/api/v1/notifications/unread-count",
    "/api/v1/notifications",
    "/api/v1/notifications/preferences",
    "/api/v1/chat/rooms",
    "/api/v1/classes",
    "/api/v1/sessions",
    "/api/v1/reports",
    "/api/v1/auth/counselors/me/profile",
    "/api/v1/clients",
    "/api/v1/onboarding/me",
    "/api/v1/counseling",
]


async def one(client, path, headers):
    t = time.perf_counter()
    try:
        r = await client.get(path, headers=headers)
        status = r.status_code
    except httpx.HTTPError:
        status = 0  # 타임아웃 등 — 실패로 집계
    return path, status, (time.perf_counter() - t) * 1000


async def main():
    base, token = sys.argv[1], sys.argv[2]
    screens = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    headers = {"Authorization": f"Bearer {token}"}
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=200)
    async with httpx.AsyncClient(base_url=base, limits=limits, timeout=45) as client:
        # 워밍업 1회(커넥션·임포트 지연 제외) + 상태코드 확인
        warm = await asyncio.gather(*(one(client, p, headers) for p in ENDPOINTS))
        bad = [(p, s) for p, s, _ in warm if s != 200]
        if bad:
            print("WARN 200 아님:", bad)
        totals, p50s, maxs = [], [], []
        for i in range(rounds):
            t0 = time.perf_counter()
            res = await asyncio.gather(*(one(client, p, headers) for _ in range(screens) for p in ENDPOINTS))
            total = (time.perf_counter() - t0) * 1000
            lat = sorted(l for _, _, l in res)
            errs = sum(1 for _, st, _ in res if st != 200)
            totals.append(total)
            p50s.append(statistics.median(lat))
            maxs.append(lat[-1])
            print(f"round {i + 1}: 전체 {total:7.1f}ms  개별 p50 {p50s[-1]:7.1f}  최대 {maxs[-1]:7.1f}  (요청 {len(res)}건, 실패 {errs})")
        print(f"MEAN 전체 {statistics.mean(totals):.1f}ms  p50 {statistics.mean(p50s):.1f}  최대 {statistics.mean(maxs):.1f}")


asyncio.run(main())

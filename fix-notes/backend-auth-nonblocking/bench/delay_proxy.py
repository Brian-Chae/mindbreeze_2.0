"""PostgreSQL 앞에 두는 지연 TCP 프록시 — RDS 왕복 지연(1~3ms)을 흉내낸다.

양방향 각 청크에 one_way_ms 만큼 지연을 넣는다(왕복 = 2 x one_way_ms).
사용: python delay_proxy.py <listen_port> <pg_port> <one_way_ms>
"""

import asyncio
import sys

LISTEN, TARGET, ONE_WAY = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]) / 1000


async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            await asyncio.sleep(ONE_WAY)
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def handle(client_r, client_w):
    server_r, server_w = await asyncio.open_connection("127.0.0.1", TARGET)
    await asyncio.gather(pipe(client_r, server_w), pipe(server_r, client_w))


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", LISTEN)
    async with server:
        await server.serve_forever()


asyncio.run(main())

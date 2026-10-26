"""SDD-246 T04 — Redis 클라이언트 래퍼. 모든 Redis 장애를 `LiveRedisUnavailable` 로 단일화한다(fail-closed).

Redis 가 불가/OOM/읽기전용이면 호출자(T05)는 retryable/503·DEGRADED 로 응답해야 하며, 프로세스 메모리 상태를
대신 돌려주는 폴백은 두지 않는다(plan §3.5, §4.1).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

import redis
from redis.exceptions import (
    BusyLoadingError,
    ConnectionError as RedisConnectionError,
    OutOfMemoryError,
    ReadOnlyError,
    ResponseError,
    TimeoutError as RedisTimeoutError,
)

from app.services.live_redis import keys, scripts

STREAM_MAXLEN = 50_000  # 회차 audience·domain 별 stream 상한 (plan §4.1)
STREAM_RETAIN_MS = 10 * 60 * 1000  # 최근 10분 (둘 중 먼저 도달한 상한)
DEDUPE_TTL_S = 24 * 3600
# 고빈도 metrics event(1Hz×참가자) 는 dedupe 키를 만들지 않는다(0): 키·keys 집합 폭증 방지. 중복 방어는 applied watermark(rev<=applied)로 충분하다.
METRIC_DEDUPE_TTL_S = 0
TERMINAL_TTL_S = 24 * 3600
LOCK_TTL_MS = 10_000  # projector-lock TTL 10초, renew 3초


class LiveRedisUnavailable(Exception):
    """Redis 불가·OOM·읽기전용·타임아웃. retryable/503 으로 매핑한다."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class ProjectionFenceLost(Exception):
    """projector fence 를 잃었다(락 만료·탈취). 이 프로세스의 이후 쓰기는 거부된다."""


class ProjectionEpochMismatch(Exception):
    """Redis epoch 가 기대와 다르다(재구축 진행/완료). 호출자는 다시 ensure_ready 해야 한다."""


class ProjectionGap(Exception):
    """기대 revision 보다 앞선 event — 앞선 항목이 아직 projection 되지 않았다(건너뛰기 금지)."""

    def __init__(self, applied: int, got: int):
        super().__init__(f"gap: applied={applied} got={got}")
        self.applied, self.got = applied, got


class LiveNotReady(Exception):
    """meta 가 없거나 재구축 중. READY 금지 — 호출자는 ensure_ready 후 재시도."""


@dataclass(frozen=True)
class Fence:
    token: str
    fence: int


class LiveRedis:
    def __init__(self, client: "redis.Redis", *, prefix: str = keys.DEFAULT_PREFIX):
        self.r = client
        self.prefix = prefix
        self._project = client.register_script(scripts.PROJECT)
        self._snapshot = client.register_script(scripts.SNAPSHOT)
        self._replay = client.register_script(scripts.REPLAY)
        self._restore = client.register_script(scripts.RESTORE)
        self._lock_acquire = client.register_script(scripts.LOCK_ACQUIRE)
        self._lock_renew = client.register_script(scripts.LOCK_RENEW)
        self._lock_release = client.register_script(scripts.LOCK_RELEASE)
        self._str_unlock = client.register_script(scripts.STR_UNLOCK)

    @classmethod
    def from_url(cls, url: str, *, prefix: str = keys.DEFAULT_PREFIX, socket_timeout: float = 2.0) -> "LiveRedis":
        client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=socket_timeout,
                                      socket_connect_timeout=1.0)
        return cls(client, prefix=prefix)

    # --- 오류 단일화 ---
    @staticmethod
    def _wrap(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except OutOfMemoryError as exc:
            raise LiveRedisUnavailable("redis_oom") from exc
        except (RedisConnectionError, RedisTimeoutError, BusyLoadingError) as exc:
            raise LiveRedisUnavailable("redis_unreachable") from exc
        except ReadOnlyError as exc:
            raise LiveRedisUnavailable("redis_readonly") from exc
        except ResponseError as exc:
            msg = str(exc)
            if "OOM" in msg or "maxmemory" in msg:
                raise LiveRedisUnavailable("redis_oom") from exc
            if "MISCONF" in msg or "LOADING" in msg or "READONLY" in msg:
                raise LiveRedisUnavailable("redis_unavailable") from exc
            raise

    # --- 키 ---
    def emitted_key(self, sid) -> str:
        """방송 워터마크(마지막으로 방송한 revision). T05 publish_pending 이 쓰고 rebuild 가 재구축 후 맞춘다."""
        return f"{self.base(sid)}:emitted"

    def base(self, sid) -> str:
        return keys.base(self.prefix, sid)

    def meta_key(self, sid) -> str:
        return keys.meta(self.prefix, sid)

    # --- meta ---
    def read_meta(self, sid) -> dict[str, str]:
        return self._wrap(self.r.hgetall, self.meta_key(sid))

    # --- projector 락 / fence ---
    def acquire_projector(self, sid, token: str | None = None, ttl_ms: int = LOCK_TTL_MS) -> Fence | None:
        token = token or uuid.uuid4().hex
        base = self.base(sid)
        res = self._wrap(self._lock_acquire, keys=[keys.lock(self.prefix, sid), f"{base}:fence", f"{base}:keys"],
                         args=[token, ttl_ms])
        return Fence(token, int(res[1])) if int(res[0]) == 1 else None

    def renew_projector(self, sid, fence: Fence, ttl_ms: int = LOCK_TTL_MS) -> bool:
        return bool(self._wrap(self._lock_renew, keys=[keys.lock(self.prefix, sid)], args=[fence.token, ttl_ms]))

    def release_projector(self, sid, fence: Fence) -> None:
        self._wrap(self._lock_release, keys=[keys.lock(self.prefix, sid)], args=[fence.token])

    # --- 재구축 락 (단일 rebuild) ---
    def acquire_rebuild(self, sid, token: str, ttl_ms: int = 30_000) -> bool:
        return bool(self._wrap(self.r.set, keys.rebuild_lock(self.prefix, sid), token, nx=True, px=ttl_ms))

    def release_rebuild(self, sid, token: str) -> None:
        self._wrap(self._str_unlock, keys=[keys.rebuild_lock(self.prefix, sid)], args=[token])

    # --- 스크립트 호출 ---
    def project(self, sid, *, epoch: int, fence: Fence, revision: int, event_id: str, domain: str, entity_id: str,
                entity_version: int, kind: str, payload: dict[str, Any], command_id: str, now_ms: int,
                deleted: bool, terminal: bool, auth_revision: int, state_value: str, audiences: list[str],
                dedupe_ttl_s: int | None = None) -> list:
        argv = [self.base(sid), str(epoch), str(fence.fence), str(revision), event_id, domain, entity_id,
                str(entity_version), kind, json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
                command_id, str(now_ms), "1" if deleted else "0", "1" if terminal else "0", str(auth_revision),
                str(STREAM_MAXLEN), str(STREAM_RETAIN_MS), str(DEDUPE_TTL_S if dedupe_ttl_s is None else dedupe_ttl_s),
                str(TERMINAL_TTL_S), state_value,
                *audiences]
        return self._wrap(self._project, keys=[self.meta_key(sid), keys.lock(self.prefix, sid)], args=argv)

    def snapshot_raw(self, sid, audiences: list[str], domains: tuple[str, ...], with_state: bool) -> list:
        return self._wrap(self._snapshot, keys=[self.meta_key(sid)],
                          args=[self.base(sid), ",".join(domains), "1" if with_state else "0", *audiences])

    def replay_raw(self, sid, expected_epoch: int | None, cursors: list[tuple[str, str, int]]) -> list:
        argv: list[str] = [self.base(sid), "" if expected_epoch is None else str(expected_epoch)]
        for aud, dom, cur in cursors:
            argv += [aud, dom, str(cur)]
        return self._wrap(self._replay, keys=[self.meta_key(sid)], args=argv)

    def restore_raw(self, sid, *, epoch: int, applied_revision: int, auth_revision: int, status: str,
                    states: dict[str, dict[str, str]], seqs: dict[str, int]) -> list:
        blob = json.dumps({"states": states, "seqs": seqs}, separators=(",", ":"), ensure_ascii=False)
        # 빈 {} / [] 는 Lua cjson 에서 빈 table 이라 pairs 가 비어 있다 — 그대로 안전하다.
        return self._wrap(self._restore, keys=[self.meta_key(sid)],
                          args=[self.base(sid), str(epoch), str(applied_revision), str(auth_revision), status,
                                str(TERMINAL_TTL_S), blob])

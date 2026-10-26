"""SDD-246 T04 — Redis 키 이름 (plan §4.1).

한 회차의 모든 키는 `{prefix}:{<session_uuid>}:...` 로 hash tag `{<session_uuid>}` 를 공유한다 → 단일 hash slot.
audience 는 서버가 만든 불투명 ID(host | public | member:<uuid>) 만 쓰고 이름·이메일·토큰은 키에 넣지 않는다.
"""

from __future__ import annotations

import uuid

DEFAULT_PREFIX = "mb:live:v2"

# wire 계약(common.schema Domain)과 동일. 순서는 snapshot 출력 순서가 아니라 반복 순서일 뿐이다.
DOMAINS: tuple[str, ...] = (
    "session", "participation", "waiting", "speaking", "signal", "audio", "device", "metrics", "aggregate", "policy",
)
# 회차에 하나뿐인 상태(entity 키는 항상 "_"). 나머지는 entity_id 키 map.
SINGLETON_DOMAINS: frozenset[str] = frozenset({"session", "audio", "aggregate", "policy"})
SINGLETON_KEY = "_"


def base(prefix: str, session_id: uuid.UUID | str) -> str:
    return f"{prefix}:{{{session_id}}}"


def meta(prefix: str, session_id: uuid.UUID | str) -> str:
    return f"{base(prefix, session_id)}:meta"


def lock(prefix: str, session_id: uuid.UUID | str) -> str:
    return f"{base(prefix, session_id)}:lock"


def rebuild_lock(prefix: str, session_id: uuid.UUID | str) -> str:
    return f"{base(prefix, session_id)}:rebuild-lock"


def events(prefix: str, session_id: uuid.UUID | str, audience: str, domain: str) -> str:
    return f"{base(prefix, session_id)}:events:{audience}:{domain}"


def state(prefix: str, session_id: uuid.UUID | str, audience: str, domain: str) -> str:
    return f"{base(prefix, session_id)}:state:{audience}:{domain}"


def seq(prefix: str, session_id: uuid.UUID | str, audience: str, domain: str) -> str:
    return f"{base(prefix, session_id)}:seq:{audience}:{domain}"

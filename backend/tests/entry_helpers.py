"""SDD-209(B5b/B10): 4자리 코드 입장(`POST /sessions/enter`) 테스트 헬퍼.

구 by-code 입장(`/by-code/{code}/join`)을 쓰던 24개 파일의 헬퍼를 새 입장 경로로 옮길 때 공통으로 쓴다.
파일명이 test_ 로 시작하지 않으므로 pytest 수집 대상이 아니다.
"""

from __future__ import annotations

GUEST_DEFAULTS = {"gender": "female", "birth_date": "1990-01-01"}


def guest_body(code: str, name: str = "게스트", **over) -> dict:
    """비회원 입장 요청 바디 — 이름·성별·생년월일·이메일 필수."""
    email = over.pop("email", None) or f"guest-{abs(hash(name)) % 10**8}@example.com"
    return {"code": code, "name": name, "email": email, **GUEST_DEFAULTS, **over}


def enter_guest(client, code: str, name: str = "게스트", **over):
    """비회원으로 입장하고 응답(Response)을 돌려준다. 자격은 client 가 자동 저장한다."""
    return client.post("/api/v1/sessions/enter", json=guest_body(code, name, **over))


def enter_member(client, code: str, headers: dict):
    """로그인 회원으로 입장(개인정보 생략 — 계정 값 사용)."""
    return client.post("/api/v1/sessions/enter", json={"code": code}, headers=headers)


def no_credential() -> dict:
    """자격 없는 요청을 명시하는 헤더(클라이언트의 자동 첨부를 막는다)."""
    return {"X-Entry-Credential": ""}


# participant_id → entry_credential. EntryAwareClient 가 /enter 응답에서 채우고, 테스트마다 비운다.
ENTRY_CREDENTIALS: dict[str, str] = {}


def with_ws_credential(args: tuple) -> tuple:
    """FakeSio.call 인자 (sid, data) 의 data 에 해당 participant_id 의 입장 자격을 실어 준다.

    실제 프론트가 WS 이벤트마다 자격을 싣는 동작을 흉내 낸다. 이미 entry_credential 키가 있으면(빈 값 포함)
    덮어쓰지 않는다 — 자격 없는 경우를 검증하려면 ``"entry_credential": None`` 을 명시한다.
    """
    if len(args) >= 2 and isinstance(args[1], dict):
        data = args[1]
        pid = data.get("participant_id")
        if pid and "entry_credential" not in data and str(pid) in ENTRY_CREDENTIALS:
            return (args[0], {**data, "entry_credential": ENTRY_CREDENTIALS[str(pid)]}, *args[2:])
    return args

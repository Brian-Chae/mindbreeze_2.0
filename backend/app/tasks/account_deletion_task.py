"""SDD-220 — 탈퇴 후속 작업 묶음(소셜 연결 해제 재시도 · 삭제 요청 알림 · 30일 영구 삭제)."""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy.orm import Session as DBSession

from app.services import account_deletion_service
from app.services.account_deletion_sweep_service import run_account_deletion_sweep


def run_account_deletion_cycle(
    db: DBSession, *, execute: bool, process_outbox: bool = True, now=None
) -> dict[str, Any]:
    """탈퇴 후속 작업 1회.

    - ``process_outbox``: 소셜 연결 해제 재시도·공개 삭제 요청 알림 메일(비파괴 운영 작업). 스위프 활성 여부와 무관하게 처리한다.
    - ``execute``: 30일 영구 삭제. False(기본)면 외부 호출·DB 쓰기 없이 후보만 보고한다.
    """
    report: dict[str, Any] = {"execute": execute, "process_outbox": process_outbox}
    if process_outbox:
        report["revoke"] = asyncio.run(account_deletion_service.process_revoke_outbox(db, now=now))
        report["notices"] = account_deletion_service.deliver_pending_request_notices(db)
    report["sweep"] = run_account_deletion_sweep(db, now=now, execute=execute)
    return report

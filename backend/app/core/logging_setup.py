"""SDD-285 S5 — 앱 로거(`app.*`) INFO 출력 설정.

배경: uvicorn 은 자기 로거(uvicorn.*)만 설정하고 root 는 건드리지 않아, `app.*` 의 INFO 로그
(`[ingest-batch]` 등)는 핸들러가 없어 어디에도 나가지 않았다(WARNING 이상만 lastResort 로 stderr 출력).
여기서 `app` 로거에 stderr 핸들러를 한 번만 붙인다(uvicorn 과 같은 `INFO:     메시지` 모양, 시각은 journald 가 붙인다).

- 멱등: 여러 번 불러도 핸들러는 하나. root 에 이미 핸들러가 있으면(celery·pytest 등) 중복 출력을 피하려고 건드리지 않는다.
- 레벨은 환경변수 `APP_LOG_LEVEL`(기본 INFO)로 바꿀 수 있다.
- 용량: `[ingest-batch]` 는 요청당 1줄(약 200바이트). 시간당 4,000~10,000건이면 0.8~2MB/시간 수준.
"""

from __future__ import annotations

import logging
import os
import sys

_HANDLER_NAME = "mindbreeze-app-stderr"


def _formatter() -> logging.Formatter:
    try:
        from uvicorn.logging import DefaultFormatter

        return DefaultFormatter("%(levelprefix)s %(name)s: %(message)s", use_colors=False)
    except Exception:  # noqa: BLE001 — uvicorn 이 없는 환경(워커·시험)에서는 같은 모양을 직접 만든다
        return logging.Formatter("%(levelname)s:     %(name)s: %(message)s")


def configure_app_logging() -> bool:
    """`app` 로거에 INFO 핸들러를 붙인다. 새로 붙였으면 True, 이미 있거나 건너뛰면 False."""
    app_logger = logging.getLogger("app")
    level_name = (os.environ.get("APP_LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    if not isinstance(level, int):
        level = logging.INFO
    if any(getattr(h, "name", None) == _HANDLER_NAME for h in app_logger.handlers):
        app_logger.setLevel(level)
        return False
    if logging.getLogger().handlers:
        # 상위(root)가 이미 출력한다 — 중복을 피하고 레벨만 맞춘다.
        app_logger.setLevel(level)
        return False
    handler = logging.StreamHandler(sys.stderr)
    handler.set_name(_HANDLER_NAME)
    handler.setFormatter(_formatter())
    app_logger.addHandler(handler)
    app_logger.setLevel(level)
    return True

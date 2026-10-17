"""로그 민감값 마스킹 (SDD-209 B4 / BE-4 · RV3-11).

클래스 입장 코드(4자리)는 짧아 로그에 남으면 곧바로 입장 수단이 된다. 로그 레코드 생성 시점에
URL 경로의 ``/by-code/<코드>`` 와 ``access_code=<값>`` 형태를 마스킹한다(uvicorn 접근 로그 포함).
레코드 팩토리를 감싸 모든 로거에 적용되며, 이미 마스킹된 값은 건드리지 않는다.
"""

from __future__ import annotations

import logging
import re

_REDACTED = "[REDACTED]"
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(/by-code/)[^/?#\s\"']+"), rf"\g<1>{_REDACTED}"),
    (re.compile(r"(access_code['\"]?\s*[=:]\s*['\"]?)[0-9A-Za-z]{4,6}"), rf"\g<1>{_REDACTED}"),
)

_installed = False


def redact(text: str) -> str:
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


def install_log_redaction() -> None:
    """로그 레코드 팩토리를 한 번만 감싼다(멱등)."""
    global _installed
    if _installed:
        return
    _installed = True
    original_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):  # noqa: ANN002, ANN003
        record = original_factory(*args, **kwargs)
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
            elif isinstance(record.args, dict):
                record.args = {k: redact(v) if isinstance(v, str) else v for k, v in record.args.items()}
        return record

    logging.setLogRecordFactory(factory)

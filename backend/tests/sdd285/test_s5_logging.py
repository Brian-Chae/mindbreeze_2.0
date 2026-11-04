"""SDD-285 S5 — `app.*` INFO 로그가 실제 stderr 로 나가는지(별도 프로세스, pytest 로깅 핸들러 영향 배제)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).parents[2]


def _run(code: str, env_extra: dict | None = None) -> subprocess.CompletedProcess:
    import os

    env = {**os.environ, **(env_extra or {})}
    return subprocess.run([sys.executable, "-I", "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True,
                          # -I 는 cwd 를 sys.path 에 넣지 않으므로 직접 추가
                          )


PRE = f"import sys; sys.path.insert(0, {str(BACKEND)!r}); import logging; "


def test_S5_without_setup_info_is_silent():
    p = _run(PRE + "logging.getLogger('app.api.v1.session').info('[ingest-batch] silent')")
    assert "[ingest-batch]" not in p.stderr  # 설정 전 기준선: INFO 는 나가지 않는다


def test_S5_setup_emits_ingest_batch_info_once():
    code = PRE + (
        "from app.core.logging_setup import configure_app_logging as c; "
        "assert c() is True; assert c() is False; "  # 멱등
        "logging.getLogger('app.api.v1.session').info('[ingest-batch] session=%s windows=%d', 'abc', 3)"
    )
    p = _run(code)
    assert p.returncode == 0, p.stderr
    lines = [ln for ln in p.stderr.splitlines() if "[ingest-batch]" in ln]
    assert len(lines) == 1, p.stderr  # 핸들러 중복으로 두 번 찍히지 않는다
    assert lines[0].startswith("INFO:"), lines[0]  # uvicorn 과 같은 접두


def test_S5_level_env_override():
    code = PRE + (
        "from app.core.logging_setup import configure_app_logging as c; c(); "
        "logging.getLogger('app.x').info('hidden'); logging.getLogger('app.x').warning('shown')"
    )
    p = _run(code, {"APP_LOG_LEVEL": "WARNING"})
    assert "shown" in p.stderr and "hidden" not in p.stderr

"""[MB261026][FIX] 심사 전용 계정 운영 시드(seed_store_review_ops.py) — PostgreSQL 검증 (verify.md B1~B11).

로컬 PG 에서만 실행한다(`PG_SMOKE=1`, conftest 가 로컬 호스트만 허용). 기록 시험은 바깥 트랜잭션 연결에 묶어 끝에 롤백한다.
발송·외부 부수효과는 "실패"가 아니라 "호출 자체가 없음"(mock 호출 0회)으로 고정한다.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import stat
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session as OrmSession

from tests.pg.conftest import BACKEND

pytestmark = pytest.mark.pg

SCRIPTS = BACKEND / "scripts"
# 이 시드가 만드는 행(신규 DB 기준). 나머지 테이블은 변화가 0이어야 한다.
EXPECTED_DELTA = {
    "users": 2, "onboarding_progress": 2, "counselor_profiles": 1, "classes": 1, "class_instructors": 1,
    "class_members": 1, "sessions": 1, "session_participants": 1, "eeg_feature_windows": 60, "reports": 2,
}


def ops():
    sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location("seed_store_review_ops", SCRIPTS / "seed_store_review_ops.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def native_pg_arrays(monkeypatch: pytest.MonkeyPatch):
    """전체 PG 수집 중 다른 시험이 루트(SQLite) conftest 를 불러오면 ARRAY 변환기가 JSON 문자열로 전역 패치된다
    (test_sdd217_consent_retention.py 의 같은 주석 참고). 이 시험에서는 psycopg2 기본 배열 변환으로 되돌린다."""
    from sqlalchemy.dialects.postgresql import ARRAY

    if getattr(ARRAY.bind_processor, "__module__", "").startswith("tests"):
        monkeypatch.setattr(ARRAY, "bind_processor", lambda self, dialect: None)
        monkeypatch.setattr(ARRAY, "result_processor", lambda self, dialect, coltype: None)
    yield


@pytest.fixture(autouse=True)
def forbid_side_effects(monkeypatch: pytest.MonkeyPatch):
    """메일·푸시·웹푸시·Celery 적재·HTTP·S3 호출을 모두 가로채 호출 0회를 확인한다."""
    import httpx
    import requests
    import boto3
    from celery.app.task import Task
    from app.tasks import email as email_tasks
    from app.services import notification_service, push_service, web_push_service, report_email_service

    called = Mock(side_effect=AssertionError("발송·외부 호출 금지"))
    targets = [
        (email_tasks, "_send_email"), (notification_service, "_send_email"),
        (push_service, "send_to_token"), (web_push_service, "send_to_subscription"),
        (report_email_service, "enqueue_report_email"), (report_email_service, "enqueue_report_generation"),
        (Task, "apply_async"), (Task, "delay"),
        (httpx.HTTPTransport, "handle_request"), (httpx.AsyncHTTPTransport, "handle_async_request"),
        (requests.Session, "send"), (boto3, "client"), (boto3, "resource"),
    ]
    for owner, name in targets:
        monkeypatch.setattr(owner, name, called)
    yield called
    assert called.call_count == 0, f"발송·외부 호출 {called.call_count}회"


def table_counts(conn: Connection) -> dict[str, int]:
    names = conn.execute(sa.text(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
        " AND table_name <> 'alembic_version' ORDER BY table_name"
    )).scalars().all()
    return {n: conn.execute(sa.text(f'SELECT count(*) FROM "{n}"')).scalar_one() for n in names}


def delta(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    return {k: after[k] - before[k] for k in after if after[k] != before.get(k)}


def url_of(engine: Engine) -> str:
    return engine.url.render_as_string(hide_password=False)


def read_file(path: Path) -> dict[str, str]:
    return {a["email"]: a["password"] for a in json.loads(path.read_text(encoding="utf-8"))["accounts"]}


def users_by_email(conn: Connection) -> dict:
    from app.models.user import User

    db = OrmSession(bind=conn, join_transaction_mode="create_savepoint")
    return {u.email: u for u in db.query(User).filter(User.email.like("store-review-%")).all()}


# ── B9 가드 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("environment,url", [
    ("production", "postgresql://u:p@127.0.0.1:5432/db"),
    ("development", "postgresql://u:p@mindbreeze-prod.abc.ap-northeast-1.rds.amazonaws.com/db"),
    ("development", "postgresql://u:p@127.0.0.1/db?host=mindbreeze-prod.example"),
    ("development", "sqlite:///test_store_review_x.db"),
])
def test_guard_rejects_before_connect(environment: str, url: str, tmp_path: Path) -> None:
    module = ops()
    factory = Mock(side_effect=AssertionError("접속 금지"))
    with pytest.raises(ValueError):
        module.run(url, environment, do_apply=True, secrets_path=tmp_path / "s.json", engine_factory=factory)
    factory.assert_not_called()


def test_guard_allows_only_with_explicit_flag() -> None:
    module = ops()
    prod = "postgresql://u:p@mindbreeze-prod.abc.ap-northeast-1.rds.amazonaws.com/db"
    assert module.require_ops_target("production", prod, allow_production=True) == "production"
    assert module.require_ops_target("development",
                                     "postgresql://u:p@mindbreeze-dev.abc.ap-northeast-1.rds.amazonaws.com/db",
                                     allow_production=False) == "dev"
    assert module.require_ops_target("test", "postgresql://u:p@localhost/db", allow_production=False) == "local"
    # 운영 환경이면 로컬 주소여도 플래그가 필요하다.
    with pytest.raises(ValueError):
        module.require_ops_target("prod", "postgresql://u:p@localhost/db", allow_production=False)


# ── B1 dry-run ─────────────────────────────────────────────────────────


def test_dry_run_reads_only(pg_engine: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    module = ops()
    secrets = tmp_path / ".secrets" / "store-review-accounts.json"
    with pg_engine.connect() as conn:
        before = table_counts(conn)
    result = module.run(url_of(pg_engine), "test", secrets_path=secrets)
    with pg_engine.connect() as conn:
        assert table_counts(conn) == before
    assert result["dry_run"] is True
    assert {a["action"] for a in result["accounts"]} == {"create"}
    assert result["content_rows_to_create"] == module_content_total()
    assert not secrets.exists() and not secrets.parent.exists()

    # 계획 단계에 쓰기가 섞여도 읽기 전용 트랜잭션이 거부한다.
    def writing_plan(db, stored):
        db.execute(sa.text("CREATE TEMP TABLE should_fail(x int)"))
        return {}
    monkeypatch.setattr(module, "plan", writing_plan)
    with pytest.raises(sa.exc.DBAPIError):
        module.run(url_of(pg_engine), "test", secrets_path=secrets)


def module_content_total() -> int:
    sys.path.insert(0, str(SCRIPTS))
    from seed_store_review import CONTENT_ROWS_TOTAL

    return CONTENT_ROWS_TOTAL


# ── B2~B8 apply ────────────────────────────────────────────────────────


def test_apply_idempotent_rotation_and_no_side_effects(
    pg_engine: Engine, pg_conn: Connection, tmp_path: Path, capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.core.security import verify_password
    from app.services import notification_service

    caplog.set_level(logging.DEBUG)
    module = ops()
    secrets = tmp_path / ".secrets" / "store-review-accounts.json"
    bind = lambda _url: pg_conn  # noqa: E731 — 바깥 트랜잭션에 묶어 끝에 롤백
    url = url_of(pg_engine)

    before = table_counts(pg_conn)
    first = module.run(url, "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    after_first = table_counts(pg_conn)
    assert delta(before, after_first) == EXPECTED_DELTA  # 발송·알림·outbox·토큰 테이블 변화 0 포함
    assert [a["action"] for a in first["accounts"]] == ["create", "create"]

    # B5 권한
    assert stat.S_IMODE(os.stat(secrets).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(secrets.parent).st_mode) == 0o700
    passwords = read_file(secrets)
    assert set(passwords) == {"store-review-counselor@example.com", "store-review-client@example.com"}

    users = users_by_email(pg_conn)
    for email, password in passwords.items():
        user = users[email]
        assert verify_password(password, user.password_hash) and user.status == "active"
        # B8 이메일·푸시 억제: 모든 이벤트에서 발송 요청이 생기지 않는다.
        prefs = notification_service.get_user_preferences(user)
        assert not any(prefs["email"].values()) and not any(prefs["push"].values())
        for event in notification_service.EVENT_CATALOG:
            assert notification_service.email_requested(event, user.id, OrmSession(bind=pg_conn)) is False

    # B3 재실행: 행 중복 0, 비밀번호 유지
    second = module.run(url, "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    assert table_counts(pg_conn) == after_first
    assert [a["password"] for a in second["accounts"]] == ["keep", "keep"]
    assert second["content_rows_created"] == 0
    assert read_file(secrets) == passwords

    # B4 비밀 파일이 없으면 행 중복 없이 비밀번호만 새로 발급
    secrets.unlink()
    third = module.run(url, "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    assert table_counts(pg_conn) == after_first
    assert [a["password"] for a in third["accounts"]] == ["new", "new"]
    rotated = read_file(secrets)
    assert all(rotated[e] != passwords[e] for e in passwords)
    users = users_by_email(pg_conn)
    assert all(verify_password(rotated[e], users[e].password_hash) for e in rotated)

    # B6 비밀번호가 화면·로그·요약에 나오지 않는다.
    summary = module.format_result(third, secrets)
    out = capsys.readouterr()
    logs = "\n".join(r.getMessage() for r in caplog.records)
    for secret in [*passwords.values(), *rotated.values()]:
        assert secret not in summary and secret not in out.out and secret not in out.err and secret not in logs


def test_deleted_account_not_revived(pg_engine: Engine, pg_conn: Connection, tmp_path: Path) -> None:
    module = ops()
    secrets = tmp_path / "s.json"
    bind = lambda _url: pg_conn  # noqa: E731
    module.run(url_of(pg_engine), "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    old_hash = pg_conn.execute(sa.text(
        "UPDATE users SET status='deleted' WHERE email='store-review-counselor@example.com' RETURNING password_hash"
    )).scalar_one()
    result = module.run(url_of(pg_engine), "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    assert result["accounts"][0] == {"role": "counselor", "email": "store-review-counselor-1@example.com",
                                     "action": "create", "password": "new"}
    row = pg_conn.execute(sa.text(
        "SELECT status, password_hash FROM users WHERE email='store-review-counselor@example.com'")).one()
    assert row.status == "deleted" and row.password_hash == old_hash
    assert set(read_file(secrets)) == {"store-review-counselor-1@example.com", "store-review-client@example.com"}


def test_deactivate_then_reactivate(pg_engine: Engine, pg_conn: Connection, tmp_path: Path) -> None:
    module = ops()
    secrets = tmp_path / "s.json"
    bind = lambda _url: pg_conn  # noqa: E731
    url = url_of(pg_engine)
    module.run(url, "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    passwords = read_file(secrets)
    before = table_counts(pg_conn)

    preview = module.run(url, "test", do_deactivate=True, secrets_path=secrets, engine_factory=bind)
    assert preview["dry_run"] and len(preview["deactivate"]) == 2
    assert table_counts(pg_conn) == before
    statuses = lambda: dict(pg_conn.execute(sa.text(  # noqa: E731
        "SELECT email, status FROM users WHERE email LIKE 'store-review-%'")).all())
    assert set(statuses().values()) == {"active"}

    module.run(url, "test", do_apply=True, do_deactivate=True, secrets_path=secrets, engine_factory=bind)
    assert set(statuses().values()) == {"suspended"}  # 로그인은 auth.login 이 suspended 를 403 으로 막는다

    again = module.run(url, "test", do_apply=True, secrets_path=secrets, engine_factory=bind)
    assert [a["action"] for a in again["accounts"]] == ["reactivate", "reactivate"]
    assert [a["password"] for a in again["accounts"]] == ["keep", "keep"]
    assert set(statuses().values()) == {"active"} and read_file(secrets) == passwords

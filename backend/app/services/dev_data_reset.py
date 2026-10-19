"""SDD-214 Z1 — 데이터 초기화(Z 트랙) 서비스.

정식 릴리스 전 전제에서 기존 데이터를 지우고 새 구조로 시작하기 위한 일회성 절차의 로직.
CLI(`scripts/reset_dev_data.py`)가 얇게 감싼다. 이 모듈은 설정(app.config)을 읽지 않고, 접속 문자열·
개인정보를 어떤 결과·오류에도 담지 않는다(건수와 테이블명만).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Engine, make_url

Scope = Literal["all", "sessions"]
Env = Literal["local", "dev", "prod"]

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
PRESERVED_TABLE = "alembic_version"

# scope=sessions(prod 권고: 계정·기관 유지, 세션 계열 삭제)에서 지우는 테이블.
SESSIONS_SCOPE_DELETE = frozenset({
    "agent_relay_events", "audio_chunks", "chat_message_reads", "chat_messages", "chat_room_participants",
    "chat_rooms", "class_instructors", "class_member_events", "class_members", "classes",
    "class_effects", "class_email_invites", "class_operations", "session_host_notes", "session_host_requests",
    # SDD-217: 클래스/참가행 FK에 종속된 운영 상태·자격·멱등 결과만 함께 정리한다.
    "class_makeup_assignments", "class_guest_credentials", "class_guest_recoveries",
    "class_member_operations", "class_guest_join_operations", "session_presence_leases",
    "counseling_guests", "counseling_relationship_counselors", "counseling_relationship_events",
    "counseling_relationships", "eeg_feature_windows", "eeg_raw_chunks", "eeg_records", "guest_claim_events",
    "narrative_cache", "notification_outbox", "notifications", "pipeline_outbox", "report_choice_events",
    "reports", "session_email_invites", "session_host_history", "session_participants", "session_records",
    "session_reminder_logs", "sessions", "video_chunks",
})

# scope=sessions 에서 보존하는 테이블(계정·기관·인증·에이전트·연구·감사).
SESSIONS_SCOPE_KEEP = frozenset({
    # SDD-217: FK 없이 보존하는 감사 원본. TRUNCATE는 행 DELETE 트리거를 거치지 않으므로 제외한다.
    "class_attendance_events", "class_guest_merges", "class_member_consent_events",
    "agent_briefing_logs", "agent_checkin_enablements", "agent_checkin_prefs", "agent_checkins",
    "agent_conversations", "agent_counselor_settings", "agent_delivery_logs", "agent_memory_items",
    "agent_messages", "agent_profile_items", "agent_risk_signals", "careers", "client_counselor_links",
    "client_invites", "client_profiles", "consents", "counselor_profiles", "credentials", "data_export_audits",
    "data_export_jobs", "device_tokens", "normalization_baselines", "normalization_models", "onboarding_progress",
    "org_documents", "org_join_requests", "organizations", "original_deletion_audits", "password_history",
    "qualifications", "refresh_tokens", "research_consent_events", "research_consents", "research_export_batches",
    "research_export_items", "research_withdrawal_requests", "retention_sweep_runs", "signup_applications",
    "user_org_memberships", "users", "verification_audits",
})


class ResetGuardError(RuntimeError):
    """안전장치가 삭제를 막았다. 메시지에 접속 문자열·호스트·비밀번호를 담지 않는다."""


# ── 환경·플래그 가드 ──────────────────────────────────────────────────────────


def classify_target(
    database_url: str,
    *,
    allowed_hosts: Iterable[str],
    prod_hosts: Iterable[str] = (),
    allow_prod: bool = False,
) -> Env:
    """대상 DB 가 초기화해도 되는 환경인지 판정한다. 허용 목록 밖이거나 prod 면 예외."""
    host = (make_url(database_url).host or "").lower()
    allowed = {h.lower() for h in allowed_hosts}
    is_local = host == "" or host.startswith("/") or host in LOCAL_HOSTS
    is_prod = not is_local and (host in {h.lower() for h in prod_hosts} or "prod" in host)
    if is_prod:
        if not allow_prod:
            raise ResetGuardError("대상이 prod 로 판정되어 거부한다(--allow-prod 와 허용 목록이 모두 필요)")
        if host not in allowed:
            raise ResetGuardError("prod 호스트가 허용 목록에 없다")
        return "prod"
    if is_local:
        return "local"
    if host not in allowed:
        raise ResetGuardError("대상 호스트가 허용 목록에 없다(--allow-host 또는 RESET_ALLOWED_HOSTS)")
    return "dev"


def check_apply_flags(*, apply: bool, confirmed: bool, env: Env, scope: Scope) -> None:
    """삭제 실행 조건: --apply 와 --i-understand-this-deletes-data 를 모두 명시, prod 는 scope=sessions 만."""
    if confirmed and not apply:
        raise ResetGuardError("확인 플래그만으로는 삭제하지 않는다: --apply 가 함께 필요하다")
    if not apply:
        return
    if not confirmed:
        raise ResetGuardError("삭제하려면 --apply 와 --i-understand-this-deletes-data 를 모두 지정해야 한다")
    if env == "prod" and scope != "sessions":
        raise ResetGuardError("prod 는 --scope sessions(계정·기관 유지)만 허용한다")


# ── DB ───────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ResetReport:
    scope: str
    applied: bool
    table_counts: dict[str, int] = field(default_factory=dict)

    @property
    def total_rows(self) -> int:
        return sum(self.table_counts.values())


def _quote(engine: Engine, name: str) -> str:
    return engine.dialect.identifier_preparer.quote(name)


def _count(conn: sa.Connection, engine: Engine, tables: Iterable[str]) -> dict[str, int]:
    return {t: conn.execute(sa.text(f"select count(*) from {_quote(engine, t)}")).scalar_one() for t in tables}


def _kept_referencing_deleted(conn: sa.Connection, deleted: set[str]) -> list[str]:
    rows = conn.execute(sa.text(
        "select distinct c.conrelid::regclass::text, c.confrelid::regclass::text from pg_constraint c "
        "where c.contype = 'f' and c.connamespace = 'public'::regnamespace"
    )).all()
    return sorted({child.strip('"') for child, parent in rows if parent.strip('"') in deleted and child.strip('"') not in deleted})


def plan_tables(conn: sa.Connection, scope: Scope, keep_tables: Iterable[str] | None = None) -> list[str]:
    """scope 에 따라 삭제할 테이블 목록. 분류되지 않은 테이블·보존 테이블의 삭제 테이블 참조는 예외."""
    present = sorted(t for t in sa.inspect(conn).get_table_names() if t != PRESERVED_TABLE)
    if scope == "all":
        return present
    keep = frozenset(keep_tables) if keep_tables is not None else SESSIONS_SCOPE_KEEP
    unclassified = [t for t in present if t not in SESSIONS_SCOPE_DELETE and t not in keep]
    if unclassified:
        raise ResetGuardError(f"scope=sessions 가 분류하지 않은 테이블이 있다: {', '.join(unclassified)}")
    deleted = [t for t in present if t in SESSIONS_SCOPE_DELETE]
    offenders = _kept_referencing_deleted(conn, set(deleted))
    if offenders:
        raise ResetGuardError(f"보존 테이블이 삭제 테이블을 참조한다: {', '.join(offenders)}")
    return deleted


def reset_database(
    engine: Engine, *, scope: Scope, apply: bool, keep_tables: Iterable[str] | None = None
) -> ResetReport:
    """dry-run 이면 삭제 대상 건수만 센다. apply 면 한 트랜잭션에서 TRUNCATE 하고 0행을 확인한다."""
    with engine.begin() as conn:
        tables = plan_tables(conn, scope, keep_tables)
        counts = _count(conn, engine, tables)
        if not apply or not tables:
            return ResetReport(scope=scope, applied=apply, table_counts=counts)
        conn.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
        names = ", ".join(_quote(engine, t) for t in tables)
        conn.execute(sa.text(f"TRUNCATE TABLE {names} RESTART IDENTITY"))
        remaining = {t: n for t, n in _count(conn, engine, tables).items() if n}
        if remaining:
            raise ResetGuardError(f"삭제 후에도 행이 남은 테이블이 있어 롤백한다: {', '.join(sorted(remaining))}")
    return ResetReport(scope=scope, applied=True, table_counts=counts)


# ── Redis · S3 ───────────────────────────────────────────────────────────────


class RedisLike(Protocol):
    def dbsize(self) -> int: ...
    def flushdb(self) -> object: ...


def reset_redis(client: RedisLike, *, apply: bool) -> int:
    """접속한 Redis DB(번호) 하나의 키 수를 돌려주고, apply 면 그 DB 만 비운다."""
    n = int(client.dbsize())
    if apply:
        client.flushdb()
    return n


class PrefixStore(Protocol):
    def count_prefix(self, bucket: str, prefix: str) -> int: ...
    def delete_prefix(self, bucket: str, prefix: str) -> int: ...


def _check_prefix(prefix: str) -> None:
    if not prefix or prefix.startswith("/") or not prefix.endswith("/") or "//" in prefix:
        raise ResetGuardError("S3 프리픽스는 비어 있지 않고 '/'로 끝나며 '/'로 시작하거나 '//'를 포함하지 않아야 한다")


def reset_s3(store: PrefixStore, *, bucket: str, prefixes: Iterable[str], apply: bool) -> dict[str, int]:
    """프리픽스별 오브젝트 수를 돌려주고, apply 면 해당 프리픽스 아래만 삭제한다(버킷·타 프리픽스 불변)."""
    prefixes = tuple(prefixes)
    for p in prefixes:
        _check_prefix(p)
    return {
        p: (store.delete_prefix(bucket, p) if apply else store.count_prefix(bucket, p)) for p in prefixes
    }


class Boto3PrefixStore:
    """boto3 S3 클라이언트로 프리픽스 단위 건수·삭제를 수행하는 어댑터."""

    def __init__(self, client: object) -> None:
        self._client = client

    def _keys(self, bucket: str, prefix: str):
        paginator = self._client.get_paginator("list_objects_v2")  # type: ignore[attr-defined]
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield obj["Key"]

    def count_prefix(self, bucket: str, prefix: str) -> int:
        return sum(1 for _ in self._keys(bucket, prefix))

    def delete_prefix(self, bucket: str, prefix: str) -> int:
        deleted, batch = 0, []
        for key in self._keys(bucket, prefix):
            batch.append({"Key": key})
            if len(batch) == 1000:
                self._client.delete_objects(Bucket=bucket, Delete={"Objects": batch})  # type: ignore[attr-defined]
                deleted, batch = deleted + len(batch), []
        if batch:
            self._client.delete_objects(Bucket=bucket, Delete={"Objects": batch})  # type: ignore[attr-defined]
            deleted += len(batch)
        return deleted

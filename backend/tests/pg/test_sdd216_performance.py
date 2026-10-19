"""합성 100클래스×52회·20강사의 충돌 조회 수·계획·지연 기록."""

import json
import math
from datetime import timedelta
from statistics import median
from time import perf_counter

import pytest
from sqlalchemy import event
from app.models.class_program import Class, ClassInstructor
from app.models.session import Session
from app.schemas.class_scheduling import ScheduleRow
from app.services.class_conflict_service import detect_conflicts_bulk
from tests.pg.sdd216_helpers import world, user
from tests.pg.test_sdd216_write import NOW

pytestmark = pytest.mark.pg


def test_bulk_conflict_query_count_and_synthetic_latency(pg_session):
    org, a, b, first = world(pg_session)
    hosts = [a, b] + [user(pg_session, org) for _ in range(18)]
    viewer = user(pg_session, org, role="org_admin")
    parents = [first]
    for i in range(1, 100):
        cls = Class(
            created_by=hosts[i % 20].id,
            organization_id=org.id,
            organization_attribution_known=True,
            title=f"합성 부하 {i}",
            default_duration_min=60,
        )
        pg_session.add(cls)
        parents.append(cls)
    pg_session.flush()
    pg_session.add_all(
        [
            ClassInstructor(class_id=cls.id, user_id=hosts[i % 20].id)
            for i, cls in enumerate(parents)
            if i
        ]
    )
    pg_session.flush()
    pg_session.add_all(
        [
            Session(
                type="meditation",
                class_id=cls.id,
                host_id=hosts[i % 20].id,
                seq=j + 1,
                status="scheduled",
                host_state="assigned",
                duration_min=60,
                location_type="online",
                scheduled_at=NOW + timedelta(days=7 * j, hours=9),
            )
            for i, cls in enumerate(parents)
            for j in range(52)
        ]
    )
    pg_session.flush()
    statements = []

    def capture(conn, cursor, statement, params, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append((statement, params))

    metrics = []
    for size in (8, 52):
        rows = [
            ScheduleRow(
                client_key=str(j),
                seq=j + 1,
                host_id=hosts[j % 20].id,
                scheduled_at=NOW + timedelta(days=7 * j, hours=9),
                duration_min=60,
                location_type="online",
            )
            for j in range(size)
        ]
        timings, query_counts, range_statement = [], [], None
        event.listen(pg_session.bind, "before_cursor_execute", capture)
        try:
            for _ in range(20):
                statements.clear()
                start = perf_counter()
                conflicts = detect_conflicts_bulk(
                    pg_session, rows, set(), {"id": str(viewer.id), "role": "org_admin"}
                )
                timings.append((perf_counter() - start) * 1000)
                query_counts.append(len(statements))
                ranged = [
                    (sql, args) for sql, args in statements if "FROM sessions" in sql
                ]
                assert len(ranged) == 1
                range_statement = ranged[0]
                assert len(conflicts) == size * 5
                assert all(item.kind == "host" for item in conflicts)
        finally:
            event.remove(pg_session.bind, "before_cursor_execute", capture)
        assert max(query_counts) == min(query_counts) == 4
        sql, params = range_statement
        plan = (
            pg_session.connection()
            .exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS) " + sql, params)
            .scalars()
            .all()
        )
        metrics.append(
            {
                "candidates": size,
                "samples": 20,
                "selects": 4,
                "p50_ms": round(median(timings), 2),
                "p95_ms": round(sorted(timings)[math.ceil(0.95 * len(timings)) - 1], 2),
                "explain": plan,
            }
        )
    print("SDD216_SYNTHETIC_PERFORMANCE=" + json.dumps(metrics, ensure_ascii=False))

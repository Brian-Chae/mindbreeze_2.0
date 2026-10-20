"""SDD-218 C4·C5·B5: 실제 PG 스키마와 DB 수준 멱등 보장.

SQLite create_all 로는 보이지 않는 것만 여기서 본다.
- 058 이 만든 제약·인덱스가 실제로 걸려 있는가
- (job_id, report_id) 유니크가 워커 중복 처리를 DB 수준에서 막는가
- 기존 reports 식별·FK 가 보존됐는가
"""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

pytestmark = pytest.mark.pg

NEW_TABLES = {"class_report_jobs", "class_report_job_items"}


def test_c5_058_테이블과_제약이_실제로_걸려_있다(pg_conn):
    schema = inspect(pg_conn)
    assert NEW_TABLES <= set(schema.get_table_names())

    # 접수 멱등: 같은 actor 가 같은 operation_key 를 두 번 쓸 수 없다.
    assert ("actor_id", "operation_key") in {
        tuple(u["column_names"]) for u in schema.get_unique_constraints("class_report_jobs")
    }
    # 건별 멱등: 한 작업 안에서 같은 리포트를 두 번 처리할 수 없다.
    assert ("job_id", "report_id") in {
        tuple(u["column_names"]) for u in schema.get_unique_constraints("class_report_job_items")
    }

    checks = {
        r[0]
        for r in pg_conn.execute(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid::regclass::text LIKE 'class_report_job%' AND contype='c'"
            )
        )
    }
    assert {
        "ck_class_report_jobs_action",
        "ck_class_report_jobs_status",
        "ck_class_report_job_items_state",
    } <= checks


def test_상태값_체크제약이_잘못된_값을_막는다(pg_conn, pg_seed_job):
    job_id, _ = pg_seed_job
    with pytest.raises(IntegrityError):
        pg_conn.execute(
            text(
                "INSERT INTO class_report_job_items (id, job_id, report_id, state) "
                "VALUES (:id, :job, :report, 'wat')"
            ),
            {"id": uuid4(), "job": job_id, "report": uuid4()},
        )


def test_b5_같은_작업에_같은_리포트를_두_번_넣을_수_없다(pg_conn, pg_seed_job):
    """워커가 같은 건을 중복 처리하려 해도 DB 가 막는다."""
    job_id, report_id = pg_seed_job
    pg_conn.execute(
        text(
            "INSERT INTO class_report_job_items (id, job_id, report_id, state) "
            "VALUES (:id, :job, :report, 'pending')"
        ),
        {"id": uuid4(), "job": job_id, "report": report_id},
    )
    with pytest.raises(IntegrityError):
        pg_conn.execute(
            text(
                "INSERT INTO class_report_job_items (id, job_id, report_id, state) "
                "VALUES (:id, :job, :report, 'pending')"
            ),
            {"id": uuid4(), "job": job_id, "report": report_id},
        )


def test_b1_같은_actor와_operation_key는_한_번만_접수된다(pg_conn, pg_seed_job):
    job_id, _ = pg_seed_job
    row = pg_conn.execute(
        text("SELECT class_id, actor_id, operation_key FROM class_report_jobs WHERE id=:id"),
        {"id": job_id},
    ).one()
    with pytest.raises(IntegrityError):
        pg_conn.execute(
            text(
                "INSERT INTO class_report_jobs "
                "(id, class_id, action, status, actor_id, operation_key, request_hash) "
                "VALUES (:id, :cls, 'approve', 'accepted', :actor, :key, 'other-hash')"
            ),
            {"id": uuid4(), "cls": row.class_id, "actor": row.actor_id, "key": row.operation_key},
        )


def test_c4_기존_리포트_식별과_승인_컬럼이_보존된다(pg_conn):
    """218 은 reports 를 건드리지 않는다."""
    columns = {c["name"] for c in inspect(pg_conn).get_columns("reports")}
    assert {"session_id", "participant_id", "type", "approved_by_user_id", "approved_at"} <= columns


def test_작업_삭제_시_건별_결과만_함께_지워진다(pg_conn, pg_seed_job):
    """job → items 는 CASCADE, items → reports 는 RESTRICT 다."""
    job_id, report_id = pg_seed_job
    pg_conn.execute(
        text(
            "INSERT INTO class_report_job_items (id, job_id, report_id, state) "
            "VALUES (:id, :job, :report, 'pending')"
        ),
        {"id": uuid4(), "job": job_id, "report": report_id},
    )
    pg_conn.execute(text("DELETE FROM class_report_jobs WHERE id=:id"), {"id": job_id})
    left = pg_conn.execute(
        text("SELECT count(*) FROM class_report_job_items WHERE job_id=:id"), {"id": job_id}
    ).scalar_one()
    assert left == 0
    # 리포트 원본은 남는다.
    assert pg_conn.execute(
        text("SELECT count(*) FROM reports WHERE id=:id"), {"id": report_id}
    ).scalar_one() == 1


@pytest.fixture
def pg_seed_job(pg_conn):
    """클래스·회차·리포트·작업을 최소로 심는다. 트랜잭션은 테스트 종료 시 롤백된다."""
    now = datetime.now(timezone.utc)
    org_id, user_id, class_id, session_id, report_id, job_id = (uuid4() for _ in range(6))

    pg_conn.execute(
        text(
            "INSERT INTO organizations (id, name, kind, verified, created_at) "
            "VALUES (:id, 'PG 검증 기관', 'center', false, :now)"
        ),
        {"id": org_id, "now": now},
    )
    pg_conn.execute(
        text(
            "INSERT INTO users (id, email, name, role, status, password_hash, "
            "verified_tier, created_at) "
            "VALUES (:id, :email, '지도사', 'counselor', 'active', 'x', 'none', :now)"
        ),
        {"id": user_id, "email": f"{uuid4().hex[:10]}@example.com", "now": now},
    )
    pg_conn.execute(
        text(
            "INSERT INTO classes (id, organization_id, created_by, title, status, "
            "default_duration_min, created_at) "
            "VALUES (:id, :org, :user, 'PG 검증 클래스', 'active', 60, :now)"
        ),
        {"id": class_id, "org": org_id, "user": user_id, "now": now},
    )
    # fk_sessions_class_host(216): 회차 진행자는 클래스 강사로 등록돼 있어야 한다.
    pg_conn.execute(
        text(
            "INSERT INTO class_instructors (id, class_id, user_id, role, status) "
            "VALUES (:id, :cls, :user, 'lead', 'active')"
        ),
        {"id": uuid4(), "cls": class_id, "user": user_id},
    )
    pg_conn.execute(
        text(
            # ck_sessions_one_parent(214): 클래스 소속 회차는 seq·host_state 가 있어야 한다.
            "INSERT INTO sessions (id, type, status, host_id, class_id, duration_min, "
            "max_participants, seq, host_state, created_at) "
            "VALUES (:id, 'meditation', 'completed', :host, :cls, 60, 20, 1, 'assigned', :now)"
        ),
        {"id": session_id, "host": user_id, "cls": class_id, "now": now},
    )
    pg_conn.execute(
        text(
            "INSERT INTO reports (id, session_id, type, status, content, is_read, created_at) "
            "VALUES (:id, :session, 'client', 'pending_review', '{}'::jsonb, false, :now)"
        ),
        {"id": report_id, "session": session_id, "now": now},
    )
    pg_conn.execute(
        text(
            "INSERT INTO class_report_jobs "
            "(id, class_id, session_id, action, status, actor_id, operation_key, "
            " request_hash, accepted_count, created_at) "
            "VALUES (:id, :cls, :session, 'approve', 'accepted', :actor, :key, 'hash', 1, :now)"
        ),
        {
            "id": job_id,
            "cls": class_id,
            "session": session_id,
            "actor": user_id,
            "key": f"op-{uuid4().hex[:10]}",
            "now": now,
        },
    )
    return job_id, report_id

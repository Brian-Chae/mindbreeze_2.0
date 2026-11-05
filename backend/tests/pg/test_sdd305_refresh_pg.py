"""SDD-305 C9/C10: 실제 PostgreSQL 트랜잭션 경쟁에서 refresh 회전이 한 번만 일어나고 모든 요청이 같은 쌍을 받는다."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import refresh_token_service as svc
from app.core.security import create_access_token

pytestmark = pytest.mark.pg


def _seed_user(engine) -> str:
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        user = User(
            email=f"{uuid.uuid4()}@example.com", password_hash="x", name="합성", role="client", status="active"
        )
        db.add(user)
        db.commit()
        return str(user.id)
    finally:
        db.close()


def _cleanup(engine, user_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM refresh_tokens WHERE user_id = :u"), {"u": user_id})
        conn.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})


def _one_request(engine, barrier, old_jti, user_id):
    """라우터 /refresh 의 회전 부분과 같은 호출 순서(회전 시도 → 졌으면 승자 결과 조회)."""
    db = sessionmaker(bind=engine)()
    try:
        access = create_access_token(subject=user_id)
        barrier.wait()
        new_refresh = svc.rotate_refresh_token_with_result(old_jti, user_id, db, access)
        if new_refresh is not None:
            return ("rotated", access, new_refresh)
        for _ in range(50):  # 승자 커밋 전이면 짧게 재시도(실제 요청은 커밋 후 도착)
            dup = svc.load_duplicate_result(old_jti, db)
            if dup is not None:
                return ("duplicate", dup["access_token"], dup["refresh_token"])
        return ("lost", None, None)
    finally:
        db.close()


def test_c9_eight_connections_same_old_token_single_rotation_same_pair(pg_engine):
    user_id = _seed_user(pg_engine)
    try:
        Session = sessionmaker(bind=pg_engine)
        db = Session()
        svc.issue_refresh_token(user_id, db)
        old_jti = db.query(RefreshToken).filter(RefreshToken.user_id == uuid.UUID(user_id)).one().jti
        db.close()

        n = 8
        barrier = Barrier(n)
        with ThreadPoolExecutor(max_workers=n) as pool:
            results = list(pool.map(lambda _: _one_request(pg_engine, barrier, old_jti, user_id), range(n)))

        kinds = [r[0] for r in results]
        assert kinds.count("rotated") == 1, kinds
        assert "lost" not in kinds, kinds
        assert len({(r[1], r[2]) for r in results}) == 1  # 모두 같은 access·refresh
        with pg_engine.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM refresh_tokens WHERE user_id = :u"), {"u": user_id}
            ).scalar()
            alive = conn.execute(
                text("SELECT count(*) FROM refresh_tokens WHERE user_id = :u AND revoked_at IS NULL"),
                {"u": user_id},
            ).scalar()
            sealed = conn.execute(
                text("SELECT rotation_result FROM refresh_tokens WHERE jti = :j"), {"j": old_jti}
            ).scalar()
        assert total == 2 and alive == 1  # 원본 + 후속 1개, 전체 폐기 0
        assert sealed and results[0][2] not in sealed
    finally:
        _cleanup(pg_engine, user_id)


def test_c10_after_grace_load_duplicate_result_is_none(pg_engine):
    user_id = _seed_user(pg_engine)
    try:
        db = sessionmaker(bind=pg_engine)()
        svc.issue_refresh_token(user_id, db)
        old_jti = db.query(RefreshToken).filter(RefreshToken.user_id == uuid.UUID(user_id)).one().jti
        assert svc.rotate_refresh_token_with_result(old_jti, user_id, db, create_access_token(subject=user_id))
        assert svc.load_duplicate_result(old_jti, db) is not None
        db.execute(
            text("UPDATE refresh_tokens SET revoked_at = now() - make_interval(secs => :s) WHERE jti = :j"),
            {"s": svc.REUSE_GRACE_SECONDS + 3, "j": old_jti},
        )
        db.commit()
        assert svc.load_duplicate_result(old_jti, db) is None
        db.close()
    finally:
        _cleanup(pg_engine, user_id)

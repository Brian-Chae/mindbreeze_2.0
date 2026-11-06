"""SDD-302 실제 로컬 PostgreSQL에서 진행 JSON 동시 저장 검증."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread
import uuid

import pytest

from app.api.v1.onboarding import client_profile_dismiss
from app.models.onboarding_progress import OnboardingProgress
from app.models.user import User
from app.services import onboarding_service
# 기존 하네스: 로컬 호스트에만 접속, 프로세스별 임시 DB + Alembic 사용.
from tests.sdd246.commands.conftest import pg_url, pg_engine, maker  # noqa: F401


@pytest.mark.parametrize("initial_progress", [False, True])
def test_동시_최초보류와_기존단계저장은_충돌없이_모두보존(maker, monkeypatch, initial_progress):
    with maker() as db:
        user = User(email=f"sdd302-{uuid.uuid4().hex}@example.test", password_hash="x", name="합성회원", role="client")
        db.add(user)
        db.flush()
        user_id = user.id
        if initial_progress:
            db.add(OnboardingProgress(user_id=user_id, current_step=1, completed=True,
                                      steps={"step1": {"name": "합성회원"}}))
        db.commit()

    first_ready, release_first, second_read = Event(), Event(), Event()
    get_progress = onboarding_service.get_progress

    def observed_get_progress(uid, db):
        progress = get_progress(uid, db)
        if current_thread().name.endswith("_0"):
            first_ready.set()
            assert release_first.wait(5)
        else:
            second_read.set()
        return progress

    monkeypatch.setattr(onboarding_service, "get_progress", observed_get_progress)

    def first_write():
        with maker() as db:
            if initial_progress:
                onboarding_service.save_step(user_id, 3, {"bio": "저장한 소개"}, db)
                db.commit()
            else:
                client_profile_dismiss(current_user={"id": str(user_id)}, db=db)

    def second_write():
        with maker() as db:
            # 오래 열린 세션의 identity map에도 새 JSON을 다시 읽어야 한다.
            stale = db.query(OnboardingProgress).filter_by(user_id=user_id).first()
            response = client_profile_dismiss(current_user={"id": str(user_id)}, db=db)
            assert response.profile_prompt_dismissed is True
            return stale

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="sdd302") as pool:
        first = pool.submit(first_write)
        assert first_ready.wait(5)
        second = pool.submit(second_write)
        second_read.wait(0.5)
        release_first.set()
        first.result(timeout=10)
        second.result(timeout=10)

    with maker() as db:
        progress = db.query(OnboardingProgress).filter_by(user_id=user_id).one()
        assert progress.steps["profile_prompt_dismissed"] is True
        assert progress.completed is initial_progress
        if initial_progress:
            assert progress.steps["step1"] == {"name": "합성회원"}
            assert progress.steps["step3"]["bio"] == "저장한 소개"
            assert progress.current_step == 3

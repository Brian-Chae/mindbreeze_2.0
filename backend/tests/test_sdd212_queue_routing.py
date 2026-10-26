"""SDD-212 T1 — 종료 파이프라인 줄(큐) 분리 라우팅 (verify Q-01·Q-02·Q-05)

줄 분리는 설정 플래그(PIPELINE_QUEUE_SPLIT_ENABLED)로 켠다. 꺼져 있으면 기존 단일 줄 구성(롤백 경로).
"""
import inspect

import pytest
from celery.app.routes import MapRoute, Router

from app.core import celery_app as celery_module
from app.core.celery_app import build_task_routes, celery_app
from app.services import audio_service


def _queue_of(task_name: str, routes: dict) -> str:
    router = Router(
        routes=[MapRoute(routes)], queues=celery_app.amqp.queues, create_missing=True, app=celery_app
    )
    queue = router.route({}, task_name).get("queue")
    return getattr(queue, "name", queue)


SPLIT = build_task_routes(True)
SINGLE = build_task_routes(False)


@pytest.mark.parametrize(
    "task_name, expected",
    [
        ("tasks.stt", "stt"),
        ("tasks.merge_video_chunks", "stt"),
        ("tasks.summary", "report"),
        ("tasks.generate_reports_for_session", "report"),
        ("tasks.report", "report"),
        ("tasks.process_pipeline_outbox", "celery"),
        ("tasks.sweep_stale_reports", "celery"),
        ("tasks.generate_data_export", "exports"),
        ("tasks.cleanup_data_exports", "exports"),
    ],
)
def test_Q01_줄_분리_시_태스크별_줄_매핑(task_name, expected):
    assert _queue_of(task_name, SPLIT) == expected


def test_Q01_줄_분리_해제_시_기존_exports_2종만_분리된다():
    assert SINGLE == {
        "tasks.generate_data_export": {"queue": "exports"},
        "tasks.cleanup_data_exports": {"queue": "exports"},
    }
    for name in ("tasks.stt", "tasks.summary", "tasks.generate_reports_for_session"):
        assert _queue_of(name, SINGLE) == "celery"


@pytest.mark.parametrize("has_recording", [True, False])
@pytest.mark.parametrize("needs_video_merge", [True, False])
def test_Q02_종료_사슬_각_단계가_지정된_줄로_라우팅된다(has_recording, needs_video_merge):
    tasks = audio_service._build_pipeline_tasks("sid", has_recording, needs_video_merge, True)
    expected = {
        "tasks.merge_video_chunks": "stt",
        "tasks.stt": "stt",
        "tasks.summary": "report",
        "tasks.generate_reports_for_session": "report",
    }
    assert tasks, "리포트 단계는 항상 포함"
    for task in tasks:
        assert _queue_of(task.name, SPLIT) == expected[task.name], task.name


def test_Q05_태스크_이름과_인자_시그니처가_불변이다():
    from app.tasks.report_task import generate_reports_for_session
    from app.tasks.stt_task import stt_task
    from app.tasks.summary_task import summary_task
    from app.tasks.video_task import merge_video_chunks_task

    assert generate_reports_for_session.name == "tasks.generate_reports_for_session"
    assert stt_task.name == "tasks.stt"
    assert summary_task.name == "tasks.summary"
    assert merge_video_chunks_task.name == "tasks.merge_video_chunks"
    for task in (generate_reports_for_session, stt_task, summary_task, merge_video_chunks_task):
        params = list(inspect.signature(task.run).parameters)
        assert params == ["session_id"], (task.name, params)


def test_모듈_기본값은_줄_분리_꺼짐_dev_배포_안전():
    from app.config import settings

    assert settings.pipeline_queue_split_enabled is False
    assert celery_module.celery_app.conf.task_routes == SINGLE

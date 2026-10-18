"""SDD-212 T9 — 정시 몰림 부하 재현 (verify C-01~C-05)

실제 Celery 라우팅(build_task_routes)과 실제 종료 사슬(audio_service._build_pipeline_tasks)을 쓰되,
일꾼은 이산 이벤트 시뮬레이터로 대체한다(주입 시계, 실제 대기 없음). 소요 시간은 plan §1.6 의 가정값이다.
"""
import heapq
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field

import pytest

from app.config import settings
from app.core.celery_app import build_task_routes
from app.services import audio_service
from app.services import pipeline_backlog_service as backlog
from app.services import report_progress_service as rps
from tests.test_sdd212_queue_routing import _queue_of

MIN = 60.0
DURATION = {
    "tasks.merge_video_chunks": 3 * MIN,
    "tasks.stt": 8 * MIN,
    "tasks.summary": 2 * MIN,
    "tasks.generate_reports_for_session": 1.5 * MIN,
}
SPLIT_CONCURRENCY = {"stt": 2, "report": 2, "celery": 1}
SINGLE_CONCURRENCY = {"celery": 2}  # 기존 구성: -Q/--concurrency 미지정 → 기본 줄 하나, 2 vCPU


@dataclass
class Result:
    enqueued: dict = field(default_factory=dict)  # (session, task) -> 줄에 들어간 시각
    started: dict = field(default_factory=dict)
    finished: dict = field(default_factory=dict)
    max_running: dict = field(default_factory=lambda: defaultdict(int))
    start_order: dict = field(default_factory=lambda: defaultdict(list))

    def wait(self, session: int, task: str) -> float:
        return self.started[(session, task)] - self.enqueued[(session, task)]


def simulate(n_sessions: int, routes: dict, concurrency: dict, *, has_recording=True, video_merge=False) -> Result:
    chains = {
        s: [t.name for t in audio_service._build_pipeline_tasks(f"s{s}", has_recording, video_merge, True)]
        for s in range(n_sessions)
    }
    result = Result()
    queues: dict[str, deque] = defaultdict(deque)
    running: dict[str, int] = defaultdict(int)
    events: list = []  # (완료 시각, 순번, session, task_index)
    seq = 0

    def enqueue(now: float, session: int, index: int):
        name = chains[session][index]
        queues[_queue_of(name, routes)].append((session, index))
        result.enqueued[(session, name)] = now

    def dispatch(now: float):
        nonlocal seq
        for queue, limit in concurrency.items():
            while running[queue] < limit and queues[queue]:
                session, index = queues[queue].popleft()
                name = chains[session][index]
                running[queue] += 1
                result.max_running[queue] = max(result.max_running[queue], running[queue])
                result.started[(session, name)] = now
                result.start_order[queue].append(session)
                seq += 1
                heapq.heappush(events, (now + DURATION[name], seq, session, index))

    for session in range(n_sessions):  # 정시에 동시에 종료 — 적재 순서 = 세션 번호
        enqueue(0.0, session, 0)
    dispatch(0.0)
    while events:
        now, _, session, index = heapq.heappop(events)
        name = chains[session][index]
        queue = _queue_of(name, routes)
        running[queue] -= 1
        result.finished[(session, name)] = now
        if index + 1 < len(chains[session]):
            enqueue(now, session, index + 1)
        dispatch(now)
    return result


SPLIT = build_task_routes(True)
SINGLE = build_task_routes(False)
STT, SUMMARY, REPORT = "tasks.stt", "tasks.summary", "tasks.generate_reports_for_session"


def test_C01_STT_일꾼이_전부_점유돼도_요약과_리포트는_바로_시작한다():
    split = simulate(10, SPLIT, SPLIT_CONCURRENCY)
    # 0번 세션 STT 가 끝난 시각(8분)에 STT 줄에는 아직 6건이 대기 중이다
    assert split.finished[(0, STT)] == 8 * MIN
    assert split.wait(0, SUMMARY) == 0
    assert split.wait(0, REPORT) == 0

    single = simulate(10, SINGLE, SINGLE_CONCURRENCY)
    assert single.wait(0, SUMMARY) > 10 * MIN, "기존 단일 줄에서는 요약이 STT 줄 뒤로 밀린다(재현)"


def test_C02_줄별_동시_실행_수가_상한을_넘지_않는다():
    result = simulate(10, SPLIT, SPLIT_CONCURRENCY)
    assert result.max_running["stt"] == 2
    assert result.max_running["report"] <= 2
    assert result.max_running["celery"] == 0


def test_C03_줄_안에서는_먼저_적재된_건이_먼저_시작한다():
    result = simulate(10, SPLIT, SPLIT_CONCURRENCY)
    assert result.start_order["stt"] == list(range(10)), "정시 동시 종료는 적재(세션 번호) 순서대로 시작"

    # report 줄에는 요약·리포트 생성이 함께 들어간다 → 시작 순서는 줄에 들어간 시각 순서여야 한다
    for queue in ("stt", "report"):
        entries = [(key, result.enqueued[key], result.started[key]) for key in result.started
                   if _queue_of(key[1], SPLIT) == queue]
        for _, enq_a, start_a in entries:
            for _, enq_b, start_b in entries:
                if enq_a < enq_b:
                    assert start_a <= start_b, f"{queue} 줄 FIFO 위반"


def test_G1_분리_구성이_마지막_리포트까지_더_빨리_끝낸다():
    split = simulate(10, SPLIT, SPLIT_CONCURRENCY)
    single = simulate(10, SINGLE, SINGLE_CONCURRENCY)
    last_split = max(v for (s, t), v in split.finished.items() if t == REPORT)
    last_single = max(v for (s, t), v in single.finished.items() if t == REPORT)
    assert last_split <= 50 * MIN, "D-3 몰림 목표(45분) 근처에서 끝나야 한다"
    assert last_split < last_single


def test_영상_병합이_있는_세션도_stt_줄에서_순서대로_처리된다():
    result = simulate(4, SPLIT, SPLIT_CONCURRENCY, video_merge=True)
    assert result.max_running["stt"] == 2
    assert all(result.finished[(s, REPORT)] > result.finished[(s, STT)] for s in range(4))


def test_대기_보정_구간이_몰림_시나리오를_수용한다():
    """plan §1.6: 정시 10건 종료. 기존 30분 기준이면 다수 건이 오판되고, 보정 기준에서는 0건이다."""
    result = simulate(10, SPLIT, SPLIT_CONCURRENCY)
    waits_until_report_row = [result.started[(s, REPORT)] for s in range(10)]  # 종료 시각 0 기준

    old_cutoff = 30 * MIN  # 보정 전: 스윕 30분 / 재발행 30분
    sweep_cutoff = rps.REPORT_GENERATION_TIMEOUT_SECONDS + settings.pipeline_queue_grace_seconds
    redrive_cutoff = settings.pipeline_redrive_delay_seconds

    assert sum(w > old_cutoff for w in waits_until_report_row) >= 3, "보정 전에는 정상 대기 건이 오판 대상이 된다"
    assert sum(w > sweep_cutoff for w in waits_until_report_row) == 0
    assert sum(w > redrive_cutoff for w in waits_until_report_row) == 0


def test_C04_리포트_일꾼이_다운되면_STT_줄은_계속_진행되고_소비자_0_경보가_난다():
    result = simulate(6, SPLIT, {"stt": 2, "report": 0, "celery": 1})
    assert all((s, STT) in result.finished for s in range(6)), "다른 줄은 영향 없이 진행"
    assert all((s, SUMMARY) not in result.started for s in range(6)), "리포트 줄은 소비되지 않는다"

    snap = {
        "queues": {"stt": 0, "report": 6, "celery": 0},
        "oldest_wait_seconds": 0,
        "consumers": backlog.count_consumers({"stt@h": [{"name": "stt"}], "main@h": [{"name": "celery"}]}),
        "queue_split_enabled": True,
    }
    assert "no_consumer:report" in backlog.evaluate_alerts(snap)


def test_C05_일꾼_강제_종료_후_재발행되어도_중복_리포트가_생기지_않는다(client):
    from uuid import UUID

    from app.models.record import Report
    from app.tasks.report_task import generate_reports_for_session
    from tests.test_audio_record import _create_session, _register
    from tests.test_sdd086_auto_report import _add_participant, _db

    host = _register(client, "t212c05@test.com")
    sid = _create_session(client, host)
    db = _db()
    for i in range(3):
        _add_participant(db, sid, guest_name=f"게스트{i}")

    generate_reports_for_session.run(sid)
    first = sorted(str(r.id) for r in db.query(Report).filter(Report.session_id == UUID(sid)).all())
    generate_reports_for_session.run(sid)  # 재드라이브로 체인이 한 번 더 도착
    db.expire_all()
    second = sorted(str(r.id) for r in db.query(Report).filter(Report.session_id == UUID(sid)).all())

    assert len(first) == 4 and first == second

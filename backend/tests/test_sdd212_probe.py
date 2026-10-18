"""SDD-212 T7 — 적체 감시 cron·지표 게시·경보 준비물 (verify M-05, M-06)

AWS 에 접속하지 않는다. CloudWatch 클라이언트는 가짜를 주입하고, 경보 스크립트는 본문만 검사한다.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from app.config import settings
from app.services import pipeline_metrics_publisher as publisher

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _snap(**over):
    base = {
        "generated_at": "2026-10-18T12:00:00+00:00",
        "queue_split_enabled": True,
        "broker_available": True,
        "queues": {"stt": 3, "report": 2, "celery": 0},
        "unacked": 1,
        "consumers": {"stt": 2, "report": 2},
        "waiting_chains": 4,
        "oldest_wait_seconds": 900,
        "pending_publish": 0,
        "redriven_chains": 1,
        "max_redrive_attempts": 2,
        "generating_reports": 5,
        "processing_records": 3,
        "oldest_processing_record_seconds": 700,
    }
    return {**base, **over}


# ── 지표 변환 ─────────────────────────────────────────────────────────


def test_지표는_MindBreeze_Pipeline_네임스페이스로_변환된다():
    namespace, data = publisher.build_metric_data(_snap())
    assert namespace == "MindBreeze/Pipeline"
    by_name = {}
    for datum in data:
        by_name.setdefault(datum["MetricName"], []).append(datum)

    assert by_name["OldestWaitSeconds"][0]["Value"] == 900
    assert by_name["OldestWaitSeconds"][0]["Unit"] == "Seconds"
    queue_lengths = {d["Dimensions"][0]["Value"]: d["Value"] for d in by_name["QueueLength"]}
    assert queue_lengths == {"stt": 3, "report": 2, "celery": 0}
    consumers = {d["Dimensions"][0]["Value"]: d["Value"] for d in by_name["Consumers"]}
    assert consumers == {"stt": 2, "report": 2}
    assert by_name["GeneratingReports"][0]["Value"] == 5


def test_브로커_또는_소비자_정보가_없으면_해당_지표는_게시하지_않는다():
    _, data = publisher.build_metric_data(_snap(queues=None, unacked=None, consumers=None, broker_available=False))
    names = {d["MetricName"] for d in data}
    assert "QueueLength" not in names and "Consumers" not in names and "Unacked" not in names
    assert "OldestWaitSeconds" in names


def test_지표에_식별자_문자열이_없다():
    _, data = publisher.build_metric_data(_snap())
    text = json.dumps(data)
    assert "session" not in text.lower() and "@" not in text


def test_게시_실패는_예외를_던지지_않고_False를_반환한다(caplog):
    class Failing:
        def put_metric_data(self, **_):
            raise RuntimeError("AccessDenied: not authorized to perform cloudwatch:PutMetricData")

    with caplog.at_level("WARNING"):
        assert publisher.publish(_snap(), client=Failing()) is False
    assert "PutMetricData" in caplog.text


def test_게시_성공은_20개_단위로_나눠_호출한다():
    calls = []

    class Recorder:
        def put_metric_data(self, **kwargs):
            calls.append(kwargs)

    assert publisher.publish(_snap(), client=Recorder()) is True
    assert calls and all(c["Namespace"] == "MindBreeze/Pipeline" for c in calls)
    assert all(len(c["MetricData"]) <= 20 for c in calls)


def test_boto3_클라이언트는_짧은_타임아웃과_재시도_1회로_만든다():
    cfg = publisher.client_config()
    assert cfg.connect_timeout <= 3 and cfg.read_timeout <= 5
    assert cfg.retries["max_attempts"] <= 2


# ── 소비자 수 추출 ────────────────────────────────────────────────────


def test_active_queues_응답에서_줄별_소비자_수를_센다():
    from app.services import pipeline_backlog_service as backlog

    replies = {
        "stt@host": [{"name": "stt"}],
        "report@host": [{"name": "report"}],
        "report@host2": [{"name": "report"}],
        "main@host": [{"name": "celery"}],
    }
    assert backlog.count_consumers(replies) == {"stt": 1, "report": 2, "celery": 1}


def test_응답이_없으면_모든_줄의_소비자는_0이다():
    from app.services import pipeline_backlog_service as backlog

    assert backlog.count_consumers(None) == {"stt": 0, "report": 0, "celery": 0}


# ── cron 스크립트 ─────────────────────────────────────────────────────


def _load_cron():
    spec = importlib.util.spec_from_file_location("report_backlog_probe_cron", BACKEND / "report_backlog_probe_cron.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["report_backlog_probe_cron"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_M05_cron_은_JSON_로그를_출력하고_정상_종료한다(client, capsys, monkeypatch):
    cron = _load_cron()
    monkeypatch.setattr(cron, "collect_consumers", lambda: None)
    published = []
    monkeypatch.setattr(cron.publisher, "publish", lambda snap, **_: published.append(snap) or True)

    assert cron.main() == 0

    line = capsys.readouterr().out.strip().splitlines()[-1]
    payload = json.loads(line)
    assert payload["event"] == "pipeline_backlog"
    assert payload["alerts"] == []
    assert "queues" in payload and "oldest_wait_seconds" in payload
    assert published == [], "CloudWatch 게시는 설정(승인) 전에는 꺼져 있다"


def test_M06_게시가_켜져_있어도_게시_실패는_정상_종료한다(client, capsys, monkeypatch):
    cron = _load_cron()
    monkeypatch.setattr(settings, "pipeline_metrics_cloudwatch_enabled", True)
    monkeypatch.setattr(cron, "collect_consumers", lambda: None)
    monkeypatch.setattr(cron.publisher, "publish", lambda snap, **_: False)

    assert cron.main() == 0
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["event"] == "pipeline_backlog"


def test_M05_경보_조건이면_alerts_에_코드가_담긴다(client, capsys, monkeypatch):
    cron = _load_cron()
    monkeypatch.setattr(cron, "collect_consumers", lambda: {"stt": 0, "report": 2, "celery": 1})
    monkeypatch.setattr(settings, "pipeline_queue_split_enabled", True)

    assert cron.main() == 0
    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["alerts"] == ["no_consumer:stt"]


def test_M05_DB_조회_실패_시_종료코드_1(client, capsys, monkeypatch):
    cron = _load_cron()
    monkeypatch.setattr(cron, "collect_consumers", lambda: None)

    def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(cron.backlog, "snapshot", boom)
    assert cron.main() == 1


def test_M05_inspect_타임아웃은_짧다():
    cron = _load_cron()
    assert cron.INSPECT_TIMEOUT_SECONDS <= 5


# ── jobs.tsv / 매니페스트 / 경보 스크립트 ─────────────────────────────


def test_M05_jobs_tsv에_1분_주기_55초_상한으로_등록된다():
    rows = [line.split("\t") for line in (ROOT / "deploy/jobs.tsv").read_text().splitlines()[1:] if line.strip()]
    row = next(r for r in rows if r[0] == "report_backlog_probe")
    assert row[1] == "report_backlog_probe_cron.py"
    assert row[2] == "*-*-* *:*:00 UTC"
    assert row[3] == "55"
    assert row[4] == "1"
    assert (BACKEND / row[1]).is_file()


def test_매니페스트에_지표_게시는_꺼진_상태로_등록된다():
    lines = (ROOT / "deploy/env-manifest.tsv").read_text().splitlines()
    row = next(line.split("\t") for line in lines if line.startswith("PIPELINE_METRICS_CLOUDWATCH_ENABLED"))
    assert row[1] == "static" and row[3] == "false"


def test_경보_스크립트는_준비만_되어_있고_승인_전_실행을_막는다():
    script = (ROOT / "deploy/aws/t14-pipeline-alarms.sh").read_text()
    assert "MB_PIPELINE_ALARMS_APPROVED" in script, "명시 승인 변수 없이는 실행되지 않아야 한다"
    assert "MindBreeze/Pipeline" in script
    for name in ("mb-prod-pipeline-oldest-wait", "mb-prod-pipeline-queue-stt", "mb-prod-pipeline-queue-report"):
        assert name in script
    assert str(settings.pipeline_alert_max_wait_seconds) in script
    t13 = (ROOT / "deploy/aws/t13-monitoring.sh").read_text()
    assert "Pipeline" not in t13, "기존 t13 재실행이 신규 경보를 만들면 안 된다"


def test_IAM_정책_문서는_PutMetricData_만_네임스페이스_조건으로_허용한다():
    policy = json.loads((ROOT / "deploy/aws/pipeline-metrics-policy.json").read_text())
    statement = policy["Statement"][0]
    assert statement["Action"] == ["cloudwatch:PutMetricData"]
    assert statement["Condition"]["StringEquals"]["cloudwatch:namespace"] == "MindBreeze/Pipeline"

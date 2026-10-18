"""SDD-212 T2 — 줄 전용 일꾼 유닛 템플릿·설치 스크립트 (verify Q-03·Q-04)

서버·AWS 에 접속하지 않는다. 레포 내 템플릿과 스크립트 본문만 검사한다.
"""
import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


render = _load("render")

PROD_VARS = {
    "WEB_HOST": "mindbreeze.looxidlabs.com",
    "API_HOST": "api.mindbreeze.looxidlabs.com",
    "PUBLIC_IP": "203.0.113.10",
    "PRIVATE_IP": "10.20.1.10",
}
PROD_SECRETS = {
    "MB_RENDER_LIVEKIT_API_KEY": "APIprodkey123",
    "MB_RENDER_LIVEKIT_API_SECRET": "prodsecretvalue456",
    "MB_RENDER_TURN_STATIC_AUTH_SECRET": "turnsecretvalue789",
}


@pytest.fixture()
def rendered(tmp_path):
    sets = [f"{k}={v}" for k, v in PROD_VARS.items()]
    render.render_all(tmp_path, render.resolve_vars(sets, environ=PROD_SECRETS))
    return tmp_path / "etc/systemd/system"


def _exec_start(unit_text: str) -> str:
    match = re.search(r"^ExecStart=(.+)$", unit_text, re.M)
    assert match, unit_text
    return match.group(1)


@pytest.mark.parametrize(
    "unit, queue, concurrency",
    [("stt", "stt", 2), ("report", "report", 2)],
)
def test_Q03_신규_일꾼_유닛이_줄_동시성_호스트명을_지정해_렌더된다(rendered, unit, queue, concurrency):
    body = (rendered / f"mindbreeze-{unit}-worker.service").read_text()
    cmd = _exec_start(body)
    assert f"-Q {queue}" in cmd
    assert f"--concurrency={concurrency}" in cmd
    assert f"--hostname={unit}@%H" in cmd
    assert "--prefetch-multiplier=1" in cmd
    assert "EnvironmentFile=/etc/mindbreeze/prod.env" in body
    assert "@@" not in body


def test_Q03_기존_일꾼은_celery_줄만_동시_1로_소비한다(rendered):
    cmd = _exec_start((rendered / "mindbreeze-worker.service").read_text())
    assert "-Q celery" in cmd
    assert "--concurrency=1" in cmd
    assert "--hostname=main@%H" in cmd


def test_Q03_일꾼_호스트명이_서로_겹치지_않는다(rendered):
    hosts = []
    for name in ("worker", "stt-worker", "report-worker", "export-worker"):
        cmd = _exec_start((rendered / f"mindbreeze-{name}.service").read_text())
        hosts.append(re.search(r"--hostname=(\S+)", cmd).group(1))
    assert len(hosts) == len(set(hosts))


def test_Q03_STT_일꾼은_호스트_tmp_청크를_읽을_수_있다(rendered):
    body = (rendered / "mindbreeze-stt-worker.service").read_text()
    assert "PrivateTmp=true" not in body


def test_Q04_설치_스크립트_유닛_목록에_신규_2종이_포함된다():
    expected = ("mindbreeze-stt-worker", "mindbreeze-report-worker")
    install = (DEPLOY / "install-release.sh").read_text()
    apply_cfg = (DEPLOY / "apply-config.sh").read_text()
    ec2 = (ROOT / "scripts/ec2-setup.sh").read_text()
    for unit in expected:
        assert unit in install, unit
        assert unit in apply_cfg, unit
    for unit in ("mindbreeze-stt-worker", "mindbreeze-report-worker"):
        assert unit.replace("mindbreeze-", "") in ec2


def test_Q04_신규_일꾼이_기존_일꾼보다_먼저_재시작된다():
    install = (DEPLOY / "install-release.sh").read_text()
    line = re.search(r"^SERVICES=\((.+)\)$", install, re.M).group(1).split()
    assert line.index("mindbreeze-stt-worker") < line.index("mindbreeze-worker")
    assert line.index("mindbreeze-report-worker") < line.index("mindbreeze-worker")


def test_Q04_dev_유닛_파일도_레포에_준비된다():
    for name in ("stt", "report"):
        text = (ROOT / f"backend/deploy/mindbreeze-{name}-worker.service").read_text()
        assert f"-Q {name}" in text and f"--hostname={name}@%H" in text


def test_운영_매니페스트에_줄_분리_설정이_등록되고_기본값이_보정값과_같다():
    render_env = _load("render_env")
    from app.config import settings

    rows = {r["key"]: r for r in render_env.load_manifest()}
    assert rows["PIPELINE_QUEUE_SPLIT_ENABLED"]["static_value"] == "true"
    assert rows["PIPELINE_QUEUE_GRACE_SECONDS"]["static_value"] == str(settings.pipeline_queue_grace_seconds)
    assert rows["PIPELINE_REDRIVE_DELAY_SECONDS"]["static_value"] == str(settings.pipeline_redrive_delay_seconds)
    assert all(rows[k]["source"] == "static" and rows[k]["required"] == "1" for k in (
        "PIPELINE_QUEUE_SPLIT_ENABLED", "PIPELINE_QUEUE_GRACE_SECONDS", "PIPELINE_REDRIVE_DELAY_SECONDS"))


def test_컷오버_운영_서비스_점검_목록에_신규_일꾼이_포함된다():
    for script in ("deploy/cutover/c05-deploy.sh", "deploy/cutover/c06-activate.sh"):
        body = (ROOT / script).read_text()
        for unit in ("mindbreeze-stt-worker", "mindbreeze-report-worker"):
            assert unit in body, (script, unit)


def test_컷오버_dev_중지_목록은_dev_유닛_구성을_유지한다():
    body = (ROOT / "deploy/cutover/lib.sh").read_text()
    line = next(l for l in body.splitlines() if l.startswith("DEV_SERVICES="))
    assert "stt-worker" not in line and "report-worker" not in line, "dev 서버에는 신규 유닛이 설치되지 않는다"

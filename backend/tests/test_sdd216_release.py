"""SDD-216 로컬 출시 준비: 실제 cron 진입점과 dev 등록 명령을 격리 실행한다."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "script", ["class_operations_cron.py", "class_rolling_cron.py"]
)
def test_스위치_off에서_DB에_접속하지_않고_종료한다(script):
    result = subprocess.run(
        [sys.executable, str(ROOT / "backend" / script)],
        cwd=ROOT / "backend",
        env={
            **os.environ,
            "CLASS_SCHEDULING_ENABLED": "false",
            "CLASS_ROLLING_ENABLED": "false",
            "CLASS_TEAM_READ_ENABLED": "false",
            "DATABASE_URL": "postgresql://test:test@127.0.0.1:65416/not_running",
        },
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload == (
        {"status": "disabled"}
        if script == "class_operations_cron.py"
        else {"processed": 0, "failed": 0}
    )


def test_dev_등록_명령은_두_cron만_멱등하게_추가한다(tmp_path):
    workflow = yaml.safe_load((ROOT / ".github/workflows/deploy-dev.yml").read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    packaging = next(
        step["run"] for step in steps if step.get("name") == "Package deploy bundle"
    )
    remote = next(
        step["with"]["script"]
        for step in steps
        if step.get("uses", "").startswith("appleboy/ssh-action")
    )
    scripts = ("class_operations_cron.py", "class_rolling_cron.py")
    for script in scripts:
        assert f"backend/{script}" in packaging
    lines = [
        line
        for line in remote.splitlines()
        if line.lstrip().startswith("(crontab")
        and any(name in line for name in scripts)
    ]
    assert len(lines) == 2
    commands = "\n".join(lines)
    stub = tmp_path / "crontab"
    stub.write_text(
        '#!/bin/sh\nif [ "$1" = "-l" ]; then cat "$CRON_STATE"; else cat > "$CRON_STATE.new"; mv "$CRON_STATE.new" "$CRON_STATE"; fi\n'
    )
    stub.chmod(0o755)
    state = tmp_path / "state"
    state.write_text("0 4 * * * keep-existing-job\n")
    env = {
        **os.environ,
        "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"],
        "CRON_STATE": str(state),
    }
    # 실제 crontab·서버에는 쓰지 않는다. 워크플로의 등록 명령을 그대로 두 번 실행한다.
    for _ in range(2):
        subprocess.run(
            ["bash", "-c", commands],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
    content = state.read_text()
    assert "0 4 * * * keep-existing-job" in content
    assert content.count("class_operations_cron.py") == 1
    assert content.count("class_rolling_cron.py") == 1
    for script, schedule in zip(scripts, ("* * * * *", "0 * * * *")):
        line = next(line for line in content.splitlines() if script in line)
        assert line.startswith(schedule + " ")
        assert "flock -n -E 0" in line
        assert "CLASS_SCHEDULING_ENABLED=true" not in line


@pytest.mark.parametrize("maintenance_failed,effects_failed", [(0, 0), (1, 0), (0, 1)])
def test_운영_cron은_실패_건수를_종료코드로_전달한다(
    monkeypatch, capsys, maintenance_failed, effects_failed
):
    from contextlib import nullcontext
    import class_operations_cron as cron

    monkeypatch.setattr(cron.settings, "class_scheduling_enabled", True)
    monkeypatch.setattr(cron, "SessionLocal", lambda: nullcontext(object()))
    monkeypatch.setattr(
        cron,
        "maintain_classes",
        lambda db: {"processed": 2, "failed": maintenance_failed},
    )
    monkeypatch.setattr(
        cron, "process_effects", lambda db: {"done": 3, "failed": effects_failed}
    )
    code = cron.main()
    output = json.loads(capsys.readouterr().out)
    assert output["maintenance"]["failed"] == maintenance_failed
    assert output["effects"]["failed"] == effects_failed
    assert code == (1 if maintenance_failed or effects_failed else 0)


@pytest.mark.parametrize("failed", [0, 1])
def test_롤링_cron은_실패_건수를_종료코드로_전달한다(monkeypatch, capsys, failed):
    from contextlib import nullcontext
    import class_rolling_cron as cron

    monkeypatch.setattr(cron, "SessionLocal", lambda: nullcontext(object()))
    monkeypatch.setattr(
        cron, "roll_classes", lambda db: {"processed": 2, "failed": failed}
    )
    code = cron.main()
    assert json.loads(capsys.readouterr().out) == {"processed": 2, "failed": failed}
    assert code == (1 if failed else 0)


@pytest.mark.parametrize("previous_jobs", [False, True])
def test_dev_실패_복귀는_클래스_cron과_진입점도_이전_상태로_돌린다(
    tmp_path, previous_jobs
):
    import re

    workflow = yaml.safe_load((ROOT / ".github/workflows/deploy-dev.yml").read_text())
    remote = next(
        step["with"]["script"]
        for step in workflow["jobs"]["deploy"]["steps"]
        if step.get("uses", "").startswith("appleboy/ssh-action")
    )

    def function(name):
        match = re.search(rf"(?ms)^{name}\(\) \{{\n.*?^\}}", remote)
        return match.group(0) if match else ""

    base = tmp_path / "base"
    (base / "backend").mkdir(parents=True)
    backup = base / ".deploy-backup"
    backup.mkdir()
    scripts = ("class_operations_cron.py", "class_rolling_cron.py")
    for name in scripts:
        if previous_jobs:
            (base / "backend" / name).write_text("이전 진입점")
    state = tmp_path / "crontab-state"
    old = "0 4 * * * keep-existing-job\n"
    if previous_jobs:
        old += "*/2 * * * * old-class_operations_cron.py\n0 2 * * * old-class_rolling_cron.py\n"
    state.write_text(old)
    (tmp_path / "crontab").write_text(
        '#!/bin/sh\nif [ "$1" = "-l" ]; then cat "$CRON_STATE"; else cat > "$CRON_STATE.new"; mv "$CRON_STATE.new" "$CRON_STATE"; fi\n'
    )
    (tmp_path / "sudo").write_text("#!/bin/sh\nexit 0\n")
    for name in ("sudo", "crontab"):
        (tmp_path / name).chmod(0o755)
    definitions = "\n".join(
        function(name)
        for name in ("snapshot_class_jobs", "restore_class_jobs", "rollback")
    )
    script = definitions + """
cd "$BASE"
if declare -F snapshot_class_jobs >/dev/null; then snapshot_class_jobs; fi
printf '새 진입점' > backend/class_operations_cron.py
printf '새 진입점' > backend/class_rolling_cron.py
printf '0 4 * * * keep-existing-job\n* * * * * new-class_operations_cron.py\n0 * * * * new-class_rolling_cron.py\n0 5 * * * unrelated-added-job\n' > "$CRON_STATE"
DEPLOY_OK=0
rollback
"""
    result = subprocess.run(
        ["bash", "-e", "-c", script],
        env={
            **os.environ,
            "BASE": str(base),
            "BACKUP_DIR": str(backup),
            "CRON_STATE": str(state),
            "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"],
        },
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    for name in scripts:
        path = base / "backend" / name
        if previous_jobs:
            assert path.read_text() == "이전 진입점"
        else:
            assert not path.exists()
    assert state.read_text() == "0 4 * * * keep-existing-job\n0 5 * * * unrelated-added-job\n" + (
        "*/2 * * * * old-class_operations_cron.py\n0 2 * * * old-class_rolling_cron.py\n"
        if previous_jobs
        else ""
    )

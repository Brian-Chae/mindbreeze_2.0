"""dev 배포가 GitHub의 표현식 길이 한도로 파싱 실패하지 않도록 감시한다."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def test_dev_action_script는_18000자를_넘지_않는다():
    workflow = yaml.safe_load((ROOT / ".github/workflows/deploy-dev.yml").read_text())
    scripts = [
        (job_name, step.get("name", ""), step["with"]["script"])
        for job_name, job in workflow["jobs"].items()
        for step in job.get("steps", [])
        if "script" in step.get("with", {})
    ]
    assert scripts, "검사할 action script가 있어야 한다"
    for job_name, step_name, script in scripts:
        # GitHub 한도 21,000자에 변경 여유를 남긴다.
        assert len(script) <= 18_000, (job_name, step_name, len(script))
        assert len(script.encode("utf-8")) <= 18_000, (
            job_name, step_name, len(script.encode("utf-8"))
        )


def test_dev_retention_승인된_소급실삭제_옵션():
    registration = (ROOT / "deploy/dev/register-crons.sh").read_text()
    line = next(line for line in registration.splitlines() if line.startswith("(crontab") and "retention_sweep_cron" in line)
    assert "export RETENTION_SWEEP_ENABLED=true &&" in line
    assert "retention_sweep_cron.py --retroactive >>" in line
    assert "--dry-run" not in line
    assert "RETENTION_APPLY_FROM=" not in line
    assert "Brian 10/24 승인: 릴리즈 전 dev 실삭제 활성, 표준 데이터 보호" in registration

"""SDD-319 round-3 로컬 회귀: 전후 동일 12묶음을 순차 실행하고 합성 DB/Redis 증거를 보존한다."""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

EVIDENCE = Path(__file__).resolve().parent
BACKEND = EVIDENCE.parents[2] / "backend"
PYTHON = "/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python"
TARGETS = {
    "sdd308": ["tests/sdd308", "--ignore=tests/sdd308/test_s5_measurement.py", "--ignore=tests/sdd308/test_s6_epoch_lock_sql.py"],
    "sdd319": ["tests/sdd319", "--ignore=tests/sdd319/test_round3_renew_lock.py", "--ignore=tests/sdd319/test_round3_renew_executor.py"],
    "sdd306": ["tests/sdd306"],
    "sdd285": ["tests/sdd285"],
    **{f"sdd246_{name}": [f"tests/sdd246/{name}"] for name in
       ("archive", "commands", "ingest", "legacy", "state", "t12b", "transport")},
    "ws_live_v2": ["tests/test_mb2_ws_mid_fixes.py", "tests/test_sdd024_session_live_ws.py", "tests/test_fix_live_v2_feature_fields.py"],
}


def main(stage: str) -> None:
    assert stage in {"before", "after"}
    env = dict(os.environ)
    env.pop("S308_MEASURE", None)
    env.pop("S319_SOCKET_LOAD", None)
    env.pop("S319_ROUND2_LOAD", None)
    env.pop("S319_ROUND3_LOAD", None)
    env.pop("S308_BASELINE_SRC", None)
    if stage == "before":
        env["S308_BASELINE_SRC"] = (EVIDENCE / "baseline-path.txt").read_text().strip()
    source_root = Path(env["S308_BASELINE_SRC"]) if stage == "before" else BACKEND
    sources = ("app/services/class_participation_service.py", "app/services/session_live_commands.py",
               "app/services/live_single_flight.py", "app/services/session_live_outbox.py",
               "app/services/session_live_ledger.py", "app/ws/session_live_namespace.py", "app/api/v1/session.py")
    def source_hashes():
        return {name: hashlib.sha256((source_root / name).read_bytes()).hexdigest() for name in sources}
    frozen_sources = source_hashes()
    if stage == "before":
        baseline_sources = json.loads((EVIDENCE / "baseline-sources.json").read_text())
        assert all(baseline_sources[name] == digest for name, digest in frozen_sources.items())
    log_dir = Path(tempfile.mkdtemp(prefix=f"sdd319-round3-regression-{stage}-"))
    results = []
    for name, targets in TARGETS.items():
        assert source_hashes() == frozen_sources, "회귀 중 소스 변경 금지"
        target = EVIDENCE / f"regression-{stage}-{name}.json"
        assert not target.exists(), f"기존 증거 덮어쓰기 금지: {target.name}"
        env["S308_REGRESSION_RESULT"] = str(target)
        command = [PYTHON, "-m", "tests.sdd308.test_s5_measurement", *targets, "-q"]
        with (log_dir / f"{name}.log").open("w") as output:
            try:
                result = subprocess.run(command, cwd=BACKEND, env=env, stdout=output,
                                        stderr=subprocess.STDOUT, timeout=120)
                status = result.returncode
            except subprocess.TimeoutExpired:
                status = "timeout"
        if target.exists():
            report = json.loads(target.read_text())
        else:
            report = {"exitstatus": status, "counts": {}, "incomplete": True}
        assert source_hashes() == frozen_sources, "회귀 중 소스 변경 감지"
        report.update(targets=targets, process_exitstatus=status, log_path=str(log_dir / f"{name}.log"),
                      source_root=str(source_root),
                      source_sha256=frozen_sources)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        results.append({"partition": name, **report})
        print(json.dumps({"partition": name, "exitstatus": status, "counts": report["counts"]}, ensure_ascii=False), flush=True)
    (EVIDENCE / f"regression-{stage}-all.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])

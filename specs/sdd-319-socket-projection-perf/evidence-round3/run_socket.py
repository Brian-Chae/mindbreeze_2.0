"""round-3: 동일 localhost 소켓 하네스의 전후 단독 실행 및 소스 해시 보존."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

EVIDENCE = Path(__file__).resolve().parent
BACKEND = EVIDENCE.parents[2] / "backend"
PYTHON = "/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python"
SOURCES = ("app/services/session_live_ledger.py", "app/services/session_live_commands.py",
           "app/services/session_live_outbox.py", "app/ws/session_live_namespace.py")

def main(stage, n, suffix=""):
    assert suffix in {"", "-r2", "-r3"}
    assert stage in {"before", "after", "pool-after", "sql-after"} and n in {100, 40}
    target = EVIDENCE / f"socket-{stage}-{n}{suffix}.json"
    assert not target.exists()
    source = Path((EVIDENCE / "baseline-path.txt").read_text().strip()) if stage == "before" else BACKEND
    env = dict(os.environ)
    env.pop("S308_BASELINE_SRC", None)
    if stage == "before":
        env["S308_BASELINE_SRC"] = str(source)
    env.update(S319_SOCKET_LOAD="1", S319_SOCKET_N=str(n), S319_SOCKET_TICKS="32",
               S319_SOCKET_BURST="120", S319_SOCKET_BURN_MS="15", S319_SOCKET_RESULT=str(target))
    env.pop("S319_ROUND2_REQUIRE", None)
    if stage != "before":
        env["S319_ROUND2_REQUIRE"] = "1"
    hashes = {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in SOURCES}
    with (EVIDENCE / f"socket-{stage}-{n}{suffix}.log").open("w") as output:
        result = subprocess.run([PYTHON, "-m", "tests.sdd319.test_round2_socket_load",
                                 "tests/sdd319/test_round2_socket_load.py", "-q", "-s"],
                                cwd=BACKEND, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=600)
    assert hashes == {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in SOURCES}
    (EVIDENCE / f"socket-{stage}-{n}{suffix}-source.json").write_text(json.dumps({"source":str(source), "sha256":hashes, "exitstatus":result.returncode},indent=2))
    if target.exists():
        data = json.loads(target.read_text())
        print(json.dumps({"stage":stage,"n":n,"suffix":suffix,"exitstatus":result.returncode,"p95_s":data["p95_s"],"cpu":data["cpu_process_mean_pct"],"errors":data["errors"],"closed":data["closed_streams"],"stored":data["stored_count"]},ensure_ascii=False),flush=True)
    else:
        print("No result JSON, exit", result.returncode,flush=True)
    return result.returncode

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1],int(sys.argv[2]),sys.argv[3] if len(sys.argv)>3 else ""))

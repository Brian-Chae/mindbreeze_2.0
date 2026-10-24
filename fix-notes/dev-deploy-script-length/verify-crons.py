"""기준/수정 크론을 임시 HOME의 파일로만 실행해 동일성과 멱등성을 검증한다."""

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

import yaml

ROOT = Path(__file__).resolve().parents[2]
BASE = "953a1437"


def remote(text):
    workflow = yaml.safe_load(text)
    return next(
        step["with"]["script"]
        for step in workflow["jobs"]["deploy"]["steps"]
        if step.get("uses", "").startswith("appleboy/ssh-action")
    )


before_text = subprocess.check_output(
    ["git", "show", f"{BASE}:.github/workflows/deploy-dev.yml"], cwd=ROOT, text=True
)
after_text = (ROOT / ".github/workflows/deploy-dev.yml").read_text()
before = remote(before_text)
after = remote(after_text)
registration = (ROOT / "deploy/dev/register-crons.sh").read_text()
old_lines = [line for line in before.splitlines() if line.startswith("(crontab")]
new_lines = [line for line in registration.splitlines() if line.startswith("(crontab")]
assert len(old_lines) == 17
assert old_lines == new_lines, "크론 등록 명령의 문자열이 바뀌었다"
assert "retention_sweep_cron.py --dry-run >>" in registration
assert "retention_sweep_cron.py >>" not in registration

# 크론 이동과 호출 외 SSH 본문이 바뀌지 않았는지 독립 확인한다.
start = before.index("# 5.5 알림")
end = before.index("# SDD-188: cron 로그 파일", start)
replacement = '# 5.5~5.10 dev 크론 등록 (번들 해제 후, 기존 순서 유지)\nbash "$BASE/deploy/dev/register-crons.sh"\n\n'
assert after == before[:start] + replacement + before[end:]
assert after.index("tar xzf deploy-bundle.tar.gz") < after.index('bash "$BASE/deploy/dev/register-crons.sh"')
workflow = yaml.safe_load(after_text)
packaging = next(s["run"] for s in workflow["jobs"]["deploy"]["steps"] if s.get("name") == "Package deploy bundle")
assert "deploy/dev/register-crons.sh" in packaging

debug = next(line for line in before.splitlines() if line.startswith("(echo 'DEBUG=false'"))
# 함수가 실제 crontab 명령을 가리므로 시스템 crontab에는 접근하지 않는다.
stub = '''
crontab() {
  if [ "$1" = "-l" ]; then
    if [ -f "$HOME/crontab-state" ]; then cat "$HOME/crontab-state"; else return 1; fi
  else
    cat > "$HOME/crontab-state.new"
    mv "$HOME/crontab-state.new" "$HOME/crontab-state"
  fi
}
export -f crontab
'''
with tempfile.TemporaryDirectory(prefix="mb-cron-compare-") as directory:
    root = Path(directory)
    for scenario in ("empty", "existing"):
        results = []
        for label, commands in (("before", "\n".join(old_lines)), ("after", registration)):
            home = root / scenario / label
            home.mkdir(parents=True)
            state = home / "crontab-state"
            keep = "0 4 * * * keep-existing-job\n"
            if scenario == "existing":
                # 이전 등록·중복·DEBUG 교체도 양쪽에서 동일한지 확인한다.
                stale = "".join(f"0 0 * * * old-{line.split(chr(39))[1]}\n" for line in old_lines)
                state.write_text(keep + "DEBUG=true\n" + stale + stale)
            env = {**os.environ, "HOME": str(home)}
            script = stub + commands + "\n" + debug
            subprocess.run(["bash", "-e", "-c", script], env=env, check=True)
            first = state.read_bytes()
            subprocess.run(["bash", "-e", "-c", script], env=env, check=True)
            second = state.read_bytes()
            if scenario == "existing":
                assert second == first, f"{scenario}/{label}: 멱등성 실패"
            # 빈 crontab에서는 원본 set -e의 첫 등록 생략 특성까지 동일하게 보존한다.
            subprocess.run(["bash", "-e", "-c", script], env=env, check=True)
            assert state.read_bytes() == second, f"{scenario}/{label}: 안정화 후 멱등성 실패"
            if scenario == "existing":
                assert keep.encode() in first
            assert len([line for line in second.splitlines() if b"_cron.py" in line]) == 17
            results.append((first, second))
        assert results[0] == results[1], f"{scenario}: 바이트 비교 실패"
        assert set(results[0][1].splitlines()) == set(results[1][1].splitlines())
        print(f"{scenario}: 1·2회차 결과 각각 동일, 17개 크론 + DEBUG 안정화 후 멱등, SHA256={hashlib.sha256(results[0][1]).hexdigest()}")
for label, script in (("before", before), ("after", after)):
    print(f"{label}: YAML scalar {len(script)}자 / UTF-8 {len(script.encode())}바이트 / UTF-16 {len(script.encode('utf-16-le')) // 2}단위")
print("YAML 파싱·번들 포함·실행 순서·나머지 SSH 본문 동일: 통과")

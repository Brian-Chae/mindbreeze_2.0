"""SDD-210 T-5: deploy/install-release.sh 통합 시험 — 시스템 경계(systemctl·헬스·마이그레이션·venv)만 스텁으로 대체하고
릴리스 전개·체크섬·링크 원자 전환·자동 복귀·롤백·유닛 동기화 로직은 실제 스크립트를 실행한다.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "install-release.sh"
RID_A = "20261017-020000-aaaaaaa"
RID_B = "20261017-030000-bbbbbbb"
RID_C = "20261017-040000-ccccccc"


def make_release(base: Path, rid: str, *, req_hash: str = "h1", destructive: bool = False, tamper: bool = False) -> Path:
    stage = base / f"stage-{rid}"
    (stage / "dist").mkdir(parents=True)
    (stage / "dist" / "index.html").write_text(f"<html>{rid}</html>")
    (stage / "backend" / "app").mkdir(parents=True)
    (stage / "backend" / "app" / "__init__.py").write_text("")
    (stage / "backend" / "requirements.txt").write_text("x\n")
    shutil.copytree(ROOT / "deploy", stage / "deploy", ignore=shutil.ignore_patterns("__pycache__", "precheck"))
    (stage / "MANIFEST.json").write_text(json.dumps({
        "release_id": rid, "requirements_sha256": req_hash, "destructive_migrations": destructive,
        "migration_heads": ["h"], "migration_warnings": [],
    }))
    out = base / "incoming" / rid
    out.mkdir(parents=True)
    tgz = out / f"mindbreeze-{rid}.tar.gz"
    with tarfile.open(tgz, "w:gz") as t:
        for p in sorted(stage.rglob("*")):
            if p.is_file():
                t.add(p, arcname=p.relative_to(stage).as_posix())
    digest = hashlib.sha256(tgz.read_bytes()).hexdigest()
    (out / f"mindbreeze-{rid}.tar.gz.sha256").write_text(f"{'0' * 64 if tamper else digest}  mindbreeze-{rid}.tar.gz\n")
    return out


@pytest.fixture()
def env(tmp_path):
    prefix = tmp_path / "opt"
    etc = tmp_path / "etc"
    flags = tmp_path / "flags"
    flags.mkdir()
    calls = tmp_path / "systemctl.log"
    fake = tmp_path / "fake-systemctl"
    fake.write_text(f'#!/bin/bash\necho "$@" >> "{calls}"\nexit 0\n')
    fake.chmod(0o755)
    e = {
        **os.environ,
        "MB_PREFIX": str(prefix), "MB_ETC": str(etc), "MB_SYSTEMCTL": str(fake),
        "MB_HEALTH_CMD": f'test ! -f "{flags}/unhealthy"',
        "MB_MIGRATE_CMD": f'echo "$MB_RELEASE_DIR" >> "{flags}/migrated"; test ! -f "{flags}/migrate_fail"',
        "MB_VENV_CREATE_CMD": 'mkdir -p "$MB_VENV/bin"',
        "MB_HEALTH_TIMEOUT": "3", "MB_SERVICE_USER": "nobody-xyz",
    }
    return {"env": e, "prefix": prefix, "etc": etc, "flags": flags, "calls": calls, "base": tmp_path}


def run(env, *args):
    return subprocess.run(["bash", str(SCRIPT), *args], env=env["env"], capture_output=True, text=True)


def install(env, rid, *extra, **kw):
    d = make_release(env["base"], rid, **kw)
    return run(env, "install", "--release-id", rid, "--dir", str(d), *extra)


def cur(env):
    return os.path.basename(os.readlink(env["prefix"] / "current"))


def test_첫_설치는_current_venv_링크를_만들고_앱_유닛과_timer_15개를_설치한다(env):
    r = install(env, RID_A)
    assert r.returncode == 0, r.stderr + r.stdout
    assert cur(env) == RID_A
    assert (env["prefix"] / "current" / "dist" / "index.html").read_text() == f"<html>{RID_A}</html>"
    assert os.readlink(env["prefix"] / "venv").endswith("/venvs/h1")
    units = env["etc"] / "systemd" / "system"
    assert (units / "mindbreeze-backend.service").is_file()
    assert len(list(units.glob("mindbreeze-job-*.timer"))) == 15  # dev cron 14 + SDD-212 적체 감시
    log = env["calls"].read_text()
    assert "restart mindbreeze-backend" in log and "restart mindbreeze-worker" in log
    # 컷오버 전(timer 비활성) 상태에서는 timer 를 enable 하지 않는다
    assert "enable --now mindbreeze-job-" not in log
    state = json.loads((env["prefix"] / "state" / "last_deploy.json").read_text())
    assert state["release_id"] == RID_A and state["event"] == "install"


def test_두번째_설치는_previous_를_남기고_같은_requirements_venv_를_재사용한다(env):
    install(env, RID_A)
    r = install(env, RID_B)
    assert r.returncode == 0, r.stderr
    assert cur(env) == RID_B
    assert os.path.basename(os.readlink(env["prefix"] / "previous")) == RID_A
    assert sorted(p.name for p in (env["prefix"] / "venvs").iterdir()) == ["h1"]
    assert "venv 재사용" in r.stdout


def test_체크섬_불일치는_전개도_전환도_하지_않는다(env):
    install(env, RID_A)
    r = install(env, RID_B, tamper=True)
    assert r.returncode == 10
    assert cur(env) == RID_A and not (env["prefix"] / "releases" / RID_B).exists()


def test_마이그레이션_실패는_전환하지_않고_서비스를_건드리지_않는다(env):
    install(env, RID_A)
    env["calls"].write_text("")
    (env["flags"] / "migrate_fail").write_text("1")
    r = install(env, RID_B)
    assert r.returncode == 20
    assert cur(env) == RID_A
    assert "restart" not in env["calls"].read_text()


def test_헬스_실패는_직전_릴리스로_자동_복귀한다(env):
    install(env, RID_A)
    # 새 릴리스 설치 직후부터 unhealthy → 복귀 후에도 unhealthy 면 31, 복귀 시 healthy 로 만들려면 훅이 필요
    # 여기서는 B 전환 후에만 unhealthy 이고 A 로 돌아가면 정상인 상황을 current 링크 기반 헬스로 모사한다.
    env["env"]["MB_HEALTH_CMD"] = f'test "$(basename "$(readlink "{env["prefix"]}/current")")" != "{RID_B}"'
    r = install(env, RID_B)
    assert r.returncode == 30, r.stdout + r.stderr
    assert cur(env) == RID_A
    state = json.loads((env["prefix"] / "state" / "last_deploy.json").read_text())
    assert state["event"] == "rollback" and state["release_id"] == RID_A


def test_복귀도_실패하면_31_로_수동_개입을_요구한다(env):
    install(env, RID_A)
    (env["flags"] / "unhealthy").write_text("1")
    r = install(env, RID_B)
    assert r.returncode == 31


def test_수동_롤백은_previous_로_돌아가고_DB_는_건드리지_않는다(env):
    install(env, RID_A)
    install(env, RID_B)
    migrated_before = (env["flags"] / "migrated").read_text()
    r = run(env, "rollback")
    assert r.returncode == 0, r.stderr
    assert cur(env) == RID_A
    assert os.path.basename(os.readlink(env["prefix"] / "previous")) == RID_B  # 롤포워드 가능
    assert (env["flags"] / "migrated").read_text() == migrated_before  # 마이그레이션 재실행 없음
    assert "DB 는 되돌리지 않음" in r.stdout


def test_특정_릴리스로_롤백하고_없는_릴리스는_거부한다(env):
    install(env, RID_A)
    install(env, RID_B)
    install(env, RID_C)
    assert run(env, "rollback", "--to", RID_A).returncode == 0
    assert cur(env) == RID_A
    assert run(env, "rollback", "--to", "20200101-000000-0000000").returncode == 13


def test_파괴적_마이그레이션은_명시_승인_없이는_설치되지_않는다(env):
    install(env, RID_A)
    r = install(env, RID_B, destructive=True)
    assert r.returncode == 11 and cur(env) == RID_A
    ok = run(env, "install", "--release-id", RID_B, "--dir", str(env["base"] / "incoming" / RID_B), "--allow-destructive")
    assert ok.returncode == 0 and cur(env) == RID_B


def test_timer_가_활성인_서버에서는_새_timer_도_활성화한다(env):
    install(env, RID_A)
    fake = Path(env["env"]["MB_SYSTEMCTL"])
    fake.write_text(
        f'#!/bin/bash\necho "$@" >> "{env["calls"]}"\n'
        'if [ "$1" = "list-units" ]; then echo "mindbreeze-job-process_email_outbox.timer loaded active waiting x"; fi\nexit 0\n'
    )
    env["calls"].write_text("")
    # 폐기될 timer 를 하나 심어 두면 제거되어야 한다
    stale = env["etc"] / "systemd" / "system" / "mindbreeze-job-old_job.timer"
    stale.write_text("x")
    r = install(env, RID_B)
    assert r.returncode == 0, r.stderr
    log = env["calls"].read_text()
    assert "enable --now mindbreeze-job-process_email_outbox.timer" in log
    assert not stale.exists() and "disable --now mindbreeze-job-old_job.timer" in log


def test_오래된_릴리스는_보관_개수를_넘으면_삭제하되_current_previous_는_유지한다(env):
    env["env"]["MB_KEEP_RELEASES"] = "2"
    rids = [f"20261017-0{i}0000-{c * 7}" for i, c in enumerate("abcde", start=1)]
    for rid in rids:
        assert install(env, rid).returncode == 0
    left = sorted(p.name for p in (env["prefix"] / "releases").iterdir())
    assert left == rids[-2:]


def test_잘못된_인자는_사용법_오류다(env):
    assert run(env, "install", "--release-id", "bad", "--dir", "/tmp").returncode == 2
    assert run(env, "nope").returncode == 2

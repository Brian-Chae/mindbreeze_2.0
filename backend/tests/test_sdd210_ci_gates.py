"""SDD-210 T-4/T-5: 릴리스 게이트 스크립트(deploy/ci) 검증 — 게이트 자체가 실제로 실패시키는지 확인한다(V-2.1 유효성)."""
import importlib.util
import os
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / "deploy" / "ci"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, CI / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


scan = _load("scan_dev_leaks")
mig = _load("check_migrations")


# ── dev 흔적 스캐너 ─────────────────────────────────────────


def test_dev_주소가_있는_dist_는_실패한다(tmp_path):
    (tmp_path / "dist" / "assets").mkdir(parents=True)
    (tmp_path / "dist" / "assets" / "a.js").write_text('fetch("https://dev-api.mindbreeze.looxidlabs.com/x")')
    findings = scan.scan(tmp_path, [])
    assert findings and "dist/assets/a.js:1" in findings[0]


@pytest.mark.parametrize("needle", ["dev.mindbreeze.looxidlabs.com", "mindbreeze-dev", "18.183.86.88", "VITE_ENABLE_ROLE_SIM", "/dev/auth/login"])
def test_dist_금지_패턴_각각을_탐지한다(tmp_path, needle):
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "i.js").write_text(f"x='{needle}'")
    assert scan.scan(tmp_path, [])


def test_dist_는_허용목록이_있어도_예외가_없다(tmp_path):
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "i.js").write_text("dev-api.")
    assert scan.scan(tmp_path, ["dist/*"])


def test_허용목록에_있는_백엔드_파일만_통과한다(tmp_path):
    (tmp_path / "backend" / "app").mkdir(parents=True)
    (tmp_path / "backend" / "app" / "config.py").write_text('x = "https://dev.mindbreeze.looxidlabs.com"')
    (tmp_path / "backend" / "app" / "other.py").write_text('x = "mindbreeze-dev"')
    findings = scan.scan(tmp_path, ["backend/app/config.py"])
    assert len(findings) == 1 and "other.py" in findings[0]


def test_허용목록은_사유가_필수다(tmp_path):
    al = tmp_path / "al.txt"
    al.write_text("backend/app/config.py\n")
    with pytest.raises(SystemExit):
        scan.load_allowlist(al)


def test_출력에는_주변_내용이_실리지_않는다(tmp_path):
    (tmp_path / "f.py").write_text('SECRET_TOKEN="abc123" ; u="mindbreeze-dev"')
    out = " ".join(scan.scan(tmp_path, []))
    assert "abc123" not in out and "SECRET_TOKEN" not in out


def test_실제_저장소_프론트_백엔드_스테이징은_허용목록_외_0건(tmp_path):
    """현재 저장소의 릴리스 대상 소스(백엔드·deploy)가 허용목록만으로 통과하는지(dist 는 빌드 후 CI 에서 검사)."""
    stage = tmp_path / "release"
    (stage / "backend").mkdir(parents=True)
    subprocess.run(["cp", "-R", str(ROOT / "backend" / "app"), str(stage / "backend" / "app")], check=True)
    subprocess.run(["cp", "-R", str(ROOT / "backend" / "alembic"), str(stage / "backend" / "alembic")], check=True)
    for p in (ROOT / "backend").glob("*_cron.py"):
        subprocess.run(["cp", str(p), str(stage / "backend" / p.name)], check=True)
    subprocess.run(["cp", "-R", str(ROOT / "deploy"), str(stage / "deploy")], check=True)
    # build-release.sh 와 동일: 운영자 전용 디렉터리는 릴리스에서 제외
    subprocess.run(["rm", "-rf", str(stage / "deploy" / "aws"), str(stage / "deploy" / "precheck"), str(stage / "deploy" / "cutover")], check=True)
    findings = scan.scan(stage, scan.load_allowlist(CI / "dev-leak-allowlist.txt"))
    assert findings == [], findings


# ── 마이그레이션 게이트 ─────────────────────────────────────


def _rev(d: Path, name: str, rev: str, down, body: str = "    pass\n"):
    d.joinpath(f"{name}.py").write_text(
        f'revision = "{rev}"\ndown_revision = {down!r}\n\ndef upgrade():\n{body}\n\ndef downgrade():\n    pass\n'
    )


def test_실제_저장소_head_는_1개다():
    revs = [mig.parse_revision(p) for p in (ROOT / "backend/alembic/versions").glob("*.py") if p.name != "__init__.py"]
    ids = {r["revision"] for r in revs}
    downs = {d for r in revs for d in r["down"]}
    assert len(ids - downs) == 1
    assert "e036a0000055" in downs  # SDD-216 이후에도 기존 head는 후속 리비전의 조상이다.


def test_head_가_2개면_실패한다(tmp_path):
    v = tmp_path / "v"
    v.mkdir()
    _rev(v, "a", "a1", None)
    _rev(v, "b", "b1", "a1")
    _rev(v, "c", "c1", "a1")
    assert mig.main(["--versions", str(v)]) == 1


def test_파괴적_변경을_경고로_표시하고_통과시킨다(tmp_path, capsys):
    v = tmp_path / "v"
    v.mkdir()
    _rev(v, "a", "a1", None)
    _rev(v, "b", "b1", "a1", '    op.drop_column("t", "c")\n    op.execute("DELETE FROM x")\n')
    out = tmp_path / "r.json"
    assert mig.main(["--versions", str(v), "--out", str(out)]) == 0
    rep = json.loads(out.read_text())
    assert rep["destructive"] is True and rep["heads"] == ["b1"] and len(rep["warnings"]) == 2


def test_안전한_추가_변경은_파괴적이지_않다(tmp_path):
    v = tmp_path / "v"
    v.mkdir()
    _rev(v, "a", "a1", None, '    op.add_column("t", sa.Column("c", sa.Integer(), nullable=True))\n    op.create_index("i", "t", ["c"])\n')
    out = tmp_path / "r.json"
    assert mig.main(["--versions", str(v), "--out", str(out)]) == 0
    assert json.loads(out.read_text())["destructive"] is False


def test_downgrade_의_drop_은_경고하지_않는다(tmp_path):
    v = tmp_path / "v"
    v.mkdir()
    (v / "a.py").write_text('revision="a1"\ndown_revision=None\ndef upgrade():\n    pass\ndef downgrade():\n    op.drop_table("t")\n')
    out = tmp_path / "r.json"
    mig.main(["--versions", str(v), "--out", str(out)])
    assert json.loads(out.read_text())["destructive"] is False


# ── 워크플로 YAML ───────────────────────────────────────────


def test_release_build_워크플로는_prod_도메인으로_빌드하고_dev_주소가_없다():
    yaml = pytest.importorskip("yaml")
    path = ROOT / ".github/workflows/release-build.yml"
    wf = yaml.safe_load(path.read_text())
    text = path.read_text()
    assert "dev-api" not in text and "dev.mindbreeze" not in text
    assert "VITE_API_BASE_URL: https://${{ env.PROD_API_HOST }}/api/v1" in text
    assert "deploy/ci/check_migrations.py" in text and "deploy/ci/scan_dev_leaks.py" in text
    assert wf["permissions"] == {"contents": "read"}
    # 서버 설정을 sed 로 고치지 않는다(R1)
    assert "sed -i" not in text


# ── T-5: deploy-prod / rollback-prod / SSM 스크립트 ─────────


def _wf(name: str):
    yaml = pytest.importorskip("yaml")
    path = ROOT / ".github/workflows" / name
    return yaml.safe_load(path.read_text()), path.read_text()


@pytest.mark.parametrize("name,job", [("deploy-prod.yml", "deploy"), ("rollback-prod.yml", "rollback")])
def test_운영_워크플로는_production_환경_승인_OIDC_직렬화를_갖는다(name, job):
    wf, text = _wf(name)
    j = wf["jobs"][job]
    assert j["environment"] == "production"                      # 승인 게이트(V-3.1)
    assert j["permissions"]["id-token"] == "write"               # OIDC
    assert wf["concurrency"] == {"group": "prod-deploy", "cancel-in-progress": False}  # 직렬화(V-3.4)
    trig = wf.get("on", wf.get(True))
    assert set(trig) == {"workflow_dispatch"}                    # 수동 실행만
    assert "role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}" in text
    assert "aws-actions/configure-aws-credentials@v4" in text
    # 장기 키·시크릿·서버 파일 sed·dev 주소 없음(R1, V-3.3, V-3.7)
    assert "AWS_ACCESS_KEY_ID" not in text and "secrets." not in text
    assert "sed -i" not in text and "dev-api" not in text and "dev.mindbreeze" not in text
    assert "ssh " not in text and "scp" not in text              # SSH/SCP 경로 없음(SSM 만)
    assert "PLACEHOLDER" in text                                  # T-7/T-8 값은 placeholder 로 명시


def test_deploy_prod_는_사유_릴리스ID_파괴적확인_입력을_요구한다():
    wf, text = _wf("deploy-prod.yml")
    inputs = (wf.get("on", wf.get(True)))["workflow_dispatch"]["inputs"]
    assert inputs["release_id"]["required"] and inputs["reason"]["required"]
    assert inputs["confirm_destructive"]["type"] == "boolean" and inputs["confirm_destructive"]["default"] is False
    assert "confirm_destructive=true" in text
    # 설치 성공 후 스모크·관찰 실패 시에만 롤백
    assert "steps.install.outcome == 'success'" in text


def test_ssm_install_cmd_는_입력을_엄격히_검증한다():
    sh = CI / "ssm-install-cmd.sh"
    ok = subprocess.run(["bash", str(sh), "install", "20261017-020000-abcdef0", "mindbreeze-prod-releases"], capture_output=True, text=True)
    assert ok.returncode == 0 and "sha256sum -c" in ok.stdout and "install-release.sh" in ok.stdout
    assert "--allow-destructive" not in ok.stdout
    allow = subprocess.run(["bash", str(sh), "install", "20261017-020000-abcdef0", "b-ucket", "allow-destructive"], capture_output=True, text=True)
    assert "--allow-destructive" in allow.stdout
    for bad in (["install", "20261017-020000-abc; rm -rf /", "bucket"], ["install", "20261017-020000-abcdef0", "b;x"],
                ["install", "../../etc", "bucket"], ["rollback", "bad id"], ["bogus"]):
        r = subprocess.run(["bash", str(sh), *bad], capture_output=True, text=True)
        assert r.returncode != 0 and r.stdout == "", bad


def test_ssm_install_cmd_의_체크섬_검증이_설치_스크립트_실행보다_앞선다():
    out = subprocess.run(["bash", str(CI / "ssm-install-cmd.sh"), "install", "20261017-020000-abcdef0", "bucket-x"],
                         capture_output=True, text=True).stdout
    assert out.index("sha256sum -c") < out.index("tar -xzf") < out.index("install-release.sh\" install")


def test_ssm_run_은_원격_종료코드를_전달한다(tmp_path):
    """aws 스텁으로 send-command/get-command-invocation 흐름을 모사 — ResponseCode 30 이 그대로 종료 코드가 된다."""
    stub = tmp_path / "aws"
    stub.write_text(
        '#!/bin/bash\n'
        'if [ "$2" = "send-command" ]; then echo cmd-123; exit 0; fi\n'
        'if [[ "$*" == *"--query Status"* ]]; then echo Failed; exit 0; fi\n'
        'echo \'{"Status":"Failed","ResponseCode":30,"StandardOutputContent":"hello","StandardErrorContent":""}\'\n'
    )
    stub.chmod(0o755)
    script = tmp_path / "s.sh"
    script.write_text("echo hi\n")
    env = {**os.environ, "MB_AWS": str(stub)}
    r = subprocess.run(["bash", str(CI / "ssm-run.sh"), "i-0123456789abcdef0", "60", str(script)], env=env, capture_output=True, text=True)
    assert r.returncode == 30, r.stdout + r.stderr
    assert "hello" in r.stdout and "RESPONSE_CODE=30" in r.stdout


def test_ssm_run_은_잘못된_인스턴스ID를_거부한다(tmp_path):
    script = tmp_path / "s.sh"
    script.write_text("echo hi\n")
    r = subprocess.run(["bash", str(CI / "ssm-run.sh"), "i-1; rm", "60", str(script)], capture_output=True, text=True)
    assert r.returncode == 1

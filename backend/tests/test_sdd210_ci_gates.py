"""SDD-210 T-4/T-5: 릴리스 게이트 스크립트(deploy/ci) 검증 — 게이트 자체가 실제로 실패시키는지 확인한다(V-2.1 유효성)."""
import importlib.util
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
    assert sorted(ids - downs) == ["e036a0000051"]


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

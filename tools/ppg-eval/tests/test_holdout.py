"""4단계 홀드아웃 잠금·로더·후보 등록 시험 (addendum-10). 홀드아웃 신호로 알고리즘을 돌리지 않는다."""
import json
import os
import subprocess

import numpy as np
import pytest

from ppg_eval import cli, guard
from ppg_eval.adapters import loaders
from ppg_eval.holdout import holdout_variants
from ppg_eval.ablation import load_registry
from ppg_eval.variants2 import split_params


def _git(d, *a):
    return subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, text=True).stdout.strip()


def _repo(tmp_path):
    r = tmp_path / "repo"
    t = r / "tools" / "ppg-eval"
    (t / "ppg_eval").mkdir(parents=True)
    (t / "tests").mkdir()
    (r / "packages" / "measurement-core" / "src").mkdir(parents=True)
    (t / "ppg_eval" / "a.py").write_text("x=1\n")
    (t / "tests" / "t.py").write_text("x=1\n")
    (t / "splits.json").write_text("{}\n")
    (r / "packages" / "measurement-core" / "src" / "lib.rs").write_text("//\n")
    reg = {"phase4_holdout": {"candidates": []}}
    (t / "experiments.json").write_text(json.dumps(reg))
    _git(r, "init", "-q")
    _git(r, "config", "user.email", "t@t")
    _git(r, "config", "user.name", "t")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "freeze")
    sha = _git(r, "rev-parse", "HEAD")
    reg["phase4_holdout"]["freeze"] = {"sha": sha}
    (t / "experiments.json").write_text(json.dumps(reg))
    ap = t / "holdout-approval.json"
    ap.write_text(json.dumps({"approver": guard.APPROVER, "candidates": guard.CANDIDATES, "frozen_sha": sha}))
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "approval")
    return r, t, ap


def _verify(r, t, ap, token, rr):
    return guard.verify_unlock(token, approval_path=str(ap), run_record=str(rr), repo=str(r), tool_rel="tools/ppg-eval")


def test_unlock_ok_then_each_condition_rejects(tmp_path):
    r, t, ap = _repo(tmp_path)
    rr = tmp_path / "run-record.json"
    tok = guard.sha256_file(str(ap))
    assert _verify(r, t, ap, tok, rr)["frozen_sha"]
    with pytest.raises(guard.HoldoutLocked):  # 토큰 불일치
        _verify(r, t, ap, "x" * 64, rr)
    with pytest.raises(guard.HoldoutLocked):  # 토큰 없음
        _verify(r, t, ap, None, rr)
    (t / "ppg_eval" / "a.py").write_text("x=2\n")  # 작업 트리 변경
    with pytest.raises(guard.HoldoutLocked):
        _verify(r, t, ap, tok, rr)
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "code change after freeze")  # 동결 이후 코드 커밋
    with pytest.raises(guard.HoldoutLocked):
        _verify(r, t, ap, tok, rr)


def test_rerun_refused_when_run_record_exists(tmp_path):
    r, t, ap = _repo(tmp_path)
    rr = tmp_path / "run-record.json"
    tok = guard.sha256_file(str(ap))
    rr.write_text("{}")
    with pytest.raises(guard.HoldoutLocked, match="재실행"):
        _verify(r, t, ap, tok, rr)


def test_approval_must_be_committed_and_match(tmp_path):
    r, t, ap = _repo(tmp_path)
    rr = tmp_path / "run-record.json"
    d = json.loads(ap.read_text())
    d["approver"] = "someone"
    ap.write_text(json.dumps(d))
    with pytest.raises(guard.HoldoutLocked):
        _verify(r, t, ap, guard.sha256_file(str(ap)), rr)


def test_locked_by_default_and_token_arg_alone_does_not_open(tmp_path, monkeypatch):
    monkeypatch.setattr(guard, "ACCESS_LOG", str(tmp_path / "l.jsonl"))
    guard.relock()
    with pytest.raises(guard.HoldoutLocked):
        guard.require_open("capnobase", "0009_8min", unlock="anything")
    with pytest.raises(PermissionError):
        loaders.load_record("capnobase", "0009_8min")


def test_cli_run_holdout_refuses_without_token(tmp_path, monkeypatch):
    monkeypatch.setattr(guard, "ACCESS_LOG", str(tmp_path / "l.jsonl"))
    assert cli.main(["run-holdout"]) == 2
    assert cli.main(["run-holdout", "--confirm-single-run"]) == 2
    assert cli.main(["run-holdout", "--unlock-token", "bad", "--confirm-single-run"]) == 2


def test_candidates_registered_exactly_three():
    reg = load_registry()
    vl = holdout_variants(reg)
    assert [v[0] for v in vl] == ["V0", "W4a", "W2a"]
    assert vl[1][1] == {"detrend": "mean"} and vl[2][1] == {"refine": "pm30"}
    pipe, resp = split_params(vl[2][1])
    assert pipe["refine"] == "pm30"
    assert reg["phase4_holdout"]["no_other_candidates"] is True


def test_capnobase_loader_schema(tmp_path):
    if not os.path.isdir(loaders.CAPNO_DIR):
        pytest.skip("CapnoBase 없음")
    ids = loaders.capnobase_ids()
    assert len(ids) == 42
    groups = {"adult": 0, "pediatric": 0, "unknown": 0}
    for rid in ids:
        r = loaders.parse_capnobase(rid)
        assert r.fs == 300.0 and len(r.ppg) >= 144000 and np.isfinite(r.ppg).all()
        ev = r.resp_events["co2_startinsp"]
        assert len(ev) >= 10 and np.all(np.diff(ev) > 0) and ev[-1] < len(r.ppg) / 300.0 + 1
        assert len(r.beats_truth) >= 10
        groups[r.meta["age_group"]] += 1
    assert groups == {"adult": 13, "pediatric": 28, "unknown": 1}


def test_age_group_boundary(tmp_path):
    d = tmp_path
    for name, body in {"signal": "co2_y,pleth_y,ecg_y\n" + "\n".join("0,1,2" for _ in range(10)) + "\n", "labels": '"co2_artif_x","co2_startexp_x","co2_startinsp_x","pleth_artif_x","pleth_peak_x","ecg_peak_x","ecg_artif_x","units_x"\n"", 1 2 3, 4 5 6,"", 1 2, 3 4,"","samples"\n', "param": '"samplingrate_pleth","samplingrate_co2","samplingrate_ecg","case_id","case_ventilation"\n300,300,300,"x","spontaneous"\n'}.items():
        (d / f"x_8min_{name}.csv").write_text(body)
    for age, exp in (("18", "adult"), ("17.9", "pediatric"), ("", "unknown")):
        (d / "x_8min_meta.csv").write_text(f'"subject_gender","subject_age","subject_weight","treatment_ventilation","persistentID"\n"",{age},18,"spontaneous","x"\n')
        assert loaders.parse_capnobase("x_8min", str(d)).meta["age_group"] == exp

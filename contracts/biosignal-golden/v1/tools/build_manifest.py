#!/usr/bin/env python3
"""SDD-246 T01 — golden v1 manifest 생성/검증.

  build_manifest.py build  <repo_root>   manifest.json 을 (재)작성한다(감독 승인된 변경에서만).
  build_manifest.py check  <repo_root>   저장된 manifest 의 파일 해시·소스 해시와 현재 파일이 같은지 검사한다(종료코드 0/1).

기록하는 것: 파일 sha256, oracle 소스(frontend/src/lib/eeg 전체) 트리 해시, backend 스코어링 소스·상수 해시,
HARU 기준 commit/상수 해시, 도구 버전, 규칙, G1 상태, 실측 fixture 추가 절차.
"""
import hashlib
import json
import os
import subprocess
import sys

mode, repo = sys.argv[1], os.path.abspath(sys.argv[2])
V1 = os.path.join(repo, "contracts", "biosignal-golden", "v1")
HARU = "/Volumes/Looxid SSD/looxid/repository/haru_band_app"
SDK_DEVICE = "/Volumes/Looxid SSD/looxid/repository/link_band_sdk/python_core/app/core/device.py"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_hash(root, rel_files):
    h = hashlib.sha256()
    for rel in sorted(rel_files):
        h.update(rel.encode() + b"\0" + sha(os.path.join(root, rel)).encode() + b"\n")
    return h.hexdigest()


def git(*a, cwd=repo):
    try:
        return subprocess.check_output(["git", *a], cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:  # noqa: BLE001
        return None


def files_under(root, rel_dir, exts=None):
    out = []
    for dp, _, fs in os.walk(os.path.join(root, rel_dir)):
        for f in fs:
            if f.startswith("."):
                continue
            if exts and not f.endswith(exts):
                continue
            out.append(os.path.relpath(os.path.join(dp, f), root))
    return sorted(out)


def v1_files():
    out = []
    for sub in ("packets", "expected", "synth", "oracle", "tools", "consumers"):
        for p in files_under(V1, sub):
            if "__pycache__" in p or p.endswith(".pyc"):
                continue
            out.append(p)
    return sorted(out)


def sources():
    eeg = files_under(repo, "frontend/src/lib/eeg", (".ts",))
    sc = ["backend/app/services/eeg_metrics.py", "backend/app/services/normalization_score.py", "backend/app/services/normalization_constants.json"]
    return {
        "oracle_ts_eeg": {"files": len(eeg), "tree_sha256": tree_hash(repo, eeg)},
        "backend_scoring": {p: sha(os.path.join(repo, p)) for p in sc},
        "source_commit_base": "60365fbaaf02954ba154631032bba9123cec7673",
        "haru": {
            "repo_path": HARU, "commit": git("rev-parse", "HEAD", cwd=HARU),
            "constants_v2_path": "specs/040-meditation-metrics-redesign/cohort/constants_v2.json",
            "constants_v2_last_commit": git("log", "-1", "--format=%H", "--", "specs/040-meditation-metrics-redesign/cohort/constants_v2.json", cwd=HARU),
            "constants_v2_sha256": sha(os.path.join(HARU, "specs/040-meditation-metrics-redesign/cohort/constants_v2.json")),
            "equals_backend_constants": sha(os.path.join(HARU, "specs/040-meditation-metrics-redesign/cohort/constants_v2.json")) == sha(os.path.join(repo, "backend/app/services/normalization_constants.json")),
            "note": "HARU 작업트리는 로컬 clone 이며 commit 은 읽은 시점의 HEAD. constants_v2.json 은 backend 상수 파일과 바이트 동일.",
        },
        "sdk_device_py": {"path": SDK_DEVICE, "sha256": sha(SDK_DEVICE)},
    }


def build():
    files = {p: sha(os.path.join(V1, p)) for p in v1_files()}
    oracle_summary = json.load(open(os.path.join(V1, "expected", "oracle", "summary.json")))
    div = json.load(open(os.path.join(V1, "expected", "oracle", "divergences.json")))
    m = {
        "manifest_version": 1,
        "golden_set": "biosignal-golden/v1",
        "generated_by": "tools/build_manifest.py",
        "status": {
            "G1_real_golden": "NOT_SATISFIED",
            "reason": "동의된 실측 raw(정상/접촉불량/운동·PPG 저품질/재연결, 정상 30분 ≥3건)가 아직 확보·검증되지 않았다. 아래 합성 fixture 통과는 G1 통과가 아니다.",
            "G1_remaining": [
                "GF03 실측 raw 세트(비식별 동의, arrival schedule 포함) 수집 — 정상 30분 ≥3 + 실패 사례 각각",
                "firmware/명세로 헤더 tick = 첫 샘플 vs 마지막 샘플 anchor 의미 교차 확인(D09)",
                "iOS/Android/WASM 3 플랫폼 실행 결과 비교(T02·T07·T08 이후, T11 독립 실행)",
                "native 음성 off·잠금 30분 spike(T07/T08)는 이 manifest 범위가 아님",
            ],
            "synthetic_only": True,
        },
        "classification": {
            "GF01": "독립 산술 — 완료(합성 바이트, 정답은 손계산/다른 구현)",
            "GF02": "합성 — 완료(clock 규칙 reference 포함)",
            "GF03": "실측 — 미확보. synth/ 는 GF03 대역 대체가 아닌 oracle 구동용 합성 입력",
            "GF04": "부분 — RSA 0.25Hz 합성 PPG 포함. RR boundary·누적 59/60/61초·flat/noise·NaN 전용 벡터는 T02 RED 시 추가(소유: T01 후속)",
            "GF05": "완료 — backend 독립 Python 스코어링 vs TS sigmoid exact. legacy_cohort 와 active_sigmoid 분리",
        },
        "tick_clock": {"hz": 32768, "header": "uint32 little endian (EEG/PPG/ACC 모두)", "wrap_bits": 32},
        "packet_rules": {
            "eeg": {"sample_bytes": 7, "layout": "leadoff(1: bit0=ch1, bit2=ch2) + ch1 BE signed24 + ch2 BE signed24", "uv": "signed*4.033/12/(2^23-1)*1e6", "min_len": 8, "rate_hz": 250},
            "ppg": {"sample_bytes": 6, "layout": "red BE uint24 + ir BE uint24 (헤더는 little endian)", "min_len": 8, "rate_hz": 50},
            "acc": {"sample_bytes": 6, "layout": "x,y,z LE int16", "g": "raw*2/32768", "min_len": 10, "rate_hz": 30},
            "strict": "(len-4) % sample_bytes != 0 이면 invalid_remainder, 최소 길이 미만이면 invalid_too_short, 헤더 4바이트 미만이면 invalid_header_short. 원문은 보관하고 분석에서 제외. (공식 SDK 는 나머지 바이트를 조용히 버린다)",
        },
        "clock_rules": {
            "per_sensor_independent_origin": True,
            "wrap": "32bit 확장: 이전 raw 대비 (raw-prev) mod 2^32 가 2^31 미만이고 raw<prev 이면 wrap",
            "duplicate_window_ticks": 65536,
            "duplicate": "역행 또는 동일 tick 이 2초(65536 tick) 이내: 동일 tick+동일 payload hash=duplicate, 동일 tick+다른 payload=conflict(원문 보존), 그 외=out_of_order. 모두 분석 제외",
            "reset": "2초 초과 역행 → 새 segment(reset_new_segment)",
            "forward_gap": "10분(19660800 tick) 초과 전진 → 새 segment(forward_gap_new_segment), 보간하지 않음",
            "anchor": "v1 profile = 헤더가 패킷의 마지막 샘플(현 웹, D09). 원 device tick 은 항상 저장. SDK 는 첫 샘플 — expected 에 두 의미 offset 을 모두 기록",
            "acc_interval": "현 웹 profile 33333µs 반올림. 새 rational 보간과 같은 버전으로 섞지 않는다",
        },
        "oracle": {
            "runner": "oracle/run-oracle.ts (vitest, fake timers, base_ms=1760000000000)",
            "command": "(cd frontend && npx vitest run --config ../contracts/biosignal-golden/v1/oracle/vitest.oracle.config.mjs)",
            "regenerate_command": "(cd frontend && ORACLE_WRITE=1 npx vitest run --config ../contracts/biosignal-golden/v1/oracle/vitest.oracle.config.mjs)  # 감독 승인 변경에서만",
            "stages": ["decoded", "clock", "eeg_psd_bandpower", "eeg_raw_indices", "ppg_peaks_rr", "hrv_sdnn_respiration", "display", "acc"],
            "stage_hashes": oracle_summary["stages"],
            "input": oracle_summary["input"],
            "meta": oracle_summary["meta"],
            "hash_method": "sha256(canonical JSON: 키 순서 보존, NaN/±Infinity/-0 는 문자열 토큰)",
            "no_rust_generated_expected": True,
        },
        "oracle_divergences": {
            "truncated": {r["file"]: {"strict": r["ref_strict"], "ts_samples": r["ts_samples"], "ts_threw": r["ts_threw"]} for r in div["gf02_truncated"]},
            "meaning": "기존 TS 파서는 나머지 바이트가 있는 패킷을 floor 로 일부 샘플만 내고 조용히 받아들인다. v1 계약은 invalid_remainder 로 분리하고 원문 보존이다 — T02 는 strict 를 따르고, 이 차이는 '이식 차이'로 숨기지 않고 감독이 profile 변경으로 확정한다.",
            "duplicates_conflicts_out_of_order": "TS(isDuplicatePacket)는 2초 이내 역행/동일 tick 패킷을 0샘플로 거른다 — conflict 의 원문 보관 여부는 TS 가 하지 않으므로 T02 가 추가(분석 출력은 동일).",
        },
        "scoring": {
            "file": "expected/scoring/gf05_scoring.json",
            "legacy_cohort": "backend eeg_metrics.normalize_* (사다리꼴/선형, 반올림 1자리) — 점 벡터 71개",
            "active_sigmoid": "backend normalization_score.sigmoid_score == frontend eegSigmoidScore.sigmoidScore (정수, JS half-up) — 점 벡터 112개 + half 경계 5개",
            "mode_rule": "같은 mode·model 에서 대응 함수만 비교. TS 실시간 코호트(eegScore.ts 선형)와 backend 코호트(trapezoid)는 정의가 달라 같은 숫자를 기대하지 않는다.",
            "no_composite_score": "meditation_total_score 등 종합점수는 새 live schema·리포트에 노출하지 않는다(계약 schema 가 거절).",
        },
        "sources": sources(),
        "toolchain": {
            "node": subprocess.check_output(["node", "-v"], text=True).strip(),
            "python_for_generators": "stdlib only (3.9+)",
            "python_for_scoring": "backend venv 3.11 (읽기 전용 import)",
            "vitest": json.load(open(os.path.join(repo, "frontend/node_modules/vitest/package.json")))["version"],
            "biquadjs": json.load(open(os.path.join(repo, "frontend/node_modules/biquadjs/package.json")))["version"],
        },
        "add_real_fixture_procedure": [
            "1. 대상: 동의서가 있는 테스트 참가자(고객 DB·운영 데이터 사용 금지). 기기/펌웨어/앱 build, OS, 착용 상태를 기록한다.",
            "2. 수집: 앱 BLE 콜백의 원 바이트를 도착 monotonic µs 와 함께 그대로 저장(packets/real/<id>/NNNN_<sensor>.bin 또는 단일 stream.bin + schedule.json). 바이트를 가공·재정렬하지 않는다.",
            "3. 비식별: 참가자 식별자 제거, 파일명은 무작위 id. 원문 repository 반입이 부적절하면 암호화 artifact 의 sha256+보관 위치 reference 만 manifest.real_fixtures 에 기록한다.",
            "4. 분류: 정상(≥30분 ×3), 접촉불량, 운동, PPG 저품질, 재연결(tick reset) 각각 최소 1건. scenario.json 에 구간 라벨을 사람이 기록한다(알고리즘 출력으로 라벨 생성 금지).",
            "5. expected: oracle/run-oracle.ts 를 해당 stream 으로 구동(runOracle(streamDir))해 단계 hash 를 생성하고, GF01 방식의 독립 산술(Python/표준 라이브러리)로 decoded 단계를 교차 확인한다. Rust(T02) 결과로 expected 를 만들지 않는다.",
            "6. 불일치는 단계별로 resolve(TS 결함 vs 규칙 vs 산술 오류)하고 결정을 oracle_divergences 와 specs 문서에 남긴다. 감독 승인 후 manifest 를 재생성한다.",
            "7. firmware/명세로 anchor 의미(첫 vs 마지막 샘플)를 확정해 tick_clock.anchor 를 갱신한다. 변경 시 algorithm_version 증가와 골든 재인증.",
            "8. HARU 기준 commit/상수 hash 를 sources.haru 에 갱신하고, 3 플랫폼 실행(T11)을 evidence 에 기록한 뒤에만 G1 을 충족으로 표시한다.",
        ],
        "real_fixtures": [],
        "files": files,
    }
    with open(os.path.join(V1, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("manifest files:", len(files))


def check():
    m = json.load(open(os.path.join(V1, "manifest.json"), encoding="utf-8"))
    errs = []
    cur = {p: sha(os.path.join(V1, p)) for p in v1_files()}
    for p, h in m["files"].items():
        if p not in cur:
            errs.append("missing: " + p)
        elif cur[p] != h:
            errs.append("changed: " + p)
    for p in cur:
        if p not in m["files"]:
            errs.append("untracked: " + p)
    s = sources()
    old = m["sources"]
    if s["oracle_ts_eeg"] != old["oracle_ts_eeg"]:
        errs.append("oracle source (frontend/src/lib/eeg) changed — golden 재검토 필요")
    if s["backend_scoring"] != old["backend_scoring"]:
        errs.append("backend scoring source/constants changed")
    if s["sdk_device_py"] != old["sdk_device_py"]:
        errs.append("SDK device.py changed")
    if m["status"]["G1_real_golden"] != "NOT_SATISFIED" and not m["real_fixtures"]:
        errs.append("G1 가 충족으로 표시됐지만 real_fixtures 가 비어 있다")
    for e in errs:
        print("FAIL", e)
    print("manifest check:", "OK" if not errs else "FAILED (%d)" % len(errs), "- files", len(cur))
    sys.exit(1 if errs else 0)


{"build": build, "check": check}[mode]()

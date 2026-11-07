"""데이터셋 어댑터 (읽기 전용). 모든 로더는 guard.require_open 을 먼저 거친다 — 홀드아웃은 열리지 않는다."""
from __future__ import annotations

import csv
import importlib
import os
import pickle

import numpy as np
import scipy.io as sio

from ..common import DATA_ROOT, Record
from ..guard import require_open

BIDMC_DIR = os.path.join(DATA_ROOT, "bidmc", "bidmc-ppg-and-respiration-dataset-1.0.0", "bidmc_csv")
MARSH_DIR = os.path.join(DATA_ROOT, "marsh", "MARSH")
MARSH_ECG_FS = 250.0  # 논문: IP 250Hz; 데이터상 ECG·IP 길이 동일 (spec §3)


def load_bidmc(rid: str) -> Record:
    require_open("bidmc", rid)
    sig = np.genfromtxt(os.path.join(BIDMC_DIR, f"bidmc_{rid}_Signals.csv"), delimiter=",", skip_header=1)
    fs = 125.0
    # 열: Time, RESP, PLETH, V, AVR, II
    ppg, ecg = sig[:, 2].astype(np.float64), sig[:, 5].astype(np.float64)
    br = np.genfromtxt(os.path.join(BIDMC_DIR, f"bidmc_{rid}_Breaths.csv"), delimiter=",", skip_header=1)
    br = np.atleast_2d(br)
    ev = {}
    for k, name in enumerate(("ann1", "ann2")):
        col = br[:, k]
        col = col[np.isfinite(col)]
        ev[name] = col.astype(np.float64) / fs
    num = np.genfromtxt(os.path.join(BIDMC_DIR, f"bidmc_{rid}_Numerics.csv"), delimiter=",", skip_header=1)
    mon_hr = float(np.nanmedian(num[:, 1]))  # 열: Time, HR, PULSE, RESP, SpO2 (헤더로 확인)
    return Record(ds="bidmc", rid=rid, fs=fs, ppg=ppg, resp_events=ev, beats_truth=None, ecg=ecg, ecg_fs=fs, meta={"n_samples": int(len(ppg)), "mon_hr": mon_hr})


def fill_nan(x: np.ndarray):
    """addendum-6 A6-1: NaN 선형 보간(양끝 최근접). 반환 (채운 배열, NaN 개수)."""
    bad = ~np.isfinite(x)
    n = int(bad.sum())
    if n == 0:
        return x, 0
    idx = np.arange(len(x))
    y = x.copy()
    y[bad] = np.interp(idx[bad], idx[~bad], x[~bad])
    return y, n


def _mat(path: str, key: str) -> np.ndarray:
    return np.asarray(sio.loadmat(path)[key]).ravel()


def load_marsh(rid: str) -> Record:
    require_open("marsh", rid)
    d = os.path.join(MARSH_DIR, rid)
    ppg = _mat(os.path.join(d, "PPG.mat"), "PPG").astype(np.float64)
    ecg = _mat(os.path.join(d, "ECG.mat"), "ECG").astype(np.float64)
    ip_ann = _mat(os.path.join(d, "IP_annot.mat"), "IP_annot").astype(np.float64)
    ecg_ann = _mat(os.path.join(d, "ECG_annot.mat"), "ECG_annot").astype(np.float64)
    ratio = len(ppg) / len(ecg)
    fs = 500.0 if ratio > 1.5 else 250.0
    dur = len(ecg) / MARSH_ECG_FS
    ip_t = ip_ann / MARSH_ECG_FS
    ecg_t = ecg_ann / MARSH_ECG_FS
    n_ip_out = int(np.sum(ip_t >= dur))
    n_ecg_out = int(np.sum(ecg_t >= dur))
    ip_t = ip_t[(ip_t >= 0) & (ip_t < dur)]
    ecg_t = ecg_t[(ecg_t >= 0) & (ecg_t < dur)]
    return Record(
        ds="marsh",
        rid=rid,
        fs=fs,
        ppg=ppg,
        resp_events={"ip": np.sort(ip_t)},
        beats_truth=np.sort(ecg_t),
        ecg=ecg,
        ecg_fs=MARSH_ECG_FS,
        meta={"ppg_fs_ratio": round(ratio, 4), "ann_ip_out_of_range": n_ip_out, "ann_ecg_out_of_range": n_ecg_out, "duration_s": dur},
    )


def load_mimic(kind: str, rid: str) -> Record:
    ds = "mimic_nonaf" if kind == "non_af" else "mimic_af"
    require_open(ds, rid)
    p = os.path.join(DATA_ROOT, "mimic-perform", f"mimic_perform_{kind}_csv", f"mimic_perform_{kind}_{rid}_data.csv")
    a = np.genfromtxt(p, delimiter=",", skip_header=1)
    fs = 125.0
    ppg, n_ppg = fill_nan(a[:, 1].astype(np.float64))
    ecg, n_ecg = fill_nan(a[:, 2].astype(np.float64))
    return Record(ds=ds, rid=rid, fs=fs, ppg=ppg, ecg=ecg, ecg_fs=fs, meta={"n_samples": int(len(a)), "ppg_nan": n_ppg, "ecg_nan": n_ecg})


class _SafeUnpickler(pickle.Unpickler):
    """numpy 배열 재구성만 허용하는 pickle 로더 (데이터셋 pkl 은 외부 파일이므로 임의 객체 실행 차단)."""

    _OK = {
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy._core.multiarray", "_reconstruct"),
        ("numpy", "ndarray"),
        ("numpy", "dtype"),
        ("numpy.core.multiarray", "scalar"),
        ("numpy._core.multiarray", "scalar"),
    }

    def find_class(self, module, name):
        if (module, name) in self._OK:
            return getattr(importlib.import_module(module), name)
        raise pickle.UnpicklingError(f"blocked {module}.{name}")


def load_dalia(rid: str) -> Record:
    require_open("dalia", rid)
    p = os.path.join(DATA_ROOT, "ppg-dalia", "PPG_FieldStudy", rid, f"{rid}.pkl")
    with open(p, "rb") as f:
        d = _SafeUnpickler(f, encoding="latin1").load()
    bvp = np.asarray(d["signal"]["wrist"]["BVP"], dtype=np.float64).ravel()
    rp = np.asarray(d["rpeaks"], dtype=np.float64).ravel() / 700.0
    return Record(ds="dalia", rid=rid, fs=64.0, ppg=bvp, beats_truth=np.sort(rp), meta={"n_samples": int(len(bvp)), "activity_available": True})


CAPNO_DIR = os.path.join(DATA_ROOT, "capnobase", "extracted", "data", "csv")
CAPNO_FS = 300.0
CAPNO_ADULT_MIN_AGE = 18.0  # 열기 전 고정(addendum-10): 나이 >=18 성인, <18 소아, 미기재 미상


def capnobase_ids(csv_dir: str = CAPNO_DIR) -> list:
    """메타 파일 이름으로 기록 ID 목록 (파일 이름만 읽는다)."""
    return sorted(f[: -len("_meta.csv")] for f in os.listdir(csv_dir) if f.endswith("_8min_meta.csv"))


def _tokens(cell: str) -> np.ndarray:
    t = cell.split()
    a = np.asarray([float(x) for x in t], dtype=np.float64) if t else np.zeros(0)
    return a[a > 0]  # MATLAB 1-기반 인덱스: 0 은 빈칸 패딩(무효). 기록 0133 에서 확인됨


def parse_capnobase(rid: str, csv_dir: str = CAPNO_DIR) -> Record:
    """CapnoBase CSV → Record (잠금 검사 없음 — 스키마 시험·guard 경유 로더 공용).

    참값(1단계 MARSH 와 같은 형식의 이벤트열): `co2_startinsp_x`(CO₂ 흡기 시작 샘플) / 300Hz = 호흡 이벤트 시각(초).
    참 박동: `ecg_peak_x`(사람 평가자 R-peak) / 300Hz. PPG: `pleth_y`.
    """
    base = os.path.join(csv_dir, f"{rid}")
    sig = np.loadtxt(base + "_signal.csv", delimiter=",", skiprows=1)
    with open(base + "_labels.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    lab = dict(zip(rows[0], rows[1]))
    with open(base + "_param.csv", newline="", encoding="utf-8") as f:
        pr = list(csv.DictReader(f))[0]
    with open(base + "_meta.csv", newline="", encoding="utf-8") as f:
        me = list(csv.DictReader(f))[0]
    fs = float(pr["samplingrate_pleth"])
    if fs != CAPNO_FS or float(pr["samplingrate_co2"]) != CAPNO_FS or float(pr["samplingrate_ecg"]) != CAPNO_FS:
        raise ValueError(f"CapnoBase {rid}: 샘플률 300Hz 아님")
    if sig.ndim != 2 or sig.shape[1] != 3:
        raise ValueError(f"CapnoBase {rid}: 신호 열 3개(co2,pleth,ecg) 아님")
    ppg, n_nan = fill_nan(sig[:, 1].astype(np.float64))
    ecg, _ = fill_nan(sig[:, 2].astype(np.float64))
    insp = _tokens(lab["co2_startinsp_x"]) / fs
    ecg_pk = _tokens(lab["ecg_peak_x"]) / fs
    age_txt = (me.get("subject_age") or "").strip()
    age = float(age_txt) if age_txt else float("nan")
    group = "unknown" if age != age else ("adult" if age >= CAPNO_ADULT_MIN_AGE else "pediatric")
    return Record(
        ds="capnobase",
        rid=rid,
        fs=fs,
        ppg=ppg,
        resp_events={"co2_startinsp": np.sort(insp)},
        beats_truth=np.sort(ecg_pk),
        ecg=ecg,
        ecg_fs=fs,
        meta={"n_samples": int(len(ppg)), "ppg_nan": n_nan, "age": age, "age_group": group, "ventilation": pr.get("case_ventilation", ""), "co2_artif": lab["co2_artif_x"].strip() != "", "n_breaths": int(len(insp)), "n_ecg_peaks": int(len(ecg_pk))},
    )


def load_capnobase(rid: str) -> Record:
    require_open("capnobase", rid)
    return parse_capnobase(rid)


def load_record(ds: str, rid: str) -> Record:
    if ds == "bidmc":
        return load_bidmc(rid)
    if ds == "marsh":
        return load_marsh(rid)
    if ds == "mimic_nonaf":
        return load_mimic("non_af", rid)
    if ds == "mimic_af":
        return load_mimic("af", rid)
    if ds == "dalia":
        return load_dalia(rid)
    if ds == "capnobase":
        return load_capnobase(rid)
    raise PermissionError(f"데이터셋 {ds} 는 개발 중 열 수 없음 (홀드아웃 전용 또는 미지원)")

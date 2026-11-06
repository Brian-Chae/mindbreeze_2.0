"""데이터셋 어댑터 (읽기 전용). 모든 로더는 guard.require_open 을 먼저 거친다 — 홀드아웃은 열리지 않는다."""
from __future__ import annotations

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
    return Record(ds="bidmc", rid=rid, fs=fs, ppg=ppg, resp_events=ev, beats_truth=None, ecg=ecg, ecg_fs=fs, meta={"n_samples": int(len(ppg))})


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
    return Record(ds=ds, rid=rid, fs=fs, ppg=a[:, 1].astype(np.float64), ecg=a[:, 2].astype(np.float64), ecg_fs=fs, meta={"n_samples": int(len(a))})


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
    raise PermissionError(f"데이터셋 {ds} 는 개발 중 열 수 없음 (홀드아웃 전용 또는 미지원)")

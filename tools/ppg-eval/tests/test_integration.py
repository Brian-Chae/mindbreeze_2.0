"""H2: 코어 호출 경로 입력 변환의 독립 교차 계산 (BIDMC 01). 코어의 디코더/ppg_eval.convert 의 패킷화를 쓰지 않고 바이트를 직접 해독."""
import math
import os
import struct

import numpy as np
import pytest
from scipy.signal import butter, find_peaks, resample_poly, sosfiltfilt

from ppg_eval.adapters.loaders import load_record
from ppg_eval.convert import prepare
from ppg_eval.core_runner import build, core_provenance, run_core
from ppg_eval.evaluate import core_beats

WORK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "work")


@pytest.fixture(scope="module")
def bidmc01():
    core_provenance()
    build()
    os.makedirs(WORK, exist_ok=True)
    rec = load_record("bidmc", "01")
    pk, info, ir, x50 = prepare(rec.ppg, rec.fs)
    path = os.path.join(WORK, "h2_bidmc01.pkts")
    open(path, "wb").write(pk)
    return rec, pk, run_core(path)


def independent_ir(raw125: np.ndarray) -> np.ndarray:
    """verify V5/A1 를 convert.py 와 따로 다시 쓴 구현."""
    x = resample_poly(raw125, 2, 5)  # 125→50
    # 극성: 0.5–8Hz 영위상 → 차분 → p01/p99
    d = np.diff(sosfiltfilt(butter(2, [0.5, 8.0], btype="band", fs=50.0, output="sos"), x))
    if abs(np.percentile(d, 1)) > np.percentile(d, 99):
        x = -x
    ac = np.std(sosfiltfilt(butter(2, [1.0, 5.0], btype="band", fs=50.0, output="sos"), x))
    v = 1_150_000.0 + (x - x.mean()) * (70.0 / ac)
    return np.clip(np.rint(v), 0, 0xFFFFFF).astype(np.int64)[: (len(x) // 50) * 50]


def decode_pkts(b: bytes):
    o, ir, ticks, arrs = 0, [], [], []
    while o < len(b):
        arr, ln = struct.unpack_from("<QI", b, o)
        body = b[o + 12 : o + 12 + ln]
        o += 12 + ln
        assert (ln - 4) % 6 == 0 and (ln - 4) // 6 == 50
        ticks.append(struct.unpack_from("<I", body, 0)[0])
        arrs.append(arr)
        for i in range(50):
            red = int.from_bytes(body[4 + i * 6 : 7 + i * 6], "big")
            irv = int.from_bytes(body[7 + i * 6 : 10 + i * 6], "big")
            assert red == irv
            ir.append(irv)
    return np.asarray(ir, dtype=np.int64), ticks, arrs


def test_h2_decoded_ir_matches_independent(bidmc01):
    rec, pk, _ = bidmc01
    dec, ticks, arrs = decode_pkts(pk)
    ind = independent_ir(rec.ppg)
    assert len(dec) == len(ind) == 480 * 50
    assert int(np.max(np.abs(dec - ind))) <= 1  # 허용 ≤1 count (실제로는 0 이어야 함)
    # 틱: 마지막 샘플 인덱스 × 32768/50 (패킷 k 의 마지막 샘플 = 50(k+1)−1)
    exp = [int(round((50 * (k + 1) - 1) * 32768.0 / 50.0)) for k in range(480)]
    assert ticks == exp
    assert arrs[1] - arrs[0] == 1_000_000  # 1초 간격 실시간


def test_h2_core_beats_vs_independent_filtered_peaks(bidmc01):
    rec, pk, rows = bidmc01
    dec, _, _ = decode_pkts(pk)
    x = dec.astype(float)
    y = sosfiltfilt(butter(2, [1.0, 5.0], btype="band", fs=50.0, output="sos"), x - x.mean())
    pk_idx, _ = find_peaks(y, distance=int(0.3 * 50), prominence=np.std(y) * 0.5)
    ind = pk_idx / 50.0
    cb = core_beats(rows)
    assert len(cb) > 300
    # addendum A2: 레코드 중앙값 지연을 빼고 ±2샘플(40ms) 이내 비율
    def nearest_delta(c, ref):
        j = np.clip(np.searchsorted(ref, c), 1, len(ref) - 1)
        left, right = ref[j - 1], ref[j]
        return np.where(np.abs(c - left) < np.abs(c - right), c - left, c - right)

    d = nearest_delta(cb, ind)
    lag = float(np.median(d))
    frac_raw = float(np.mean(np.abs(d) <= 0.040))
    frac_corr = float(np.mean(np.abs(d - lag) <= 0.040))
    print(f"H2 박동: 지연 중앙값={lag * 1000:.1f}ms, 지연제거 전 ±40ms={frac_raw:.3f}, 후={frac_corr:.3f}")
    assert frac_corr >= 0.95


def test_h2_core_hr_vs_independent_peak_hr(bidmc01):
    rec, pk, rows = bidmc01
    dec, _, _ = decode_pkts(pk)
    x = dec.astype(float)
    y = sosfiltfilt(butter(2, [1.0, 5.0], btype="band", fs=50.0, output="sos"), x - x.mean())
    pk_idx, _ = find_peaks(y, distance=int(0.3 * 50), prominence=np.std(y) * 0.5)
    ind_hr = 60.0 * len(pk_idx) / 480.0
    core_hr = float(np.median([r["hr"] for r in rows[60:] if r["hr"] is not None]))
    print(f"H2 HR: 코어 중앙값={core_hr:.1f}, 독립 피크 HR={ind_hr:.1f}")
    assert abs(core_hr - ind_hr) <= 3.0

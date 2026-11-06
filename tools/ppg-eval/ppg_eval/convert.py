"""원 PPG → 50Hz → 코어 입력 패킷(.pkts). verify.md V5 + addendum A1/A3 구현."""
from __future__ import annotations

import math
import struct

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt

from .common import EPOCH_US, IR_AC_STD, IR_DC


def to_50hz(x: np.ndarray, fs: float) -> np.ndarray:
    fs_i = int(round(fs))
    g = math.gcd(50, fs_i)
    return resample_poly(x, 50 // g, fs_i // g)


def polarity_flip(x50: np.ndarray) -> bool:
    """addendum A1: 0.5–8Hz 영위상 대역통과 후 1차 차분의 p01/p99 로 극성 판정."""
    sos = butter(2, [0.5, 8.0], btype="band", fs=50.0, output="sos")
    d = np.diff(sosfiltfilt(sos, x50))
    return bool(abs(np.percentile(d, 1)) > np.percentile(d, 99))


def scale_ir(x50: np.ndarray):
    """V5: ir = round(1.15M + (x-mean)*g), g = 70/std(1-5Hz 영위상). uint24 클립 수 반환."""
    sos = butter(2, [1.0, 5.0], btype="band", fs=50.0, output="sos")
    ac = float(np.std(sosfiltfilt(sos, x50)))
    g = IR_AC_STD / ac if ac > 0 else 1.0
    ir = np.rint(IR_DC + (x50 - np.mean(x50)) * g)
    clipped = int(np.sum((ir < 0) | (ir > 0xFFFFFF)))
    ir = np.clip(ir, 0, 0xFFFFFF).astype(np.int64)
    return ir, g, clipped


def sample_tick(idx: int) -> int:
    return int(round(idx * 32768.0 / 50.0))


def build_packets(ir: np.ndarray) -> bytes:
    """50샘플/패킷. 헤더 u32 LE = 마지막 샘플 tick. 도착시각 = EPOCH + (k+1)*1e6 µs. 반환: .pkts 바이트."""
    n_pk = len(ir) // 50
    out = bytearray()
    for k in range(n_pk):
        body = bytearray()
        last_idx = (k + 1) * 50 - 1
        body += struct.pack("<I", sample_tick(last_idx) & 0xFFFFFFFF)
        for v in ir[k * 50 : (k + 1) * 50]:
            v = int(v)
            b3 = bytes([(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF])
            body += b3 + b3  # red = ir 복제
        arr = EPOCH_US + (k + 1) * 1_000_000
        out += struct.pack("<QI", arr, len(body)) + bytes(body)
    return bytes(out)


def prepare(x: np.ndarray, fs: float):
    """반환: (pkts_bytes, info dict, ir int array, x50 float array). 극성 반전 후 스케일."""
    x50 = to_50hz(x, fs)
    flipped = polarity_flip(x50)
    if flipped:
        x50 = -x50
    ir, g, clipped = scale_ir(x50)
    n_pk = len(ir) // 50
    ir = ir[: n_pk * 50]
    info = {"flipped": flipped, "gain": float(g), "uint24_clipped": clipped, "n_packets": n_pk, "duration_s": float(n_pk)}
    return build_packets(ir), info, ir, x50[: n_pk * 50]

"""SDD-327 T3 — 뇌파 1/f(비주기) 기울기 산출.

시안(daegu-group-1112 분석, methods.md)과 같은 알고리즘:
  원시 EEG(250Hz, 2ch) → 4초 Hann Welch PSD, 2초 간격, 선형 추세 제거
  → 창·채널 품질 거름(|진폭| ≤ 150µV, 표준편차 ≥ 0.05) → 양호 채널 평균 PSD
  → 유효 창 PSD 의 중앙값 → specparam SpectralModel(fixed, 2–40Hz,
    피크폭 1–8Hz, 최대 5피크, 최소 높이 0.1) → 지수(exponent)
  → 유효 합산 < 180초 이면 insufficient_window, R² < 0.9 이면 poor_fit.

구성
- 순수 계산(`compute_aperiodic`): 배열만 받는다. I/O·DB 없음 → 단위 테스트·골든 비교용.
- 청크 로더(`load_eeg_array`): 디코더(biosignal_decoder)로 청크를 절대시각 배열에 배치.
- 진입점(`compute_member_aperiodic`): DB 청크 조회 + S3 읽기 + 계산. 예외는 모두 삼켜
  결측 코드로 바꾼다 — 1/f 실패가 리포트 전체 생성을 막지 않는다.

결측 코드는 `app.schemas.member_report.MissingReason` 의 no_raw / insufficient_window / poor_fit.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Literal, Optional

import numpy as np

logger = logging.getLogger(__name__)

AperiodicMissing = Literal["no_raw", "insufficient_window", "poor_fit"]

# ── 시안과 동일한 분석 상수 ─────────────────────────────────────────
FS = 250                      # EEG 표본률(Hz)
WIN_SAMPLES = 4 * FS          # 4초 창
STEP_SAMPLES = 2 * FS         # 2초 간격
AMP_LIMIT_UV = 150.0          # 이 값 초과 창은 해당 채널 제외(눈 깜빡임·움직임)
MIN_SD_UV = 0.05              # 평탄 신호(전극 이탈) 제외
MIN_VALID_SECONDS = 180       # 유효 창 합산 하한 (창 수 × 2초)
MIN_WINDOWS = 5               # 중앙값을 낼 최소 창 수
FIT_RANGE_HZ = (2.0, 40.0)
MIN_R2 = 0.9
PSD_MIN_HZ = 1.0


@dataclass(frozen=True)
class AperiodicResult:
    """1/f 산출 결과. state='ok' 면 exponent·r2 가 채워지고, 아니면 missing_reason 만 의미 있다."""

    state: Literal["ok", "missing"]
    exponent: Optional[float] = None
    offset: Optional[float] = None
    r2: Optional[float] = None
    valid_seconds: int = 0
    missing_reason: Optional[AperiodicMissing] = None


def _missing(reason: AperiodicMissing, valid_seconds: int = 0, r2: Optional[float] = None) -> AperiodicResult:
    return AperiodicResult(state="missing", r2=r2, valid_seconds=valid_seconds, missing_reason=reason)


# ── 순수 계산 ──────────────────────────────────────────────────────
def window_psd(x: np.ndarray, fs: int = FS) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(2, n) µV 배열 → 4초 창(2초 간격)별 채널 PSD·최대진폭·표준편차.

    NaN 이 하나라도 든 창·채널은 PSD=NaN, MX=SD=NaN 이다.
    반환: (f, P[win,2,freq], MX[win,2], SD[win,2])
    """
    from scipy.signal import detrend, welch

    n = x.shape[1]
    f_all = np.fft.rfftfreq(WIN_SAMPLES, 1 / fs)
    sel = (f_all >= PSD_MIN_HZ) & (f_all <= 100)
    if n < WIN_SAMPLES:
        return f_all[sel], np.empty((0, 2, int(sel.sum()))), np.empty((0, 2)), np.empty((0, 2))
    starts = np.arange(0, n - WIN_SAMPLES + 1, STEP_SAMPLES)
    # (win, 2, 1000) 뷰 → 메모리 복사는 정상 창에 대해서만 한다
    view = np.lib.stride_tricks.sliding_window_view(x, WIN_SAMPLES, axis=1)[:, ::STEP_SAMPLES, :]
    segs = np.transpose(view, (1, 0, 2))[: len(starts)]
    finite = ~np.isnan(segs).any(axis=2)  # (win, 2)
    p_out = np.full((len(starts), 2, int(sel.sum())), np.nan, dtype=np.float64)
    mx = np.full((len(starts), 2), np.nan)
    sd = np.full((len(starts), 2), np.nan)
    for c in range(2):
        idx = np.where(finite[:, c])[0]
        if idx.size == 0:
            continue
        y = detrend(segs[idx, c, :].astype(np.float64), axis=-1)
        mx[idx, c] = np.abs(y).max(axis=1)
        sd[idx, c] = y.std(axis=1)
        _, p = welch(y, fs=fs, nperseg=WIN_SAMPLES, noverlap=0, window="hann", detrend=False, axis=-1)
        p_out[idx, c, :] = p[:, sel]
    return f_all[sel], p_out, mx, sd


def compute_aperiodic(x: np.ndarray, fs: int = FS) -> AperiodicResult:
    """(2, n) µV 연속 배열(결측=NaN) → 1/f 지수. 입력은 변경하지 않는다."""
    if x.ndim != 2 or x.shape[0] != 2 or x.shape[1] < WIN_SAMPLES:
        return _missing("insufficient_window")
    f, p, mx, sd = window_psd(x, fs)
    ok_ch = (mx <= AMP_LIMIT_UV) & (sd >= MIN_SD_UV) & ~np.isnan(mx)  # (win, 2)
    any_ok = ok_ch.any(axis=1)
    valid_s = int(any_ok.sum()) * 2
    if int(any_ok.sum()) < MIN_WINDOWS or valid_s < MIN_VALID_SECONDS:
        return _missing("insufficient_window", valid_s)
    masked = np.where(ok_ch[:, :, None], p, np.nan)[any_ok]  # 유효 창만 (양호하지 않은 채널=NaN)
    pm = np.nanmean(masked, axis=1)  # (유효창, freq) — 양호 채널 평균
    psd = np.median(pm, axis=0)
    try:
        from specparam import SpectralModel

        model = SpectralModel(peak_width_limits=(1, 8), max_n_peaks=5, min_peak_height=0.1,
                              aperiodic_mode="fixed", verbose=False)
        model.fit(f, psd, list(FIT_RANGE_HZ))
        ap = model.results.params.aperiodic.params
        offset, exponent = float(ap[0]), float(ap[1])
        r2 = float(model.results.metrics.results["gof_rsquared"])
    except Exception as exc:  # noqa: BLE001 — 적합 실패는 poor_fit 으로 취급
        logger.warning("[aperiodic] specparam 적합 실패: %s", exc)
        return _missing("poor_fit", valid_s)
    if not (np.isfinite(exponent) and np.isfinite(r2)) or r2 < MIN_R2:
        return _missing("poor_fit", valid_s, r2 if np.isfinite(r2) else None)
    return AperiodicResult("ok", exponent=exponent, offset=offset, r2=r2, valid_seconds=valid_s)


# ── 청크 로더 ──────────────────────────────────────────────────────
Reader = Callable[[str], Optional[bytes]]


def place_samples(
    samples: Iterable[tuple[float, float, float]], t_lo_ms: float, t_hi_ms: float, fs: int = FS
) -> np.ndarray:
    """(utc_ms, fp1, fp2) 표본을 [t_lo, t_hi] 절대시각 격자에 배치한다. 빈 곳은 NaN(보간 금지)."""
    n = int((t_hi_ms - t_lo_ms) / 1000 * fs) + 1
    arr = np.full((2, max(n, 0)), np.nan)
    for t_ms, a, b in samples:
        i = int(round((t_ms - t_lo_ms) * fs / 1000))
        if 0 <= i < n:
            arr[0, i] = a
            arr[1, i] = b
    return arr


def chunk_utc_span_ms(header: object) -> Optional[tuple[float, float]]:
    """청크 헤더(dict)의 UTC 앵커로 절대 [시작, 끝] ms 를 계산. 앵커 없거나 해석 불가면 None."""
    if not isinstance(header, dict):
        return None
    try:
        anchor = header["anchor"]
        utc_us = anchor.get("utc_us")
        if utc_us is None:
            return None
        n = int(header["sample_count"])
        t0 = int(utc_us) / 1000.0 + (int(header["first_sample_index"]) - int(anchor["sample_index"])) * 1000.0 / FS
        return t0, t0 + n * 1000.0 / FS
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def load_eeg_array(chunks: list, reader: Reader, t_lo_ms: float, t_hi_ms: float) -> Optional[np.ndarray]:
    """EEGRawChunk 행들 → (2, n) 배열. 읽기·디코딩 실패 청크는 건너뛴다(해당 구간은 NaN).

    UTC 앵커가 없는 청크는 시각을 추정하지 않고 건너뛴다. 사용 가능한 청크가 없으면 None.
    """
    from app.schemas.biosignal import RawChunkMeta, RawHeader
    from app.services.biosignal_decoder import DecodeError, decode_raw_chunk_with_gaps

    n = int((t_hi_ms - t_lo_ms) / 1000 * FS) + 1
    if n <= 0:
        return None
    arr = np.full((2, n), np.nan)
    used = 0
    for row in sorted(chunks, key=lambda c: (str(c.stream_id), str(c.segment_id), c.chunk_index)):
        if row.schema_version != "mb-biosignal-raw-v2" or not row.header:
            continue
        # 구간 밖 청크는 내려받지 않는다. 주의: EEGRawChunk.start_ms/end_ms 는 세션 시작 기준
        # 상대 ms(음수 가능)라 절대 UTC 구간과 비교하면 전부 걸러진다 → 헤더 UTC 앵커로 절대 구간을 계산한다.
        # UTC 앵커가 없는 청크는 표본 시각을 알 수 없으므로(utc_us=None) 내려받지 않고 건너뛴다.
        span = chunk_utc_span_ms(row.header)
        if span is None:
            continue
        if span[1] < t_lo_ms - 5000 or span[0] > t_hi_ms + 5000:
            continue
        payload = reader(row.object_key)
        if payload is None:
            continue
        try:
            meta = RawChunkMeta(
                session_id=row.session_id, participant_id=row.participant_id, play_group_id=None,
                chunk_id=row.id, header=RawHeader.model_validate(row.header), checksum=row.checksum,
                size_bytes=row.size_bytes, object_key=row.object_key, object_version_id=row.object_version_id,
            )
            decoded = decode_raw_chunk_with_gaps(payload, meta)
        except (DecodeError, ValueError) as exc:
            logger.warning("[aperiodic] 청크 디코딩 실패(건너뜀): %s", exc)
            continue
        got = False
        for s in decoded.samples:
            if s.utc_us is None:
                continue
            i = int(round((float(s.utc_us) / 1000.0 - t_lo_ms) * FS / 1000))
            if 0 <= i < n:
                arr[0, i], arr[1, i] = s.values[0], s.values[1]
                got = True
        used += int(got)
    return arr if used else None


def compute_member_aperiodic(
    db,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    t_lo_ms: float,
    t_hi_ms: float,
    reader: Optional[Reader] = None,
) -> AperiodicResult:
    """참가자의 [t_lo, t_hi](절대 ms) 구간 EEG 원시에서 1/f 지수를 산출한다. 어떤 실패도 예외로 올리지 않는다."""
    try:
        from sqlalchemy import select

        from app.models.record import EEGRawChunk

        if reader is None:
            from app.services import storage_service

            reader = storage_service.download_bytes
        rows = list(db.execute(select(EEGRawChunk).where(
            EEGRawChunk.session_id == session_id, EEGRawChunk.participant_id == participant_id,
            EEGRawChunk.signal_type == "eeg", EEGRawChunk.upload_status == "uploaded",
        )).scalars())
        if not rows:
            return _missing("no_raw")
        arr = load_eeg_array(rows, reader, t_lo_ms, t_hi_ms)
        if arr is None:
            return _missing("no_raw")
        return compute_aperiodic(arr)
    except Exception as exc:  # noqa: BLE001 — 1/f 실패가 리포트 생성을 막지 않는다
        logger.warning("[aperiodic] 산출 실패: %s", exc)
        return _missing("no_raw")

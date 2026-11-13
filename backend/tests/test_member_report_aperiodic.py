"""SDD-327 T3 — 뇌파 1/f 기울기 산출 테스트 (합성 신호만 사용, 실데이터 금지)."""
import uuid
from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("specparam")

from app.services import member_report_aperiodic as ap  # noqa: E402


def _pink(exponent: float, seconds: int, seed: int, sd_uv: float = 8.0) -> np.ndarray:
    """파워 ∝ 1/f^exponent 인 백색→유색 잡음 (µV)."""
    rng = np.random.default_rng(seed)
    n = seconds * ap.FS
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / ap.FS)
    f[0] = f[1]
    spec *= f ** (-exponent / 2)  # 진폭 = f^(-e/2) → 파워 = f^(-e)
    x = np.fft.irfft(spec, n)
    return x / x.std() * sd_uv


def _two_ch(exponent: float, seconds: int = 300) -> np.ndarray:
    return np.vstack([_pink(exponent, seconds, 1), _pink(exponent, seconds, 2)])


@pytest.mark.parametrize("true_exp", [1.0, 1.5, 2.0])
def test_합성_1_f_기울기_복원(true_exp):
    r = ap.compute_aperiodic(_two_ch(true_exp))
    assert r.state == "ok" and r.missing_reason is None
    assert r.exponent == pytest.approx(true_exp, abs=0.15)
    assert r.r2 >= ap.MIN_R2
    assert r.valid_seconds >= ap.MIN_VALID_SECONDS


def test_입력_배열을_변경하지_않는다():
    x = _two_ch(1.5)
    before = x.copy()
    ap.compute_aperiodic(x)
    assert np.array_equal(x, before)


def test_결측_insufficient_window_짧은_신호():
    r = ap.compute_aperiodic(_two_ch(1.5, seconds=60))
    assert (r.state, r.missing_reason) == ("missing", "insufficient_window")


def test_결측_insufficient_window_진폭_초과_창이_많음():
    x = _two_ch(1.5, seconds=300)
    x[:, : 200 * ap.FS] *= 100  # 앞 200초는 150µV 초과 → 제외, 남은 100초 < 180초
    r = ap.compute_aperiodic(x)
    assert (r.state, r.missing_reason) == ("missing", "insufficient_window")
    assert r.valid_seconds < ap.MIN_VALID_SECONDS


def test_NaN_구간은_보간하지_않고_제외():
    x = _two_ch(1.5, seconds=300)
    x[:, 100 * ap.FS : 200 * ap.FS] = np.nan  # 100초 공백 → 유효 약 200초
    r = ap.compute_aperiodic(x)
    assert r.state == "ok"
    assert r.valid_seconds <= 200


def test_결측_poor_fit_적합도_미달(monkeypatch):
    import specparam

    class _Bad:
        def __init__(self, **_kw):
            pass

        def fit(self, *_a, **_k):
            ap_params = np.array([1.0, 1.5])
            self.results = SimpleNamespace(
                params=SimpleNamespace(aperiodic=SimpleNamespace(params=ap_params)),
                metrics=SimpleNamespace(results={"gof_rsquared": 0.5}),
            )

    monkeypatch.setattr(specparam, "SpectralModel", _Bad)
    r = ap.compute_aperiodic(_two_ch(1.5))
    assert (r.state, r.missing_reason) == ("missing", "poor_fit")
    assert r.r2 == 0.5


def test_결측_poor_fit_적합_예외(monkeypatch):
    import specparam

    class _Boom:
        def __init__(self, **_kw):
            pass

        def fit(self, *_a, **_k):
            raise RuntimeError("fit failed")

    monkeypatch.setattr(specparam, "SpectralModel", _Boom)
    assert ap.compute_aperiodic(_two_ch(1.5)).missing_reason == "poor_fit"


class _FakeDb:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, *_a, **_k):
        return SimpleNamespace(scalars=lambda: iter(self._rows))


def test_결측_no_raw_청크_없음():
    r = ap.compute_member_aperiodic(_FakeDb([]), uuid.uuid4(), uuid.uuid4(), 0.0, 300_000.0, reader=lambda k: None)
    assert (r.state, r.missing_reason) == ("missing", "no_raw")


def test_결측_no_raw_객체_읽기_실패():
    row = SimpleNamespace(schema_version="mb-biosignal-raw-v2", header={"x": 1}, object_key="k",
                          stream_id="s", segment_id="g", chunk_index=0, start_ms=0, end_ms=1000)
    r = ap.compute_member_aperiodic(_FakeDb([row]), uuid.uuid4(), uuid.uuid4(), 0.0, 300_000.0, reader=lambda k: None)
    assert r.missing_reason == "no_raw"


def test_예외는_삼키고_결측으로_반환():
    class _BoomDb:
        def execute(self, *_a, **_k):
            raise RuntimeError("db down")

    r = ap.compute_member_aperiodic(_BoomDb(), uuid.uuid4(), uuid.uuid4(), 0.0, 1000.0, reader=lambda k: None)
    assert r.state == "missing"


def test_place_samples_격자_배치와_빈칸_NaN():
    arr = ap.place_samples([(0.0, 1.0, 2.0), (4.0, 3.0, 4.0), (12.0, 5.0, 6.0)], 0.0, 20.0)
    assert arr[0, 0] == 1.0 and arr[1, 1] == 4.0 and arr[0, 3] == 5.0
    assert np.isnan(arr[0, 2])


def test_chunk_utc_span_ms_앵커로_절대구간을_계산():
    h = {"anchor": {"utc_us": "1794302909649000", "sample_index": 0}, "first_sample_index": 250, "sample_count": 2500}
    lo, hi = ap.chunk_utc_span_ms(h)
    assert lo == pytest.approx(1794302909649 + 1000.0)
    assert hi - lo == pytest.approx(10000.0)
    assert ap.chunk_utc_span_ms({"anchor": {"utc_us": None, "sample_index": 0}, "first_sample_index": 0, "sample_count": 1}) is None
    assert ap.chunk_utc_span_ms(None) is None


def test_상대_start_ms_청크도_읽는다_UTC_앵커_기준_필터(monkeypatch):
    """회귀: EEGRawChunk.start_ms/end_ms 는 세션 시작 기준 상대 ms(음수 가능). 절대 UTC 구간과 직접 비교하면 전부 걸러졌다."""
    t_lo = 1_794_300_000_000.0
    header = {"anchor": {"utc_us": str(int(t_lo * 1000)), "sample_index": 0}, "first_sample_index": 0, "sample_count": 2500}
    read = []
    row = SimpleNamespace(schema_version="mb-biosignal-raw-v2", header=header, object_key="k", stream_id="s", segment_id="g",
                          chunk_index=0, start_ms=-96.0, end_ms=9_900.0, session_id=uuid.uuid4(), participant_id=uuid.uuid4(),
                          id=uuid.uuid4(), checksum="0" * 64, size_bytes=1, object_version_id=None)

    def reader(key):
        read.append(key)
        return None  # 다운로드 시도만 확인(디코딩은 다른 테스트가 다룬다)

    ap.load_eeg_array([row], reader, t_lo, t_lo + 60_000)
    assert read == ["k"]  # 상대 start_ms(-96) 때문에 건너뛰지 않고 내려받는다
    read.clear()
    ap.load_eeg_array([row], reader, t_lo + 3_600_000, t_lo + 3_660_000)
    assert read == []  # 구간 밖(앵커 기준)이면 내려받지 않는다


def test_UTC_앵커_없는_청크는_내려받지_않는다():
    header = {"anchor": {"utc_us": None, "sample_index": 0}, "first_sample_index": 0, "sample_count": 2500}
    row = SimpleNamespace(schema_version="mb-biosignal-raw-v2", header=header, object_key="k", stream_id="s", segment_id="g",
                          chunk_index=0, start_ms=0.0, end_ms=1.0)
    called = []
    assert ap.load_eeg_array([row], lambda k: called.append(k), 0.0, 60_000.0) is None
    assert called == []

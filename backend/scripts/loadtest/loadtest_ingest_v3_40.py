"""SDD-260 QA — 40명 저장 완결성 부하 시험 (REST 배치 정본 저장, 소켓은 방송 전용). 시험 데이터 접두사 `LT40S-`.

저장 경로(계약 specs/sdd-260-live-ingest-bottleneck/contract.md):
  feature : POST /sessions/{sid}/features/batch  (5초 주기, ≤60창)   ← 정본. 소켓 live:metric 은 방송만.
  원시    : POST /biosignal-raw/presign → PUT(S3) → POST /biosignal-raw/ack  (10초 청크 × eeg/ppg/acc)
  대조    : GET /features/summary, GET /biosignal-raw/summary (+ 선택: DB·S3 직접 대조)

서브커맨드:
  setup   게스트 N명 가입·동의·입장(자격은 상태 파일에 저장 — 비밀번호는 저장 안 함)
  run     본 시험(합성 40기기) → 종료 후 summary 대조·재전송 → 합격/불합격 판정 + JSON·MD 리포트

환경변수(자격 증명을 파일·인자로 받지 않는다):
  LT40S_API            기본 https://dev-api.mindbreeze.looxidlabs.com
  LT40S_COUNSELOR_PW   호스트(상담사) 비밀번호 — run(소켓 session.start)·host 대조에 필요
  LT40S_DATABASE_URL   (선택) 읽기 전용 PG DSN — DB 창 수·중복·원시 상태 대조
  LT40S_S3_BUCKET      (선택) 기본 mindbreeze-dev. S3 HEAD 대조는 DB 대조가 켜졌을 때만, AWS 기본 자격 체인 사용
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import random
import struct
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

import httpx

API_DEFAULT = "https://dev-api.mindbreeze.looxidlabs.com"
NS = "/session-live"
PREFIX = "LT40S-"
SHARE_DIR = os.path.expanduser("~/.hermes/share/loadtest-40s")
STATE_FILE = os.path.join(SHARE_DIR, "state.json")

BATCH_PERIOD_S = 5.0          # 계약: 5초 주기
BATCH_MAX = 60                # 계약: ≤60창 (서버 상한 300)
CHUNK_SECS = 10
RATES = {"eeg": 250, "ppg": 50, "acc": 30}
STRIDE = {"eeg": 17, "ppg": 8, "acc": 18}
PKT_SAMPLES = {"eeg": 25, "ppg": 5, "acc": 3}
PKT_ROW = {"eeg": 7, "ppg": 6, "acc": 6}
ENC = {"eeg": "eeg-i32-i32-u8-f32-f32-le", "ppg": "ppg-u32-u32-le", "acc": "acc-i16-i16-i16-f32-f32-f32-le"}
EEG_SCALE = 4.033 / 12 / (2 ** 23 - 1) * 1e6
CH = {"eeg": (["fp1", "fp2"], ["uV", "uV"], [EEG_SCALE] * 2), "ppg": (["red", "ir"], ["ADC_count"] * 2, [1.0, 1.0]),
      "acc": (["x", "y", "z"], ["g"] * 3, [2 / 32768] * 3)}
UNITS = {
    "focus_raw": "index_raw", "focus_display": "score_0_100", "relaxation_raw": "index_raw", "relaxation_display": "score_0_100",
    "emotion_raw": "index_raw", "emotion_display": "score_0_100", "bpm": "beats_per_min", "respiration": "breaths_per_min", "sdnn": "ms",
    "tna_raw": "index_raw", "delta_power": "power_raw", "theta_power": "power_raw", "alpha_power": "power_raw", "beta_power": "power_raw",
    "gamma_power": "power_raw", "total_power": "power_raw", "stress_index": "index_raw", "cognitive_load": "index_raw", "faa": "index_raw",
    "hemispheric_balance": "index_raw", "rmssd": "ms", "lf_power": "power_raw", "hf_power": "power_raw", "lf_hf_ratio": "index_raw",
    "motion": "ratio_0_1",
}
SCENARIOS = ("normal", "netdrop", "sockblock", "mixed-close", "dup-resend", "rate429")


# ------------------------------------------------------------------ 시계 (시험 가속용)
class Clock:
    """가상 초 단위 시계. scale=10 이면 가상 1초 = 실제 0.1초 (스모크·단위시험용). 본 시험은 scale=1."""

    def __init__(self, scale: float = 1.0):
        self.scale = scale
        self.t0 = time.monotonic()

    def now(self) -> float:
        return (time.monotonic() - self.t0) * self.scale

    async def sleep(self, virtual_s: float) -> None:
        if virtual_s > 0:
            await asyncio.sleep(virtual_s / self.scale)

    async def sleep_until(self, virtual_t: float) -> None:
        await self.sleep(virtual_t - self.now())


# ------------------------------------------------------------------ 통계
class Stats:
    def __init__(self) -> None:
        self.lat: dict[str, list[float]] = {}
        self.http: dict[str, dict[str, int]] = {}      # kind -> {"200": n, "429": n, "exc:ConnectError": n}
        self.reject_codes: dict[str, int] = {}          # REST 창 단위 거절 코드
        self.result_status: dict[str, int] = {"accepted": 0, "duplicate": 0, "rejected": 0}
        self.retry_429 = 0
        self.events: list[str] = []

    def rec(self, kind: str, dt: float, outcome: str) -> None:
        self.lat.setdefault(kind, []).append(dt)
        d = self.http.setdefault(kind, {})
        d[outcome] = d.get(outcome, 0) + 1

    def ev(self, text: str) -> None:
        self.events.append(f"{time.strftime('%H:%M:%S')} {text}")

    def latency_summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in self.lat.items():
            s = sorted(v)
            n = len(s)

            def q(p: float) -> float:
                return round(s[min(n - 1, int(n * p))] * 1000, 1)

            out[k] = {"n": n, "p50_ms": q(.5), "p95_ms": q(.95), "p99_ms": q(.99), "max_ms": round(s[-1] * 1000, 1)}
        return out


# ------------------------------------------------------------------ 네트워크 장애 주입 (httpx 전송 계층)
@dataclass
class Fault:
    start: float                  # 가상 초
    end: float
    mode: str                     # drop | delay | status
    param: float = 0.0            # delay: 초, status: HTTP 코드
    prob: float = 1.0
    only: Optional[str] = None    # "api" | "s3" | None(전부)


class FaultTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport, clock: Clock, rng: random.Random, api_host: str):
        self.inner, self.clock, self.rng, self.api_host = inner, clock, rng, api_host
        self.faults: list[Fault] = []
        self.injected = {"drop": 0, "delay": 0, "status": 0}

    def add(self, f: Fault) -> None:
        self.faults.append(f)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        now = self.clock.now()
        is_api = request.url.host == self.api_host
        for f in self.faults:
            if not (f.start <= now < f.end) or self.rng.random() > f.prob:
                continue
            if f.only and (f.only == "api") != is_api:
                continue
            if f.mode == "drop":
                self.injected["drop"] += 1
                await self.clock.sleep(0.2)
                raise httpx.ConnectError("injected network drop", request=request)
            if f.mode == "delay":
                self.injected["delay"] += 1
                await self.clock.sleep(f.param)
            elif f.mode == "status":
                self.injected["status"] += 1
                hdr = {"Retry-After": "2"} if int(f.param) == 429 else {}
                return httpx.Response(int(f.param), headers=hdr, json={"detail": {"code": "injected"}}, request=request)
        return await self.inner.handle_async_request(request)


# ------------------------------------------------------------------ 합성 데이터 (결정적 — 재전송 시 동일 바이트·해시)
def _det_bytes(seed: str, n: int) -> bytes:
    return hashlib.shake_256(seed.encode()).digest(n)


def build_chunk(signal: str, stream_id: str, segment_id: str, index: int, anchor_us: int) -> tuple[dict, bytes]:
    n = RATES[signal] * CHUNK_SECS
    first = index * n
    stride = STRIDE[signal]
    seed = f"{signal}|{stream_id}|{segment_id}|{index}"
    samples = _det_bytes(seed + "|s", n * stride)
    rng = random.Random(seed)
    pk_n = max(1, n // PKT_SAMPLES[signal])
    ln = 4 + PKT_ROW[signal] * PKT_SAMPLES[signal]
    packets = _det_bytes(seed + "|p", pk_n * ln)
    pmap, off = [], 0
    for p in range(pk_n):
        pmap.append(json.dumps({
            "packet_seq": index * pk_n + p, "byte_offset": off, "byte_length": ln, "first_sample_index": first + p * PKT_SAMPLES[signal],
            "sample_count": PKT_SAMPLES[signal], "tick_raw": str(rng.randrange(2 ** 32)), "tick_unwrapped": str(rng.randrange(2 ** 40)),
            "received_utc_us": str(anchor_us + p * 100000), "received_monotonic_us": str(anchor_us + p * 100000),
            "header_anchor": "last_sample", "clock_segment_id": segment_id, "malformed_reason": None}) + "\n")
        off += ln
    pmap_b = "".join(pmap).encode()
    ch, un, sc = CH[signal]
    header = {
        "schema_version": "mb-biosignal-raw-v2", "signal_type": signal, "stream_id": stream_id, "segment_id": segment_id, "chunk_index": index,
        "parser_profile": {"firmware": "unknown", "device_model": "LINK-BAND-2.0", "profile_id": "mb-web-clock-v1", "version": "1",
                           "parameters_hash": "0" * 63 + "1", "platform": "mb-web", "verification": "unverified", "packet_endian": "mixed",
                           "tick_hz": 32768, "tick_bits": 32, "header_anchor": "last_sample"},
        "rate": {"numerator": RATES[signal], "denominator": 1}, "observed_rate": None, "observed_rate_window_us": None,
        "observed_rate_reason": "not_measured", "channels": ch, "units": un, "scale": sc, "sample_count": n, "packet_count": pk_n,
        "first_sample_index": first, "end_sample_index_exclusive": first + n, "time_basis": "host_estimated",
        "anchor": {"sample_index": 0, "utc_us": str(anchor_us), "monotonic_us": str(anchor_us), "relative_us": "0", "device_tick_raw": "1",
                   "device_tick_unwrapped": "1", "clock_segment_id": segment_id, "uncertainty_us": None, "rule": "anchor_plus_index_delta_over_rate"},
        "sections": [{"name": "samples", "offset": 0, "length": len(samples), "row_stride": stride, "encoding": ENC[signal]},
                     {"name": "packets", "offset": len(samples), "length": len(packets), "row_stride": 0, "encoding": "bytes"},
                     {"name": "packet_map", "offset": len(samples) + len(packets), "length": len(pmap_b), "row_stride": 0, "encoding": "utf8-jsonl"}],
    }
    hb = json.dumps(header, sort_keys=True).encode()
    payload = b"MBRAW002" + struct.pack("<I", len(hb)) + hb + samples + packets + pmap_b
    alias = "R" + hashlib.sha256(f"{signal}{stream_id}{segment_id}{index}".encode()).hexdigest()[:30]
    meta = {"chunk_alias": alias, "header": header, "checksum": hashlib.sha256(payload).hexdigest(), "size_bytes": len(payload),
            "content_type": "application/octet-stream"}
    return meta, payload


def metric_window(seq: int, pid: str, sid: str, stream_id: str, gen: str, anchor_id: str, t0_us: int, observed_ms: int) -> dict:
    rng = random.Random(f"{pid}|{stream_id}|{seq}")
    ms: dict[str, Any] = {}
    for k, u in UNITS.items():
        v = round(rng.uniform(0, 100), 3) if k.endswith("_display") else round(rng.uniform(0.1, 3.0), 4)
        if k == "bpm":
            v = round(rng.uniform(60, 90), 1)
        elif k == "motion":
            v = round(rng.uniform(0, 1), 4)
        ms[k] = {"value": v, "unit": u, "validity": "valid", "reason": None, "last_valid_sequence": None, "last_valid_observed_at_ms": None}
    start = t0_us + seq * 1_000_000
    w = {"session_id": sid, "participant_id": pid, "stream_id": stream_id, "stream_generation": gen, "sequence": str(seq),
         "window_start_us": str(start), "window_end_us": str(start + 1_000_000), "observed_at_ms": observed_ms, "clock_anchor_id": anchor_id,
         "clock_uncertainty_ms": 50, "device_profile_version": "linkband-2.0", "algorithm_version": "lt40s-1", "model_version": "lt40s-1",
         "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9, "metrics": ms}
    w["feature_hash"] = hashlib.sha256(json.dumps([pid, stream_id, seq, ms["focus_raw"]["value"]]).encode()).hexdigest()
    return w


def receipt_hash(rows: list[tuple]) -> str:
    """contract.md §3 receipt_hash: (stream_id, segment_id, signal_type, chunk_index, checksum, size_bytes) 오름차순 `|` 연결 SHA-256."""
    ordered = sorted(rows)
    return hashlib.sha256("|".join("|".join(str(x) for x in r) for r in ordered).encode()).hexdigest()


# ------------------------------------------------------------------ 소켓 (방송 전용 + capture.start 로 stream 만 생성)
class LiveSocket:
    """실서버 소켓. 저장에는 관여하지 않는다. connect_join→capture.start→live:metric(방송)."""

    def __init__(self, api: str, sid: str, cred: Optional[str], token: Optional[str], stats: Stats):
        import socketio  # 지연 임포트: 단위시험·REST 전용 실행은 패키지 없이도 동작
        self.api, self.sid, self.cred, self.token, self.stats = api, sid, cred, token, stats
        self.sio = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
        self.epoch, self.gen, self.ready = "0", 1, asyncio.Event()
        self.instance = str(uuid.uuid4())
        self.blocked = False
        self.block_attempts = 0
        self.metric_acks = {"projected": 0, "ignored": 0, "other": 0, "no_ack": 0}
        s = self.sio

        @s.on("live:snapshot", namespace=NS)
        async def _snap(m: dict) -> None:
            self.epoch = str(m.get("epoch", "0"))

        @s.on("live:sync_complete", namespace=NS)
        async def _sync(m: dict) -> None:
            await s.emit("live:applied", {"protocol_version": 2, "schema_version": 1, "session_id": self.sid,
                                          "snapshot_id": m["snapshot_id"], "cursors": []}, namespace=NS)
            self.ready.set()

    async def _call(self, ev: str, data: dict, kind: str, timeout: float = 15) -> Any:
        t0 = time.perf_counter()
        try:
            res = await self.sio.call(ev, data, namespace=NS, timeout=timeout)
        except Exception as e:  # noqa: BLE001
            self.stats.rec("sock:" + kind, time.perf_counter() - t0, "exc:" + type(e).__name__)
            return None
        self.stats.rec("sock:" + kind, time.perf_counter() - t0, "ok")
        return res

    async def connect_join(self) -> bool:
        try:
            await self.sio.connect(self.api, namespaces=[NS], auth={"token": self.token} if self.token else {}, transports=["websocket"], wait_timeout=30)
        except Exception as e:  # noqa: BLE001
            self.stats.ev(f"socket connect 실패: {type(e).__name__}")
            return False
        r = await self._call("live:hello", {"protocol_version": 2, "schema_version": 1, "supported_protocol_versions": [2], "app_build": "lt40s",
                                            "client_instance_id": self.instance, "capabilities": ["http_fallback", "paint_ack"], "core_version": None}, "hello")
        if not (isinstance(r, dict) and r.get("ok")):
            return False
        r = await self._call("live:join", {"protocol_version": 2, "schema_version": 1, "session_id": self.sid, "request_id": str(uuid.uuid4()),
                                           "generation": "1", "last_cursors": [], "entry_credential": self.cred}, "join")
        if not (isinstance(r, dict) and r.get("ok")):
            return False
        try:
            await asyncio.wait_for(self.ready.wait(), 20)
        except asyncio.TimeoutError:
            return False
        return True

    async def command(self, kind: str, payload: dict) -> Any:
        cmd = {"protocol_version": 2, "schema_version": 1, "command_id": str(uuid.uuid4()), "session_id": self.sid, "expected_epoch": self.epoch,
               "kind": kind, "client_generation": str(self.gen), "payload": payload}
        return await self._call("live:command", cmd, "cmd:" + kind)

    async def start_capture(self) -> Optional[tuple[str, str]]:
        r = await self.command("capture.start", {"device_profile": "linkband-2.0", "algorithm_version": "lt40s-1", "model_version": "lt40s-1"})
        res = (r or {}).get("result") or {}
        if not res.get("stream_id"):
            self.stats.ev(f"capture.start 실패 {str(r)[:120]}")
            return None
        stream_id = res["stream_id"]
        gen = str(res.get("owner_generation") or res.get("generation") or "1")
        await self._call("live:device", {"protocol_version": 2, "schema_version": 1, "session_id": self.sid, "stream_id": stream_id, "device_seq": "1",
                                         "band_state": "connected", "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9,
                                         "battery_pct": 80, "state_reason": None}, "device")
        return stream_id, gen

    async def metric(self, window: dict) -> None:
        """방송 전용 전송. 저장 판정에 쓰지 않는다. 차단 중이면 시도만 기록."""
        if self.blocked:
            self.block_attempts += 1
            return
        r = await self._call("live:metric", {"protocol_version": 2, "schema_version": 1, "windows": [window]}, "metric", timeout=5)
        acks = (r or {}).get("acks") if isinstance(r, dict) else None
        if not acks:
            self.metric_acks["no_ack"] += 1
        else:
            st = acks[0].get("status")
            self.metric_acks[st if st in ("projected", "ignored") else "other"] += 1

    async def block(self) -> None:
        """소켓 차단 시뮬레이션: 연결을 끊고 이후 재연결 시도만 센다(REST 는 영향 없음)."""
        self.blocked = True
        try:
            await self.sio.disconnect()
        except Exception:  # noqa: BLE001
            pass

    async def close(self, stream_id: str, finals: dict[str, str]) -> None:
        if not self.blocked:
            await self.command("capture.close", {"stream_id": stream_id, "reason": "user_stopped", "final_sequences": finals})
            try:
                await self.sio.disconnect()
            except Exception:  # noqa: BLE001
                pass

    async def presence_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            if not self.blocked:
                await self._call("live:presence", {"protocol_version": 2, "schema_version": 1, "session_id": self.sid, "instance_id": self.instance,
                                                   "lease_generation": "1", "visibility": "foreground"}, "presence")


# ------------------------------------------------------------------ 로컬 장부 (기기 디스크 대용 — 프로세스 "재실행" 후에도 유지)
@dataclass
class LocalStore:
    pid: str
    sid: str
    cred: str
    name: str
    stream_id: str = ""
    gen: str = "1"
    anchor_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    t0_us: int = 0
    windows: dict[int, dict] = field(default_factory=dict)      # seq -> envelope
    pending: set[int] = field(default_factory=set)
    acked: set[int] = field(default_factory=set)
    quarantined: dict[int, str] = field(default_factory=dict)   # seq -> 거절 코드
    raw_stream: str = field(default_factory=lambda: str(uuid.uuid4()))
    segs: dict[str, str] = field(default_factory=lambda: {s: str(uuid.uuid4()) for s in RATES})
    chunks: dict[str, dict] = field(default_factory=dict)       # alias -> {signal,index,checksum,size}
    raw_pending: set[str] = field(default_factory=set)
    raw_done: set[str] = field(default_factory=set)
    rest_rejected: int = 0
    first_batch_at: Optional[float] = None
    first_presign_at: Optional[float] = None
    resend_notes: dict[str, int] = field(default_factory=lambda: {"feature_resent": 0, "raw_requeued": 0})


class Device:
    """합성 기기 1대. 로컬 장부(LocalStore)에 쌓고 REST 로 비운다. 소켓은 방송만."""

    def __init__(self, store: LocalStore, http: httpx.AsyncClient, base: str, clock: Clock, stats: Stats,
                 sock: Optional[Any], rng: random.Random, retry_deadline: float = 1e12):
        self.s, self.http, self.B, self.clock, self.stats, self.sock, self.rng = store, http, base, clock, stats, sock, rng
        self.retry_deadline = retry_deadline
        self.H = {"X-Entry-Credential": store.cred}
        self.killed = False

    # ---- 공통 REST + 재시도 (429: Retry-After 하한 + full jitter, 5xx/타임아웃: full jitter)
    async def request(self, kind: str, method: str, url: str, **kw: Any) -> Optional[httpx.Response]:
        attempt = 0
        while self.clock.now() < self.retry_deadline and not self.killed:
            t0 = time.perf_counter()
            try:
                r = await self.http.request(method, url, **kw)
            except Exception as e:  # noqa: BLE001
                self.stats.rec(kind, time.perf_counter() - t0, "exc:" + type(e).__name__)
                await self.clock.sleep(self.rng.uniform(0, min(8.0, 0.5 * 2 ** attempt)) + 0.2)
                attempt += 1
                continue
            self.stats.rec(kind, time.perf_counter() - t0, str(r.status_code))
            if r.status_code == 429:
                self.stats.retry_429 += 1
                ra = float(r.headers.get("Retry-After", "2") or 2)
                await self.clock.sleep(ra + self.rng.uniform(0, min(8.0, 0.5 * 2 ** attempt)))
                attempt += 1
                continue
            if r.status_code >= 500:
                await self.clock.sleep(self.rng.uniform(0, min(8.0, 0.5 * 2 ** attempt)) + 0.2)
                attempt += 1
                continue
            return r
        return None

    # ---- feature: 로컬 장부 → REST 배치
    def make_window(self, seq: int) -> dict:
        w = metric_window(seq, self.s.pid, self.s.sid, self.s.stream_id, self.s.gen, self.s.anchor_id, self.s.t0_us, int(time.time() * 1000))
        self.s.windows[seq] = w
        self.s.pending.add(seq)
        return w

    async def send_batch(self, seqs: list[int]) -> bool:
        """seqs(오름차순, ≤60) 를 1회 전송. 결과를 장부에 반영. 전체 요청 실패면 False(pending 유지)."""
        body = {"participant_id": self.s.pid, "windows": [self.s.windows[q] for q in seqs]}
        if self.s.first_batch_at is None:
            self.s.first_batch_at = self.clock.now()
        r = await self.request("batch", "POST", f"{self.B}/sessions/{self.s.sid}/features/batch", headers=self.H, json=body)
        if r is None:
            return False
        if r.status_code != 200:   # 401/403/404/422: 재시도해도 소용없음 → 격리 기록(합격 실패로 집계)
            for q in seqs:
                self.s.pending.discard(q)
                self.s.quarantined[q] = f"http_{r.status_code}"
            self.stats.reject_codes[f"http_{r.status_code}"] = self.stats.reject_codes.get(f"http_{r.status_code}", 0) + len(seqs)
            self.s.rest_rejected += len(seqs)
            return True
        for q, res in zip(seqs, r.json()["results"]):
            st = res["status"]
            self.stats.result_status[st] = self.stats.result_status.get(st, 0) + 1
            if st in ("accepted", "duplicate"):
                self.s.pending.discard(q)
                self.s.acked.add(q)
            else:
                code = res.get("code", "unknown")
                self.s.pending.discard(q)
                self.s.quarantined[q] = code
                self.s.rest_rejected += 1
                self.stats.reject_codes[code] = self.stats.reject_codes.get(code, 0) + 1
        return True

    async def flush_features(self, once: bool = False) -> None:
        while self.s.pending and not self.killed and self.clock.now() < self.retry_deadline:
            seqs = sorted(self.s.pending)[:BATCH_MAX]
            ok = await self.send_batch(seqs)
            if once:
                return
            if not ok:
                await self.clock.sleep(1)

    async def feature_loop(self, until_event: asyncio.Event) -> None:
        while not until_event.is_set() and not self.killed:
            await self.clock.sleep(BATCH_PERIOD_S)
            if self.s.pending:
                await self.flush_features(once=True)

    # ---- 원시: 청크 생성 → presign → PUT → ack
    def register_chunks(self, idx: int) -> list[str]:
        aliases = []
        for sig in RATES:
            meta, _ = build_chunk(sig, self.s.raw_stream, self.s.segs[sig], idx, self.s.t0_us)
            a = meta["chunk_alias"]
            self.s.chunks[a] = {"signal": sig, "index": idx, "checksum": meta["checksum"], "size": meta["size_bytes"], "segment": self.s.segs[sig]}
            self.s.raw_pending.add(a)
            aliases.append(a)
        return aliases

    async def upload_chunks(self, aliases: list[str]) -> bool:
        built = {}
        for a in aliases:
            c = self.s.chunks[a]
            meta, payload = build_chunk(c["signal"], self.s.raw_stream, c["segment"], c["index"], self.s.t0_us)
            built[meta["chunk_alias"]] = (meta, payload)
        if self.s.first_presign_at is None:
            self.s.first_presign_at = self.clock.now()
        r = await self.request("presign", "POST", f"{self.B}/sessions/{self.s.sid}/biosignal-raw/presign", headers=self.H,
                               json={"participant_id": self.s.pid, "capture_stream_id": self.s.stream_id, "chunks": [m for m, _ in built.values()]})
        if r is None or r.status_code != 200:
            if r is not None:
                self.stats.reject_codes[f"presign_http_{r.status_code}"] = self.stats.reject_codes.get(f"presign_http_{r.status_code}", 0) + 1
            return False
        ack_items, ack_alias = [], {}
        for it in r.json()["chunks"]:
            a = it["chunk_alias"]
            if it.get("upload_url"):
                t1 = time.perf_counter()
                try:
                    pr = await self.http.put(it["upload_url"], content=built[a][1], headers=it["upload_headers"])
                    good = pr.status_code in (200, 201)
                    self.stats.rec("s3_put", time.perf_counter() - t1, str(pr.status_code))
                except Exception as e:  # noqa: BLE001
                    good = False
                    self.stats.rec("s3_put", time.perf_counter() - t1, "exc:" + type(e).__name__)
                if not good:
                    continue
            ack_items.append({"chunk_id": it["chunk_id"], "checksum": it["checksum"], "size_bytes": it["size_bytes"]})
            ack_alias[it["chunk_id"]] = a
        if not ack_items:
            return False
        ar = await self.request("ack", "POST", f"{self.B}/sessions/{self.s.sid}/biosignal-raw/ack", headers=self.H,
                                json={"participant_id": self.s.pid, "chunks": ack_items})
        if ar is None or ar.status_code != 200:
            return False
        for res in ar.json().get("chunks", []):
            if res.get("upload_status") == "uploaded":
                a = res["chunk_alias"]
                self.s.raw_pending.discard(a)
                self.s.raw_done.add(a)
        return True

    async def raw_job(self, aliases: list[str]) -> None:
        while any(a in self.s.raw_pending for a in aliases) and not self.killed and self.clock.now() < self.retry_deadline:
            if not await self.upload_chunks([a for a in aliases if a in self.s.raw_pending]):
                await self.clock.sleep(2)

    # ---- 측정 루프 (1초 창, 10초마다 원시 청크)
    async def measure(self, seconds: int, t_start: float) -> None:
        jobs: list[asyncio.Task] = []
        done = asyncio.Event()
        sender = asyncio.create_task(self.feature_loop(done))
        for n in range(seconds):
            await self.clock.sleep_until(t_start + n + 1)
            if self.killed:
                break
            w = self.make_window(n)
            if self.sock is not None:
                asyncio.create_task(self.sock.metric(w))   # 방송 전용: 저장 판정에 쓰지 않는다
            if (n + 1) % CHUNK_SECS == 0:
                jobs.append(asyncio.create_task(self.raw_job(self.register_chunks(n // CHUNK_SECS))))
        done.set()
        await asyncio.gather(sender, return_exceptions=True)
        self.measure_jobs = jobs

    async def drain(self) -> None:
        """측정 종료 후 남은 것을 전송 시도(데드라인까지). 로컬 장부가 비면 끝."""
        await asyncio.gather(*getattr(self, "measure_jobs", []), return_exceptions=True)
        await self.flush_features()

    # ---- 종료 후 대조 (서버 summary == 로컬 장부 될 때까지)
    async def summary_server_set(self) -> Optional[set[int]]:
        r = await self.request("summary", "GET", f"{self.B}/sessions/{self.s.sid}/features/summary", headers=self.H, params={"participant_id": self.s.pid})
        if r is None or r.status_code != 200:
            return None
        return parse_feature_summary(r.json(), self.s.stream_id)

    async def reconcile_features(self, max_rounds: int = 8) -> dict[str, Any]:
        info = {"rounds": 0, "resent": 0, "ok": False}
        for _ in range(max_rounds):
            server = await self.summary_server_set()
            info["rounds"] += 1
            if server is None:
                await self.clock.sleep(5)
                continue
            missing = sorted(set(self.s.windows) - server - set(self.s.quarantined))
            if not missing:
                info["ok"] = True
                break
            self.s.pending.update(missing)
            self.s.acked.difference_update(missing)
            info["resent"] += len(missing)
            self.s.resend_notes["feature_resent"] += len(missing)
            await self.flush_features()
        return info

    async def reconcile_raw(self, max_rounds: int = 8) -> dict[str, Any]:
        info = {"rounds": 0, "requeued": 0, "ok": False, "receipt_match": None}
        for _ in range(max_rounds):
            r = await self.request("raw_summary", "GET", f"{self.B}/sessions/{self.s.sid}/biosignal-raw/summary", headers=self.H,
                                   params={"participant_id": self.s.pid})
            info["rounds"] += 1
            if r is None or r.status_code != 200:
                await self.clock.sleep(5)
                continue
            j = r.json()
            missing = sorted(set(self.s.chunks) - set(j.get("aliases_uploaded", [])))
            local_rows = [(self.s.raw_stream, c["segment"], c["signal"], c["index"], c["checksum"], c["size"]) for c in self.s.chunks.values()]
            if not missing:
                info["ok"] = True
                info["receipt_match"] = (j.get("receipt_hash") == receipt_hash(local_rows))
                break
            info["requeued"] += len(missing)
            self.s.resend_notes["raw_requeued"] += len(missing)
            self.s.raw_pending.update(missing)
            self.s.raw_done.difference_update(missing)
            for i in range(0, len(missing), 3):
                await self.raw_job(missing[i:i + 3])
        return info

    async def dup_resend(self, fraction: float = 0.3, concurrent: int = 5) -> dict[str, int]:
        """멱등 시험: 이미 보낸 배치를 그대로 재전송 → 전부 duplicate 여야 한다. 한 배치는 동시에 N회."""
        seqs = sorted(self.s.acked)
        if not seqs:
            return {"resent_batches": 0, "not_duplicate": 0}
        batches = [seqs[i:i + BATCH_MAX] for i in range(0, len(seqs), BATCH_MAX)]
        pick = [b for b in batches if self.rng.random() < fraction] or batches[:1]
        bad = 0

        async def one(b: list[int]) -> None:
            nonlocal bad
            body = {"participant_id": self.s.pid, "windows": [self.s.windows[q] for q in b]}
            r = await self.request("batch_dup", "POST", f"{self.B}/sessions/{self.s.sid}/features/batch", headers=self.H, json=body)
            if r is not None and r.status_code == 200:
                for x in r.json()["results"]:
                    self.stats.result_status[x["status"]] = self.stats.result_status.get(x["status"], 0) + 1
                    if x["status"] == "rejected":
                        bad += 1
                        self.stats.reject_codes[x.get("code", "unknown")] = self.stats.reject_codes.get(x.get("code", "unknown"), 0) + 1
        for b in pick:
            await asyncio.gather(*(one(b) for _ in range(concurrent)))
        return {"resent_batches": len(pick) * concurrent, "rejected_on_resend": bad}


def parse_feature_summary(j: dict, stream_id: str) -> set[int]:
    """contract.md §2: min_index 이전·max_index 이후는 서버가 모른다 → 서버 보유 집합 = [min..max] − missing_ranges."""
    for st in j.get("streams", []):
        if st["stream_id"] != stream_id:
            continue
        if st.get("min_index") is None or st["count"] == 0:
            return set()
        have = set(range(st["min_index"], st["max_index"] + 1))
        for lo, hi in st.get("missing_ranges", []):
            have.difference_update(range(lo, hi + 1))
        if st.get("truncated"):   # 구간 목록이 잘렸으면 contiguous_through 까지만 신뢰
            have = set(range(0, st["contiguous_through"] + 1))
        return have
    return set()


# ------------------------------------------------------------------ 시나리오 → 장애 계획
def plan_faults(scenario: str, idx: int, seconds: int, transports: FaultTransport) -> dict[str, Any]:
    """기기별 장애/동작 계획. 반환: {"kill_at_end": bool, "restart_after": s, "block_socket_at": t|None}"""
    T = float(seconds)
    plan: dict[str, Any] = {"kill_at_end": False, "restart_after": 0.0, "block_socket_at": None, "group": "normal"}
    if scenario == "netdrop":
        a = T * (0.2 + 0.1 * (idx % 5))
        transports.add(Fault(a, a + 60, "drop"))
        transports.add(Fault(a + 60, a + 120, "delay", 3.0, prob=0.5))
        transports.add(Fault(T * 0.8, T * 0.8 + 20, "drop", prob=0.3))
        plan["group"] = "netdrop"
    elif scenario == "sockblock":
        plan["block_socket_at"] = T * 0.3
        plan["group"] = "sockblock"
    elif scenario == "mixed-close":
        g = idx % 4
        if g == 0:     # 네트워크 3분 단절 (중간)
            transports.add(Fault(T * 0.3, T * 0.3 + 180, "drop"))
            plan["group"] = "netdrop3m"
        elif g == 1:   # 종료 직후 앱 강제종료 → 2분 뒤 재실행
            plan["kill_at_end"], plan["restart_after"], plan["group"] = True, 120.0, "kill_restart"
        elif g == 2:   # 종료 시 Wi-Fi 끊김 5분
            transports.add(Fault(T, T + 300, "drop"))
            plan["group"] = "wifi_off_5m"
        else:
            plan["group"] = "normal"
    elif scenario == "rate429":
        # 서버가 429 를 내지 않아도 재시도 경로를 검증: 2구간에서 주입 429
        transports.add(Fault(T * 0.4, T * 0.4 + 30, "status", 429, prob=0.4))
        plan["group"] = "rate429"
    return plan


# ------------------------------------------------------------------ 한 기기 시나리오 실행
async def run_device(dev: Device, plan: dict[str, Any], seconds: int, t_start: float, finalize_at: float, scenario: str,
                     make_device: Callable[[], Device]) -> dict[str, Any]:
    out: dict[str, Any] = {"group": plan["group"]}
    block_task = None
    if plan.get("block_socket_at") is not None and dev.sock is not None:
        async def _block() -> None:
            await dev.clock.sleep_until(t_start + plan["block_socket_at"])
            await dev.sock.block()
            dev.stats.ev(f"{dev.s.name} 소켓 차단")
            while True:   # 차단 중 재연결 시도만 센다
                await dev.clock.sleep(30)
                dev.sock.block_attempts += 1
        block_task = asyncio.create_task(_block())
    await dev.measure(seconds, t_start)
    if plan["kill_at_end"]:
        dev.killed = True   # 앱 강제종료: 진행 중 전송 중단, 메모리 소거. 로컬 장부(LocalStore)만 남는다.
        await asyncio.sleep(0)
        await dev.clock.sleep(plan["restart_after"])
        dev = make_device()   # 재실행 → 장부에서 이어올림
        out["restarted"] = True
        # 이어올림: 장부의 미전송 창/청크를 큐에 올린다
        dev.s.pending.update(set(dev.s.windows) - dev.s.acked - set(dev.s.quarantined))
        await dev.flush_features()
        await asyncio.gather(*(dev.raw_job(sorted(dev.s.raw_pending)[i:i + 3]) for i in range(0, len(dev.s.raw_pending), 3)), return_exceptions=True)
    else:
        await dev.drain()
    await dev.clock.sleep_until(finalize_at)   # 전원 종료 후 동시에 대조 시작
    if scenario == "dup-resend":
        out["dup_resend"] = await dev.dup_resend()
    out["reconcile_features"] = await dev.reconcile_features()
    out["reconcile_raw"] = await dev.reconcile_raw()
    if block_task:
        block_task.cancel()
    return out


# ------------------------------------------------------------------ DB / S3 대조 (선택)
def db_verify(dsn: str, sid: str, pids: list[str]) -> dict[str, Any]:
    import psycopg2
    out: dict[str, Any] = {}
    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True)
    try:
        cur = conn.cursor()
        for pid in pids:
            cur.execute("select count(*), count(distinct (play_group_id, window_index)) from eeg_feature_windows where session_id=%s and participant_id=%s", (sid, pid))
            n, dist = cur.fetchone()
            cur.execute("select count(*) from eeg_feature_windows where session_id=%s and participant_id=%s and device_timestamp_ms is null", (sid, pid))
            nonnull_bad = cur.fetchone()[0]
            cur.execute("select upload_status, count(*) from eeg_raw_chunks where session_id=%s and participant_id=%s group by 1", (sid, pid))
            raw = {k: v for k, v in cur.fetchall()}
            cur.execute("select object_key, size_bytes, checksum from eeg_raw_chunks where session_id=%s and participant_id=%s and upload_status='uploaded'", (sid, pid))
            keys = cur.fetchall()
            out[pid] = {"db_windows": n, "db_duplicates": n - dist, "device_ts_null": nonnull_bad, "raw_status": raw, "raw_keys": keys}
    finally:
        conn.close()
    return out


def s3_verify(bucket: str, keys: list[tuple[str, int, str]], workers: int = 16, download: bool = False) -> dict[str, Any]:
    """HEAD 로 크기(+가능하면 SHA256) 대조. 403 이면 원인(오류 코드·메시지 첫 줄)을 reasons 에 기록."""
    import boto3
    from botocore.exceptions import ClientError
    from concurrent.futures import ThreadPoolExecutor
    s3 = boto3.client("s3")
    res = {"ok": 0, "size_mismatch": 0, "sha_mismatch": 0, "sha_unverified": 0, "missing": 0, "forbidden": 0, "error": 0, "reasons": {}}

    def one(item: tuple[str, int, str]) -> str:
        key, size, sha_hex = item
        try:
            if download:
                body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
                if len(body) != size:
                    return "size_mismatch"
                return "ok" if hashlib.sha256(body).hexdigest() == sha_hex else "sha_mismatch"
            h = s3.head_object(Bucket=bucket, Key=key, ChecksumMode="ENABLED")
            if h["ContentLength"] != size:
                return "size_mismatch"
            b64 = h.get("ChecksumSHA256")
            if b64 is None:
                return "sha_unverified"
            return "ok" if base64.b64decode(b64).hex() == sha_hex else "sha_mismatch"
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "?")
            msg = f"{code}: {str(e.response.get('Error', {}).get('Message', ''))[:80]}"
            kind = "forbidden" if code in ("403", "AccessDenied", "Forbidden") else "missing" if code in ("404", "NoSuchKey", "NotFound") else "error"
            res["reasons"][msg] = res["reasons"].get(msg, 0) + 1
            return kind
        except Exception as e:  # noqa: BLE001
            res["reasons"][type(e).__name__] = res["reasons"].get(type(e).__name__, 0) + 1
            return "error"

    with ThreadPoolExecutor(workers) as ex:
        for r in ex.map(one, keys):
            res[r] += 1
    res["total"] = len(keys)
    return res


# ------------------------------------------------------------------ 판정·리포트
def judge(rows: list[dict[str, Any]], expected_windows: int, db_on: bool, s3_res: Optional[dict[str, Any]]) -> dict[str, Any]:
    """합격선: 지표 600/600 · 중복 0 · REST 거절 0 · 원시 100% · S3 대조 100%. 검증 수단이 없으면 PASS 가 아니라 UNVERIFIED."""
    crit: dict[str, str] = {}
    crit["feature_complete"] = "PASS" if all(r["server_windows"] == r["expected"] == expected_windows for r in rows) else "FAIL"
    crit["rest_rejected_0"] = "PASS" if all(r["rest_rejected"] == 0 for r in rows) else "FAIL"
    crit["raw_100pct"] = "PASS" if all(r["raw_server_uploaded"] == r["raw_expected"] for r in rows) else "FAIL"
    crit["raw_receipt_match"] = "PASS" if all(r.get("receipt_match") is True for r in rows) else "FAIL"
    if db_on:
        crit["db_duplicates_0"] = "PASS" if all(r.get("db_duplicates") == 0 for r in rows) else "FAIL"
        crit["db_windows_eq"] = "PASS" if all(r.get("db_windows") == expected_windows for r in rows) else "FAIL"
    else:
        crit["db_duplicates_0"] = crit["db_windows_eq"] = "UNVERIFIED"
    if s3_res is None:
        crit["s3_100pct"] = "UNVERIFIED"
    else:
        crit["s3_100pct"] = "PASS" if s3_res["ok"] == s3_res["total"] and s3_res["total"] > 0 else ("UNVERIFIED" if s3_res["forbidden"] == s3_res["total"] else "FAIL")
    overall = "FAIL" if "FAIL" in crit.values() else ("CONDITIONAL(미검증 있음)" if "UNVERIFIED" in crit.values() else "PASS")
    return {"criteria": crit, "overall": overall}


def render_md(res: dict[str, Any]) -> str:
    L = [f"# LT40S 시험 결과 — {res['scenario']} ({res['started_at']})", "",
         f"- 판정: **{res['verdict']['overall']}**", f"- 기준별: {json.dumps(res['verdict']['criteria'], ensure_ascii=False)}",
         f"- 기기 {res['devices']}대 · 측정 {res['seconds']}s · 시간배율 {res['time_scale']}", "",
         "## 참여자별", "", "| 이름 | 그룹 | 기대창 | 서버창(summary) | DB창 | DB중복 | 결측 | REST거절 | 원시 기대 | 원시 서버 | 영수증일치 | S3 |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res["rows"]:
        L.append(f"| {r['name']} | {r['group']} | {r['expected']} | {r['server_windows']} | {r.get('db_windows', '-')} | {r.get('db_duplicates', '-')} | {r['missing']} | "
                 f"{r['rest_rejected']} | {r['raw_expected']} | {r['raw_server_uploaded']} | {r.get('receipt_match')} | {r.get('s3', '-')} |")
    L += ["", "## 거절/응답 통계", "", f"- 창 결과: {json.dumps(res['stats']['result_status'])}", f"- 거절 코드: {json.dumps(res['stats']['reject_codes'], ensure_ascii=False)}",
          f"- 429 재시도: {res['stats']['retry_429']}", f"- HTTP 결과: {json.dumps(res['stats']['http'], ensure_ascii=False)}",
          f"- 주입 장애: {json.dumps(res['injected'])}", "", "## 지연 분포", "", "| 종류 | n | p50ms | p95ms | p99ms | max |", "|---|---|---|---|---|---|"]
    for k, v in sorted(res["stats"]["latency"].items()):
        L.append(f"| {k} | {v['n']} | {v['p50_ms']} | {v['p95_ms']} | {v['p99_ms']} | {v['max_ms']} |")
    if res.get("s3"):
        L += ["", "## S3 대조", "", f"- {json.dumps({k: v for k, v in res['s3'].items() if k != 'reasons'})}", f"- 사유(403 등): {json.dumps(res['s3']['reasons'], ensure_ascii=False)}"]
    if res.get("socket"):
        L += ["", "## 소켓(방송 전용)", "", f"- {json.dumps(res['socket'], ensure_ascii=False)}"]
    L += ["", "## 분산(첫 전송 시각, 가상초)", "", f"- 첫 배치: min {res['spread']['batch_min']} / max {res['spread']['batch_max']}, 첫 presign: min {res['spread']['presign_min']} / max {res['spread']['presign_max']}"]
    L += ["", "## 이벤트", ""] + [f"- {e}" for e in res["events"][:40]]
    return "\n".join(L) + "\n"


# ------------------------------------------------------------------ 본 시험
async def execute(*, api: str, sid: str, members: list[dict], wearers: int, seconds: int, scenario: str, scale: float, token: Optional[str],
                  use_socket: bool, seed: int, transport: Optional[httpx.AsyncBaseTransport] = None,
                  sock_factory: Optional[Callable[[dict, Stats], Any]] = None, finalize_delay: float = 0.0) -> dict[str, Any]:
    rng = random.Random(seed)
    stats = Stats()
    clock = Clock(scale)
    base = api.rstrip("/") + "/api/v1"
    api_host = httpx.URL(api).host
    inner = transport or httpx.AsyncHTTPTransport(limits=httpx.Limits(max_connections=300, max_keepalive_connections=100))
    members = members[:wearers]
    stores, devices, plans, fts, clients = [], [], [], [], []
    host_sock = None
    try:
        # --- 기기 준비: 소켓 join → capture.start (stream 생성). 저장은 REST.
        socks: list[Any] = []
        for m in members:
            sk = None
            if use_socket and sock_factory is None:
                sk = LiveSocket(api, sid, m["entry_credential"], None, stats)
            elif sock_factory is not None:
                sk = sock_factory(m, stats)
            socks.append(sk)
        if use_socket and sock_factory is None:
            pw = os.environ.get("LT40S_COUNSELOR_PW")
            if pw and token is None:
                r = httpx.post(f"{base}/auth/login", json={"email": os.environ.get("LT40S_COUNSELOR_EMAIL", "counselor@test.com"), "password": pw, "role": "counselor"}, timeout=20)
                token = r.json()["access_token"]
            if token:
                host_sock = LiveSocket(api, sid, None, token, stats)
                if await host_sock.connect_join():
                    await asyncio.gather(*(s.connect_join() for s in socks), return_exceptions=True)
                    await asyncio.gather(*(s.command("entry.enter", {}) for s in socks), return_exceptions=True)
                    await host_sock.command("session.start", {})
            else:
                stats.ev("호스트 자격(LT40S_COUNSELOR_PW) 없음 — 소켓 입장 생략")
        t_start = clock.now() + 8 * (1 if scale <= 1 else 0.5)
        started_at = time.strftime("%Y-%m-%d %H:%M:%S")
        t0_us = int(time.time() * 1_000_000)
        for i, m in enumerate(members):
            store = LocalStore(pid=m["participant_id"], sid=sid, cred=m["entry_credential"], name=m["name"], t0_us=t0_us)
            sk = socks[i]
            if sk is not None:
                got = await sk.start_capture()
                if got is None:
                    stats.ev(f"{m['name']} capture.start 실패 → 기기 제외")
                    continue
                store.stream_id, store.gen = got
            else:
                store.stream_id = m.get("stream_id") or str(uuid.uuid4())
            ft = FaultTransport(inner, clock, random.Random(rng.random()), api_host)
            plan = plan_faults(scenario, i, seconds, ft)
            client = httpx.AsyncClient(transport=ft, timeout=httpx.Timeout(20.0, connect=10.0))
            clients.append(client)
            fts.append(ft)
            stores.append(store)
            plans.append(plan)
            devices.append((store, client, sk))
        # 분산 시작: 첫 전송은 기기별 지터(0~5초)로 자연 분산됨(주기 루프 시작점이 다름)

        def mk(store: LocalStore, client: httpx.AsyncClient, sk: Any, deadline: float) -> Callable[[], Device]:
            return lambda: Device(store, client, base, clock, stats, sk, random.Random(rng.random()), retry_deadline=deadline)

        finalize_at = t_start + seconds + finalize_delay
        deadline = t_start + seconds + 1200 + finalize_delay    # 종료 후 20분 안에 일치(V-A10)
        jobs = []
        presence = [asyncio.create_task(sk.presence_loop()) for _, _, sk in devices if sk is not None and hasattr(sk, "presence_loop")]
        for (store, client, sk), plan in zip(devices, plans):
            mkdev = mk(store, client, sk, deadline)
            jobs.append(run_device(mkdev(), plan, seconds, t_start, finalize_at, scenario, mkdev))
        results = await asyncio.gather(*jobs, return_exceptions=True)
        for p in presence:
            p.cancel()
        # --- 소켓 정리
        for (store, _, sk) in devices:
            if sk is not None:
                await sk.close(store.stream_id, {"metric": str(seconds)})
        if host_sock:
            await host_sock.close("", {})
        # --- 최종 서버 대조(summary 재조회) — 로컬 장부와 직접 비교
        rows = []
        final_http = httpx.AsyncClient(transport=inner, timeout=30)
        try:
            for (store, _, sk), res, plan in zip(devices, results, plans):
                H = {"X-Entry-Credential": store.cred}
                fr = await final_http.get(f"{base}/sessions/{sid}/features/summary", headers=H, params={"participant_id": store.pid})
                srv = parse_feature_summary(fr.json(), store.stream_id) if fr.status_code == 200 else set()
                rr = await final_http.get(f"{base}/sessions/{sid}/biosignal-raw/summary", headers=H, params={"participant_id": store.pid})
                rj = rr.json() if rr.status_code == 200 else {}
                local_rows = [(store.raw_stream, c["segment"], c["signal"], c["index"], c["checksum"], c["size"]) for c in store.chunks.values()]
                rows.append({
                    "name": store.name, "pid": store.pid, "group": plan["group"], "expected": len(store.windows),
                    "server_windows": len(srv & set(store.windows)), "missing": len(set(store.windows) - srv),
                    "rest_rejected": store.rest_rejected, "quarantined": dict(store.quarantined),
                    "raw_expected": len(store.chunks), "raw_server_uploaded": len(set(store.chunks) & set(rj.get("aliases_uploaded", []))),
                    "raw_pending": rj.get("pending"), "raw_failed": rj.get("failed"),
                    "receipt_match": (rj.get("receipt_hash") == receipt_hash(local_rows)) if rj else False,
                    "first_batch_at": store.first_batch_at, "first_presign_at": store.first_presign_at,
                    "resend": store.resend_notes, "detail": res if not isinstance(res, Exception) else {"error": repr(res)[:200]},
                })
        finally:
            await final_http.aclose()
    finally:
        for c in clients:
            await c.aclose()
    injected = {k: sum(f.injected[k] for f in fts) for k in ("drop", "delay", "status")}
    fb = [r["first_batch_at"] for r in rows if r["first_batch_at"] is not None]
    fp = [r["first_presign_at"] for r in rows if r["first_presign_at"] is not None]
    r1 = lambda v: round(v, 1) if v is not None else None  # noqa: E731
    out = {
        "scenario": scenario, "started_at": started_at, "seconds": seconds, "time_scale": scale, "devices": len(rows), "rows": rows, "injected": injected,
        "stats": {"result_status": stats.result_status, "reject_codes": stats.reject_codes, "retry_429": stats.retry_429, "http": stats.http,
                  "latency": stats.latency_summary()},
        "spread": {"batch_min": r1(min(fb) - t_start) if fb else None, "batch_max": r1(max(fb) - t_start) if fb else None,
                   "presign_min": r1(min(fp) - t_start) if fp else None, "presign_max": r1(max(fp) - t_start) if fp else None},
        "socket": ({"metric_acks": {k: sum(getattr(sk, "metric_acks", {}).get(k, 0) for _, _, sk in devices if sk) for k in ("projected", "ignored", "other", "no_ack")},
                    "block_attempts": sum(getattr(sk, "block_attempts", 0) for _, _, sk in devices if sk)} if any(sk for _, _, sk in devices) else None),
        "events": stats.events,
    }
    return out


def finish(res: dict[str, Any], dsn: Optional[str], sid: str, bucket: Optional[str], s3_download: bool, out_dir: str) -> dict[str, Any]:
    """동기 후처리: DB·S3 대조 → 판정 → 파일 기록."""
    s3_res = None
    db_on = bool(dsn)
    if dsn:
        dbr = db_verify(dsn, sid, [r["pid"] for r in res["rows"]])
        all_keys: list[tuple[str, int, str]] = []
        for r in res["rows"]:
            d = dbr[r["pid"]]
            r.update({"db_windows": d["db_windows"], "db_duplicates": d["db_duplicates"], "db_device_ts_null": d["device_ts_null"], "db_raw_status": d["raw_status"]})
            all_keys += [(k, s or 0, c or "") for k, s, c in d["raw_keys"]]
        if bucket and all_keys:
            s3_res = s3_verify(bucket, all_keys, download=s3_download)
            res["s3"] = s3_res
            for r in res["rows"]:
                r["s3"] = f"{s3_res['ok']}/{s3_res['total']}(전체)"
    res["verdict"] = judge(res["rows"], max((r["expected"] for r in res["rows"]), default=0), db_on, s3_res)
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    slim = {k: v for k, v in res.items()}
    with open(os.path.join(out_dir, f"result-{res['scenario']}-{stamp}.json"), "w") as f:
        json.dump(slim, f, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(out_dir, f"result-{res['scenario']}-{stamp}.md"), "w") as f:
        f.write(render_md(res))
    return res


# ------------------------------------------------------------------ setup (게스트 가입)
async def setup(members: int, api: str) -> None:
    os.makedirs(SHARE_DIR, exist_ok=True)
    st = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    for k in ("class_id", "session_id", "code"):
        if k not in st:
            raise SystemExit(f"상태 파일 {STATE_FILE} 에 {k} 가 필요합니다(시험용 클래스·회차를 먼저 만든 뒤 기록).")
    B = api.rstrip("/") + "/api/v1"
    cid, sid, code = st["class_id"], st["session_id"], st["code"]
    st.setdefault("members", [])
    async with httpx.AsyncClient(timeout=60) as c:
        for i in range(len(st["members"]), members):
            name = f"{PREFIX}게스트-{i + 1:03d}"
            for attempt in range(5):
                r = await c.post(f"{B}/classes/{cid}/guest-memberships", json={
                    "code": code, "operation_key": str(uuid.uuid4()), "guest_name": name, "gender": "other", "birth_year_month": "1990-01",
                    "report_email": f"lt40s-{i + 1:03d}@example.com", "report_included": False, "research_consented": False, "join_mode": "active"})
                if r.status_code == 201:
                    break
                await asyncio.sleep(2 + attempt * 3)
            else:
                raise SystemExit(f"가입 실패 {i}")
            j = r.json()
            h = {"X-Class-Member-Credential": j["credential_bundle"]["activity_credential"]}
            rev = j["revision"]
            r = await c.put(f"{B}/classes/{cid}/sessions/{sid}/me/recording-consent", headers=h, json={"consented": True, "notice_version": "v1"})
            assert r.status_code == 200, r.status_code
            r = await c.post(f"{B}/classes/{cid}/sessions/{sid}/guest-entry", headers=h, json={"operation_key": str(uuid.uuid4()), "expected_revision": rev})
            if r.status_code == 409:
                rev = r.json().get("detail", {}).get("revision", rev + 1)
                r = await c.post(f"{B}/classes/{cid}/sessions/{sid}/guest-entry", headers=h, json={"operation_key": str(uuid.uuid4()), "expected_revision": rev})
            assert r.status_code == 200, r.status_code
            e = r.json()
            r = await c.put(f"{B}/sessions/{sid}/entry/eeg-consent", headers={"X-Entry-Credential": e["entry_credential"]}, json={"consented": True, "notice_version": "v1"})
            assert r.status_code == 200, r.status_code
            st["members"].append({"name": name, "participant_id": e["participant_id"], "entry_credential": e["entry_credential"]})
            json.dump(st, open(STATE_FILE, "w"))
            print("ok", name, len(st["members"]), flush=True)
            await asyncio.sleep(0.4)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["setup", "run"])
    ap.add_argument("--members", type=int, default=40)
    ap.add_argument("--wearers", type=int, default=40)
    ap.add_argument("--seconds", type=int, default=600)
    ap.add_argument("--scenario", choices=SCENARIOS, default="normal")
    ap.add_argument("--time-scale", type=float, default=1.0, help="가상시간 배율(스모크용). 본 시험은 1")
    ap.add_argument("--no-socket", action="store_true", help="소켓(방송·capture.start) 생략 — 서버가 stream 을 알아야 하므로 실서버에서는 쓰지 않는다")
    ap.add_argument("--s3-download", action="store_true", help="S3 전수 다운로드로 SHA-256 직접 대조(느림)")
    ap.add_argument("--seed", type=int, default=260)
    ap.add_argument("--out", default=os.path.join(SHARE_DIR, "results"))
    a = ap.parse_args(argv)
    api = os.environ.get("LT40S_API", API_DEFAULT)
    if a.cmd == "setup":
        asyncio.run(setup(a.members, api))
        return 0
    st = json.load(open(STATE_FILE))
    res = asyncio.run(execute(api=api, sid=st["session_id"], members=st["members"], wearers=a.wearers, seconds=a.seconds, scenario=a.scenario,
                              scale=a.time_scale, token=None, use_socket=not a.no_socket, seed=a.seed))
    res = finish(res, os.environ.get("LT40S_DATABASE_URL"), st["session_id"], os.environ.get("LT40S_S3_BUCKET", "mindbreeze-dev") if os.environ.get("LT40S_DATABASE_URL") else None,
                 a.s3_download, a.out)
    print(render_md(res))
    return 0 if res["verdict"]["overall"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())

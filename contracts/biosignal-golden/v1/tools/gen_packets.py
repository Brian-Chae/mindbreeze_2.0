#!/usr/bin/env python3
"""SDD-246 T01 — 패킷 바이트 정본 fixture 생성기 (GF01/GF02).

독립 산술 원칙:
  - 공식 SDK(link_band_sdk python_core/app/core/device.py)의 바이트 규칙을 표준 라이브러리만으로 다시 계산한다.
  - frontend/src/lib/eeg 의 TS 코드와 Rust 코어는 이 스크립트가 쓰지 않는다. (expected 를 이식 코어로 만들지 않는다.)
  - 정수 산술은 Fraction/정수, µV 는 Decimal 12자리 정수 근사 + SDK 연산 순서 float 을 같이 기록한다.
결정적: 무작위는 아래 LCG 뿐이며 시드를 고정한다. 재실행하면 바이트 단위로 동일해야 한다(verify_packets.py 가 검사).

사용:  python3 gen_packets.py <출력_v1_디렉터리>
"""
import json
import os
import sys
from decimal import Decimal, getcontext
from fractions import Fraction

getcontext().prec = 40
TICK_HZ = 32768
EEG_HZ, PPG_HZ, ACC_HZ = 250, 50, 30
U32 = 1 << 32
EEG_SAMPLE_BYTES, PPG_SAMPLE_BYTES, ACC_SAMPLE_BYTES = 7, 6, 6
MIN_LEN = {"eeg": 8, "ppg": 8, "acc": 10}  # SDK device.py 최소 길이
SAMPLE_BYTES = {"eeg": EEG_SAMPLE_BYTES, "ppg": PPG_SAMPLE_BYTES, "acc": ACC_SAMPLE_BYTES}
RATE = {"eeg": EEG_HZ, "ppg": PPG_HZ, "acc": ACC_HZ}
# 장치 명목 profile: 패킷당 0.1초 분량(EEG 25 / PPG 5 / ACC 3 샘플). 헤더 tick 은 정수 반올림.
PER_PACKET = {"eeg": 25, "ppg": 5, "acc": 3}


class Lcg:
    """결정적 의사난수(Numerical Recipes). 외부 라이브러리 비의존."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s


def le32(v):
    return bytes([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255])


def be24(v):
    return bytes([(v >> 16) & 255, (v >> 8) & 255, v & 255])


def le16(v):  # signed 입력
    v &= 0xFFFF
    return bytes([v & 255, v >> 8])


def eeg_sample(leadoff, ch1_raw24, ch2_raw24):
    return bytes([leadoff]) + be24(ch1_raw24) + be24(ch2_raw24)


def acc_sample(x, y, z):
    return le16(x) + le16(y) + le16(z)


# ── 독립 디코더(표 기반, int.from_bytes/비트 연산 아님: 합 산술) ─────────────────
def signed24(raw):
    return raw - (1 << 24) if raw >= (1 << 23) else raw


def uv_exact(signed):
    """signed * 4.033 / 12 / (2^23-1) * 1e6 의 정확한 십진값(소수 9자리 문자열)."""
    v = Decimal(signed) * Decimal("4.033") / Decimal(12) / Decimal((1 << 23) - 1) * Decimal(10) ** 6
    return format(v.quantize(Decimal("0.000000001")), "f")


def uv_sdk_float(signed):
    return signed * 4.033 / 12 / (2 ** 23 - 1) * 1e6  # SDK 와 동일 연산 순서


def header_ticks_le(b):
    return b[0] + b[1] * 256 + b[2] * 65536 + b[3] * 16777216


def header_ticks_be_wrong(b):
    return b[3] + b[2] * 256 + b[1] * 65536 + b[0] * 16777216


def decode_packet(sensor, b):
    """엄격 규칙 판정 + 표본. SDK 의 lenient(나머지 byte 무시) 결과도 같이 낸다."""
    out = {"sensor": sensor, "length": len(b)}
    if len(b) < 4:
        out.update(strict_status="invalid_header_short", sdk_accepts=False, samples=[])
        return out
    ticks = header_ticks_le(b)
    out["header_ticks"] = ticks
    out["header_ticks_if_big_endian_wrong"] = header_ticks_be_wrong(b)
    out["header_seconds_exact"] = str(Fraction(ticks, TICK_HZ))
    body = len(b) - 4
    n = body // SAMPLE_BYTES[sensor]
    rem = body - n * SAMPLE_BYTES[sensor]
    out["sdk_accepts"] = len(b) >= MIN_LEN[sensor]
    out["sdk_lenient_sample_count"] = n if out["sdk_accepts"] else 0
    out["remainder_bytes"] = rem
    if len(b) < MIN_LEN[sensor]:
        out.update(strict_status="invalid_too_short", samples=[])
        return out
    if rem != 0:
        out.update(strict_status="invalid_remainder", samples=[])
        return out
    out["strict_status"] = "ok"
    out["n_samples"] = n
    samples = []
    for i in range(n):
        o = 4 + i * SAMPLE_BYTES[sensor]
        if sensor == "eeg":
            lo = b[o]
            r1 = b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]
            r2 = b[o + 4] * 65536 + b[o + 5] * 256 + b[o + 6]
            s1, s2 = signed24(r1), signed24(r2)
            samples.append({
                "leadoff_byte": lo,
                "leadoff_ch1": (lo & 1) != 0, "leadoff_ch2": (lo & 4) != 0,
                "ch1_raw24": r1, "ch2_raw24": r2, "ch1_signed": s1, "ch2_signed": s2,
                "ch1_uv_exact": uv_exact(s1), "ch2_uv_exact": uv_exact(s2),
                "ch1_uv_sdk_float": uv_sdk_float(s1), "ch2_uv_sdk_float": uv_sdk_float(s2),
            })
        elif sensor == "ppg":
            red = b[o] * 65536 + b[o + 1] * 256 + b[o + 2]
            ir = b[o + 3] * 65536 + b[o + 4] * 256 + b[o + 5]
            samples.append({"red": red, "ir": ir})
        else:
            def s16(lo_, hi_):
                v = lo_ + hi_ * 256
                return v - 65536 if v >= 32768 else v
            x, y, z = s16(b[o], b[o + 1]), s16(b[o + 2], b[o + 3]), s16(b[o + 4], b[o + 5])
            samples.append({"x_raw": x, "y_raw": y, "z_raw": z,
                            "x_g": x * 2.0 / 32768.0, "y_g": y * 2.0 / 32768.0, "z_g": z * 2.0 / 32768.0,
                            "x_g_exact": str(Fraction(x, 16384)), "y_g_exact": str(Fraction(y, 16384)), "z_g_exact": str(Fraction(z, 16384))})
    out["samples"] = samples
    # 시각 anchor 두 의미(D09): SDK=헤더가 첫 샘플, 현 웹=헤더가 마지막 샘플. 단위 마이크로틱(µs 정확 분수).
    if n:
        rate = RATE[sensor]
        out["anchor_offsets_us"] = {
            "sdk_first_sample": [str(Fraction(i * 1_000_000, rate)) for i in range(n)],
            "web_last_sample": [str(Fraction((i - n + 1) * 1_000_000, rate)) for i in range(n)],
        }
        if sensor == "acc":  # 현 웹 profile 은 33333µs 로 반올림한 간격을 사용
            out["anchor_offsets_us"]["web_last_sample_rounded_33333us"] = [str((i - n + 1) * 33333) for i in range(n)]
    return out


# ── 패킷 생성 ────────────────────────────────────────────────────────────
def rnd_eeg_samples(rng, n, leadoff_pattern=None):
    out = []
    for i in range(n):
        lo = 0 if leadoff_pattern is None else leadoff_pattern[i % len(leadoff_pattern)]
        # 부호 있는 24비트 범위를 폭넓게 사용(±100k 근방 + 가끔 극단)
        a = (rng.next() % 200001) - 100000
        b = (rng.next() % 200001) - 100000
        out.append(eeg_sample(lo, a & 0xFFFFFF, b & 0xFFFFFF))
    return out


def rnd_ppg_samples(rng, n):
    return [be24(100000 + rng.next() % 50000) + be24(120000 + rng.next() % 50000) for _ in range(n)]


def rnd_acc_samples(rng, n):
    return [acc_sample((rng.next() % 2001) - 1000, (rng.next() % 2001) - 1000, 16384 + (rng.next() % 201) - 100) for _ in range(n)]


def build(sensor, ticks, rng, n=None):
    n = n or PER_PACKET[sensor]
    if sensor == "eeg":
        body = b"".join(rnd_eeg_samples(rng, n))
    elif sensor == "ppg":
        body = b"".join(rnd_ppg_samples(rng, n))
    else:
        body = b"".join(rnd_acc_samples(rng, n))
    return le32(ticks % U32) + body


def step_ticks(sensor, k):
    """k 번째 패킷의 누적 tick 증가분(정수 반올림, 평균 정확): round(k*N/rate*32768)."""
    num = k * PER_PACKET[sensor] * TICK_HZ
    return (2 * num + RATE[sensor]) // (2 * RATE[sensor])  # round half up


# ── 참조 clock 모델(생성기 내부, 독립 규칙) ─────────────────────────────────
DUP_WINDOW_TICKS = 2 * TICK_HZ          # 2초 이내 역행 = 중복/역순
MAX_FORWARD_GAP_TICKS = 600 * TICK_HZ   # 10분 초과 전진은 gap 미상 → 새 segment


class RefClock:
    """sensor 별 독립 카운터. 규칙은 manifest.clock_rules 에 문서화(T02 가 소비)."""

    def __init__(self):
        self.last = {}  # sensor -> dict(prev_raw, ext, segment, seen{(ext): hash})

    def feed(self, sensor, pkt):
        d = decode_packet(sensor, pkt)
        rec = {"sensor": sensor, "length": len(pkt), "strict_status": d["strict_status"],
               "remainder_bytes": d.get("remainder_bytes"), "sdk_lenient_sample_count": d.get("sdk_lenient_sample_count")}
        if d["strict_status"] != "ok":
            rec.update(status="invalid", reason=d["strict_status"], segment=self.last.get(sensor, {}).get("segment"))
            return rec
        raw = d["header_ticks"]
        phash = _fnv(pkt[4:])
        st = self.last.get(sensor)
        if st is None:
            st = {"prev_raw": raw, "ext": raw, "segment": 0, "seen": {raw: phash}, "max_ext": raw}
            self.last[sensor] = st
            rec.update(status="accepted", segment=0, extended_ticks=raw, delta_ticks=None, event="first")
            return rec
        fwd = (raw - st["prev_raw"]) % U32
        if fwd == 0 or fwd >= U32 // 2:  # 같거나 역행
            back = (st["prev_raw"] - raw) % U32
            if back < DUP_WINDOW_TICKS:
                ext = st["max_ext"] - back
                prev_hash = st["seen"].get(ext)
                if back == 0 and prev_hash == phash:
                    status, event = "duplicate", "same_tick_same_payload"
                elif back == 0 and prev_hash is not None:
                    status, event = "conflict", "same_tick_different_payload"
                else:
                    status, event = "out_of_order", "older_tick_within_2s"
                rec.update(status=status, segment=st["segment"], extended_ticks=ext, delta_ticks=-back, event=event)
                return rec
            st.update(prev_raw=raw, ext=raw, segment=st["segment"] + 1, seen={raw: phash}, max_ext=raw)
            rec.update(status="accepted", segment=st["segment"], extended_ticks=raw, delta_ticks=None, event="reset_new_segment")
            return rec
        if fwd > MAX_FORWARD_GAP_TICKS:
            st.update(prev_raw=raw, ext=raw, segment=st["segment"] + 1, seen={raw: phash}, max_ext=raw)
            rec.update(status="accepted", segment=st["segment"], extended_ticks=raw, delta_ticks=None, event="forward_gap_new_segment")
            return rec
        wrapped = raw < st["prev_raw"]
        ext = st["max_ext"] + fwd
        st.update(prev_raw=raw, ext=ext, max_ext=ext)
        st["seen"][ext] = phash
        rec.update(status="accepted", segment=st["segment"], extended_ticks=ext, delta_ticks=fwd, event="wrap" if wrapped else "forward")
        return rec


def _fnv(b):
    h = 0xCBF29CE484222325
    for x in b:
        h ^= x
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return "%016x" % h


# ── 파일 쓰기 ───────────────────────────────────────────────────────────
def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def main(out):
    packets = os.path.join(out, "packets")
    expected = os.path.join(out, "expected")

    # ===== GF01: 바이트 edge =====
    edge_eeg = le32(TICK_HZ) + b"".join([
        eeg_sample(0x00, 0x800000, 0x7FFFFF),   # signed24 최소 / 최대
        eeg_sample(0x01, 0xFFFFFF, 0x000000),   # -1 / 0, ch1 leadoff
        eeg_sample(0x04, 0x000001, 0xFFFFFE),   # +1 / -2, ch2 leadoff
        eeg_sample(0x05, 0x123456, 0xFEDCBA),   # 양쪽 leadoff
        eeg_sample(0xFA, 0x000000, 0x000000),   # bit0/2 외 비트만 → leadoff 아님
    ])
    ppg_hdr = bytes([0x00, 0x80, 0x00, 0x00])    # little endian = 32768 tick = 1초. BE 오해는 0x00800000
    edge_ppg = ppg_hdr + b"".join([be24(0x000000) + be24(0xFFFFFF), be24(0x123456) + be24(0xABCDEF), be24(0x800000) + be24(0x7FFFFF)])
    edge_acc = le32(TICK_HZ) + b"".join([acc_sample(-32768, 32767, -1), acc_sample(0, 1, -32767), acc_sample(16384, -16384, 256)])
    probe = bytes([0x01, 0x02, 0x03, 0x04]) + be24(1) + be24(2)  # PPG 헤더 endian 프로브
    gf01 = {
        "gf01_eeg_signed24_leadoff": ("eeg", edge_eeg),
        "gf01_ppg_header_le_1s": ("ppg", edge_ppg),
        "gf01_acc_signed16": ("acc", edge_acc),
        "gf01_ppg_header_endian_probe": ("ppg", probe),
    }
    for name, (sensor, b) in gf01.items():
        write(os.path.join(packets, name + ".bin"), b)
        exp = decode_packet(sensor, b)
        exp["file"] = "packets/%s.bin" % name
        exp["sha256_note"] = "sha256 은 manifest.json 에 고정"
        wjson(os.path.join(expected, name + ".json"), exp)

    # ===== GF02 스트림 =====
    streams = {}

    def stream(name, entries):
        """entries: list of (arrival_us, sensor, bytes, label). 파일은 순서대로 저장."""
        ref = RefClock()
        sched = []
        for i, (arr, sensor, b, label) in enumerate(entries):
            fn = "packets/%s/%03d_%s.bin" % (name, i, sensor)
            write(os.path.join(out, fn), b)
            rec = ref.feed(sensor, b)
            rec.update(index=i, file=fn, arrival_us=arr, label=label)
            sched.append(rec)
        wjson(os.path.join(expected, name + ".json"), {"stream": name, "packets": sched,
              "clock_rules_ref": "manifest.clock_rules", "ticks_per_second": TICK_HZ})
        streams[name] = len(entries)

    rng = Lcg(246001)

    def jitter(rng):
        return (rng.next() % 50001) - 25000  # ±25ms (µs)

    # (a) 세 센서의 원점이 서로 다름 (+92,400초) · arrival jitter ±25ms
    origin = {"eeg": 100 * TICK_HZ, "acc": 50 * TICK_HZ, "ppg": (100 + 92400) * TICK_HZ}
    ent = []
    for k in range(30):
        for sensor in ("eeg", "ppg", "acc"):
            ticks = origin[sensor] + step_ticks(sensor, k)
            t_us = k * 100_000 + {"eeg": 0, "ppg": 3000, "acc": 7000}[sensor]
            ent.append((t_us + 500_000 + jitter(rng), sensor, build(sensor, ticks, rng), "k=%d" % k))
    ent.sort(key=lambda e: e[0])  # 도착 순서(센서 사이는 jitter 로 뒤섞임)
    stream("gf02_multisensor_origin", ent)

    # (b) 32bit wrap: EEG 헤더가 2^32 직전 → 0 근처
    base = U32 - step_ticks("eeg", 3) - 10
    ent = [(k * 100_000 + jitter(rng) + 500_000, "eeg", build("eeg", (base + step_ticks("eeg", k)) % U32, rng), "k=%d" % k) for k in range(8)]
    stream("gf02_wrap32", ent)

    # (c) tick reset(장치 재부팅): 40초 후 헤더가 0 근처로
    ent = [(k * 100_000 + 500_000, "eeg", build("eeg", 40 * TICK_HZ + step_ticks("eeg", k), rng), "pre") for k in range(5)]
    ent += [(600_000 + k * 100_000 + 500_000, "eeg", build("eeg", 100 + step_ticks("eeg", k), rng), "post_reset") for k in range(5)]
    stream("gf02_reset_segment", ent)

    # (d) 중복/충돌/역순
    p = [build("eeg", 80 * TICK_HZ + step_ticks("eeg", k), rng) for k in range(6)]
    conflict = p[3][:4] + bytes([(p[3][4] + 1) & 255]) + p[3][5:]
    ent = [
        (500_000, "eeg", p[0], "first"),
        (600_000, "eeg", p[1], "next"),
        (610_000, "eeg", p[1], "duplicate_notification"),
        (700_000, "eeg", p[2], "next"),
        (800_000, "eeg", p[3], "next"),
        (805_000, "eeg", conflict, "same_tick_different_payload"),
        (900_000, "eeg", p[4], "next"),
        (905_000, "eeg", p[2], "out_of_order_older"),
        (1_000_000, "eeg", p[5], "next"),
    ]
    stream("gf02_duplicate_conflict_order", ent)

    # (e) 잘린 패킷
    g = build("eeg", 10 * TICK_HZ, rng)
    pg = build("ppg", 10 * TICK_HZ, rng)
    ag = build("acc", 10 * TICK_HZ, rng)
    ent = [
        (1, "eeg", g, "ok_25_samples"),
        (2, "eeg", build("eeg", 10 * TICK_HZ + step_ticks("eeg", 1), rng)[: 4 + 7 * 3 + 3], "remainder_3_bytes"),
        (3, "eeg", build("eeg", 10 * TICK_HZ + step_ticks("eeg", 2), rng)[:7], "shorter_than_8"),
        (4, "eeg", b"\x01\x02", "header_incomplete"),
        (5, "ppg", pg, "ok_5_samples"),
        (6, "ppg", build("ppg", 10 * TICK_HZ + step_ticks("ppg", 1), rng)[: 4 + 6 + 2], "remainder_2_bytes"),
        (7, "acc", ag, "ok_3_samples"),
        (8, "acc", build("acc", 10 * TICK_HZ + step_ticks("acc", 1), rng)[:9], "shorter_than_10"),
        (9, "acc", build("acc", 10 * TICK_HZ + step_ticks("acc", 2), rng)[: 4 + 6 + 4], "remainder_4_bytes"),
    ]
    stream("gf02_truncated", ent)

    return {"gf01": list(gf01), "gf02_streams": streams}


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1]), ensure_ascii=False))

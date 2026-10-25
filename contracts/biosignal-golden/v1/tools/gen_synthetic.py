#!/usr/bin/env python3
"""SDD-246 T01 — 결정적 시드 합성 EEG/PPG/ACC 패킷 스트림 생성기 (GF03 합성 대역, GF04 일부).

실측 raw 가 아니다(G1 미충족). 생리 형태를 흉내 낸 입력일 뿐이며,
oracle(기존 frontend/src/lib/eeg TS)이 단계별 출력을 내는 '입력'으로만 쓴다.
출력: synth/stream.bin (패킷 연결) + synth/schedule.json ([arrival_us, sensor, offset, length]) + synth/scenario.json.
무작위는 LCG(시드 고정) 뿐 → 같은 파이썬에서 바이트 동일. 커밋된 바이너리가 정본이다.

사용: python3 gen_synthetic.py <v1_디렉터리>
"""
import bisect
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_packets import (  # noqa: E402
    ACC_HZ, EEG_HZ, PER_PACKET, PPG_HZ, TICK_HZ, U32, Lcg, acc_sample, be24, eeg_sample, le32, step_ticks,
)

SEED = 246002
DURATION_S = 150
LSB_UV = 4.033 / 12 / (2 ** 23 - 1) * 1e6  # SDK 와 동일 상수(µV/LSB)
# 센서별 헤더 원점(초) — 서로 다름(GF02)
ORIGIN_S = {"eeg": 1000, "ppg": 1000 + 92400, "acc": 500}


def seg_amp(t):
    if t < 50:
        return {"alpha": 18.0, "beta": 3.0}
    if t < 100:
        return {"alpha": 5.0, "beta": 12.0}
    return {"alpha": 10.0, "beta": 6.0}


def eeg_uv(ch, i, rng):
    t = i / EEG_HZ
    a = seg_amp(t)
    ph = (0.3, 1.1, 2.0, 0.7, 1.9, 0.2) if ch == 1 else (1.0, 0.4, 1.3, 2.2, 0.1, 0.9)
    gain = 1.0 if ch == 1 else 0.8
    v = (a["alpha"] * math.sin(2 * math.pi * 10 * t + ph[0]) + a["beta"] * math.sin(2 * math.pi * 20 * t + ph[1])
         + 4.0 * math.sin(2 * math.pi * 6 * t + ph[2]) + 6.0 * math.sin(2 * math.pi * 2 * t + ph[3])
         + 1.5 * math.sin(2 * math.pi * 38 * t + ph[4]) + 3.0 * math.sin(2 * math.pi * 60 * t + ph[5]))
    noise = ((rng.next() % 4001) - 2000) / 1000.0  # ±2µV
    return gain * v + noise


def leadoff_byte(i):
    t = i / EEG_HZ
    b = 0
    if 120 <= t < 125:
        b |= 0x01  # ch1 접촉 불량 5초
    if 130 <= t < 131:
        b |= 0x05  # 양쪽 1초
    return b


def ppg_beats():
    """RSA(0.25Hz)로 변조된 RR 열 → 박동 시각(초)."""
    beats, t, k = [], 0.5, 0
    while t < DURATION_S + 2:
        beats.append(t)
        rr = 0.9 + 0.06 * math.sin(2 * math.pi * 0.25 * t)  # 66.7bpm ± 변조
        t += rr
        k += 1
    return beats


BEATS = ppg_beats()


def ppg_val(i, rng, chan):
    t = i / PPG_HZ
    if 100 <= t < 110:  # 저품질 구간: 맥파 없음 + 큰 잡음
        amp = 0.0
        noise = ((rng.next() % 6001) - 3000)
    else:
        amp = 1.0
        noise = ((rng.next() % 401) - 200)
    s = 0.0
    # 가까운 박동만 합산
    lo = max(0, bisect.bisect_left(BEATS, t - 0.9))
    for bt in BEATS[lo:lo + 4]:
        dt = t - bt
        if -0.3 < dt < 0.8:
            s += math.exp(-((dt - 0.12) / 0.09) ** 2 / 2) + 0.08 * math.exp(-((dt - 0.40) / 0.10) ** 2 / 2)
    if chan == "ir":
        v = 120000 + amp * 9000 * s + noise
    else:
        v = 100000 + amp * 5400 * s + noise
    return max(0, min(0xFFFFFF, int(round(v))))


def acc_vals(i, rng):
    t = i / ACC_HZ
    burst = 60 <= t < 65
    s = 900 if burst else 60
    return ((rng.next() % (2 * s + 1)) - s, (rng.next() % (2 * s + 1)) - s, 16384 + (rng.next() % (2 * s + 1)) - s)


def main(out):
    rng = Lcg(SEED)
    jr = Lcg(SEED + 1)
    pk = {s: [] for s in ("eeg", "ppg", "acc")}
    n_packets = DURATION_S * 10  # 패킷당 0.1초
    eeg_i = ppg_i = acc_i = 0
    entries = []
    for k in range(n_packets):
        # EEG
        samples = b""
        for j in range(PER_PACKET["eeg"]):
            i = eeg_i + j
            r1 = int(round(eeg_uv(1, i, rng) / LSB_UV))
            r2 = int(round(eeg_uv(2, i, rng) / LSB_UV))
            samples += eeg_sample(leadoff_byte(i), r1 & 0xFFFFFF, r2 & 0xFFFFFF)
        eeg_i += PER_PACKET["eeg"]
        # 헤더 tick = "마지막 샘플" 시각(현 웹 profile 가정)에 가까운 값을 정수로. 원점 + k 번째 패킷 끝.
        eeg_ticks = (ORIGIN_S["eeg"] * TICK_HZ + step_ticks("eeg", k + 1)) % U32
        entries.append((k * 100_000 + 100_000, "eeg", le32(eeg_ticks) + samples))
        # PPG
        samples = b""
        for j in range(PER_PACKET["ppg"]):
            i = ppg_i + j
            samples += be24(ppg_val(i, rng, "red")) + be24(ppg_val(i, rng, "ir"))
        ppg_i += PER_PACKET["ppg"]
        ppg_ticks = (ORIGIN_S["ppg"] * TICK_HZ + step_ticks("ppg", k + 1)) % U32
        entries.append((k * 100_000 + 103_000, "ppg", le32(ppg_ticks) + samples))
        # ACC
        samples = b""
        for j in range(PER_PACKET["acc"]):
            x, y, z = acc_vals(acc_i + j, rng)
            samples += acc_sample(x, y, z)
        acc_i += PER_PACKET["acc"]
        acc_ticks = (ORIGIN_S["acc"] * TICK_HZ + step_ticks("acc", k + 1)) % U32
        entries.append((k * 100_000 + 107_000, "acc", le32(acc_ticks) + samples))

    # 도착 시각: 명목 + ±25ms jitter(결정적), 단 같은 센서 내 도착 순서는 보존(링크 순서)
    sched, blob, off = [], bytearray(), 0
    last_arr = {"eeg": -1, "ppg": -1, "acc": -1}
    timed = []
    for arr, sensor, b in entries:
        a = arr + ((jr.next() % 50001) - 25000)
        a = max(a, last_arr[sensor] + 1)
        last_arr[sensor] = a
        timed.append((a, sensor, b))
    timed.sort(key=lambda e: e[0])
    for a, sensor, b in timed:
        sched.append([a, sensor, off, len(b)])
        blob += b
        off += len(b)
    d = os.path.join(out, "synth")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "stream.bin"), "wb") as f:
        f.write(bytes(blob))
    with open(os.path.join(d, "schedule.json"), "w") as f:
        json.dump(sched, f, separators=(",", ":"))
        f.write("\n")
    scenario = {
        "name": "synth_seed246",
        "kind": "synthetic",
        "real_data": False,
        "g1_satisfied": False,
        "seed": SEED, "duration_s": DURATION_S,
        "packets": len(sched), "bytes": len(blob),
        "origin_seconds": ORIGIN_S,
        "per_packet_samples": PER_PACKET,
        "events": [
            {"t_s": [0, 50], "note": "alpha 우세(18µV@10Hz) + beta 3µV@20Hz"},
            {"t_s": [50, 100], "note": "beta 우세(12µV) + alpha 5µV"},
            {"t_s": [100, 150], "note": "혼합 alpha 10 / beta 6"},
            {"t_s": [120, 125], "note": "ch1 leadoff"}, {"t_s": [130, 131], "note": "양 채널 leadoff"},
            {"t_s": [100, 110], "note": "PPG 저품질(맥파 0 + 잡음 ±3000)"},
            {"t_s": [60, 65], "note": "ACC 움직임 burst"},
            {"note": "PPG RSA 0.25Hz(15 breaths/min), RR=0.9±0.06s"},
        ],
        "arrival": "명목 도착 + 결정적 jitter ±25ms, 센서 내 순서 보존",
    }
    with open(os.path.join(d, "scenario.json"), "w", encoding="utf-8") as f:
        json.dump(scenario, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    print(json.dumps({"packets": len(sched), "bytes": len(blob)}))


if __name__ == "__main__":
    main(sys.argv[1])

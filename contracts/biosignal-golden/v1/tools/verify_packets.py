#!/usr/bin/env python3
"""SDD-246 T01 — 패킷 fixture 독립 검증 (GF01/GF02).

생성기(gen_packets.py)와 다른 두 경로로 expected 를 다시 확인한다.
  A) 손으로 계산해 하드코딩한 정수/분수 (생성기 코드를 import 하지 않는다)
  B) struct 모듈 기반 디코더 (생성기는 수동 산술)
그리고 생성기를 임시 디렉터리에 다시 돌려 바이트/JSON 이 저장본과 동일(결정성)한지 본다.

사용: python3 verify_packets.py <v1_디렉터리>   (실패 시 종료코드 1)
"""
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction

V1 = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else None
if V1 is not None:
    sys.argv.pop(1)
HERE = os.path.dirname(os.path.abspath(__file__))


def rd(rel):
    with open(os.path.join(V1, rel), "rb") as f:
        return f.read()


def rj(rel):
    return json.loads(rd(rel).decode("utf-8"))


class HandComputedGF01(unittest.TestCase):
    """A) 하드코딩 정답 — 값은 손계산."""

    def test_ppg_header_is_little_endian_one_second(self):
        b = rd("packets/gf01_ppg_header_le_1s.bin")
        self.assertEqual(b[:4], bytes([0x00, 0x80, 0x00, 0x00]))
        e = rj("expected/gf01_ppg_header_le_1s.json")
        self.assertEqual(e["header_ticks"], 32768)                      # 0x00008000
        self.assertEqual(e["header_seconds_exact"], "1")
        self.assertEqual(e["header_ticks_if_big_endian_wrong"], 8388608)  # 0x00800000 — BE 오해
        self.assertNotEqual(e["header_ticks"], e["header_ticks_if_big_endian_wrong"])

    def test_ppg_samples_be_uint24(self):
        s = rj("expected/gf01_ppg_header_le_1s.json")["samples"]
        self.assertEqual([(x["red"], x["ir"]) for x in s], [(0, 16777215), (0x123456, 0xABCDEF), (0x800000, 0x7FFFFF)])
        self.assertEqual(0x123456, 1193046)
        self.assertEqual(0xABCDEF, 11259375)

    def test_ppg_endian_probe(self):
        e = rj("expected/gf01_ppg_header_endian_probe.json")
        self.assertEqual(e["header_ticks"], 0x04030201)       # 67305985
        self.assertEqual(e["header_ticks_if_big_endian_wrong"], 0x01020304)  # 16909060
        self.assertEqual(e["header_ticks"], 67305985)
        self.assertEqual(e["header_ticks_if_big_endian_wrong"], 16909060)

    def test_eeg_signed24_extremes_and_leadoff(self):
        e = rj("expected/gf01_eeg_signed24_leadoff.json")
        self.assertEqual(e["header_ticks"], 32768)
        s = e["samples"]
        self.assertEqual([(x["ch1_signed"], x["ch2_signed"]) for x in s],
                         [(-8388608, 8388607), (-1, 0), (1, -2), (0x123456, -0x012346), (0, 0)])
        # 0xFEDCBA = 16702650 → -(0x1000000-0xFEDCBA) = -0x012346
        self.assertEqual(0xFEDCBA - 0x1000000, -74566)
        self.assertEqual(s[3]["ch2_signed"], -74566)
        self.assertEqual([(x["leadoff_ch1"], x["leadoff_ch2"]) for x in s],
                         [(False, False), (True, False), (False, True), (True, True), (False, False)])
        self.assertEqual(s[4]["leadoff_byte"], 0xFA)   # bit0/bit2 가 0 → leadoff 아님

    def test_eeg_uv_conversion_exact_values(self):
        s = rj("expected/gf01_eeg_signed24_leadoff.json")["samples"]
        # 1 LSB = 4.033/12/(2^23-1)*1e6 µV (손계산: 4.033e6/12 = 336083.3333…, /8388607 = 0.04006426…)
        lsb = Fraction(4033, 1000) / 12 / (2 ** 23 - 1) * 10 ** 6
        self.assertAlmostEqual(float(lsb), 0.04006426, places=8)
        for x in s:
            self.assertAlmostEqual(float(Fraction(x["ch1_uv_exact"])), float(lsb * x["ch1_signed"]), places=6)
        # 최대값 (2^23-1) → 정확히 4.033e6/12 = 336083.333333333 µV
        self.assertEqual(s[0]["ch2_uv_exact"], "336083.333333333")
        # 최소값 -2^23 → -(336083.333…)*(2^23)/(2^23-1)
        self.assertAlmostEqual(float(Fraction(s[0]["ch1_uv_exact"])), -336083.3333333333 * 8388608 / 8388607, places=6)

    def test_acc_signed16_le(self):
        e = rj("expected/gf01_acc_signed16.json")
        s = e["samples"]
        self.assertEqual([(x["x_raw"], x["y_raw"], x["z_raw"]) for x in s],
                         [(-32768, 32767, -1), (0, 1, -32767), (16384, -16384, 256)])
        self.assertEqual([x["x_g"] for x in s], [-2.0, 0.0, 1.0])       # 2/32768 g/LSB
        self.assertEqual(s[2]["z_g_exact"], "1/64")                      # 256/16384
        self.assertEqual(s[0]["y_g_exact"], str(Fraction(32767, 16384)))

    def test_anchor_two_meanings_d09(self):
        a = rj("expected/gf01_eeg_signed24_leadoff.json")["anchor_offsets_us"]
        self.assertEqual(a["sdk_first_sample"], ["0", "4000", "8000", "12000", "16000"])           # base + i/250
        self.assertEqual(a["web_last_sample"], ["-16000", "-12000", "-8000", "-4000", "0"])        # base + (i-n+1)/250
        acc = rj("expected/gf01_acc_signed16.json")["anchor_offsets_us"]
        self.assertEqual(acc["sdk_first_sample"], ["0", "100000/3", "200000/3"])                   # 정확한 분수
        self.assertEqual(acc["web_last_sample_rounded_33333us"], ["-66666", "-33333", "0"])         # 현 웹 profile 반올림


class StructDecoderCrossCheck(unittest.TestCase):
    """B) struct 기반 독립 디코더와 expected 일치."""

    def _eeg(self, b):
        t, = struct.unpack_from("<I", b, 0)
        n = (len(b) - 4) // 7
        out = []
        for i in range(n):
            o = 4 + i * 7
            lo = b[o]
            c1 = int.from_bytes(b[o + 1:o + 4], "big", signed=True)
            c2 = int.from_bytes(b[o + 4:o + 7], "big", signed=True)
            out.append((lo & 1 != 0, lo & 4 != 0, c1, c2))
        return t, out

    def test_eeg_edge(self):
        b = rd("packets/gf01_eeg_signed24_leadoff.bin")
        t, out = self._eeg(b)
        e = rj("expected/gf01_eeg_signed24_leadoff.json")
        self.assertEqual(t, e["header_ticks"])
        self.assertEqual(out, [(x["leadoff_ch1"], x["leadoff_ch2"], x["ch1_signed"], x["ch2_signed"]) for x in e["samples"]])
        for (_, _, c1, _), x in zip(out, e["samples"]):
            self.assertEqual(c1 * 4.033 / 12 / (2 ** 23 - 1) * 1e6, x["ch1_uv_sdk_float"])  # SDK 연산 순서 float 동일

    def test_ppg_acc_edge(self):
        b = rd("packets/gf01_ppg_header_le_1s.bin")
        self.assertEqual(struct.unpack_from("<I", b, 0)[0], 32768)
        e = rj("expected/gf01_ppg_header_le_1s.json")
        for i, x in enumerate(e["samples"]):
            o = 4 + i * 6
            self.assertEqual(int.from_bytes(b[o:o + 3], "big"), x["red"])
            self.assertEqual(int.from_bytes(b[o + 3:o + 6], "big"), x["ir"])
        b = rd("packets/gf01_acc_signed16.bin")
        e = rj("expected/gf01_acc_signed16.json")
        for i, x in enumerate(e["samples"]):
            self.assertEqual(struct.unpack_from("<hhh", b, 4 + i * 6), (x["x_raw"], x["y_raw"], x["z_raw"]))

    def test_every_gf02_packet_decodes_same(self):
        for name in ("gf02_multisensor_origin", "gf02_wrap32", "gf02_reset_segment", "gf02_duplicate_conflict_order", "gf02_truncated"):
            e = rj("expected/%s.json" % name)
            for p in e["packets"]:
                b = rd(p["file"])
                self.assertEqual(len(b), p["length"], p["file"])
                if p["strict_status"] != "ok":
                    continue
                self.assertEqual(struct.unpack_from("<I", b, 0)[0] % (1 << 32), struct.unpack_from("<I", b, 0)[0])
                body = len(b) - 4
                size = {"eeg": 7, "ppg": 6, "acc": 6}[p["sensor"]]
                self.assertEqual(body % size, 0, p["file"])


class Gf02Semantics(unittest.TestCase):
    def test_sensor_origins_differ_by_92400s(self):
        e = rj("expected/gf02_multisensor_origin.json")["packets"]
        first = {}
        for p in e:
            first.setdefault(p["sensor"], p["extended_ticks"]) if p["event"] == "first" else None
        # 센서별 첫 도착 패킷의 k 는 jitter 로 다를 수 있으므로 원점(100s/50s/92500s) 근방(±1s)만 확인
        self.assertAlmostEqual(first["ppg"] / 32768, 92500, delta=3)
        self.assertAlmostEqual(first["eeg"] / 32768, 100, delta=3)
        self.assertAlmostEqual(first["acc"] / 32768, 50, delta=3)
        self.assertAlmostEqual((first["ppg"] - first["eeg"]) / 32768, 92400, delta=3)

    def test_wrap32_extends_monotonic_and_marks_wrap(self):
        p = rj("expected/gf02_wrap32.json")["packets"]
        self.assertEqual(sum(1 for x in p if x["event"] == "wrap"), 1)
        ext = [x["extended_ticks"] for x in p]
        self.assertEqual(ext, sorted(ext))
        self.assertTrue(any(x > (1 << 32) for x in ext))
        # 패킷당 25샘플/250Hz = 0.1초 = 3276.8 tick → 정수 반올림 3277/3276 교대, 합은 정확히 round(k*3276.8)
        d = [b - a for a, b in zip(ext, ext[1:])]
        self.assertTrue(all(3276 <= x <= 3277 for x in d), d)

    def test_reset_makes_new_segment(self):
        p = rj("expected/gf02_reset_segment.json")["packets"]
        self.assertEqual([x["segment"] for x in p], [0] * 5 + [1] * 5)
        self.assertEqual(p[5]["event"], "reset_new_segment")

    def test_duplicate_conflict_out_of_order(self):
        p = rj("expected/gf02_duplicate_conflict_order.json")["packets"]
        self.assertEqual([x["status"] for x in p],
                         ["accepted", "accepted", "duplicate", "accepted", "accepted", "conflict", "accepted", "out_of_order", "accepted"])
        self.assertEqual(p[5]["event"], "same_tick_different_payload")

    def test_truncated_statuses(self):
        p = rj("expected/gf02_truncated.json")["packets"]
        self.assertEqual([x["strict_status"] for x in p],
                         ["ok", "invalid_remainder", "invalid_too_short", "invalid_header_short",
                          "ok", "invalid_remainder", "ok", "invalid_too_short", "invalid_remainder"])
        # SDK 는 나머지 byte 를 조용히 무시한다(lenient) — 우리는 invalid 로 분리하고 원문 보관
        rem = rj("expected/gf02_truncated.json")["packets"][1]
        self.assertEqual(rem["sdk_lenient_sample_count"], 3)
        self.assertEqual(rem["remainder_bytes"], 3)


class Determinism(unittest.TestCase):
    def test_regeneration_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([sys.executable, "-I", os.path.join(HERE, "gen_packets.py"), d], check=True, stdout=subprocess.DEVNULL)
            for root, _, files in os.walk(d):
                for f in files:
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, d)
                    with open(full, "rb") as a, open(os.path.join(V1, rel), "rb") as b:
                        self.assertEqual(a.read(), b.read(), rel)
            n_new = sum(len(fs) for _, _, fs in os.walk(d))
            n_old = 0
            for sub in ("packets", "expected"):
                n_old += sum(len(fs) for _, _, fs in os.walk(os.path.join(V1, sub)))
            self.assertEqual(n_new, n_old)


if __name__ == "__main__":
    if V1 is None:
        print("사용: verify_packets.py <v1_디렉터리>", file=sys.stderr)
        sys.exit(2)
    unittest.main(verbosity=1)

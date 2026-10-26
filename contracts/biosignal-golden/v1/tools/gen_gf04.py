#!/usr/bin/env python3
"""SDD-246 T01 — GF04 경계 벡터 입력 + 독립(표준 라이브러리) 기대값.
HRV 게이트 규칙은 AnalysisMetricsService 의 문서화된 계약(plan §5.2)을 Python 으로 다시 계산한다:
  유효 RR 200..2000ms(양끝 포함) → 중앙값 ±25% 이탈 제외(FIX hrv-sdnn-scale) · 버퍼 최근 120 · 계산은 버퍼>=30 · SDNN/RMSSD: 최근 60 RR 중 >=10개이고 합>=30000ms,
  SDNN 분모 N(모집단) · 호흡: 버퍼 RR 합>=60000ms 이고 첫~마지막 박동 시각 경과>=60000ms.
출력: expected/gf04/cases.json (입력 rr 열 + independent 기대값). 호흡 '값' 자체는 oracle 몫(여기선 게이트 여부만).
사용: python3 gen_gf04.py <v1_dir>
"""
import json, math, os, sys

def art(rr):
    # 중앙값 ±25% 아티팩트 제외 (하루명상 SDD-052 filterArtifactRr). 기준 풀이 3개 미만이면 통과.
    if len(rr) < 3: return rr
    med = sorted(rr)[len(rr) >> 1]
    return [x for x in rr if abs(x - med) <= med * 0.25] if med > 0 else rr

def valid_of(rr_in):
    v = art([x for x in rr_in if 200 <= x <= 2000])
    return art(v)[-120:] if len(v) >= 5 else v[-120:]

def run(rr_in):
    rr = valid_of(rr_in)
    out = {"valid_rr": len(rr), "calc": len(rr) >= 30}
    if not out["calc"]:
        out.update(sdnn=None, avnn=None, resp_gate="insufficient_rr_buffer"); return out
    w = rr[-60:]
    if len(w) < 10 or sum(w) < 30000:
        out.update(sdnn=None, avnn=None)
    else:
        m = sum(w) / len(w)
        out.update(avnn=m, sdnn=math.sqrt(sum((x - m) ** 2 for x in w) / len(w)))
    return out

def with_resp(case):
    rr = case["rr"]; valid = valid_of(rr)
    e = run(rr)
    if e["calc"]:
        # 시각: 마지막 박동 종료 시각을 기준으로 RR 누적 (첫 박동 시각 = 마지막 - 합(첫 RR 제외))
        total = sum(valid); elapsed = total - valid[0]
        e["resp_gate"] = "insufficient_window" if (total < 60000 or elapsed < 60000) else "open"
        e["rr_sum_ms"] = total; e["elapsed_ms"] = elapsed
    case["independent"] = e
    return case

C = []
def add(name, why, rr): C.append(with_resp({"name": name, "why": why, "rr": rr}))
for n in (58, 59, 60, 61, 62):
    add(f"cumulative_{n}s", f"RR 1000ms x {n}: 합 {n}s, 경과 {n-1}s -> 호흡 게이트(합>=60s AND 경과>=60s)", [1000] * n)
add("rr_bound_199", "199ms 는 제외", [199] + [1000] * 40)
add("rr_bound_200", "200ms 는 포함(양끝)", [200] + [1000] * 40)
add("rr_bound_2000", "2000ms 는 포함", [2000] + [1000] * 40)
add("rr_bound_2001", "2001ms 는 제외", [2001] + [1000] * 40)
add("min_beats_29", "유효 박동 29 -> 계산 안 함(버퍼<30)", [1000] * 29)
add("min_beats_30", "유효 박동 30, 합 30s -> SDNN 가능, 호흡 불가", [1000] * 30)
add("sdnn_sum_29970", "30박 x 999ms=29970ms (<30s) -> SDNN null", [999] * 30)
add("sdnn_sum_30000", "30박 x 1000ms -> SDNN 0", [1000] * 30)
add("sdnn_denominator_N", "900/1100 교대 40박: 분모 N -> SDNN=100 (표본분산이면 101.3)", [900, 1100] * 20)
add("sdnn_window_last60", "70박: 앞 10박 900, 뒤 60박 1000/1200 교대 -> 최근 60 만 사용", [900] * 10 + [1000, 1200] * 30)
add("buffer_cap_120", "130박 -> 버퍼 최근 120", [1000 + (i % 7) * 10 for i in range(130)])

d = os.path.join(sys.argv[1], "expected", "gf04"); os.makedirs(d, exist_ok=True)
json.dump({"cases": C, "rules": "gen_gf04.py docstring"}, open(os.path.join(d, "cases.json"), "w"), ensure_ascii=False, indent=1, sort_keys=True)
print(len(C))

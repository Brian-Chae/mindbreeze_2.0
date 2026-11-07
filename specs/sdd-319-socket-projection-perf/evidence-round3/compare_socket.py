"""보존된 전후 소켓 결과와 실행 소스 SHA를 비교한다(DB 접근 없음)."""
import json
from pathlib import Path
BASE = Path(__file__).resolve().parent

def read(name):
    return json.loads((BASE / name).read_text())

def main():
    out = {}
    for n, suffix in ((100, ""), (40, ""), (100, "-r2"), (40, "-r2")):
        if not (BASE / f"socket-after-{n}{suffix}.json").exists():
            continue
        b, a = (read(f"socket-{stage}-{n}{suffix}.json") for stage in ("before", "after"))
        sb, sa = (read(f"socket-{stage}-{n}{suffix}-source.json") for stage in ("before", "after"))
        assert all(b[k] == a[k] for k in ("n", "ticks", "burst", "burn_ms", "period_ms"))
        out[f"{n}{suffix}"] = {
            "p95_s": {k: {"before": b["p95_s"][k], "after": a["p95_s"][k],
                           "delta": a["p95_s"][k] - b["p95_s"][k]} for k in b["p95_s"]},
            "cpu_process_mean_pct": {"before": b["cpu_process_mean_pct"], "after": a["cpu_process_mean_pct"],
                                     "delta_pp": a["cpu_process_mean_pct"] - b["cpu_process_mean_pct"]},
            "counts": {"before": b["counts"], "after": a["counts"]},
            "errors": {"before": b["errors"], "after": a["errors"]},
            "exitstatus": {"before": sb["exitstatus"], "after": sa["exitstatus"]},
            "changed_sources": [name for name, value in sb["sha256"].items() if sa["sha256"][name] != value],
            "invariants": {key: {"before": b[key], "after": a[key]} for key in
                           ("stored_count", "expected_windows", "closed_streams", "broadcast_missing_pairs",
                            "client_missing_pairs", "revision", "applied_revision", "emitted_revision")},
        }
    aggregates = {}
    for n in (100, 40):
        aggregates[n] = {}
        for stage in ("before", "after"):
            samples = [read(f"socket-{stage}-{n}{suffix}.json") for suffix in ("", "-r2")
                       if (BASE / f"socket-{stage}-{n}{suffix}.json").exists()]
            aggregates[n][stage] = {"samples": len(samples)}
            values = {key: [d["p95_s"][key] for d in samples] for key in samples[0]["p95_s"]}
            values["cpu_process_mean_pct"] = [d["cpu_process_mean_pct"] for d in samples]
            for key, vals in values.items():
                aggregates[n][stage][key] = {"min": min(vals), "max": max(vals), "mean": sum(vals)/len(vals)}
    out["aggregates"] = aggregates
    (BASE / "socket-comparison.json").write_text(json.dumps(out,ensure_ascii=False,indent=2))
    print(json.dumps(out,ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()

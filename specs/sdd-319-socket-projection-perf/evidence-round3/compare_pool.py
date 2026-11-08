"""최종 전용 풀 변형과 보존한 기준선 2표본을 비교한다. DB 접근 없음."""
import hashlib
import json
from pathlib import Path
BASE=Path(__file__).resolve().parent
BACKEND=BASE.parents[2]/"backend"
def read(name):
    return json.loads((BASE/name).read_text())
def main():
    out={}
    for n in (100,40):
        before=[read(f"socket-before-{n}{suffix}.json") for suffix in ("","-r2")]
        after=read(f"socket-pool-after-{n}.json")
        manifest=read(f"socket-pool-after-{n}-source.json")
        for key,value in manifest["sha256"].items():
            preserved=BASE/"variants-pool"/(Path(key).name+".txt")
            source=preserved if preserved.exists() else BACKEND/key
            assert hashlib.sha256(source.read_bytes()).hexdigest()==value
        metrics={k:[d["p95_s"][k] for d in before] for k in after["p95_s"]}
        metrics["cpu_process_mean_pct"]=[d["cpu_process_mean_pct"] for d in before]
        result={}
        for key,values in metrics.items():
            value=after["cpu_process_mean_pct"] if key=="cpu_process_mean_pct" else after["p95_s"][key]
            result[key]={"before_samples":values,"before_mean":sum(values)/len(values),"before_min":min(values),"before_max":max(values),"after":value,"delta_from_before_mean":value-sum(values)/len(values)}
        result.update(after_counts=after["counts"],after_errors=after["errors"],after_exitstatus=manifest["exitstatus"],
                      after_invariants={k:after[k] for k in ("stored_count","expected_windows","closed_streams","broadcast_missing_pairs","client_missing_pairs","revision","applied_revision","emitted_revision")},source_sha256=manifest["sha256"])
        out[n]=result
    (BASE/"socket-pool-comparison.json").write_text(json.dumps(out,ensure_ascii=False,indent=2))
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=="__main__":
    main()

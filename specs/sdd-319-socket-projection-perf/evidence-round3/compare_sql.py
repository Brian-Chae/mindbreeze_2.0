"""SQL 왕복 축소 최종 변형과 기준선 각 2표본 비교. DB 접근 없음."""
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
        samples={stage:[read(f"socket-{stage}-{n}{suffix}.json") for suffix in ("","-r2")]
                 for stage in ("before","sql-after")}
        manifests=[read(f"socket-sql-after-{n}{suffix}-source.json") for suffix in ("","-r2")]
        for manifest in manifests:
            for key,value in manifest["sha256"].items():
                preserved=BASE/"variants-sql"/(Path(key).name+".txt")
                source=preserved if preserved.exists() else BACKEND/key
                assert hashlib.sha256(source.read_bytes()).hexdigest()==value
        result={}
        keys=list(samples["before"][0]["p95_s"])+["cpu_process_mean_pct"]
        for key in keys:
            result[key]={}
            for stage,data in samples.items():
                values=[d[key] if key=="cpu_process_mean_pct" else d["p95_s"][key] for d in data]
                result[key][stage]={"samples":values,"mean":sum(values)/len(values),"min":min(values),"max":max(values)}
            result[key]["mean_delta"]=result[key]["sql-after"]["mean"]-result[key]["before"]["mean"]
        result.update(after_counts=[d["counts"] for d in samples["sql-after"]],after_errors=[d["errors"] for d in samples["sql-after"]],
                      after_exitstatus=[m["exitstatus"] for m in manifests],
                      after_invariants=[{k:d[k] for k in ("stored_count","expected_windows","closed_streams","broadcast_missing_pairs","client_missing_pairs","revision","applied_revision","emitted_revision")} for d in samples["sql-after"]],
                      source_sha256=manifests[0]["sha256"])
        out[n]=result
    (BASE/"socket-sql-comparison.json").write_text(json.dumps(out,ensure_ascii=False,indent=2))
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=="__main__":
    main()

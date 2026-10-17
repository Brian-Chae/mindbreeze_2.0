#!/usr/bin/env bash
# SDD-210 T-4: 릴리스 산출물(tar.gz + sha256 + MANIFEST.json) 조립. 리포지토리 루트에서 실행.
# 사용: deploy/ci/build-release.sh <RELEASE_ID> <GIT_SHA> <출력 디렉터리> [migration-report.json] [RUN_ID]
# 전제: frontend/dist 가 이미 prod 설정으로 빌드되어 있어야 한다. 서버에서는 재빌드하지 않는다(V-3.7).
set -euo pipefail
RID="${1:?RELEASE_ID}"; SHA="${2:?GIT_SHA}"; OUT="${3:?출력 디렉터리}"; MIGREPORT="${4:-}"; RUN_ID="${5:-local}"
[ -d frontend/dist ] || { echo "frontend/dist 없음 — 먼저 빌드" >&2; exit 2; }
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"   # 절대 경로화 — 아래 서브셸이 cd 하므로 상대 경로면 tar 출력 위치가 깨진다
[ -z "$MIGREPORT" ] || MIGREPORT="$(cd "$(dirname "$MIGREPORT")" && pwd)/$(basename "$MIGREPORT")"
STAGE="$OUT/stage/release"
rm -rf "$OUT/stage"; mkdir -p "$STAGE/backend" "$STAGE/deploy"
cp -R frontend/dist "$STAGE/dist"
cp -R backend/app backend/alembic "$STAGE/backend/"
cp backend/alembic.ini backend/requirements.txt "$STAGE/backend/"
cp backend/*_cron.py "$STAGE/backend/"
rsync -a --exclude '__pycache__' --exclude 'precheck' deploy/ "$STAGE/deploy/" 2>/dev/null || cp -R deploy/. "$STAGE/deploy/"
# 운영자 전용(인프라 생성·점검 스크립트, 사전 점검)은 릴리스에 싣지 않는다 — 서버에 불필요하고 dev 비교 문자열을 담는다.
rm -rf "$STAGE/deploy/aws" "$STAGE/deploy/precheck"
find "$STAGE" \( -name '__pycache__' -o -name '._*' -o -name '.DS_Store' -o -name '*.pyc' \) -prune -exec rm -rf {} + 2>/dev/null || true
REQ_SHA="$(shasum -a 256 backend/requirements.txt | cut -d' ' -f1)"
python3 - "$STAGE" "$RID" "$SHA" "$REQ_SHA" "$RUN_ID" "$MIGREPORT" <<'PY'
import hashlib, json, sys, datetime
from pathlib import Path
stage, rid, sha, req, run_id, mig = sys.argv[1:7]
mig_data = json.loads(Path(mig).read_text()) if mig and Path(mig).is_file() else {"heads": [], "destructive": False, "warnings": []}
files = {}
for p in sorted(Path(stage).rglob("*")):
    if p.is_file():
        files[p.relative_to(stage).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
manifest = {
    "release_id": rid, "git_sha": sha, "run_id": run_id,
    "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "requirements_sha256": req,
    "migration_heads": mig_data.get("heads", []),
    "destructive_migrations": bool(mig_data.get("destructive")),
    "migration_warnings": mig_data.get("warnings", []),
    "file_count": len(files),
    "files_sha256_of_hashes": hashlib.sha256("".join(f"{k}:{v}\n" for k, v in files.items()).encode()).hexdigest(),
}
Path(stage, "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
PY
ART="$OUT/mindbreeze-$RID.tar.gz"
# 결정적 순서로 tar (재현성): 파일 목록 정렬. macOS bsdtar/GNU tar 모두 동작하는 옵션만 사용.
( cd "$STAGE" && find . -type f | sort | tar -czf "$ART" -T - )
( cd "$OUT" && shasum -a 256 "mindbreeze-$RID.tar.gz" > "mindbreeze-$RID.tar.gz.sha256" )
echo "산출물: $ART"
cat "$ART.sha256"

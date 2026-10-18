#!/usr/bin/env bash
# C-2 DB 이전: dev RDS 최종 스냅샷 → KMS 암호화 복사 → mindbreeze-prod 복원 → 정리 (리허설 T-17 실측 15~20분)
#  1) dev 스냅샷(수동)  2) alias/mindbreeze-prod 로 암호화 복사  3) 새 인스턴스 mindbreeze-prod 복원(서브넷 그룹·SG·파라미터 그룹·t4g.small·단일 AZ·삭제방지)
#  4) 마스터 비밀번호 재설정(SSM DB_PASSWORD → boto3, 값 비출력)  5) 파라미터 그룹 적용 재시작(복원 후 1회 필요, V-1.15)
#  6) 백업 14일·삭제방지 재적용  7) SSM DB_HOST 갱신 → prod.env 재렌더(엄격: 자리표시 허용 안 함)
#  8) DB 이름 mindbreeze_dev → mindbreeze_prod RENAME (render_env 의 dev 흔적 검사 통과 조건)
# 멱등: 이미 만든 스냅샷·인스턴스는 건너뜀(--from 재개 가능). 사용: bash c02-db-restore.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SNAP_DEV="mb-cutover-dev-$RUN_ID"
SNAP_PROD="mb-cutover-prod-$RUN_ID"
TAGS_RDS=(--tags Key=project,Value=mindbreeze Key=env,Value=prod)

exists_rds() { aws rds describe-db-instances --db-instance-identifier "$1" >/dev/null 2>&1; }
exists_snap() { aws rds describe-db-snapshots --db-snapshot-identifier "$1" >/dev/null 2>&1; }
rds_field() { aws rds describe-db-instances --db-instance-identifier "$1" --query "DBInstances[0].$2" --output text; }

# 상태가 available 이고 대기 중인 변경(비밀번호·클래스 등)이 없을 때까지 대기 (modify 직후 'available' 오탐 방지)
wait_rds_settled() {
  local id="$1" i st pend
  for i in $(seq 1 120); do
    st="$(rds_field "$id" DBInstanceStatus)"
    pend="$(aws rds describe-db-instances --db-instance-identifier "$id" --query 'DBInstances[0].PendingModifiedValues' --output json | python3 -c 'import json,sys; d=json.load(sys.stdin) or {}; print(len([k for k in d if d[k] not in (None, {}, [])]))')"
    if [ "$st" = "available" ] && [ "$pend" = "0" ]; then return 0; fi
    sleep 10
  done
  return 1
}
param_apply_status() { rds_field "$1" 'DBParameterGroups[0].ParameterApplyStatus'; }

assert_prod_rds() { # 최종 사양 검증 — 하나라도 어긋나면 중단
  aws rds describe-db-instances --db-instance-identifier "$PROD_DB_ID" --output json | python3 -c '
import json, sys
d = json.load(sys.stdin)["DBInstances"][0]
checks = {
  "StorageEncrypted": d["StorageEncrypted"] is True,
  "KMS(고객 관리형 키)": "alias" in d.get("KmsKeyId", "") or d.get("KmsKeyId", "").startswith("arn:aws:kms"),
  "DeletionProtection": d["DeletionProtection"] is True,
  "BackupRetentionPeriod=14": d["BackupRetentionPeriod"] == 14,
  "MultiAZ=false": d["MultiAZ"] is False,
  "PubliclyAccessible=false": d["PubliclyAccessible"] is False,
  "class=db.t4g.small": d["DBInstanceClass"] == "db.t4g.small",
  "param group mb-prod-pg16 in-sync": d["DBParameterGroups"][0]["DBParameterGroupName"] == "mb-prod-pg16" and d["DBParameterGroups"][0]["ParameterApplyStatus"] == "in-sync",
  "engine postgres 16": d["Engine"] == "postgres" and d["EngineVersion"].startswith("16."),
}
bad = [k for k, v in checks.items() if not v]
for k, v in checks.items(): print(("OK   " if v else "FAIL ") + k)
sys.exit(1 if bad else 0)'
}

step_main() {
  guard_prod_account
  note "스냅샷 이름: dev=$SNAP_DEV / 암호화 사본=$SNAP_PROD (RUN_ID=$RUN_ID)"

  # 1) dev 스냅샷
  if ! is_dry && exists_snap "$SNAP_DEV"; then note "dev 스냅샷 이미 있음 — 건너뜀"; else
    x "dev RDS 최종 수동 스냅샷(쓰기 정지 상태)" aws rds create-db-snapshot --db-instance-identifier "$DEV_DB_ID" --db-snapshot-identifier "$SNAP_DEV" "${TAGS_RDS[@]}"
  fi
  x "스냅샷 available 대기(리허설 ≤5.5분)" aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP_DEV"

  # 2) 암호화 복사
  if ! is_dry && exists_snap "$SNAP_PROD"; then note "암호화 사본 이미 있음 — 건너뜀"; else
    x "KMS(alias/mindbreeze-prod) 암호화 복사" aws rds copy-db-snapshot --source-db-snapshot-identifier "$SNAP_DEV" --target-db-snapshot-identifier "$SNAP_PROD" --kms-key-id "$KMS_ALIAS" "${TAGS_RDS[@]}"
  fi
  x "암호화 사본 available 대기(리허설 ≤5분)" aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP_PROD"

  # 3) 복원 (스냅샷 복원은 항상 새 인스턴스)
  if ! is_dry && exists_rds "$PROD_DB_ID"; then note "$PROD_DB_ID 이미 있음 — 복원 건너뜀"; else
    x "새 인스턴스 $PROD_DB_ID 복원(db.t4g.small·단일 AZ·prod 서브넷/SG/파라미터 그룹·삭제방지)" \
      aws rds restore-db-instance-from-db-snapshot --db-instance-identifier "$PROD_DB_ID" --db-snapshot-identifier "$SNAP_PROD" \
        --db-instance-class "$RDS_CLASS" --db-subnet-group-name "$RDS_SUBNET_GROUP" --vpc-security-group-ids "$RDS_SG" \
        --db-parameter-group-name "$RDS_PARAM_GROUP" --availability-zone ap-northeast-1c --no-multi-az --no-publicly-accessible \
        --storage-type gp3 --deletion-protection --copy-tags-to-snapshot --auto-minor-version-upgrade "${TAGS_RDS[@]}"
  fi
  x "available 대기(리허설 3분)" aws rds wait db-instance-available --db-instance-identifier "$PROD_DB_ID"

  # 4) 마스터 비밀번호(복원본은 dev 비밀번호 상속) — 값은 SSM→boto3 직접
  x "마스터 비밀번호를 SSM DB_PASSWORD 로 재설정(값 비출력)" awsx rds-reset-master-password "$PROD_DB_ID"
  is_dry && note "재설정 반영 대기: 상태 available + 대기 중인 변경 0" || wait_rds_settled "$PROD_DB_ID" || die "비밀번호 재설정 반영 시간 초과"

  # 5) 파라미터 그룹 적용 재시작 (pending-reboot 일 때만)
  if is_dry; then
    note "ParameterApplyStatus 가 pending-reboot 이면 reboot-db-instance 1회(리허설 1~2분) 후 in-sync 확인"
    x "(조건부) 파라미터 그룹 적용 재시작" aws rds reboot-db-instance --db-instance-identifier "$PROD_DB_ID"
  elif [ "$(param_apply_status "$PROD_DB_ID")" != "in-sync" ]; then
    aws rds reboot-db-instance --db-instance-identifier "$PROD_DB_ID" >/dev/null
    sleep 20; aws rds wait db-instance-available --db-instance-identifier "$PROD_DB_ID"; wait_rds_settled "$PROD_DB_ID" || die "재시작 후 안정화 시간 초과"
  fi

  # 6) 백업·삭제방지 재적용(복원은 백업 보존기간을 계승하지 않음)
  x "백업 14일·백업 창·삭제방지 재적용" aws rds modify-db-instance --db-instance-identifier "$PROD_DB_ID" --backup-retention-period 14 \
      --preferred-backup-window 18:26-18:56 --preferred-maintenance-window sun:19:30-sun:20:00 --deletion-protection --apply-immediately
  is_dry || { sleep 15; wait_rds_settled "$PROD_DB_ID" || die "modify 반영 시간 초과"; }
  if is_dry; then
    x "RDS 사양 검증(암호화·삭제방지·백업14·단일AZ·비공개·클래스·파라미터 in-sync)" assert_prod_rds
  else
    assert_prod_rds | tee "$RUN_DIR/C2-rds-verify.txt" >&2 || die "prod RDS 사양 불일치"
  fi

  # 7) 엔드포인트 → SSM DB_HOST, prod.env 재렌더
  local ep
  if is_dry; then ep="<새-엔드포인트>"; else ep="$(rds_field "$PROD_DB_ID" Endpoint.Address)"; [ -n "$ep" ] && [ "$ep" != None ] || die "엔드포인트 조회 실패"; state_set prod_db_endpoint "$ep"; fi
  x "SSM DB_HOST 를 새 엔드포인트로 갱신 (DB_NAME=mindbreeze_prod 는 기존값)" awsx ssm-put-host DB_HOST "$ep"
  remote_prod "prod.env 재렌더(엄격: 필수 키 자리표시 허용 안 함) — 새 DB 호스트 반영" <<EOF
python3 /opt/mindbreeze/current/deploy/render_env.py --ssm-path /mindbreeze/prod/ --out $PROD_ENV_FILE --region $MB_REGION >/dev/null
chmod 600 $PROD_ENV_FILE
python3 /opt/mindbreeze/current/deploy/render_env.py --check-file $PROD_ENV_FILE
EOF

  # 8) DB 이름 RENAME (마스터 계정으로 postgres DB 에 접속, 대상 DB 연결 종료 후 변경)
  local dbs
  dbs="$(pg_prod "복원본의 DB 이름 확인" "SELECT datname FROM pg_database WHERE datname IN ('mindbreeze_dev','mindbreeze_prod') ORDER BY 1" --dbname postgres --autocommit)"
  if is_dry; then
    note "mindbreeze_dev 가 있고 mindbreeze_prod 가 없으면 RENAME, 이미 mindbreeze_prod 면 건너뜀, 둘 다 없으면 중단"
    pg_prod "DB 이름 RENAME (연결 종료 후)" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='mindbreeze_dev' AND pid <> pg_backend_pid()
--;--
ALTER DATABASE mindbreeze_dev RENAME TO mindbreeze_prod" --dbname postgres --autocommit
  elif printf '%s\n' "$dbs" | grep -qx mindbreeze_prod; then note "이미 mindbreeze_prod — RENAME 건너뜀"
  elif printf '%s\n' "$dbs" | grep -qx mindbreeze_dev; then
    pg_prod "DB 이름 RENAME" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='mindbreeze_dev' AND pid <> pg_backend_pid()
--;--
ALTER DATABASE mindbreeze_dev RENAME TO mindbreeze_prod" --dbname postgres --autocommit >/dev/null
    note "RENAME 완료"
  else die "mindbreeze_dev / mindbreeze_prod 어느 DB 도 없음 — 복원본 확인 필요"; fi
  pg_prod "새 이름으로 접속·리비전 확인" "SELECT current_database(), (SELECT version_num FROM alembic_version)" --readonly | tee -a "$RUN_DIR/C2-restored-db.txt" >&2 || true
  note "dev 스냅샷($SNAP_DEV)·암호화 사본($SNAP_PROD)은 롤백 대비로 유지 — 정리는 C-10 이후(T-21)"
}
run_step "C-2" "DB 이전: 스냅샷→암호화 복사→mindbreeze-prod 복원→이름·비밀번호·사양 정리" "$@"

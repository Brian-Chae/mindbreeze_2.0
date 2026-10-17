#!/usr/bin/env bash
# T-9: RDS 서브넷 그룹 · 파라미터 그룹(rds.force_ssl=1) · mindbreeze-prod-empty (리허설용 빈 인스턴스)
# 실제 mindbreeze-prod 는 컷오버 C-2 에서 스냅샷 복원(암호화 사본)으로 생성한다 — 여기서 만들지 않는다.
source "$(dirname "$0")/common.sh"; guard_account
VPC_ID="$(load vpc_id)"; SG_RDS="$(load sg_rds)"; KMS_ARN="$(load kms_key_arn)"
[[ -n "$VPC_ID" && -n "$SG_RDS" && -n "$KMS_ARN" ]] || { echo "T-7 선행 필요" >&2; exit 1; }
DBID=mindbreeze-prod-empty
PG_VER=16.14   # dev 와 동일 마이너

# 서브넷 그룹 (사설 서브넷 2개: 1c·1a)
if ! aws rds describe-db-subnet-groups --db-subnet-group-name mb-prod-db-subnets >/dev/null 2>&1; then
  log "DB 서브넷 그룹 생성"
  aws rds create-db-subnet-group --db-subnet-group-name mb-prod-db-subnets --db-subnet-group-description 'MindBreeze prod private subnets' \
    --subnet-ids "$(load subnet_private_1c)" "$(load subnet_private_1a)" --tags Key=project,Value=mindbreeze Key=env,Value=prod >/dev/null
fi

# 파라미터 그룹
if ! aws rds describe-db-parameter-groups --db-parameter-group-name mb-prod-pg16 >/dev/null 2>&1; then
  log "파라미터 그룹 생성"
  aws rds create-db-parameter-group --db-parameter-group-name mb-prod-pg16 --db-parameter-group-family postgres16 \
    --description 'MindBreeze prod postgres16 (force_ssl)' --tags Key=project,Value=mindbreeze Key=env,Value=prod >/dev/null
fi
aws rds modify-db-parameter-group --db-parameter-group-name mb-prod-pg16 --parameters 'ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=immediate' >/dev/null

# 마스터 계정 (비밀번호는 SSM 으로만 — 화면·파일·명령줄에 남지 않음)
ensure_random_param DB_PASSWORD alnum 32
ensure_text_param DB_USER mindbreeze SecureString
ensure_text_param DB_NAME mindbreeze_prod SecureString

if aws rds describe-db-instances --db-instance-identifier $DBID >/dev/null 2>&1; then
  log "$DBID 이미 존재 — 생성 건너뜀"
else
  log "$DBID 생성 (db.t4g.small / 단일 AZ / 암호화 / 백업14 / 삭제방지)"
  RDS_SPEC_JSON="$(DBID="$DBID" PG_VER="$PG_VER" SG="$SG_RDS" KMS="$KMS_ARN" python3 -c '
import json, os
print(json.dumps({
 "DBInstanceIdentifier": os.environ["DBID"], "DBInstanceClass": "db.t4g.small", "Engine": "postgres",
 "EngineVersion": os.environ["PG_VER"],
 "DBName": "mindbreeze_prod", "AllocatedStorage": 20, "StorageType": "gp3",
 "StorageEncrypted": True, "KmsKeyId": os.environ["KMS"],
 "DBSubnetGroupName": "mb-prod-db-subnets", "VpcSecurityGroupIds": [os.environ["SG"]],
 "DBParameterGroupName": "mb-prod-pg16", "AvailabilityZone": "ap-northeast-1c", "MultiAZ": False,
 "PubliclyAccessible": False, "BackupRetentionPeriod": 14,
 "PreferredBackupWindow": "18:26-18:56", "PreferredMaintenanceWindow": "sun:19:30-sun:20:00",
 "DeletionProtection": True, "CopyTagsToSnapshot": True, "AutoMinorVersionUpgrade": True,
 "Tags": [{"Key":"project","Value":"mindbreeze"},{"Key":"env","Value":"prod"},{"Key":"Name","Value":os.environ["DBID"]}]}))')"
  export RDS_SPEC_JSON   # 비밀 없는 사양만; 계정/비밀번호는 secrets_helper 가 SSM 에서 직접 읽어 boto3 로 전달
  secrets_helper rds-create-empty
fi
log "available 대기(수 분)…"
aws rds wait db-instance-available --db-instance-identifier $DBID
EP=""
for _ in $(seq 1 30); do
  EP="$(aws rds describe-db-instances --db-instance-identifier $DBID --query 'DBInstances[0].Endpoint.Address' --output text)"
  [[ -n "$EP" && "$EP" != None ]] && break; sleep 10
done
[[ -n "$EP" && "$EP" != None ]] || { echo "엔드포인트 조회 실패" >&2; exit 1; }
save rds_empty_endpoint "$EP"
ensure_text_param DB_HOST_EMPTY "$EP" SecureString yes
log "T-9 완료 (엔드포인트는 SSM DB_HOST_EMPTY)"

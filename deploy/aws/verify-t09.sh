#!/usr/bin/env bash
# T-9 사양 검증 (V-1.10~V-1.14). V-1.12 삭제방지 시도는 empty 인스턴스에서만.
source "$(dirname "$0")/common.sh"; DB=mindbreeze-prod-empty
aws rds describe-db-instances --db-instance-identifier $DB --query 'DBInstances[0].{class:DBInstanceClass,engine:Engine,ver:EngineVersion,enc:StorageEncrypted,kms:KmsKeyId,backup:BackupRetentionPeriod,delprot:DeletionProtection,public:PubliclyAccessible,multiaz:MultiAZ,az:AvailabilityZone,sg:VpcSecurityGroups[].VpcSecurityGroupId,subnetgrp:DBSubnetGroup.DBSubnetGroupName,storage:StorageType,size:AllocatedStorage,pg:DBParameterGroups[0].ParameterApplyStatus,latestRestorable:LatestRestorableTime,status:DBInstanceStatus}' --output json
echo "now(UTC)=$(date -u +%FT%TZ)"
echo "kms-expected=$(load kms_key_arn)"
aws rds describe-db-parameters --db-parameter-group-name mb-prod-pg16 --query "Parameters[?ParameterName=='rds.force_ssl'].[ParameterValue,ApplyMethod]" --output text
echo "== V-1.12 삭제방지 시도(empty 에서만, skip-final-snapshot 없이 → 거부돼야 함)"
aws rds delete-db-instance --db-instance-identifier $DB --final-db-snapshot-identifier mb-prod-empty-final-test 2>&1 | head -2

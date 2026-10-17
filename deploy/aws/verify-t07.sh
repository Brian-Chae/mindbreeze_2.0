#!/usr/bin/env bash
# T-7 사양 검증 (V-1.3, V-1.4, V-1.10 일부, V-8.3 일부)
source "$(dirname "$0")/common.sh"
echo "== VPC/서브넷"; aws ec2 describe-vpcs --vpc-ids "$(load vpc_id)" --query 'Vpcs[].[VpcId,CidrBlock,IsDefault]' --output text
aws ec2 describe-subnets --filters Name=vpc-id,Values="$(load vpc_id)" --query 'Subnets[].[Tags[?Key==`Name`]|[0].Value,CidrBlock,AvailabilityZone,MapPublicIpOnLaunch]' --output text
echo "== SG 인바운드"; for s in mb-prod-ec2 mb-prod-rds; do echo "-- $s"; aws ec2 describe-security-groups --group-ids "$(load sg_${s#mb-prod-})" --query 'SecurityGroups[0].IpPermissions[].[IpProtocol,FromPort,ToPort,IpRanges[0].CidrIp,UserIdGroupPairs[0].GroupId]' --output text; done
echo "== KMS"; aws kms describe-key --key-id alias/mindbreeze-prod --query 'KeyMetadata.[KeyId,KeyState,KeyManager]' --output text; aws kms get-key-rotation-status --key-id "$(load kms_key_id)" --query KeyRotationEnabled --output text
echo "== 신뢰정책"; aws iam get-role --role-name mb-prod-github-deploy --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
echo "== 인스턴스 프로필"; aws iam get-instance-profile --instance-profile-name mb-prod-ec2-profile --query 'InstanceProfile.Roles[].RoleName' --output text

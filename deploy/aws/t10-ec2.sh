#!/usr/bin/env bash
# T-10: EC2 mindbreeze-prod (t4g.medium · Ubuntu 24.04 arm64 · 암호화 gp3 40GB · IMDSv2 required · 프로필 · EIP)
# 키페어 없음, 22 비개방(SSM 세션). 멱등: Name 태그로 존재 확인.
source "$(dirname "$0")/common.sh"; guard_account
SUBNET="$(load subnet_public_1c)"; SG="$(load sg_ec2)"
[[ -n "$SUBNET" && -n "$SG" ]] || { echo "T-7 선행 필요" >&2; exit 1; }

IID="$(aws ec2 describe-instances --filters Name=tag:Name,Values=mindbreeze-prod Name=tag:env,Values=prod Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[0].Instances[0].InstanceId' --output text | sed 's/^None$//')"
if [[ -z "$IID" ]]; then
  AMI="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)"
  log "인스턴스 생성 (AMI=$AMI)"
  IID="$(aws ec2 run-instances --image-id "$AMI" --instance-type t4g.medium --subnet-id "$SUBNET" --security-group-ids "$SG" \
    --iam-instance-profile Name=mb-prod-ec2-profile \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=40,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
    --disable-api-termination \
    --user-data "file://$(dirname "$0")/userdata-base.sh" \
    --tag-specifications "$(TAGS_EC2 instance mindbreeze-prod)" "$(TAGS_EC2 volume mindbreeze-prod-root)" \
    --client-token mb-prod-ec2-sdd210 \
    --query 'Instances[0].InstanceId' --output text)"
fi
save instance_id "$IID"; log "INSTANCE=$IID"
aws ec2 wait instance-running --instance-ids "$IID"

# EIP (멱등)
ALLOC="$(aws ec2 describe-addresses --filters Name=tag:Name,Values=mb-prod-eip --query 'Addresses[0].AllocationId' --output text | sed 's/^None$//')"
if [[ -z "$ALLOC" ]]; then
  log "EIP 할당"
  ALLOC="$(aws ec2 allocate-address --domain vpc --tag-specifications "$(TAGS_EC2 elastic-ip mb-prod-eip)" --query AllocationId --output text)"
fi
aws ec2 associate-address --allocation-id "$ALLOC" --instance-id "$IID" --allow-reassociation >/dev/null
save eip_alloc "$ALLOC"
save eip_ip "$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)"
log "T-10 완료 — SSM 등록·userdata 완료는 verify-t10.sh 로 확인"

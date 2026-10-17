#!/usr/bin/env bash
# T-7: 네트워크(VPC·서브넷·IGW·라우트) · 보안그룹 · KMS · EC2 인스턴스 역할/프로필 · GitHub OIDC 배포 역할
# 멱등: 이름(Name 태그/별칭/역할명)으로 존재 확인 후 없을 때만 생성. 기본 VPC·dev 리소스는 읽기도 하지 않음.
source "$(dirname "$0")/common.sh"; guard_account

REPO="Brian-Chae/mindbreeze_2.0"
ZONE_ID="Z061081436L4M61L2W9NR"   # looxidlabs.com (같은 계정)
DOMAIN="mindbreeze.looxidlabs.com"

### 1. VPC
VPC_ID="$(find_ec2 describe-vpcs 'Vpcs[0].VpcId' mb-prod-vpc)"
if [[ -z "$VPC_ID" ]]; then
  log "VPC 생성"
  VPC_ID="$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 --tag-specifications "$(TAGS_EC2 vpc mb-prod-vpc)" --query Vpc.VpcId --output text)"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
fi
save vpc_id "$VPC_ID"; log "VPC=$VPC_ID"

mk_subnet() { # name cidr az public(true/false)
  local id; id="$(find_ec2 describe-subnets 'Subnets[0].SubnetId' "$1")"
  if [[ -z "$id" ]]; then
    log "서브넷 $1 생성"
    id="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$2" --availability-zone "$3" --tag-specifications "$(TAGS_EC2 subnet "$1")" --query Subnet.SubnetId --output text)"
  fi
  aws ec2 modify-subnet-attribute --subnet-id "$id" --map-public-ip-on-launch "{\"Value\":$4}"
  echo "$id"
}
PUB_1C="$(mk_subnet mb-prod-public-1c  10.20.0.0/24  ap-northeast-1c true)"
PRV_1C="$(mk_subnet mb-prod-private-1c 10.20.10.0/24 ap-northeast-1c false)"
PRV_1A="$(mk_subnet mb-prod-private-1a 10.20.11.0/24 ap-northeast-1a false)"
save subnet_public_1c "$PUB_1C"; save subnet_private_1c "$PRV_1C"; save subnet_private_1a "$PRV_1A"

### 2. IGW + 라우트
IGW_ID="$(find_ec2 describe-internet-gateways 'InternetGateways[0].InternetGatewayId' mb-prod-igw)"
if [[ -z "$IGW_ID" ]]; then
  log "IGW 생성"
  IGW_ID="$(aws ec2 create-internet-gateway --tag-specifications "$(TAGS_EC2 internet-gateway mb-prod-igw)" --query InternetGateway.InternetGatewayId --output text)"
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
fi
save igw_id "$IGW_ID"

RT_PUB="$(find_ec2 describe-route-tables 'RouteTables[0].RouteTableId' mb-prod-rt-public)"
if [[ -z "$RT_PUB" ]]; then
  log "퍼블릭 라우트 테이블 생성"
  RT_PUB="$(aws ec2 create-route-table --vpc-id "$VPC_ID" --tag-specifications "$(TAGS_EC2 route-table mb-prod-rt-public)" --query RouteTable.RouteTableId --output text)"
  aws ec2 create-route --route-table-id "$RT_PUB" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
  aws ec2 associate-route-table --route-table-id "$RT_PUB" --subnet-id "$PUB_1C" >/dev/null
fi
RT_PRV="$(find_ec2 describe-route-tables 'RouteTables[0].RouteTableId' mb-prod-rt-private)"
if [[ -z "$RT_PRV" ]]; then
  log "사설 라우트 테이블 생성 (기본 경로 없음 = 인터넷 불가)"
  RT_PRV="$(aws ec2 create-route-table --vpc-id "$VPC_ID" --tag-specifications "$(TAGS_EC2 route-table mb-prod-rt-private)" --query RouteTable.RouteTableId --output text)"
  aws ec2 associate-route-table --route-table-id "$RT_PRV" --subnet-id "$PRV_1C" >/dev/null
  aws ec2 associate-route-table --route-table-id "$RT_PRV" --subnet-id "$PRV_1A" >/dev/null
fi
save rt_public "$RT_PUB"; save rt_private "$RT_PRV"

### 3. 보안그룹 (최소 개방. 22/8000/7880/5432 비개방)
mk_sg() { # name desc
  local id; id="$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$1" --query 'SecurityGroups[0].GroupId' --output text | sed 's/^None$//')"
  if [[ -z "$id" ]]; then
    log "SG $1 생성"
    id="$(aws ec2 create-security-group --group-name "$1" --description "$2" --vpc-id "$VPC_ID" --tag-specifications "$(TAGS_EC2 security-group "$1")" --query GroupId --output text)"
  fi
  echo "$id"
}
SG_EC2="$(mk_sg mb-prod-ec2 'MindBreeze prod EC2: 80/443 + LiveKit/TURN only')"
SG_RDS="$(mk_sg mb-prod-rds 'MindBreeze prod RDS: 5432 from mb-prod-ec2 only')"
save sg_ec2 "$SG_EC2"; save sg_rds "$SG_RDS"

allow() { # sg proto from to cidr desc  (이미 있으면 Duplicate 무시)
  aws ec2 authorize-security-group-ingress --group-id "$1" --ip-permissions \
    "IpProtocol=$2,FromPort=$3,ToPort=$4,IpRanges=[{CidrIp=$5,Description=$6}]" >/dev/null 2>"$MB_STATE_DIR/err" \
    || grep -q 'InvalidPermission.Duplicate' "$MB_STATE_DIR/err" || { cat "$MB_STATE_DIR/err" >&2; exit 1; }
}
A=0.0.0.0/0
allow "$SG_EC2" tcp 80   80    $A http
allow "$SG_EC2" tcp 443  443   $A https
allow "$SG_EC2" tcp 7881 7881  $A livekit-rtc-tcp
allow "$SG_EC2" tcp 3478 3478  $A turn-tcp
allow "$SG_EC2" udp 3478 3478  $A turn-udp
allow "$SG_EC2" tcp 5349 5349  $A turns-tls
allow "$SG_EC2" udp 49152 49200 $A turn-relay-udp
allow "$SG_EC2" udp 50000 50200 $A livekit-rtc-udp   # Phase C 보정: LiveKit UDP 고정 범위(render.py LIVEKIT_UDP_PORT_START=50000)
# RDS: EC2 SG 에서 오는 5432 만
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --ip-permissions \
  "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$SG_EC2,Description=postgres-from-ec2}]" >/dev/null 2>"$MB_STATE_DIR/err" \
  || grep -q 'InvalidPermission.Duplicate' "$MB_STATE_DIR/err" || { cat "$MB_STATE_DIR/err" >&2; exit 1; }

### 4. KMS (고객 관리형 키 1개: RDS·SSM SecureString 공용)
KEY_ID="$(aws kms describe-key --key-id alias/mindbreeze-prod --query KeyMetadata.KeyId --output text 2>/dev/null || true)"
if [[ -z "$KEY_ID" ]]; then
  log "KMS 키 생성"
  KEY_ID="$(aws kms create-key --description 'MindBreeze prod (RDS, SSM SecureString)' --tags TagKey=project,TagValue=mindbreeze TagKey=env,TagValue=prod --query KeyMetadata.KeyId --output text)"
  aws kms create-alias --alias-name alias/mindbreeze-prod --target-key-id "$KEY_ID"
  aws kms enable-key-rotation --key-id "$KEY_ID"
fi
KEY_ARN="$(aws kms describe-key --key-id "$KEY_ID" --query KeyMetadata.Arn --output text)"
save kms_key_id "$KEY_ID"; save kms_key_arn "$KEY_ARN"

### 5. EC2 인스턴스 역할/프로필
ROLE=mb-prod-ec2-role
TRUST_EC2='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  log "역할 $ROLE 생성"
  aws iam create-role --role-name $ROLE --assume-role-policy-document "$TRUST_EC2" --tags "Key=project,Value=mindbreeze" "Key=env,Value=prod" >/dev/null
fi
aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

EC2_POLICY="$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"S3ProdObjects","Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts","s3:GetObjectVersion"],"Resource":["arn:aws:s3:::mindbreeze-prod/*"]},
 {"Sid":"S3ProdBuckets","Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation","s3:ListBucketMultipartUploads"],"Resource":["arn:aws:s3:::mindbreeze-prod"]},
 {"Sid":"S3ReleasesRead","Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion"],"Resource":["arn:aws:s3:::mindbreeze-prod-releases/*"]},
 {"Sid":"S3ReleasesList","Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::mindbreeze-prod-releases"]},
 {"Sid":"SnsPublishAlerts","Effect":"Allow","Action":["sns:Publish"],"Resource":["arn:aws:sns:$MB_REGION:$MB_ACCOUNT:mindbreeze-alerts"]},
 {"Sid":"SsmParamsRead","Effect":"Allow","Action":["ssm:GetParameter","ssm:GetParameters","ssm:GetParametersByPath"],"Resource":["arn:aws:ssm:$MB_REGION:$MB_ACCOUNT:parameter/mindbreeze/prod","arn:aws:ssm:$MB_REGION:$MB_ACCOUNT:parameter/mindbreeze/prod/*"]},
 {"Sid":"KmsDecryptProd","Effect":"Allow","Action":["kms:Decrypt","kms:DescribeKey"],"Resource":["$KEY_ARN"]},
 {"Sid":"CertbotDns01List","Effect":"Allow","Action":["route53:ListHostedZones","route53:ListHostedZonesByName","route53:GetChange"],"Resource":"*"},
 {"Sid":"CertbotDns01Txt","Effect":"Allow","Action":["route53:ListResourceRecordSets","route53:ChangeResourceRecordSets"],"Resource":"arn:aws:route53:::hostedzone/$ZONE_ID",
  "Condition":{"ForAllValues:StringLike":{"route53:ChangeResourceRecordSetsNormalizedRecordNames":["_acme-challenge.$DOMAIN","_acme-challenge.*.$DOMAIN"],"route53:ChangeResourceRecordSetsRecordTypes":["TXT"],"route53:ChangeResourceRecordSetsActions":["UPSERT","DELETE"]}}}
]}
JSON
)"
aws iam put-role-policy --role-name $ROLE --policy-name mb-prod-ec2-inline --policy-document "$EC2_POLICY"

if ! aws iam get-instance-profile --instance-profile-name mb-prod-ec2-profile >/dev/null 2>&1; then
  log "인스턴스 프로필 생성"
  aws iam create-instance-profile --instance-profile-name mb-prod-ec2-profile --tags "Key=project,Value=mindbreeze" "Key=env,Value=prod" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name mb-prod-ec2-profile --role-name $ROLE
fi
save ec2_role_arn "$(aws iam get-role --role-name $ROLE --query Role.Arn --output text)"

### 6. GitHub OIDC (공급자는 계정에 이미 존재 → 재사용, 수정 금지) + 배포 역할
OIDC_ARN="arn:aws:iam::$MB_ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  log "OIDC 공급자 생성"
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com \
    --tags "Key=project,Value=mindbreeze" "Key=env,Value=prod" >/dev/null
fi
DROLE=mb-prod-github-deploy
TRUST_GH="$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$OIDC_ARN"},"Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":"repo:$REPO:environment:production"}}}]}
JSON
)"
if ! aws iam get-role --role-name $DROLE >/dev/null 2>&1; then
  log "배포 역할 $DROLE 생성"
  aws iam create-role --role-name $DROLE --assume-role-policy-document "$TRUST_GH" --max-session-duration 3600 --tags "Key=project,Value=mindbreeze" "Key=env,Value=prod" >/dev/null
else
  aws iam update-assume-role-policy --role-name $DROLE --policy-document "$TRUST_GH"
fi
DEPLOY_POLICY="$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"RunShellOnProdInstances","Effect":"Allow","Action":"ssm:SendCommand","Resource":"arn:aws:ec2:$MB_REGION:$MB_ACCOUNT:instance/*","Condition":{"StringEquals":{"ssm:resourceTag/env":"prod","ssm:resourceTag/project":"mindbreeze"}}},
 {"Sid":"RunShellDocument","Effect":"Allow","Action":"ssm:SendCommand","Resource":"arn:aws:ssm:$MB_REGION::document/AWS-RunShellScript"},
 {"Sid":"ReadCommandResult","Effect":"Allow","Action":["ssm:GetCommandInvocation","ssm:ListCommandInvocations","ssm:ListCommands","ssm:DescribeInstanceInformation"],"Resource":"*"},
 {"Sid":"EC2Describe","Effect":"Allow","Action":["ec2:DescribeInstances"],"Resource":"*"},
 {"Sid":"ReleasesBucketRW","Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:GetObjectVersion"],"Resource":"arn:aws:s3:::mindbreeze-prod-releases/*"},
 {"Sid":"ReleasesBucketList","Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":"arn:aws:s3:::mindbreeze-prod-releases"}
]}
JSON
)"
aws iam put-role-policy --role-name $DROLE --policy-name mb-prod-github-deploy-inline --policy-document "$DEPLOY_POLICY"
save deploy_role_arn "$(aws iam get-role --role-name $DROLE --query Role.Arn --output text)"

### 7. 릴리스 빌드 역할 (Phase C 보정) — release-build 워크플로(environment 없음)가 releases 버킷에 PUT 만 하는 전용 역할.
#   신뢰: main 브랜치 / release-* 태그에서 실행된 워크플로만(정확 sub 패턴). 읽기·삭제·SSM·기타 권한 없음.
RROLE=mb-prod-release-build
TRUST_RB="$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$OIDC_ARN"},"Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
 "StringLike":{"token.actions.githubusercontent.com:sub":["repo:$REPO:ref:refs/heads/main","repo:$REPO:ref:refs/tags/release-*"]}}}]}
JSON
)"
if ! aws iam get-role --role-name $RROLE >/dev/null 2>&1; then
  log "릴리스 빌드 역할 $RROLE 생성"
  aws iam create-role --role-name $RROLE --assume-role-policy-document "$TRUST_RB" --max-session-duration 3600 --tags "Key=project,Value=mindbreeze" "Key=env,Value=prod" >/dev/null
else
  aws iam update-assume-role-policy --role-name $RROLE --policy-document "$TRUST_RB"
fi
RB_POLICY='{"Version":"2012-10-17","Statement":[
 {"Sid":"ReleasesPutOnly","Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::mindbreeze-prod-releases/releases/*"},
 {"Sid":"ReleasesList","Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":"arn:aws:s3:::mindbreeze-prod-releases"}]}'
aws iam put-role-policy --role-name $RROLE --policy-name mb-prod-release-build-inline --policy-document "$RB_POLICY"
save release_build_role_arn "$(aws iam get-role --role-name $RROLE --query Role.Arn --output text)"
log "T-7 완료"

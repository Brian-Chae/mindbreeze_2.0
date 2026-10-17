#!/usr/bin/env bash
# T-8: S3 mindbreeze-prod (데이터) / mindbreeze-prod-releases (릴리스 산출물)
# 멱등. 수명주기: 현재 객체의 기간 삭제는 걸지 않는다 — 원본 보관/삭제는 앱의 retention_sweep(연구 게이트·DB 행 정합)가 담당하므로
#   S3 가 먼저 지우면 DB 행이 고아가 되고 연구 보류 대상이 유실된다. 버전·멀티파트 정리만 규칙화.
source "$(dirname "$0")/common.sh"; guard_account
ROLE_ARN="$(load ec2_role_arn)"; DEPLOY_ARN="$(load deploy_role_arn)"
[[ -n "$ROLE_ARN" && -n "$DEPLOY_ARN" ]] || { echo "T-7 선행 필요" >&2; exit 1; }
KMS_ARN="$(load kms_key_arn)"

mk_bucket() { # name
  if ! aws s3api head-bucket --bucket "$1" 2>/dev/null; then
    log "버킷 $1 생성"
    aws s3api create-bucket --bucket "$1" --create-bucket-configuration LocationConstraint=$MB_REGION >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$1" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-ownership-controls --bucket "$1" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  aws s3api put-bucket-encryption --bucket "$1" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
  aws s3api put-bucket-versioning --bucket "$1" --versioning-configuration Status=Enabled
  aws s3api put-bucket-tagging --bucket "$1" --tagging 'TagSet=[{Key=project,Value=mindbreeze},{Key=env,Value=prod}]'
}
mk_bucket mindbreeze-prod
mk_bucket mindbreeze-prod-releases

# CORS: 운영 오리진만 (프리사인 PUT/GET 용, dev 설정과 동일 메서드)
aws s3api put-bucket-cors --bucket mindbreeze-prod --cors-configuration '{"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["PUT","GET","HEAD","POST"],"AllowedOrigins":["https://mindbreeze.looxidlabs.com"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}'

# 수명주기
aws s3api put-bucket-lifecycle-configuration --bucket mindbreeze-prod --lifecycle-configuration '{"Rules":[
 {"ID":"abort-incomplete-multipart-7d","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},
 {"ID":"expire-noncurrent-versions-30d","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":30}},
 {"ID":"cleanup-expired-delete-markers","Status":"Enabled","Filter":{},"Expiration":{"ExpiredObjectDeleteMarker":true}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket mindbreeze-prod-releases --lifecycle-configuration '{"Rules":[
 {"ID":"abort-incomplete-multipart-7d","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}},
 {"ID":"expire-noncurrent-versions-180d","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":180}}]}'

# 버킷 정책: TLS 강제 + 객체 접근은 prod 역할(+ 관리자 brian.chae: 컷오버 sync·비상용)만 허용, 그 외(dev IAM 사용자 포함) 명시 거부
for B in mindbreeze-prod mindbreeze-prod-releases; do
  if [[ "$B" == mindbreeze-prod ]]; then ALLOW="\"$ROLE_ARN\""; else ALLOW="\"$ROLE_ARN\",\"$DEPLOY_ARN\""; fi
  aws s3api put-bucket-policy --bucket "$B" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::$B","arn:aws:s3:::$B/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}},
 {"Sid":"DenyObjectAccessExceptProdRoles","Effect":"Deny","Principal":"*","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::$B/*",
  "Condition":{"StringNotLike":{"aws:PrincipalArn":[$ALLOW,"arn:aws:iam::$MB_ACCOUNT:user/brian.chae"]}}}
]}
JSON
)"
done
log "T-8 완료"

#!/usr/bin/env bash
# T-8 사양 검증 (V-1.17~V-1.19)
source "$(dirname "$0")/common.sh"
for B in mindbreeze-prod mindbreeze-prod-releases; do
  echo "== $B"
  aws s3api get-public-access-block --bucket $B --query 'PublicAccessBlockConfiguration' --output json | tr -d '\n '; echo
  aws s3api get-bucket-encryption --bucket $B --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text
  aws s3api get-bucket-versioning --bucket $B --query Status --output text
  aws s3api get-bucket-lifecycle-configuration --bucket $B --query 'Rules[].ID' --output text
  aws s3api get-bucket-tagging --bucket $B --query 'TagSet[].[Key,Value]' --output text | tr '\n' ' '; echo
done
aws s3api get-bucket-cors --bucket mindbreeze-prod --query 'CORSRules[0].AllowedOrigins' --output text
aws s3api get-bucket-policy-status --bucket mindbreeze-prod --query PolicyStatus.IsPublic --output text

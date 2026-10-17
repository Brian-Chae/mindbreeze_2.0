#!/usr/bin/env bash
# T-12: SSM Parameter Store /mindbreeze/prod/* (전부 SecureString, 고객 관리형 KMS 키)
#  · 난수 시크릿: boto3 로 직접 생성·저장 (값이 파일·로그·명령줄·출력에 남지 않음)
#  · 외부 API 키: 자리표시 'PLACEHOLDER-FILL-ME' 만 생성 → Brian/다른 단계에서 채움 (render-env 는 이 값을 '미설정'으로 취급해야 함)
#  · 비밀 아닌 설정값(도메인·플래그)도 SecureString 으로 통일 (V-1.25)
# 멱등: 이미 있는 파라미터는 건드리지 않음.
source "$(dirname "$0")/common.sh"; guard_account
[[ -f "$MB_STATE_DIR/kms_key_id" ]] || { echo "T-7 선행 필요" >&2; exit 1; }

# 1) 신규 난수 시크릿 (T-D15: dev 값 재사용 금지)
ensure_random_param JWT_SECRET_KEY            b64url 64
ensure_random_param LIVEKIT_API_KEY           alnum  16
ensure_random_param LIVEKIT_API_SECRET        alnum  48
ensure_random_param RESEARCH_ID_KEY_V1        hex    64      # ⚠ 오프라인 백업 필수 (research-key-backup.sh)
ensure_random_param RESEARCH_EXPORT_ACK_TOKEN b64url 48
ensure_random_param TURN_STATIC_AUTH_SECRET   hex    64      # coturn (Phase C 렌더)
secrets_helper put-vapid VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY >&2
# DB_USER / DB_PASSWORD / DB_NAME 은 T-9 에서 생성됨. DATABASE_URL(_SYNC) 은 서버 render-env 가 DB_HOST(_EMPTY)+계정으로 조립.

# 2) 비밀 아닌 설정값 (SecureString)
S=SecureString
cfg() { ensure_text_param "$1" "$2" $S; }
cfg ENVIRONMENT production
cfg DEBUG false
cfg ENABLE_DEV_ROLE_SIMULATION false
cfg S3_BUCKET mindbreeze-prod
cfg S3_REGION ap-northeast-1
cfg S3_USE_INSTANCE_ROLE true
cfg CORS_ALLOWED_ORIGINS 'https://mindbreeze.looxidlabs.com,capacitor://localhost,https://localhost'
cfg FRONTEND_BASE_URL https://mindbreeze.looxidlabs.com
cfg REPORT_EMAIL_BASE_URL https://mindbreeze.looxidlabs.com
cfg RESEND_FROM_EMAIL 'MIND BREEZE <noreply@mindbreeze.looxidlabs.com>'
cfg LIVEKIT_HOST wss://api.mindbreeze.looxidlabs.com/livekit     # Phase C(T-3/T-14) 에서 nginx 경로와 확정
cfg REDIS_URL redis://127.0.0.1:6379/0
cfg VAPID_SUBJECT mailto:developer@looxidlabs.com
cfg RETENTION_SWEEP_ENABLED false          # SDD-209: 방침 게시·별도 승인 전 비활성
cfg RESEARCH_EXPORT_ENABLED false
cfg DEBUG false

# 3) 외부 API 키 자리표시 (값은 Brian/다른 단계에서 채움)
for n in RESEND_API_KEY GEMINI_API_KEY OPENAI_API_KEY DEEPSEEK_API_KEY GOOGLE_CLIENT_ID FCM_PROJECT_ID FCM_SERVICE_ACCOUNT_JSON; do
  secrets_helper put-placeholder "$n" >&2
done
log "T-12 완료"

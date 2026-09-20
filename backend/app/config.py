"""Application Configuration — Pydantic Settings"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # Database
    database_url: str = "postgresql://localhost:5432/mindbreeze_dev"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 2880  # 48시간
    refresh_token_expire_days: int = 14

    # Resend Email
    resend_api_key: str = ""
    resend_from_email: str = "onboarding@resend.dev"

    # SDD-052: 이메일 링크가 여는 프론트엔드 리포트 열람 주소
    report_email_base_url: str = "https://dev.mindbreeze.looxidlabs.com"

    # SDD-073: 가입 신청(기관/개인 상담사) 운영 알림 수신자 — 서버 설정으로 고정하며
    # 클라이언트 입력으로 바꿀 수 없다.
    signup_notice_email: str = "brian.chae@looxidlabs.com"

    # S3
    s3_bucket: str = "mindbreeze-dev"
    s3_region: str = "ap-northeast-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # App
    debug: bool = True
    frontend_base_url: str = "https://dev.mindbreeze.looxidlabs.com"

    # SDD-019: 실행 환경 식별자 — 기본값 production (fail-safe).
    # dev 전용 기능은 이 값이 "production" 이 아닐 때만 켤 수 있다. debug 는 dev 판별에 쓰지 않는다.
    environment: str = "production"
    # SDD-019: dev 역할 시뮬레이션 로그인 기능 게이트 — 기본 False (명시적 opt-in).
    enable_dev_role_simulation: bool = False

    # Google OAuth
    google_client_id: str = ""

    # SDD-087: Gemini — 상담사 코멘트 AI 초안 생성 (키 부재 시 규칙 템플릿 폴백)
    gemini_api_key: str = ""

    # LiveKit WebRTC
    livekit_host: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"


settings = Settings()

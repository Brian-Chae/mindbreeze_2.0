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

    # LiveKit WebRTC
    livekit_host: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"


settings = Settings()

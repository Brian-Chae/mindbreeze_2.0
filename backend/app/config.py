"""Application Configuration — Pydantic Settings"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    # Database
    database_url: str = "postgresql://localhost:5432/mindbreeze_dev"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14

    # AWS
    s3_bucket: str = "mindbreeze-dev"
    aws_region: str = "ap-northeast-2"
    ses_from_email: str = "noreply@mindbreeze.kr"

    # App
    debug: bool = True


settings = Settings()

"""Application Configuration — Pydantic Settings"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # Database
    database_url: str = "postgresql://localhost:5432/mindbreeze_dev"
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14

    # Email — Resend
    resend_api_key: str = ""
    resend_from_email: str = "MIND BREEZE <onboarding@resend.dev>"

    # App
    debug: bool = True


settings = Settings()

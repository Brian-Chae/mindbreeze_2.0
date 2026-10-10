"""Application Configuration — Pydantic Settings"""

from pathlib import Path

from pydantic_settings import BaseSettings


def _resolve_env_files() -> tuple[str, ...]:
    """환경파일 소스 선택 (INFRA-11).

    - 서버(dev): backend/.env 가 없으므로 backend/.env.dev 를 읽는다
      → systemd 유닛(EnvironmentFile=.env.dev)과 소스가 일치한다(불일치 해소).
    - 로컬 개발: backend/.env 가 있으면 그것을 읽는다(저장소 기본값·테스트 격리 유지,
      서버 전용 자격증명이 로컬로 새어들지 않게 한다).
    어느 경우든 실제 환경변수(env var)는 env_file 값보다 항상 우선한다(pydantic-settings 기본).
    """
    backend_dir = Path(__file__).resolve().parent.parent  # .../backend
    if (backend_dir / ".env").is_file():
        return (str(backend_dir / ".env"),)
    if (backend_dir / ".env.dev").is_file():
        return (str(backend_dir / ".env.dev"),)
    return (".env",)


class Settings(BaseSettings):
    # INFRA-11: env_file 은 _resolve_env_files() 가 서버 표준(.env.dev)/로컬(.env)을 선택한다.
    model_config = {
        "env_file": _resolve_env_files(),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    # Database
    database_url: str = "postgresql://localhost:5432/mindbreeze_dev"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT — 기본값 없음. 미설정 시 기동 중단(main.py lifespan fail-fast).
    jwt_secret_key: str = ""
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
    # STG-06: S3 호환 엔드포인트(MinIO 등)를 설정으로 주입한다. 빈 값이면 AWS 표준
    #   엔드포인트를 사용한다. 하드코딩된 AWS 엔드포인트로는 MinIO/온프레미스 S3 에
    #   붙을 수 없어 presigned URL·업로드가 리전 밖으로 새는 문제를 막는다.
    s3_endpoint_url: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # App
    # SDD-197: DEBUG 는 SQL echo(바인드 파라미터=개인정보 포함)를 켠다. 기본은 꺼짐 — 로컬 개발만 명시적으로 켠다.
    debug: bool = False
    frontend_base_url: str = "https://dev.mindbreeze.looxidlabs.com"

    # SDD-019: 실행 환경 식별자 — 기본값 production (fail-safe).
    # dev 전용 기능은 이 값이 "production" 이 아닐 때만 켤 수 있다. debug 는 dev 판별에 쓰지 않는다.
    environment: str = "production"
    # SDD-019: dev 역할 시뮬레이션 로그인 기능 게이트 — 기본 False (명시적 opt-in).
    enable_dev_role_simulation: bool = False

    # SDD-197(D5): 뇌파 원본(업로드 완료분) 보관 일수. 0 이하 = 무기한(영구 보관, 기본).
    # 음성·영상은 media_cleanup_service.MEDIA_RETENTION_DAYS(90일) 별도 적용.
    eeg_raw_retention_days: int = 0

    # Google OAuth
    google_client_id: str = ""
    # 네이티브 앱 id_token 의 추가 허용 aud(쉼표 구분) — Firebase 웹 클라이언트 ID 등
    google_extra_client_ids: str = ""

    # SDD-087: Gemini — 상담사 코멘트 AI 초안 생성 (키 부재 시 규칙 템플릿 폴백)
    gemini_api_key: str = ""

    # STT-5TH-02: Whisper 폴백용 OpenAI 키 — os.environ 직접 조회 대신 설정으로 관리한다.
    openai_api_key: str = ""

    # GEN-5TH-10: AI 모델명은 하드코딩하지 않고 설정으로 관리한다(모델 교체·롤백 시 재배포 불필요).
    #   - gemini_model: STT·요약·상담사 코멘트 초안에 쓰는 Gemini 모델
    #   - whisper_model: Gemini 실패 시 폴백 전사에 쓰는 Whisper 모델
    gemini_model: str = "gemini-2.5-flash"
    whisper_model: str = "whisper-1"

    # SDD-201: 루시(AI 에이전트) 전용 Gemini 모델 — STT·요약과 분리해 감정 대화 품질을
    #   올릴 때 다른 파이프라인 비용을 건드리지 않는다. 기본값은 flash(기존 동작 유지).
    agent_llm_model: str = "gemini-2.5-flash"

    # LiveKit WebRTC
    livekit_host: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"

    # SDD-190: 앱 푸시(FCM HTTP v1). 둘 다 설정된 환경에서만 실제 발송한다.
    # fcm_service_account_json 은 서비스 계정 키 **파일 경로** 또는 JSON 문자열.
    fcm_project_id: str = ""
    fcm_service_account_json: str = ""

    # SDD-192: 웹 푸시(VAPID). 공개키·개인키가 모두 있어야 웹 구독에 발송한다.
    # 개인키는 로그·응답에 절대 노출하지 않는다.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:developer@looxidlabs.com"


settings = Settings()

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

    # SDD-216: 두 차례 출시. 팀 본문은 개정 고지 UI 검증 후 활성화한다.
    class_scheduling_enabled: bool = False
    class_rolling_enabled: bool = False
    class_team_read_enabled: bool = False

    # Database
    database_url: str = "postgresql://localhost:5432/mindbreeze_dev"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # SDD-212: 종료 파이프라인 줄(큐) 분리 — stt/report 전용 일꾼 유닛이 설치된 환경에서만 켠다.
    #   꺼져 있으면 기존 단일 줄 구성(롤백 경로). 신규 유닛 기동 후 켜야 작업이 쌓이지 않는다.
    pipeline_queue_split_enabled: bool = False
    # SDD-212 TD4: 줄 대기 시간 보정. 대기가 길어도 정상 건을 실패 처리·중복 발행하지 않도록 한다.
    #   - queue_grace: 녹음 종료 후 30분 타임아웃에 더하는 대기 유예(초)
    #   - redrive_delay: 발행 후 체인 미완료로 보고 재발행하기까지의 지연(초, D-3 몰림 목표의 2배)
    pipeline_queue_grace_seconds: int = 60 * 60
    pipeline_redrive_delay_seconds: int = 90 * 60
    # SDD-212 TD6: 적체 경보 임계. 최장 대기(D-3 몰림 목표 45분의 2/3)와 줄별 대기 건수.
    pipeline_alert_max_wait_seconds: int = 30 * 60
    pipeline_alert_queue_len: int = 20
    # SDD-212 TD6: CloudWatch 사용자 지정 지표 게시. AWS 권한 확인·승인 전에는 꺼 둔다(꺼져 있으면 로그만 출력).
    pipeline_metrics_cloudwatch_enabled: bool = False
    # SDD-212 TD7: 회원 '리뷰 중' 에 생성 지연 보조 문구를 붙이는 기준(세션 종료 후 경과, 초). D-3 평상시 목표 15분.
    pipeline_report_delay_notice_seconds: int = 15 * 60

    # JWT — 기본값 없음. 미설정 시 기동 중단(main.py lifespan fail-fast).
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 2880  # 48시간
    # SDD-209(B5a): 클래스 입장 자격(로그인 없는 참가자 소유 증명) 만료 시간
    entry_credential_ttl_hours: int = 24

    # SDD-209(B11): 연구 가명 ID(HMAC-SHA256) 키 — 서버 .env 전용(RESEARCH_ID_KEY_V1). 값은 어떤 로그·응답·번들·
    # 저장소에도 싣지 않는다. 연구 DB(Spark)에는 보내지 않는다. 분실하면 이후 동일인 매핑이 끊기므로 오프라인 백업 필수.
    # 키 교체는 버전 번호(research_id_key_version)를 올리고 RESEARCH_ID_KEY_V{n} 을 추가하는 방식(정기 교체 안 함).
    research_id_key_v1: str = ""
    research_id_key_version: int = 1
    # SDD-209(B13): 연구 DB 내보내기. 기본 비활성 — 활성화는 스테이징 prefix·IAM 인프라 승인 후.
    research_export_enabled: bool = False
    # S3 스테이징 prefix (Spark 가 pull). 이 prefix 아래에만 쓴다.
    research_export_prefix: str = "research-export/"
    # ack API 서비스 토큰 — 서버 .env 전용(RESEARCH_EXPORT_ACK_TOKEN). 값은 어떤 로그·응답에도 싣지 않는다. 비어 있으면 ack 거부.
    research_export_ack_token: str = ""
    # 같은 세션 배치가 연속 실패한 횟수가 이 값에 닿으면 플랫폼 관리자에게 1회 알린다
    research_export_max_attempts: int = 5
    # 한 배치의 최대 바이트(초과 시 배치 실패 — 분할 정책은 후속)
    research_export_max_batch_bytes: int = 256 * 1024 * 1024
    refresh_token_expire_days: int = 14

    # SDD-210: CORS 허용 오리진(쉼표 구분). 미설정이면 기존 기본 목록(dev 호환), 운영은 **명시 필수**.
    # HTTP CORS 와 Socket.IO 가 같은 값을 쓴다(app/core/cors.py).
    cors_allowed_origins: str = ""

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
    # SDD-210(T-D3): True 면 키 없이 boto3 기본 자격 체인(EC2 인스턴스 역할)으로 S3 를 사용한다.
    # 기본 False — 키가 비어 있으면 기존처럼 스텁/로컬 폴백(로컬·테스트·현 dev 서버 호환).
    s3_use_instance_role: bool = False

    # App
    # SDD-197: DEBUG 는 SQL echo(바인드 파라미터=개인정보 포함)를 켠다. 기본은 꺼짐 — 로컬 개발만 명시적으로 켠다.
    debug: bool = False
    frontend_base_url: str = "https://dev.mindbreeze.looxidlabs.com"

    # SDD-019: 실행 환경 식별자 — 기본값 production (fail-safe).
    # dev 전용 기능은 이 값이 "production" 이 아닐 때만 켤 수 있다. debug 는 dev 판별에 쓰지 않는다.
    environment: str = "production"
    # SDD-019: dev 역할 시뮬레이션 로그인 기능 게이트 — 기본 False (명시적 opt-in).
    enable_dev_role_simulation: bool = False

    # SDD-209(B12/BE-R2): 기본 DB 삭제 스위프(retention_sweep). 기본 **비활성** — 활성화는 dry-run 승인 후 별도 승인.
    # 비활성이어도 dry-run 보고서는 만들 수 있다(삭제 0). 활성화하면 기존 두 cron(sweep_stale_media/eeg_raw)은 건너뛴다.
    retention_sweep_enabled: bool = False
    # 원본(EEG raw·음성·영상·STT 원문) 보관 일수 — 세션 종료일 기준(N-1 기본 90일)
    retention_raw_days: int = 90
    # 비회원 개인정보(이름·성별·생년월일·이메일, 이메일 초대 주소) 보관 일수 — 세션 종료일 기준(N-1 기본 90일)
    retention_guest_pii_days: int = 90
    # 연구 동의 건이 내보내기 ack 되지 않은 채 삭제 기한을 이만큼(일) 넘기면 운영 알림 1회
    retention_hold_alert_days: int = 14
    # N-5: 이 날짜(YYYY-MM-DD, UTC) 이후 종료된 클래스부터만 삭제 대상. 비어 있으면 실제 삭제를 거부한다(dry-run 만).
    retention_apply_from: str = ""

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

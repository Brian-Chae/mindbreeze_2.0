# [SDD-210] — Implementation Plan (운영 환경 구축 · 배포 워크플로우 · 컷오버)

> 7-Stage SDD — Stage ③ verify.md 승인 전 구현 금지. 본 문서의 AWS·서버 항목은 **전부 읽기 전용 조사 결과**이며 리소스는 하나도 만들지 않았다.
> 표기: `[검증]` 2026-10-17 직접 확인 / `[추정]` / `[제안]` / `[미확인]`

**Goal:** dev 서버에서 운영(prod) 환경으로 서비스를 야간 점검 1회로 옮기고, 이후 운영 반영을 build-once → Brian 승인 → 배포 → 롤백 가능 경로로 고정한다.

**Architecture:** 별도 VPC 의 EC2 1대(nginx+API+워커 3종+LiveKit+coturn+Redis) + 암호화 단일 AZ RDS + 전용 S3. 비밀값은 SSM, 배포는 GitHub OIDC → SSM Run Command, 릴리스는 버전별 디렉터리 + 원자적 심볼릭 링크 전환.

**Tech Stack:** AWS(EC2·RDS·S3·SSM·KMS·Route53·CloudWatch·SNS·IAM), GitHub Actions(environment 승인·OIDC), systemd service/timer, nginx + Let's Encrypt, Alembic, FastAPI·Celery, Vite 빌드.

---

## 1. 실제 현황 조사 결과

### 1-1. CI·배포 워크플로우 `[검증]`
| 항목 | 현황 |
|---|---|
| 워크플로우 | `ci-feature.yml`, `deploy-dev.yml`, `e2e-smoke.yml` 3개. 운영용 없음 |
| deploy-dev | develop push·수동 실행. 프론트는 `.env`를 `dev-api` 주소로 **하드코딩 생성**, 번들(tar)을 SCP 로 서버에 올리고 SSH 로 실행. 서버 `.env.dev`를 sed 로 **덮어씀**(`ENVIRONMENT=development`·`ENABLE_DEV_ROLE_SIMULATION=false`·`DEBUG=false`·`GEMINI_API_KEY`). cron 14개를 스크립트 문자열로 등록. 롤백 트랩은 코드(dist·app·alembic)만 복원 |
| 시크릿 | GitHub Secrets: `E2E_PASSWORD`, `EC2_DEV_HOST`, `EC2_SSH_KEY`, `GEMINI_API_KEY`, `VITE_GOOGLE_CLIENT_ID` (이름만 확인) |
| 저장소 | `Brian-Chae/mindbreeze_2.0`, **공개(public)**, 개인 계정 소유. `production` 환경 없음. develop·main 브랜치 보호 없음. 보존 태그 `archive/main-20260605` 있음. main 은 develop 과 135커밋 차이(기획서의 565에서 감소 — 이후 main 재설정 여부 [미확인]) |
| 마이그레이션 | `alembic/versions` 파일 **85개**(요청서의 94는 이 저장소 기준 불일치 — 파일 수 기준 85, 체인은 단일 head `e036a0000051`). dev 서버·DB 모두 `e036a0000051` `[검증]` |

### 1-2. 서버 구성 (dev EC2 `i-00fd62ca8876bec8f`, 이름 `mindbreeze-dev`) `[검증]`
| 항목 | 값 |
|---|---|
| 사양 | t4g.medium(2vCPU/4GB), ap-northeast-1c, 기본 VPC `vpc-26172a41`, 퍼블릭 IP 18.183.86.88(탄력 IP 아님) |
| OS·버전 | Ubuntu 24.04.4, kernel 6.17 aarch64, Python 3.12.3, nginx 1.24, Redis 7.0.15, certbot |
| 디스크 | 루트 20GB gp3 **비암호화**, 사용 53%(9.7G/19G). 앱 디렉터리 3.0GB. 메모리 사용 1.1GB/3.8GB |
| IMDS | IMDSv2 필수(`HttpTokens=required`) — 이미 충족. 단 **인스턴스 프로필 없음**(서버가 IAM 사용자 액세스 키를 .env 에 보관) |
| systemd 유닛(활성) | `mindbreeze-backend`(uvicorn :8000), `mindbreeze-worker`, `mindbreeze-email-worker`, `mindbreeze-export-worker`, `livekit`, `coturn`, `nginx`, `redis-server`, `amazon-ssm-agent`(설치·실행 중이나 인스턴스 프로필이 없어 SSM 미등록 — 관리 인스턴스 0대) |
| 유닛 파일 | 저장소 `backend/deploy/` 에 worker 3종 + export-beat(미설치) + logrotate. **backend/livekit/coturn/nginx 유닛·설정은 저장소에 없음**(서버에만 존재 → 환경 재현 불가, IaC 공백) |
| cron | 14개(아래 3-4) + `DEBUG=false` 환경 줄. systemd timer 로는 certbot·logrotate·OS 기본만 |
| nginx | `sites-enabled/mindbreeze-ssl` 단일. `dev.` + `dev-api.` 서버명, `/livekit/`→127.0.0.1:7880, 그 외 `proxy_pass 127.0.0.1:8000`, 인증서 Let's Encrypt(`dev.mindbreeze…` SAN 에 `dev-api.` 포함, 만료 2026-12-01 자동 갱신 timer) |
| LiveKit | `/etc/livekit/livekit.yaml`: 7880, `rtc.tcp_port 7881`, `use_external_ip:false`, **`node_ip` 가 현 공인 IP 하드코딩** — 새 서버에서 반드시 재작성 |
| coturn | `listening 3478 / tls 5349`, **`external-ip=18.183.86.88`**, relay 49152–49200, `realm=dev.mindbreeze.looxidlabs.com` — 전부 환경 의존 |
| .env 키 이름(값 미열람) | `DEBUG DATABASE_URL DATABASE_URL_SYNC REDIS_URL JWT_SECRET_KEY JWT_ALGORITHM ACCESS_TOKEN_EXPIRE_MINUTES REFRESH_TOKEN_EXPIRE_DAYS RESEND_API_KEY RESEND_FROM_EMAIL S3_BUCKET S3_REGION GOOGLE_CLIENT_ID GOOGLE_EXTRA_CLIENT_IDS LIVEKIT_HOST LIVEKIT_API_KEY LIVEKIT_API_SECRET GEMINI_API_KEY AGENT_LLM_MODEL OPENAI_API_KEY DEEPSEEK_API_KEY ENVIRONMENT ENABLE_DEV_ROLE_SIMULATION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY FCM_PROJECT_ID FCM_SERVICE_ACCOUNT_JSON VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT` (총 29) |
| 비밀 아닌 설정값 | `ENVIRONMENT=development`, `DEBUG=false`, `ENABLE_DEV_ROLE_SIMULATION=false`, `S3_BUCKET=mindbreeze-dev`, `FCM_PROJECT_ID=mind-breeze`, 발신 `MIND BREEZE DEV <noreply@dev.mindbreeze…>` |
| **없는 키 (prod 에서 새로 필요)** | `RESEARCH_ID_KEY_V1`(연구 가명 키, 분실 시 매핑 영구 단절 — 오프라인 백업 필수), `RESEARCH_EXPORT_ACK_TOKEN`, `CORS_ALLOWED_ORIGINS`(현재 코드 하드코딩이라 변수 자체 없음), `REPORT_EMAIL_BASE_URL`/`FRONTEND_BASE_URL`(dev 서버는 코드 기본값 사용 중), `RETENTION_SWEEP_ENABLED` 등 SDD-209 변수(미설정=비활성) |

### 1-3. AWS 읽기 전용 조회 (계정 187768779388, 사용자 `brian.chae`, 자격증명 정상) `[검증]`
| 영역 | 현황 |
|---|---|
| EC2 | 이 리전 인스턴스 1대(dev). EIP 0개 |
| 네트워크 | VPC 는 **기본 VPC 1개**(172.31.0.0/16), 서브넷 3개(1a·1c·1d, 모두 퍼블릭 자동할당) |
| 보안그룹 | `mindbreeze-dev-sg`: **22·8000·7880 이 0.0.0.0/0 전체 개방**(80·443·3478·5349·7881 TCP, 3478·49152–49200 UDP 포함 전부 전체 개방), 5432 는 자기 SG 만. `mindbreeze-rds-sg` 는 **규칙 없음·미사용**(RDS 는 dev-sg 를 사용). **→ prod 는 그대로 복제 금지** |
| RDS | `mindbreeze-dev` db.t4g.micro, PG 16.14, **단일 AZ, 저장소 암호화 꺼짐**, gp2 20GB, 백업 14일(창 18:26–18:56 UTC), **삭제방지 ON**, 퍼블릭 아님, 성능 인사이트 꺼짐. 기본 파라미터 그룹(`rds.force_ssl=1`). 스냅샷: 수동 `…pre-envsplit-20261010` + 자동 14일치, **전부 비암호화** → 암호화는 스냅샷 암호화 복사 후 복원으로만 가능 |
| S3 | `mindbreeze-dev`(2,873객체·2.41GB, 접두사 `eeg-raw/` `video/` `_server-archive-20261010/`): 기본 암호화 AES256, 퍼블릭 차단 4종 ON, CORS=dev 오리진만, **버저닝 꺼짐, 수명주기 없음**. `mindbreeze-dev-frontend`: 퍼블릭 차단 **꺼짐**, 용도 미확인 `[미확인]`. prod 버킷 없음 |
| CloudFront | 계정 내 다수 배포가 있으나 mindbreeze 용 없음 |
| Route53 | 호스티드존 `looxidlabs.com`(92레코드, **같은 계정** — DNS 직접 변경 가능), `mindbreeze.kr`(3레코드, SES 인증용). 현 mindbreeze 레코드: `dev.`·`dev-api.` A→18.183.86.88(TTL 300), `resend._domainkey`(dev·운영 루트 둘 다), `send.`(MX·SPF dev·운영 루트 둘 다). **운영 `mindbreeze.` 루트와 `api.` 에는 A 레코드 없음**(비어 있음) |
| ACM | ap-northeast-1 인증서 0개. us-east-1 에 `*.mindbreeze.looxidlabs.com`·`*.mindbreeze.kr` ISSUED(CloudFront/ALB 전용 — 본 설계는 서버 내 Let's Encrypt 라 불필요) |
| IAM | 사용자 `brian.chae`: 직접 정책은 `IAMUserChangePassword` 뿐, 그룹 `developer` 에 **AdministratorAccess** 부여. 정책 시뮬레이션: RunInstances·CreateSecurityGroup·CreateDBInstance·Restore/CopyDBSnapshot·CreateBucket·ssm:PutParameter·iam:CreateRole/InstanceProfile·route53 변경·acm 요청·PutMetricAlarm·sns:CreateTopic·kms:CreateKey·AllocateAddress **전부 allowed**(실행은 하지 않음). → 생성 권한 부족 블로커 **없음** |
| 인스턴스 프로필 | 계정에 `ec2forSSM` 등 다수 존재하나 mindbreeze 전용 없음 |
| SSM Parameter Store | **사용 0개**(파라미터 없음) |
| SNS·CloudWatch | SNS `mindbreeze-alerts` 1개, 경보 5개(`mb-dev-*` EC2 CPU·상태점검, RDS CPU·연결수·저장공간) 전부 OK. 메모리·디스크 경보 없음(에이전트 없음) |
| 비용 | 요금 API 는 조회하지 않음 → 금액은 전부 `[추정]` |

### 1-4. 코드의 환경 하드코딩 `[검증]`
| 위치 | 내용 | prod 영향 |
|---|---|---|
| `backend/app/main.py:88-100` | CORS 허용 오리진에 dev 4개 + 로컬 + 앱 WebView 2개. **prod 도메인은 주석 처리** | 설정 없이 prod 기동 시 로그인·API 전부 CORS 차단. 앱 자동로그인용 `expose_headers=["X-MB-Refresh-Token"]` 은 이미 있음 |
| `backend/app/ws/__init__.py:82` | Socket.IO `cors_allowed_origins="*"` | prod 에서도 전체 허용 — 제한 필요 |
| `backend/app/config.py:68,87` | `report_email_base_url`, `frontend_base_url` 기본값이 dev 주소 | 메일 링크가 조용히 dev 로 — 이미 fail-fast(`production_config_problems`)가 `ENVIRONMENT=production` 명시 시 기동 중단 |
| `backend/app/config.py:75` | `s3_bucket` 기본 `mindbreeze-dev` | **fail-fast 대상 아님** → prod 가 dev 버킷에 쓸 위험(확장 대상) |
| `backend/app/config.py:70` | `resend_from_email` 기본 `onboarding@resend.dev` | 미검사 |
| `backend/app/config.py` livekit | 기본 `ws://localhost:7880`·`devkey/secret` | 미검사(prod 에서 기본값이면 화상 불가·공개 키 노출) |
| `production_config_problems` | 검사 항목은 dev 주소 2개·DEBUG·역할 시뮬레이션 **4가지뿐**. 환경은 `ENVIRONMENT` 를 **명시 설정**해야만 작동(`model_fields_set`) | S3·CORS·발신·LiveKit·FCM·AWS 키·연구 키 검사 추가 필요 |
| `config.py` `environment` 기본 `production` | dev 서버는 `development` 로 우회. **prod 는 `ENVIRONMENT=production` 명시 시 쿠키 secure·업로드 실패 엄격 처리가 켜짐**(dev 에서는 미검증 경로) | prod 첫 기동 때 처음 실행되는 분기가 많음 → 리허설 필수 |
| `backend/ensure_livekit_nginx.py`, `scripts/setup-route53-dev.py` | dev 주소 | dev 용 스크립트(prod 재사용 금지, prod 는 템플릿 렌더) |
| `deploy-dev.yml:40` | 프론트 `VITE_API_BASE_URL` dev-api 하드코딩 | prod 워크플로는 별도 |
| `frontend/vite.config.ts:28,33` | 개발 서버 프록시 대상 dev-api | 개발 서버 전용 — 산출물 영향 없음(검사 예외 처리) |
| `frontend/tests/livekit-url.test.ts`, `e2e/*.mjs`, `backend/tests/*` | dev 주소 | 테스트 — 예외 |
| `frontend/ios/App/App/public/assets/*.js`, `frontend/android/app/src/main/assets/public/assets/*.js` | **git 에 추적되는 과거 빌드 산출물에 dev-api 주소** | prod 앱 빌드는 `cap sync` 로 덮어쓰지만 오염된 번들이 저장소에 남음 — 정리 필요, 검사 대상에 포함 |
| 프론트 VITE 변수 | `VITE_API_BASE_URL`, `VITE_LIVEKIT_URL`(없으면 API 주소에서 유도, SDD-197), `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_NATIVE_{IOS,WEB}_CLIENT_ID`, `VITE_PUBLIC_APP_URL`, `VITE_SOCKET_URL`, `VITE_RETENTION_RAW_DAYS`, `VITE_USE_MOCK_EEG`, `VITE_ENABLE_ROLE_SIM` | 아래 3-2 표 |
| 프론트 env 파일 | 추적됨: `.env`(dev 주소), `.env.dev`, `.env.prod`(api. 주소·LiveKit — **`VITE_GOOGLE_CLIENT_ID` 없음**) | prod 빌드에 Google 로그인 ID 주입 경로 필요(GitHub Secret `VITE_GOOGLE_CLIENT_ID` 는 이미 있음) |
| 역할 시뮬레이션 | `app/api/v1/__init__.py:43`: `environment != production and enable_dev_role_simulation` 일 때만 라우터 포함. 서버는 `false` → 공개 `/api/v1/dev/auth/*` 404 `[검증, SDD-197]` | prod 는 이중으로 차단(production 이면 라우터 자체 없음) |

### 1-5. 앱(Capacitor) `[검증]`
- `capacitor.config.ts`: `appId com.looxidlabs.mindbreeze`, `webDir dist`, `server.url` 없음 → API 주소는 **번들 시점 고정**.
- Android: `flavorDimensions env` — `dev`(`.dev` 접미사·`-dev`)·`prod` 이미 구분. 버전은 `-PversionCode/-PversionName` 주입(기본 1).
- iOS: 번들 ID `com.looxidlabs.mindbreeze.ios` **단일**, `MARKETING_VERSION 1.0`·빌드 번호 1 — dev/prod 구분 없음(Phase 5).
- `package.json` `cap:android:prod`/`cap:ios:prod` = `vite build --mode prod` → `.env.prod`(api. 주소). `cap:ios`·`cap:android`(모드 없음) 일부는 모드 없는 빌드 → `.env`(dev 주소)로 빌드될 수 있어 **혼용 위험**.
- `google-services.json`: 프로젝트 `mind-breeze` 하나에 prod·dev 두 패키지 모두 등록, iOS `GoogleService-Info.plist` 도 존재 → prod Firebase 분리 필요(D10).
- 스토어 배포 여부 `[미확인]`(버전 1.0/빌드 1 → 정식 출시 전으로 보이나 내부 배포 이력은 확인 못함).

### 1-6. 데이터 규모 (집계만) `[검증, dev DB]`
| 항목 | 값 |
|---|---|
| DB 크기 | 54MB, 테이블 63개, alembic head `e036a0000051` |
| 계정 | 총 18 = client 8 · counselor 5 · org_admin 3 · platform_admin 2. **`auth_provider=dev` 3개**(client·counselor·org_admin 각 1), email 13, google 2. 최근 7일 신규 6 |
| 기관 | 6 |
| 세션 | 134(완료 105·예정 19·준비 3·진행 1·취소 6), 최근 30일 생성 103 |
| 기록·리포트 | session_records 74, reports 146 |
| 큰 테이블 | `eeg_feature_windows` 46,131행 32MB, `refresh_tokens` 5,924행, `eeg_raw_chunks` 1,550, `video_chunks` 2,277, `audio_chunks` 1,405, `notification_outbox` 1,068 |
| S3 | 2,873객체 / 2.41GB (`eeg-raw/`, `video/`) |
| 구(6자리) 데이터 | 모델에 6자리 `class_code` 컬럼 주석과 SDD-209 4자리 정책이 공존(`models/session.py:59-60`). 기존 6자리 코드 행 수는 이번에 미집계 `[미확인]` → T-1 에서 집계(컷오버 영향: 코드는 활성 클래스 사이에서만 유일하므로 종료·취소 건은 문제 없음, 진행·예정 건만 확인) |
- 결론: **이관량은 작다**(DB 덤프 수 초, S3 복사 수 분). 실사용자 15명 안팎이라 점검 시간은 데이터가 아니라 검증 단계가 좌우한다.

---

## 2. 인프라 구성도 `[제안]`

```
                       Route53 (looxidlabs.com, 같은 계정)
        mindbreeze.…  ─A→ EIP ─┐        api.mindbreeze.… ─A→ 같은 EIP
                               ▼
 ┌──────────────── VPC mb-prod 10.20.0.0/16 (기본 VPC 와 분리) ─────────────────┐
 │  퍼블릭 서브넷 A(1c)                         프라이빗 서브넷 A(1c)·B(1a)         │
 │  ┌───────────────────────────────┐        ┌───────────────────────────┐     │
 │  │ EC2 t4g.medium  mindbreeze-prod│  5432  │ RDS PostgreSQL 16 t4g.small│     │
 │  │ nginx(443/80, LE 인증서)       │───────▶│ 단일 AZ · KMS 암호화       │     │
 │  │  ├ / → dist(릴리스 링크)       │        │ 백업14일·PITR·삭제방지     │     │
 │  │  ├ /api,/ws → uvicorn :8000   │        │ SG: EC2 SG 에서만 5432     │     │
 │  │  └ /livekit → livekit :7880   │        └───────────────────────────┘     │
 │  │ celery worker ×3 · timer ×14  │                                          │
 │  │ redis(로컬) · livekit · coturn│        IAM 인스턴스 역할: S3 prod 버킷,   │
 │  │ SSM agent (포트 22 닫힘)      │        SSM /mindbreeze/prod/* 읽기,       │
 │  └───────────────────────────────┘        CloudWatch 에이전트                │
 └────────────────────────────────────────────────────────────────────────────┘
 S3: mindbreeze-prod(데이터, 암호화·버저닝·퍼블릭차단)   mindbreeze-prod-releases(릴리스 산출물)
 SSM Parameter Store /mindbreeze/prod/*   CloudWatch → SNS mindbreeze-alerts → Telegram
 GitHub Actions(environment: production, Brian 승인) ─ OIDC ─▶ IAM 역할 ─▶ SSM Run Command → EC2
```
- 인바운드 보안그룹(prod EC2): 80·443 TCP 전체, LiveKit/TURN 에 필요한 포트만(7881 TCP, 3478 UDP/TCP, 5349 TCP, TURN 릴레이 UDP 49152–49200, LiveKit RTC UDP 포트는 T-3 에서 `livekit.yaml` 로 확정). **22·8000·7880 비개방**(nginx 가 로컬로 프록시).
- RDS 보안그룹: EC2 보안그룹에서 오는 5432 만 허용. 퍼블릭 접근 없음. NAT 게이트웨이 없음(RDS 는 외부 통신 불필요, EC2 는 퍼블릭 서브넷의 EIP 사용).

---

## 3. 핵심 설계 결정 (기술 — 에이전트 결정, 기본값 적용)

| # | 결정 | 근거 |
|---|---|---|
| T-D1 | **prod 전용 VPC 신설**(기본 VPC 미사용) | 기본 VPC 는 dev 와 서브넷·보안그룹을 공유하고 모든 서브넷이 퍼블릭. RDS 를 사설 서브넷에 둘 수 있음. 비용 차이 없음(NAT 미사용) |
| T-D2 | 서버 접속은 **SSM 세션만**, 22 닫음 | dev 는 22 전체 개방 `[검증]`. 인스턴스 프로필 부여로 SSM 등록. 비상 접속은 SSM 세션(감사 로그) |
| T-D3 | 서버 AWS 자격은 **인스턴스 역할**, `.env` 에 액세스 키 없음 | 키 유출면 제거. 코드 확인 필요: `storage_service.py:117` 이 빈 문자열 키를 boto3 에 그대로 넘김 → 빈 값이면 `None` 으로 전달해 기본 자격 체인 사용하도록 수정(구현 Task) |
| T-D4 | 비밀값 = **SSM SecureString**, 서버에서 `/etc/mindbreeze/prod.env` 렌더(배포 시) | GitHub 에 prod 비밀 미보관. 값 변경은 SSM 갱신 후 배포 또는 `render-env` 실행. Standard 파라미터 무료 |
| T-D5 | DB 암호화 KMS = **고객 관리형 키 1개**(월 $1) | 스냅샷 공유·키 정책 통제 가능(기본 키는 계정 간 공유 불가). 기본 `aws/rds` 키도 허용 가능하나 DR 유연성 낮음 |
| T-D6 | 프론트는 **서버 nginx 서빙**(S3/CloudFront 미사용) | dev 와 동일 구조, 추가 비용 0, 쿠키 SameSite 동일 상위 도메인 유지 |
| T-D7 | 인증서 = **서버 내 certbot + Route53 DNS-01**, 웹·API 한 인증서(SAN 2개), 서버 역할에 해당 존 TXT 변경 권한(최소 범위) | dev 와 같은 Let's Encrypt 자동 갱신 방식이되, DNS 전환 **전에** 발급 가능해 컷오버 위험 제거(R6). 불가 시 HTTP-01 로 대체 |
| T-D8 | 릴리스 구조 `/opt/mindbreeze/releases/<릴리스ID>/{dist,backend}` + `current` 심볼릭 링크, venv 는 `requirements` 해시별 `/opt/mindbreeze/venvs/<hash>` | 원자적 전환·롤백(링크 교체 + 서비스 재시작). 의존성 설치는 전환 전에 완료 |
| T-D9 | 릴리스 산출물 보관 = **S3 `mindbreeze-prod-releases`**(체크섬 파일 포함, 버저닝) | 같은 산출물 승격(staging 후속 확장 대비). GitHub Actions artifact 는 보존 기간 한계 |
| T-D10 | GitHub → AWS = **OIDC 역할**(장기 키 없음), 역할 신뢰 조건 = 본 저장소 + environment `production` | 승인 없이는 역할을 맡을 수 없음 → D4 를 인프라 레벨로 강제 |
| T-D11 | 주기 작업 = **`mindbreeze-job@<이름>.timer` 템플릿** + 단일 목록 파일(`deploy/jobs.tsv`: 이름·주기·시간대·타임아웃) | 14개 cron 의 문자열 주입(`#`·공백 취약) 제거, `flock` 중복 실행 방지, `journald` 로 로그 일원화, 실패 시 `OnFailure` 알림 |
| T-D12 | 컷오버 방식 = **스냅샷 복원**(논리 덤프 아님) | 데이터 54MB 라 덤프도 가능하나, 암호화 사본 복원이 AWS 표준·검증 쉬움(스냅샷 암호화 복사 → 복원). 덤프(`pg_dump`)는 이중 확인용 보조 |
| T-D13 | 운영 SG 는 신설, 규칙은 최소 개방(§2) | dev SG 복제 금지(22/8000/7880 전체 개방 `[검증]`) |
| T-D14 | prod 서버 전용 `ENVIRONMENT=production` 명시 + 확장된 fail-fast | 기본값에 의존 금지 |
| T-D15 | prod 는 **새 비밀값 전부 신규 발급**(JWT·LiveKit·VAPID·연구 가명 키 등) | 재사용하면 dev 유출이 prod 로 이어짐. 부작용: 전 사용자 재로그인(도메인이 바뀌므로 어차피 쿠키 불승계), 웹푸시 구독 재등록 필요 |
| T-D16 | 외부 키(Gemini·OpenAI·DeepSeek·Resend)는 **prod 전용 키 신규 발급 권장, 불가 시 동일 키 임시 공유 후 컷오버 후 분리** | 사용량·차단 격리. 키 발급은 Brian 계정(결정 B-5 에 포함하지 않고 기본값=신규 발급 시도) |

---

## 4. 컷오버 대상 데이터·상태 인벤토리

| 항목 | 처리 |
|---|---|
| RDS 데이터 | dev 스냅샷 → 암호화 복사 → prod 복원 |
| S3 `eeg-raw/` `video/` | `aws s3 sync` dev→prod(2.4GB), 객체 수·총 용량 일치 확인. **DB 에 저장된 키가 버킷명 없이 상대 키인지 T-1 에서 확인**(전체 URL 이면 재작성 필요) `[미확인]` |
| `_server-archive-20261010/` | prod 로 복사하지 않음(dev 보관본) |
| `auth_provider='dev'` 계정 3개 | prod 에서 **비활성화**(삭제는 FK 확인 후) — 복원 직후 실행 |
| `refresh_tokens` 5,924행 | prod 복원 후 **전체 폐기**(새 JWT 키라 어차피 무효, 정리) |
| 앱·웹푸시 기기 토큰(`devices` 계열) | **prod 에서 비움**: FCM 프로젝트·VAPID 가 새것이라 기존 토큰은 무효이고, 구 토큰으로 발송 시도하면 실패 누적 `[추정]` — 앱 재로그인 시 재등록 |
| `notification_outbox` 1,068행·이메일/푸시 대기 | 점검 모드 진입 시점에 **미발송 건 확인** → dev 에서 소진 또는 prod 로 복원 후 prod 만 처리. dev 는 복원 직후 발송 비활성(아래) |
| 진행/예정 세션 | 점검 시간대(야간)에 `in_progress` 가 0인지 사전 확인, 예정 건의 사전 알림·초대 링크는 새 주소로 재생성 필요한지 확인(링크는 메일 발송 시점 주소로 만들어짐 → 이미 발송된 dev 링크는 컷오버 후 dev 로 연결됨) → 사전 공지 항목 |
| 개발용 로그인 | prod 에 `dev_auth` 라우터 없음 확인 |
| `platform_admin` | email 가입 2명 존재 → prod 관리자 접근 확보됨(SDD-197 당시 우려 해소) `[검증]` |
| 구독/외부 예약 | Google 로그인 연동 계정 2개 — 같은 웹 클라이언트 ID 재사용 시 연동 유지(`sub` 불변) |

---

## 5. Task 분해

> 각 Task 30~60분(에이전트+Brian 대기 제외). **`AWS`** 표시는 리소스 생성이므로 verify 승인 후에만 실행. 롤백 = 해당 Task 로 만든 리소스 삭제/변경 원복.
> 의존: 선행 Task 번호. 범례 [B]=Brian 결정/작업 필요.

### Phase A — 준비 (코드·문서, 서비스 영향 없음)
| Task | 내용 | 선행 | 시간 | 롤백 |
|---|---|---|---|---|
| **T-0** | 기준선: `alembic heads` 단일·테스트 기준선(백엔드 pytest·프론트 tsc/build), `deploy-dev` 최신 성공 SHA 기록, develop 동결 지점(릴리스 후보 SHA) 확정 | — | 30 | 불필요(읽기) |
| **T-1** | 사전 집계(읽기): 6자리 `class_code` 행 수, S3 키 형식(상대/절대), 진행·예정 세션, `notification_outbox` 미발송 수, 기기 토큰 테이블 위치, dev 계정 3개 FK 참조 행 수 | T-0 | 40 | 불필요 |
| **T-2** | 환경 주입 분리(코드): ① CORS 오리진을 `CORS_ALLOWED_ORIGINS` 변수로(기본=로컬 개발만) ② Socket.IO `cors_allowed_origins` 동일 변수 사용(prod `*` 금지) ③ `production_config_problems` 확장(`s3_bucket` 'dev' 포함·CORS 에 dev 도메인·발신 주소 DEV·LiveKit 기본값·FCM 프로젝트 미설정·AWS 키 비어있지 않음·`research_id_key_v1` 비어있음·`ENVIRONMENT` 미명시) ④ `storage_service` 빈 키→기본 자격 체인 ⑤ 단위 테스트(`test_phase0_hardening.py` 확장) | T-0 | 60 | 커밋 revert(기본값 유지로 dev 무영향) |
| **T-3** | 서버 구성 템플릿화: `deploy/` 에 nginx(prod 서버명 변수)·livekit.yaml(`node_ip`·키 변수)·coturn(`external-ip`·`realm` 변수)·service 파일(EnvironmentFile=`/etc/mindbreeze/prod.env`)·`jobs.tsv` + timer/service 템플릿 + 렌더 스크립트. dev 서버의 livekit/coturn 실제 포트(UDP 범위 포함)를 읽기로 확정 | T-0 | 60 | 커밋 revert |
| **T-4** | `release-build.yml`(build-once): prod 모드 프론트 빌드 + 백엔드 소스 + 마이그레이션 + 유닛·timer + `MANIFEST`(SHA·체크섬) tar → S3 릴리스 버킷 업로드. **dev 주소 0건 검사 단계**(산출물 `grep -rE "dev-api|dev\.mindbreeze|mindbreeze-dev|18\.183\.86\.88"` 허용목록 외 발견 시 실패, `ENABLE_ROLE_SIM` 코드 부재 확인). 마이그레이션 head 1개·파괴적 마이그레이션(`drop_`·`op.execute UPDATE/DELETE`) 감지 시 릴리스 노트 경고 | T-2 | 60 | 워크플로 파일 삭제 |
| **T-5** | `deploy-prod.yml`·`rollback-prod.yml` 작성(`environment: production`, `workflow_dispatch` 입력=릴리스 ID·사유, OIDC 역할, SSM Run Command 호출, 공개 스모크 + 관찰 후 확정, 동시성 그룹 직렬화) + 서버측 설치 스크립트(`deploy/install-release.sh`: 다운로드→체크섬→venv→`alembic upgrade`→링크 전환→재시작→`/health/ready`→실패 시 링크 원복) | T-3, T-4 | 60 | 워크플로 파일 삭제 |
| **T-6** | 개인정보처리방침 게이트 점검: 방침 본문·동의 UI 위치(`ConsentCheckList.tsx`, 방침 페이지) 파악, N-6 반영 항목 체크리스트 작성 [B] 문구 확정 대기 | T-0 | 30 | 불필요 |

### Phase B — 인프라 생성 (**AWS**, 서비스 영향 없음·미노출)
| Task | 내용 | 선행 | 시간 | 롤백 |
|---|---|---|---|---|
| **T-7 AWS** | 네트워크·IAM·KMS: VPC `mb-prod`(퍼블릭 1·사설 2 서브넷, IGW, 라우트), 보안그룹(`mb-prod-ec2`, `mb-prod-rds`), KMS 키 + 별칭, EC2 인스턴스 역할/프로필(S3 prod 버킷·SSM 경로 읽기·CloudWatch·SSMManagedInstanceCore), GitHub OIDC 공급자·배포 역할 | [B] 비용 승인 | 60 | 생성한 리소스 역순 삭제(태그 `project=mindbreeze,env=prod` 로 식별) |
| **T-8 AWS** | S3: `mindbreeze-prod`(퍼블릭 차단·암호화·버저닝·수명주기·CORS=운영 오리진), `mindbreeze-prod-releases`(버저닝). 버킷 정책: prod 역할만 접근 | T-7 | 40 | 빈 버킷이면 삭제 |
| **T-9 AWS** | RDS: 서브넷 그룹·파라미터 그룹(`rds.force_ssl=1`)·`mindbreeze-prod-empty` 생성(암호화·14일·삭제방지·최종 스냅샷 필수·퍼블릭 아님·**초기 데이터 없음** — T-15 배포 리허설용. 실제 `mindbreeze-prod` 는 컷오버 C-2 의 스냅샷 복원으로 생성). 연결 확인은 EC2 에서 | T-7 | 50(생성 대기 제외) | 삭제방지 해제 후 삭제(초기라 데이터 없음) |
| **T-10 AWS** | EC2: 최신 Ubuntu 24.04 arm64, t4g.medium, 암호화 gp3 40GB, IMDSv2 필수, 프로필 연결, EIP 할당·연결. 사용자 데이터로 기본 패키지(nginx·redis·certbot·libcairo 등)·SSM agent 등록 확인 | T-7 | 40 | 인스턴스 종료·EIP 해제 |
| **T-11 AWS** | DNS·인증서: Route53 에 `mindbreeze.`·`api.mindbreeze.` A 레코드(TTL **60** 선행 설정, EIP) — **컷오버 전에는 내부 확인용 임시 호스트명만**(예: `prod-check.mindbreeze…`)을 가리키고 공개 레코드는 T-20 에서 전환. 임시 호스트명으로 certbot 발급 시험 | T-10 | 40 | 레코드 삭제 |
| **T-12 AWS** | SSM 비밀값: `/mindbreeze/prod/*` 생성(JWT·LiveKit·VAPID·연구 가명 키·DB URL 등 신규 발급, 값은 **파일·로그·명령줄에 남기지 않음**), 렌더 스크립트로 `/etc/mindbreeze/prod.env` 생성 확인. **연구 가명 키 오프라인 백업**(Brian 보관 — 분실 시 동일인 매핑 영구 단절) [B] 외부 API 키 | T-10 | 50 | 파라미터 삭제 |
| **T-13 AWS** | 모니터링: 경보 확장(EC2 상태·CPU·**디스크·메모리**(CW 에이전트), RDS 저장공간·CPU·연결수·**FreeableMemory**), 기존 SNS `mindbreeze-alerts` 연결, 업타임 감시(운영 도메인 `/health/ready`), 로그 보관 설정 | T-10, T-9 | 50 | 경보 삭제 |

### Phase C — 서버 구성·배포 리허설 (미노출)
| Task | 내용 | 선행 | 시간 | 롤백 |
|---|---|---|---|---|
| **T-14** | 서버 구성 적용: nginx·livekit·coturn 템플릿 렌더·기동, timer 설치(**단 비활성** — prod 가 dev 와 같은 대기열을 건드리지 않도록 컷오버 전까지 `disable`), Redis 로컬, logrotate/journald 상한 | T-3, T-10, T-12 | 60 | 서비스 중지·파일 제거(서버 폐기 가능) |
| **T-15** | **첫 릴리스 배포 리허설**: `release-build` → Brian 승인 → `deploy-prod` 로 서버에 설치(임시 호스트명). 빈 DB 에 `alembic upgrade head`(85개 체인 신규 적용 시간·오류 확인), `/health/ready` 200, `ENVIRONMENT=production` 첫 기동(쿠키 secure·업로드 엄격 분기), 역할 시뮬레이션 404 | T-5, T-9, T-14, T-8 | 60 | 인스턴스 유지 + DB 재생성(빈 DB) |
| **T-16** | **롤백 리허설**: 릴리스 2개 연속 배포 → `rollback-prod` → 링크·유닛·timer 복귀 + 스모크. 마이그레이션 실패 주입(롤백 트랩 동작) 확인 | T-15 | 40 | 불필요 |
| **T-17** | **컷오버 리허설(복제본)**: dev 스냅샷 → 암호화 복사 → **리허설용 임시 RDS** 로 복원 → `alembic current`=head·행 수 집계 일치·dev 계정 정리·S3 복사(시험 버킷 또는 prod 버킷 임시 접두사)·스모크(로그인·세션·리포트·실시간 EEG·메일은 본인 주소만·푸시 제외). 소요 시간 실측 → 점검창 산정 | T-15, T-1 | 60 | 임시 RDS·접두사 삭제 |
| **T-18** | **복구 훈련**: prod RDS PITR 로 임시 인스턴스 복원 → 헬스·행 수 확인 → 삭제. RPO/RTO 실측 기록 | T-9, T-17 | 40 | 임시 인스턴스 삭제 |

### Phase D — 컷오버 (사용자 영향: 야간 점검 1회) — 게이트: Brian 승인 + N-6 완료
| Task | 내용 | 선행 | 시간 | 롤백 |
|---|---|---|---|---|
| **T-19** | **사전 공지·준비**: D-3·D-1 공지(점검 시각·새 주소·재로그인·푸시 재허용), 점검 페이지(nginx 503) 준비, 공지문 [B] 승인, TTL 60 반영 확인, prod 릴리스 후보 최종 확정(= 리허설 통과 산출물) | T-16~T-18, [B] B-1~B-6 | 40 | 공지 정정 |
| **T-20** | **컷오버 실행** (§6 런북). 점검 시작 → 쓰기 차단 → 스냅샷·복원·S3·정리 → timer 전환 → DNS 전환 → 스모크 → 점검 해제 | T-19 | 60(+대기) | §6 롤백 기준 |
| **T-21** | **dev 사후 처리**: dev DB 비식별화(음성·전사·뇌파 Raw 삭제, 개인정보 마스킹, 발송 차단 변수), `deploy-dev` 재개, dev 환경 표식(배너·`ENVIRONMENT=development`), E2E smoke 주소 유지 확인, 구 앱 빌드용 `dev-api` 유지(D11) | T-20 + 24시간 관찰 | 50 | 비식별화는 비가역 → **prod 안정 확인 후**에만 실행 |
| **T-22** | **관찰·마감**: 48시간 경보·오류 로그 확인, 비용 실측, 스모크 계정 정책, summary 작성 | T-20 | 30 | — |

### 순서 요약(의존 그래프)
```
T-0 ─┬─ T-1 ──────────────────────────┐
     ├─ T-2 ─ T-4 ─┐                  │
     ├─ T-3 ───────┴─ T-5 ─┐          │
     └─ T-6(B-6 대기)       │          │
[B 비용 승인] → T-7 ┬ T-8 ┐ │          │
                    ├ T-9 ┼─┤          │
                    └ T-10┴ T-11,T-12,T-13
                          T-14 → T-15 → T-16 → T-17 → T-18
                                          └────────────┴→ T-19 → T-20 → T-21 → T-22
```

---

## 6. 컷오버 런북 (T-20 상세, `[제안]`)

**전제(모두 충족해야 시작)**: T-15~T-18 통과 / N-6 게시 확인 / Brian 컷오버 승인 / 공지 D-1 완료 / dev `in_progress` 세션 0건 / 릴리스 후보 SHA 동결 / 롤백 담당(에이전트) 대기.

| 단계 | 내용 | 확인 | 누적 시간 `[추정]` |
|---|---|---|---|
| C-0 | dev 에서 마지막 확인: `alembic current`, 행 수 집계 스냅샷(전후 비교용) 기록, dev `notification_outbox` 미발송 건수 기록 | 기록 파일 | −5 |
| C-1 | **점검 모드**: dev nginx 점검 페이지(503, 관리자 IP 우회) → 쓰기 차단. dev cron·워커 **중지**(알림·스윕이 점검 중 데이터를 바꾸지 않게) | 신규 요청 503, 워커 inactive | 0 |
| C-2 | dev RDS 최종 수동 스냅샷 → **암호화 사본 복사**(KMS) → 새 인스턴스 `mindbreeze-prod` 로 복원(스냅샷 복원은 항상 새 인스턴스. 리허설 T-17 과 같은 옵션: 서브넷 그룹·`mb-prod-rds` SG·파라미터 그룹·t4g.small·단일 AZ·백업 14일·삭제방지 재적용). 복원 후 SSM 의 DB 접속 주소를 새 엔드포인트로 갱신하고 T-9 의 빈 인스턴스 `mindbreeze-prod-empty` 는 컷오버 안정 확인 후 삭제 | 인스턴스 available, 암호화 true, 삭제방지 true, 백업 14 | +15 |
| C-3 | prod DB 검증: `alembic current`=`e036a0000051`, 행 수 집계 = C-0 기록, `auth_provider='dev'` 3계정 비활성, `refresh_tokens` 폐기, 기기 토큰 비움, 필요한 경우 `ALEMBIC upgrade head`(릴리스 후보가 더 새 마이그레이션을 가지면) | 집계 일치 | +25 |
| C-4 | S3: `eeg-raw/`·`video/` dev→prod sync(최종분), 객체 수·총 바이트 일치, 샘플 5건 다운로드 | 일치 | +35 |
| C-4b | **서버 로컬 청크 이관 (T-17 에서 발견, 2026-10-18)**: dev `audio_chunks` 1,405행 전부 `/tmp/mindbreeze_audio/…` 절대 경로 — dev 서버 디스크에 실제 존재 1,072건(84.2MB), 333건 유실. `video_chunks` 2,277행 중 982행이 `/tmp/mindbreeze_video/…` 절대 경로이나 **실제 파일 0건**(이미 정리됨, 나머지 1,295행은 S3 키). 조치: (1) dev 서버에서 존재하는 오디오 청크 1,072건을 tar → prod 버킷 `_migration/` 임시 접두사 → prod 서버 동일 경로(`/tmp/mindbreeze_audio`, 서비스 PrivateTmp 여부 확인)로 복원하거나, STT 완료된 세션 청크면 이관 생략(`session_records.audio_s3_key` 가 영속 원본)하고 (2) 파일 없는 청크 행(오디오 333·영상 982)은 `media_cleanup_service` 가 처리하도록 두거나 컷오버 후 정리 SQL 로 제거 — Brian 결정 | 존재 파일 수 = 복원 수, 유실 행 목록 보고 | +37 |
| C-5 | prod 릴리스 확정 배포(`deploy-prod` — GitHub 환경 승인은 컷오버 승인과 별개로 Brian 이 이 시점에 직접 클릭): `ENVIRONMENT=production`, `RETENTION_SWEEP_ENABLED=false`, `RESEARCH_EXPORT_ENABLED=false` | `/health/ready` 200(임시 호스트명) | +40 |
| C-6 | **실행 주체 전환**: prod timer **활성화**(14개), prod 워커 3종 기동. dev 는 C-1 에서 중지된 상태 유지 | prod `systemctl list-timers` 14개, dev cron 0 | +45 |
| C-7 | **DNS 전환**: `mindbreeze.`·`api.mindbreeze.` A→prod EIP(TTL 60). certbot 본 인증서 발급(웹+API SAN) → nginx reload | `curl https://api.…/health/ready` 200, 인증서 유효 | +50 |
| C-8 | **스모크**(prod): 로그인(이메일·Google)·세션 생성·클래스 입장 코드·실시간 EEG 연결·화상(LiveKit/TURN)·음성 업로드→리포트 생성·본인 주소 메일·CORS/WebSocket·`/api/v1/dev/auth/*`=404 | 체크리스트 전부 통과 | +60 |
| C-9 | **점검 해제**: 신규 접속 허용. **dev 는 계속 점검 모드/발송 차단 유지** — T-21 전까지 사용자 접속 시 "새 주소 안내" 페이지(점검 페이지에 새 주소 표시) | 사용자 접속 가능 | +60 |
| C-10 | 관찰 30분(오류율·큐 적체·경보) 후 컷오버 완료 선언 | 이상 없음 | +90 |

**점검 시간 `[추정]`**: 60분 목표(C-1~C-9), 데이터가 작아 복원·복사는 합쳐 15~25분. T-17 리허설 실측으로 확정. **D2 한도 30~60분을 넘기면** 롤백 판단.

**롤백 기준·방법**
- C-1~C-6(DNS 전환 전): prod 폐기 없이 **dev 점검 모드 해제 + dev cron/워커 재가동**으로 즉시 복귀. 데이터 분기 없음(쓰기 차단 상태였음).
- C-7~C-9(DNS 전환 후, 점검 해제 전): DNS 를 dev EIP 로 되돌리고(TTL 60) dev 점검 해제·cron/워커 재가동. prod 에는 스모크 계정 쓰기만 있음 → 분기 없음. 단 prod timer 는 **먼저 중지**(이중 발송 방지).
- **점검 해제(C-9) 이후**: 실사용 쓰기가 prod 에 생김 → **단순 복귀 금지**. 수정 배포 우선, 데이터 손상 시 PITR. 이 시점 이후 dev 로 DNS 복귀가 필요하면 prod→dev 역복원 절차(별도 승인) 사용.
- 어느 단계든 S3 sync 는 dev 원본을 건드리지 않으므로(복사) 영향 없음.

---

## 7. 비용 재산정 `[추정 — 요금 API 미조회, 도쿄 리전 온디맨드, 월]`

| 항목 | 월 | 비고 |
|---|---|---|
| EC2 t4g.medium | 약 $31 | 4GB. dev 메모리 사용 1.1GB 로 여유 |
| EBS gp3 40GB 암호화 | 약 $4 | |
| 퍼블릭 IPv4(EIP) | 약 $4 | 연결 여부와 무관하게 과금 |
| RDS db.t4g.small 단일 AZ | 약 $38 | 기획서(초안)는 $65 총액이었음 |
| RDS 스토리지 gp3 20GB | 약 $3 | 자동백업 저장은 DB 크기 한도 내 무료 |
| KMS 고객 관리형 키 | $1 | |
| S3 (2.4GB + 증가분) | 약 $1~3 | 영상·뇌파 누적에 비례 |
| CloudWatch 경보·에이전트 로그 | 약 $3~5 | 경보 10개 이하·로그 소량 |
| SSM Parameter Store(Standard)·Route53 레코드·Let's Encrypt | $0 | |
| 데이터 전송(아웃바운드) | 약 $2~5 | 화상은 P2P/TURN 릴레이 비중에 따라 변동 |
| **prod 합계** | **약 $85~95** | 기획서 시나리오 ① 의 $65 보다 약 $20~30 증가(RDS small 단가·IPv4·KMS·모니터링 반영) |
| dev(유지) | 약 $40 | 컷오버 후 로컬 이전·해지 시 −$40 |
| **총합(prod+dev)** | **약 $125~135** | 기획서 시나리오 ① 합계 $105 대비 +$20~30 |
- 일회성: 컷오버 리허설용 임시 RDS 1회(수 시간, 약 $1 미만), 스냅샷 복사.
- 절감: 3~6개월 후 1년 약정 시 EC2·RDS 30~40% ↓, 스타트업 크레딧 자격은 `[미확인]`.
- Sentry·상용 APM 은 본 SDD 비포함(Phase 4).

## 8. 위험·함정

| # | 함정 | 대응 |
|---|---|---|
| R1 | 운영 워크플로를 `deploy-dev.yml` 복사로 만들면 서버 `.env` sed 덮어쓰기·dev 주소 하드코딩·cron 문자열 주입이 prod 에 이식 | prod 는 새로 작성(T-4~5). 리뷰 체크리스트에 "sed 로 서버 설정 수정 없음" |
| R2 | `ENVIRONMENT=production` 첫 기동에서 dev 에서 한 번도 안 돈 분기(쿠키 `secure`·업로드 실패 엄격 처리·역할 시뮬레이션 라우터 부재) 가 처음 실행 | T-15 리허설에서 로그인·업로드·리포트까지 실제 경로 확인 |
| R3 | CORS 목록이 코드 하드코딩(prod 도메인 주석) → prod 에서 전원 로그인 실패 | T-2 변수화 + fail-fast + C-8 스모크 CORS |
| R4 | Socket.IO `cors_allowed_origins="*"` | T-2 제한 |
| R5 | LiveKit `node_ip`·coturn `external-ip` 하드코딩 → 새 서버에서 화상·TURN 불통 | T-3 템플릿 + 스모크에 화상 포함 |
| R6 | 인증서 발급은 DNS 가 먼저 prod 를 가리켜야 함(HTTP-01) → 컷오버 순서와 충돌 | 임시 호스트명으로 사전 발급 시험(T-11), 본 도메인은 C-7 에서 발급. 실패에 대비해 TTL 60·롤백 포함. 대안: DNS-01(Route53) 로 DNS 전환 전 발급 가능 — T-11 에서 DNS-01 로 확정하면 C-7 위험 제거(`[제안]` 기본 DNS-01) |
| R7 | S3 객체 키가 절대 URL 이면 복사 후 전부 깨짐 | T-1 확인 |
| R8 | 개발용 계정 3개가 prod 에 남음 | C-3 정리 + verify |
| R9 | prod timer 가 활성인 채 dev 도 돌면 이중 발송 | 컷오버 전 prod timer disable(T-14), C-1 dev 중지 → C-6 prod 활성 순서 고정 |
| R10 | 컷오버 후 구 링크(이미 발송된 dev 주소 초대·리포트 메일) 클릭 시 dev 로 이동 | dev 에 "운영은 새 주소" 안내 페이지 유지(T-21). 공지에 포함 |
| R11 | 도메인이 바뀌어 모든 사용자 재로그인·웹푸시 구독 해제 | 공지에 명시 |
| R12 | Resend 운영 도메인 인증 상태 `[미확인]` → 발신 실패 | T-12 에서 Resend 콘솔 확인, 실패 시 컷오버 중단 사유 |
| R13 | 방침 갱신 지연 | B-6 로 일정 확정, 미충족 시 컷오버 승인 요청 안 함 |
| R14 | 연구 가명 키 분실·미설정 | T-12 오프라인 백업, 컷오버 전 `production_config_problems` 가 빈 키 차단 |
| R15 | 공개 저장소 — 설정 파일에 값이 섞이면 즉시 노출 | prod 값은 SSM 만, 저장소에는 **키 이름·템플릿만**. 기존 추적 파일 `frontend/.env*` 에 비밀 없음 확인(Google 클라이언트 ID 는 공개 값). 저장소 공개 유지 여부는 B-8 |
| R16 | 서버 1대 장애 = 전면 중단 | 경보·PITR·복구 훈련, 확장 임계(기획서 §2-9) 모니터링 |
| R17 | RDS 암호화는 사후 변경 불가 → 처음부터 암호화 | T-9 필수 항목, verify |
| R18 | `deploy-dev` 에서 `sudo apt-get update`·pip 설치를 배포마다 실행 → prod 에서 배포 지연·외부 의존 장애 | prod 는 venv 해시 재사용, 시스템 패키지는 서버 구성(T-14)에서 1회 |
| R19 | 마이그레이션 85개 신규 적용 시간·잠금(빈 DB 라 짧음) vs 복원본은 head 이므로 적용 없음 | T-15(빈 DB)·T-17(복원본) 둘 다 리허설 |
| R20 | 앱 `cap:ios`·`cap:android`(모드 없음) 스크립트가 dev `.env` 로 빌드 | prod 빌드는 `:prod` 스크립트만 허용, 빌드 후 `grep` 검사. 구현 시 모드 없는 스크립트 제거/경고 |

## 9. 기술 결정 기록 (기본값 적용, Brian 질문 없음)
§3 표 T-D1~T-D16 이 기술 결정 전체다. 별도 승인이 필요한 것은 없다(단 T-D15/16 의 외부 키 신규 발급과 B-5 일부는 Brian 계정 작업).

## 10. Brian 결정 필요 항목 (비즈니스만, 기본값 제안)

| # | 결정 | 기본값(제안) | 필요 시점 |
|---|---|---|---|
| **B-1** | **운영 주소 우선순위**: 운영 웹·API 도메인 | `mindbreeze.looxidlabs.com`(웹) / `api.mindbreeze.looxidlabs.com`(API) — DNS 레코드·메일 인증 레코드가 이미 준비돼 있음 `[검증]`. 별도 소유 도메인 `mindbreeze.kr`(현재 이메일 인증용 존재)을 서비스 주소로 쓰려면 추가 설계(인증서·쿠키·CORS) 필요 | T-7 전 |
| **B-2** | **DNS 권한**: DNS 변경(운영 도메인 레코드)을 에이전트가 직접 수행 | 허용 — `looxidlabs.com` 존은 같은 AWS 계정, 현재 권한으로 변경 가능 `[검증]`. 기존 레코드(dev 등)는 건드리지 않고 `mindbreeze.`·`api.` 신규 추가만 | T-11 |
| **B-3** | **Firebase 운영 프로젝트**: 앱·웹 푸시용 prod 프로젝트 신설(Brian 계정) | 신설(D10). 컷오버 전 미완료 시: **푸시 없이 컷오버**(메일·화면 알림만) 후 앱 출시(Phase 5) 때 연동. 웹 푸시용 VAPID 는 새로 발급해 서버 비밀값으로 | T-12 / 앱 출시 전 |
| **B-4** | **Resend 운영 발신 도메인**: `mindbreeze.looxidlabs.com` 발신(`noreply@mindbreeze…`) 인증 확인·prod 전용 API 키 | 운영 루트 도메인 사용(DKIM·SPF 레코드 존재). 키는 prod 전용 신규 발급. 인증 안 돼 있으면 Brian 의 Resend 콘솔에서 확인 요청 | T-12 |
| **B-5** | **비용 승인**: prod 월 약 $85~95(총 약 $125~135, 컷오버 후 dev 이전 시 −$40) | 승인 — 기획서 시나리오 ① 대비 +$20~30(RDS small 단가·IPv4·KMS·모니터링). 1년 약정은 3~6개월 후 재검토 | T-7 전 |
| **B-6** | **개인정보처리방침 문구 담당·기한**: N-6(기록 N일 삭제·연구 동의·무기한 보관·재식별 위험) 작성·법무 검토 | 담당: Brian(법무 자문 포함). 에이전트는 초안 항목표와 게시 위치 제공. **컷오버 승인 요청은 게시 확인 후**. 기한 제안: 컷오버 D-7 | T-19 전 |
| **B-7** | **컷오버 일시·공지**: 야간 점검(약 60분, 목표 요일·시간대) 및 사용자 공지 문구·발송 | 제안: 사용 적은 평일 야간(예: 02:00~03:00 KST), D-3·D-1 이메일+화면 공지, **새 주소·재로그인·푸시 재허용** 포함. 일시·공지 문구 승인 필요 | T-19 |
| **B-8** | **저장소 공개 상태 유지 여부**: 현재 공개(public) 저장소 `[검증]`. 배포 승인 게이트(필수 승인자)는 공개 저장소에서도 동작하므로 필수는 아님 | 비공개 전환은 별건으로 두고 **현 상태 유지**(prod 값은 SSM 에만, 저장소에는 값 미커밋). 비공개 전환 시 GitHub 요금제에 따라 환경 승인 기능 제한 가능성 있음 `[미확인]` — 전환 전 확인 | 참고 |

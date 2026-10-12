# A. 인프라·보안·데이터 — 개발/운영 환경 분리 기획

- 작성: 2026-10-10 / 조사 범위: 읽기 전용 저장소 조사 + 브리프 [확정 사실]
- 전제: AWS 관리형 + systemd 단일 프로세스 선호, 실용성 우선, 배포는 GitHub Actions.

---

## 1. 현황 진단

### 1-1. 치명(🔴)

| # | 항목 | 근거 | 왜 위험한가 |
|---|---|---|---|
| A1 | 운영 환경 자체가 없음 — 실사용자가 dev를 실서비스로 사용 | `.github/workflows/deploy-dev.yml` 단독, develop push=즉시 반영 | 개발 실험·에이전트 커밋이 실사용자에게 직결. 안전한 실험 공간이 0 |
| A2 | RDS 암호화 꺼짐 + Multi-AZ 아님 + 삭제방지 꺼짐 | 확정 사실(RDS `mindbreeze-dev`, db.t4g.micro) | 뇌파·상담 내용·음성이 미암호 저장. AZ 장애 시 복구 수단은 7일 자동백업 복원뿐 |
| A3 | 비밀값 전부 서버 평문 1개 파일 | `.env.dev`(JWT, AWS IAM 키, LLM 키, LiveKit, FCM, VAPID) | EC2 1대 침해 = 전 자산 침해. 로테이션 절차·이력 없음 |
| A4 | 개발·테스트·실사용 데이터가 한 DB | 확정 사실 | 개발 중 파괴적 마이그레이션·테스트 시드가 실데이터를 오염 |
| A5 | Alembic 파괴적 변경 무게이트 적용 | `op.execute("UPDATE sessions SET status='in_progress' WHERE status='paused'")` (`backend/alembic/versions/e036a0000028_sdd_125_remove_paused_status.py:20`), `op.drop_column('sessions','cuesheet')` (`e036a0000022_drop_class_cuesheet.py:27`), 그 외 `drop_column`/`drop_table` 62개 파일 | 배포 롤백 트랩은 코드만 복원. 데이터 손실은 비가역 |
| A6 | 단일 EC2에 전부 — 디스크 69%/19GB, RAM 3.8GB | 확정 사실 | 워커(STT·영상 병합)가 API와 CPU·RAM·디스크를 다툼. 디스크 full = 전면 장애 |

### 1-2. 중대(🟡)

| # | 항목 | 근거 |
|---|---|---|
| A7 | dev 도메인 소스 하드코딩(기본값) | `backend/app/config.py:50`(report_email_base_url), `:68`(frontend_base_url), `backend/app/main.py:57-60`, `frontend/src/hooks/useLiveKit.ts:10`, `useMemberLiveKit.ts:20` → 운영에서 환경변수 누락 시 **조용히 dev 주소로 메일·링크 발송** |
| A8 | `environment` 기본값 "production" (fail-safe 의도) | `backend/app/config.py:72`. dev 기능 차단엔 안전하지만, **S3 업로드 실패 엄격화**(`backend/app/services/storage_service.py:73`)가 dev에선 꺼져 업로드 실패를 로컬 폴백으로 묵살. dev가 실서비스인 현재 상태에서 실데이터 유실 가능 |
| A9 | 모바일 앱 API 주소가 빌드 시점 고정 | `frontend/capacitor.config.ts`에 server.url 없음, `frontend/src/lib/api/client.ts:35` 등이 `VITE_API_BASE_URL` 사용. 배포 워크플로는 dev 주소를 하드코딩 주입(`deploy-dev.yml:38`) → 스토어에 올라간 앱은 서버 교체로 되돌릴 수 없음 |
| A10 | `.env.prod`가 존재하지 않는 도메인 지시 | `frontend/.env.prod` = `api.mindbreeze.looxidlabs.com` (DNS 없음), CORS 허용목록의 prod 항목은 주석(`backend/app/main.py:64-66`) |
| A11 | S3 버킷/접두사 환경 분리 불명확 | `settings.s3_bucket` 기본값 `mindbreeze-dev`(`config.py:57`), 실제는 `looxid-las` 버킷을 접두사로 공유. 서버는 IAM **사용자 키** 사용(역할 아님) |
| A12 | 백업·모니터링 에이전트 없음 | 확정 사실(sysstat·certbot만, CloudWatch 미설치). 디스크·메모리·DB 커넥션 경보 0 |
| A13 | 보관기간·접근감사 정책 미비 | `backend/app/models/consent.py`는 동의 기록만(type=tos/privacy/sensitive). 데이터 보관기간 모델·전역 접근 감사 로그 없음(감사는 `data_export`·`credential` 등 국소) |

### 1-3. 경(🟢) — 이미 잘 된 것

- S3 업로드 전부 `ServerSideEncryption: AES256` 적용(`storage_service.py:128,254,299,331`).
- JWT 키 미설정 시 기동 중단 fail-fast(`backend/app/main.py:33-35`).
- refresh 쿠키 httpOnly + secure는 요청 scheme 기준 판정(`backend/app/api/v1/auth.py:123-131`).

---

## 2. 목표 상태

### 2-1. 권장안 — "단일 계정 + 환경 태그 분리, 운영만 신규 리소스"

- AWS 계정: **기존 계정 유지**, VPC를 prod/dev 2개로 분리(서브넷·보안그룹·IAM 역할 별도). 계정 분리는 Phase 3 이후 재검토.
- 컴퓨트(prod): EC2 2대 — ①API+nginx(t4g.small→medium), ②워커+LiveKit+Redis(t4g.medium). dev는 현행 1대 유지.
- RDS(prod): `mindbreeze-prod` 신규 — PostgreSQL 16, db.t4g.small, **Multi-AZ 켜기**, **스토리지 암호화(KMS) 켜기**, 자동백업 14일 + PITR, 삭제방지 켜기, 성능인사이트.
  - 암호화는 **생성 시에만** 설정 가능 → 기존 dev DB 암호화는 스냅샷 암호화 복사 후 교체만 가능. 따라서 prod를 신규로 만들고 데이터를 이관하는 경로가 유일하게 합리적.
- 비밀값: AWS SSM Parameter Store(SecureString) → 배포 시 `.env` 생성 또는 systemd `EnvironmentFile` 렌더. Secrets Manager는 로테이션이 필요한 DB 비밀번호만.
- 도메인: `mindbreeze.looxidlabs.com`(프론트, CloudFront+S3) / `api.mindbreeze.looxidlabs.com`(ALB 또는 nginx). dev는 현행 유지.
- 앱: Android/iOS를 **환경별 빌드 변형**으로 — prod 스토어 빌드는 `.env.prod`, 내부 테스트 빌드는 dev. Firebase 프로젝트도 prod 신규 1개 추가.

개략 비용(서울/도쿄 온디맨드 추정, 월): EC2 t4g.small×1 ≈ \$15 + t4g.medium×1 ≈ \$30 + RDS t4g.small Multi-AZ ≈ \$60 + 스토리지·전송·CloudFront ≈ \$20 → **월 \$120~150 추가**(추정).

### 2-2. 대안 — "운영 1대 집약"

- prod도 EC2 1대(t4g.medium)에 전부, RDS는 Single-AZ 암호화만. 월 \$55~70(추정).
- 득: 비용·운영 단순. 실: 워커 작업이 상담 중 API 지연 유발, AZ 장애 복구 수단이 백업 복원뿐(RTO 수 시간).
- 추천: **동시 상담 20건 미만이면 대안으로 시작, 초과 시 권장안으로 승격.**

---

## 3. 단계별 로드맵

### Phase 0 — 지금 당장(1~2일, 비용 0, 운영 환경 없이도 가능)

| 산출물 | 내용 | 롤백 |
|---|---|---|
| RDS 보호 | dev RDS 삭제방지 켜기, 자동백업 7→14일, 수동 스냅샷 1회 | 설정 되돌리기(무중단) |
| 디스크 확보 | 서버 홈 배포 잔재 tar.gz 정리(69%→목표 50% 미만) | 백업 tar는 S3로 이동 후 삭제 |
| 설정 하드코딩 제거 | `config.py:50,68` 기본값을 `""`로 바꾸고 미설정 시 기동 중단(JWT와 동일 패턴). `useLiveKit.ts:10`·`useMemberLiveKit.ts:20`을 `VITE_LIVEKIT_URL` 참조로 | 기본값 복원 |
| 업로드 실패 엄격화 | `storage_service.py:73`의 prod 조건을 "실자격증명 존재"만으로 완화 → dev에서도 업로드 실패를 숨기지 않음 | 조건 복원 |
| 기본 경보 | CloudWatch 에이전트 설치 + 디스크>80%·메모리>85%·RDS 스토리지<20% 경보(이메일) | 에이전트 제거 |

선행조건: 없음. 이 단계만으로 🔴 중 A2 일부·A6 완화.

### Phase 1 — 운영 환경 신설(1~2주)

- 산출물: prod VPC·보안그룹·IAM 역할, prod RDS(암호화·Multi-AZ·PITR·삭제방지), prod EC2, SSM 비밀값 트리(`/mindbreeze/prod/*`·`/mindbreeze/dev/*`), 도메인·ACM 인증서, `deploy-prod.yml`(수동 승인 게이트 + `workflow_dispatch`).
- 선행조건: Phase 0 완료, D1·D2·D3 결정.
- 롤백: prod는 아직 사용자 미노출 → 리소스 삭제로 완전 롤백.

### Phase 2 — 데이터 이관 + 전환(2~4일, 사용자 영향 있음)

- 절차: ①dev 스냅샷 → ②암호화 복사 → ③prod로 복원(또는 `pg_dump`/`pg_restore`) → ④`alembic upgrade head` 검증 → ⑤읽기전용 공지창(30~60분) → ⑥증분 재덤프 → ⑦DNS 전환 → ⑧dev DB는 비식별 처리 후 개발용으로 재사용.
- 비식별(dev 재사용 시): 이메일·이름·전화 마스킹, 상담 전사·음성·뇌파 Raw는 **삭제**(합성 데이터로 대체). 뇌파+상담 내용은 민감정보라 마스킹만으로는 불충분.
- 롤백: DNS를 dev로 되돌림(전환창 중 쓰기 금지였기에 데이터 분기 없음).

### Phase 3 — 보안·DR 성숙(2~3주, 병행 가능)

- 비밀값 로테이션: JWT 서명키(교체 시 refresh 토큰 전면 무효 → 사전 공지), LLM API 키, LiveKit 키 — 분기 1회.
- 서버 IAM 사용자 키 → **EC2 인스턴스 프로파일(역할)** 전환, S3 정책을 `prod/*` 접두사로 한정.
- 보관기간 정책: 음성 원본 N일, 전사·요약 M년, 뇌파 Raw K일 → cron 스윕에 반영(기존 `sweep_stale_eeg_raw_cron`·`sweep_stale_media_cron` 재활용).
- 접근 감사: 뇌파·전사·리포트 조회에 감사 로그(6개월 보관) — 현재 모델 없음.
- DR 목표 제안: **RPO 15분 / RTO 2시간**(PITR + 문서화된 복구 절차). 분기 1회 복구 훈련(스냅샷→임시 RDS 복원→헬스체크).

### Phase 4 — 확장 분기 기준(수치)

| 신호 | 임계 | 조치 |
|---|---|---|
| API CPU 5분 평균 | >70% | API 인스턴스 1단계 스케일업 |
| 동시 EEG 스트리밍 | >40명 | 워커·LiveKit을 별도 인스턴스로 분리 |
| RPS | >60 (실측 한계 80~100의 70%) | API 2대 + ALB |
| Redis 메모리 | >70% | ElastiCache로 이전 |
| RDS 커넥션 | 최대의 >70% | 인스턴스 승격 또는 PgBouncer |

---

## 4. 위험·함정 (이 코드베이스 특유)

| # | 함정 | 상세 |
|---|---|---|
| F1 | `environment` 기본값 "production"의 양면성 | dev 기능 차단엔 유효(`backend/app/api/v1/__init__.py:43`). 그러나 **운영 안전장치가 이 한 문자열에 묶여 있음** — prod 서버에서 ENVIRONMENT 누락/오타 시 쿠키 secure 판정(`auth.py:97`)과 S3 엄격모드가 동시에 흔들린다. prod 기동 시 `ENVIRONMENT=production` 명시 검증을 lifespan에 추가 권장 |
| F2 | 배포가 서버 `.env.dev`를 **sed로 덮어씀** | `deploy-dev.yml:164,170` — 배포마다 GEMINI 키·ENVIRONMENT를 재기록. prod 워크플로를 복사하면 **운영 서버 환경값이 dev 값으로 오염**된다. prod는 SSM 렌더로 교체 필수 |
| F3 | cron 14개가 `.env` grep 방식 | `deploy-dev.yml:239-269` — 값에 `#`·공백·따옴표가 들어가면 조용히 깨짐. prod는 systemd timer + `EnvironmentFile`로 일원화 권장 |
| F4 | Alembic downgrade 비가역 | `881a08fbe584_...py`, `e036a0000028_...py` — paused→in_progress 변환은 되돌릴 수 없음. prod는 **expand→migrate→contract** 강제: ①컬럼 추가만 배포 ②이중 쓰기·백필 ③구 컬럼 제거는 1릴리스 뒤. `drop_column`/파괴적 UPDATE가 포함된 마이그레이션은 Brian 승인 + 사전 스냅샷 의무 |
| F5 | 쿠키 `samesite="lax"` + 도메인 분리 | `auth.py:128`. 프론트 `mindbreeze…` / API `api.mindbreeze…`는 동일 사이트(eTLD+1 동일)라 Lax로 동작. 단 프론트를 CloudFront 다른 도메인에 두면 쿠키가 조용히 버려짐 → **반드시 동일 상위 도메인 유지** |
| F6 | 앱은 네이티브 헤더로 토큰 수령 | `auth.py:120-122`(`x-mb-native: capacitor` 시 `X-MB-Refresh-Token` 헤더). CORS `expose_headers`에 의존(`main.py:68`) → prod CORS 활성화 시 이 노출 헤더를 빠뜨리면 **앱 자동 로그인 전면 실패** |
| F7 | 스토어 앱의 주소 고정 | A9. prod 전환 전에 앱 빌드 환경 분리를 먼저 해야 하며, 이미 배포된 빌드는 서버 측에서 구제 불가 → **dev-api 도메인을 당분간 유지**(폐기 금지) |
| F8 | S3 접두사 공유 | `prod/` 접두사 사용 여부 미확인(추정). prod IAM 정책을 좁히기 전에 실제 객체 목록 확인 필요. 버킷 자체 분리가 더 안전 |

---

## 5. Brian이 결정할 항목

| # | 결정 | 선택지 | 추천 | 근거 |
|---|---|---|---|---|
| D1 | AWS 계정 분리 | ①단일 계정+VPC 분리 ②계정 2개(Organizations) | **①** | 관리 부담·IAM 복잡도 대비 이득 작음. 실사용자 보호가 급함 |
| D2 | prod 컴퓨트 규모 | ①2대 분리(월 \$120~150) ②1대 집약(월 \$55~70) | **②로 시작** | 현 사용자 규모 미정. §4 Phase 4 임계 도달 시 승격 |
| D3 | prod RDS Multi-AZ | ①켜기(비용 2배) ②끄기 | **①** | 뇌파·상담 데이터 유실 리스크가 월 \$30보다 큼 |
| D4 | dev DB 데이터 처리 | ①비식별 후 개발용 재사용 ②전량 폐기+합성 데이터 | **①** | 재현 가능한 실데이터 패턴이 디버깅에 유용. 단 음성·전사·뇌파 Raw는 삭제 |
| D5 | 전환 다운타임 | ①30~60분 읽기전용 창 ②무중단(이중 쓰기, 개발 2주+) | **①** | 사용자 수 적고 상담 예약 시간 회피 가능 |
| D6 | RPO/RTO 목표 | ①RPO 15분/RTO 2시간 ②RPO 24시간/RTO 1일 | **①** | PITR만 켜면 추가 비용 거의 없음 |
| D7 | 보관기간 수치 | 음성 원본 / 전사·요약 / 뇌파 Raw 각각 며칠·몇 년 | 제안: 음성 90일, 전사·요약 3년, 뇌파 Raw 180일 | 개인정보보호법상 목적 달성 후 지체없는 파기 원칙 + 상담 연속성 |
| D8 | Firebase·푸시 환경 분리 | ①prod 프로젝트 신설 ②dev 공유 유지 | **①** | 현재 dev 1개 공유 → 개발 중 테스트 푸시가 실사용자에게 발송될 수 있음 |
| D9 | dev-api 도메인 존속 | ①무기한 유지 ②6개월 후 폐기 | **①** | F7 — 구 앱 빌드가 이 주소에 고정 |
| D10 | 파괴적 마이그레이션 승인 게이트 | ①Brian 승인 의무 ②에이전트 자율 | **①** | F4 — 비가역 데이터 손실 사례가 이미 저장소에 존재 |

---

## 6. 에이전트가 알아서 처리할 기술 사항 (결정 불필요)

- `config.py` 기본값 제거 + 기동 시 필수 환경변수 검증, `main.py` CORS 허용목록을 환경변수 기반으로 전환.
- `useLiveKit.ts`·`useMemberLiveKit.ts` 하드코딩 → `VITE_LIVEKIT_URL` 참조.
- SSM 파라미터 트리 설계·배포 시 `.env` 렌더 스크립트, cron → systemd timer 전환.
- `/health`를 DB·Redis 점검 포함 깊은 헬스체크로 분리(`/health` 유지 + `/health/ready` 추가, `main.py:99`).
- 앱 환경별 빌드 변형(Android flavor / iOS scheme) 구성.
- CloudWatch 경보·대시보드, 복구 절차 문서(runbook) 작성.

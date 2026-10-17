# [SDD-210] — Verification (Pre-Implementation, Stage ③ 게이트)

> 구현 **전** 작성. Stage ⑤ 에서 이 체크리스트를 실제로 실행하고 PASS/FAIL·증빙(명령 출력 요약)을 summary.md 에 기록한다. 비밀값·개인정보는 증빙에 싣지 않는다(키 이름·존재 여부·집계만).
> 시나리오 번호 `V-섹션.번호`. 대응 Task 는 plan.md §5.

## 0. 선행 게이트 (구현 착수 조건)
- [ ] V-0.1 Brian 이 Stage ①~③ 승인
- [ ] V-0.2 Brian 결정 B-1(도메인)·B-5(비용) 확정 — 확정 전 AWS 리소스 생성 금지
- [ ] V-0.3 T-0 기준선 기록: 백엔드 pytest 결과(통과/제외 수), 프론트 `tsc -b`·`npm run build` 통과, `alembic heads` = 1개(`e036a0000051`), `deploy-dev` 마지막 성공 SHA
- [ ] V-0.4 컷오버 단계(T-19~)는 V-7(방침 게이트)·V-3~V-6 전부 PASS 후에만 진입

## 1. 인프라 검증 (T-7~T-13)

### 1-A. EC2 / 네트워크
- [ ] V-1.1 `describe-instances`: 타입 t4g.medium, 루트 볼륨 `Encrypted=true`, `MetadataOptions.HttpTokens=required`, 인스턴스 프로필 연결됨
- [ ] V-1.2 인스턴스 메타데이터를 토큰 없이 호출하면 401 (IMDSv2 강제)
- [ ] V-1.3 prod VPC 는 기본 VPC 가 아니며 RDS 서브넷은 퍼블릭 IP 자동할당 없음
- [ ] V-1.4 prod EC2 보안그룹 인바운드 목록 대조: **22·8000·7880·5432 가 0.0.0.0/0 에 없음**. 허용 목록 = 80·443 TCP + LiveKit/TURN 에 필요한 포트(7881 TCP, 3478 UDP/TCP, 5349 TCP, UDP 릴레이 범위)뿐. 목록 외 규칙 0건
- [ ] V-1.5 외부에서 8000·7880·22 포트 접속 시도 → 타임아웃(포트 스캔 또는 `nc -zv`)
- [ ] V-1.6 SSM 관리 인스턴스로 등록되고(`PingStatus=Online`) SSM 세션으로 접속 가능, SSH 키페어 없이 운영 가능
- [ ] V-1.7 EIP 연결 확인, EC2 재시작 후에도 동일 IP
- [ ] V-1.8 서버 `/etc/mindbreeze/prod.env` 권한 0600·소유자 서비스 계정, 파일에 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY` 키 **없음**(키 이름만 확인)
- [ ] V-1.9 서버에서 `aws sts get-caller-identity` 결과가 인스턴스 역할(IAM 사용자 아님)

### 1-B. RDS
- [ ] V-1.10 `StorageEncrypted=true` 이고 KMS 키가 고객 관리형 키(Arn 확인)
- [ ] V-1.11 `BackupRetentionPeriod=14`, `LatestRestorableTime` 이 현재와 5분 이내(PITR 가능)
- [ ] V-1.12 `DeletionProtection=true` — 삭제 시도(`--no-skip-final-snapshot` 없이) 가 거부됨(드라이런 아닌 **리허설용 empty 인스턴스에서 확인**, prod 본체에는 시도하지 않음)
- [ ] V-1.13 `PubliclyAccessible=false`, 보안그룹은 `mb-prod-rds` 단독, 인바운드 = EC2 SG 의 5432 만. 인터넷에서 5432 접속 불가
- [ ] V-1.14 `MultiAZ=false`(D3 확정), 엔진 PostgreSQL 16, `rds.force_ssl=1` 파라미터, 서버 연결이 SSL
- [ ] V-1.15 컷오버 복원 후 복원본이 위 V-1.10~1.14 를 **다시** 충족(복원 시 암호화 설정·SG·삭제방지·백업이 원복되는 함정)
- [ ] V-1.16 dev RDS 는 변경되지 않음(`mindbreeze-dev` 스펙·삭제방지 동일)

### 1-C. S3
- [ ] V-1.17 `mindbreeze-prod`: 퍼블릭 액세스 차단 4종 ON, 기본 암호화 ON, **버저닝 Enabled**, 수명주기 규칙 존재(정책 문서와 일치), CORS 오리진 = 운영 도메인만(dev 도메인 0건)
- [ ] V-1.18 `mindbreeze-prod-releases` 버저닝 Enabled, 퍼블릭 차단
- [ ] V-1.19 버킷 정책: prod 인스턴스 역할/배포 역할만 접근. **dev 서버(IAM 사용자)로 prod 버킷 접근 시 AccessDenied**
- [ ] V-1.20 prod 서버에서 dev 버킷 접근 시 AccessDenied (교차 접근 차단)

### 1-D. 도메인·인증서
- [ ] V-1.21 `mindbreeze.looxidlabs.com`·`api.mindbreeze.looxidlabs.com` A 레코드 = prod EIP, TTL ≤ 60(컷오버 기간)
- [ ] V-1.22 인증서 발급 완료, `openssl s_client` 로 SAN 2개·만료일 > 60일, 자동 갱신 `certbot renew --dry-run` 성공
- [ ] V-1.23 HTTP→HTTPS 리다이렉트, HSTS 등 보안 헤더 dev 와 동등 이상
- [ ] V-1.24 기존 `dev.`·`dev-api.` 레코드·인증서·Resend 레코드가 변경되지 않음 (Route53 변경 전후 레코드 diff = 추가만)

### 1-E. SSM 비밀값
- [ ] V-1.25 `/mindbreeze/prod/*` 파라미터 전부 `SecureString`(KMS 암호화), 키 이름 목록이 `production_config_problems` 필수 목록·`.env` 키 목록(plan §1-2)과 대응
- [ ] V-1.26 JWT·LiveKit·VAPID 값이 dev 와 **다름**(해시 비교로만 확인, 값 출력 금지)
- [ ] V-1.27 `RESEARCH_ID_KEY_V1` 존재 + 오프라인 백업 완료 Brian 확인
- [ ] V-1.28 GitHub Secrets 에 prod 비밀값 0개 (이름 목록 확인)
- [ ] V-1.29 배포 로그·GitHub Actions 로그·서버 journal 에 비밀값 문자열 0건 (키 접두사 패턴 grep)

### 1-F. 모니터링
- [ ] V-1.30 경보 존재: EC2 상태점검·CPU, **디스크 80%·메모리 85%**, RDS CPU·저장공간(20% 미만)·연결수·FreeableMemory; 모두 SNS 로 연결
- [ ] V-1.31 **경보 시험 발화**: 시험 알림 1건이 Telegram 에 실제 도착(알림 경로 end-to-end)
- [ ] V-1.32 외부 업타임 감시가 `/health/ready` 를 1분 주기로 확인, 서비스 중지 시 알림 도착(시험 후 복구)
- [ ] V-1.33 `/health/ready` 가 DB·Redis 불가 시 503 (프로세스만 살아있다고 정상 응답하지 않음) — 리허설 서버에서 Redis 중지로 확인
- [ ] V-1.34 journald 상한·logrotate 적용, 디스크 사용 증가 추세 확인

### 1-G. 비용
- [ ] V-1.35 생성 리소스 전부 태그(`project=mindbreeze,env=prod`), 컷오버 후 7일 비용 실측이 plan §7 추정 범위(월 환산 $85~95)에서 크게 벗어나지 않음(±30%) — 벗어나면 원인 보고

## 2. 환경 격리 (dev 값이 prod 에 0건)

- [ ] V-2.1 릴리스 산출물(`dist` 전체 + 백엔드 소스)에서 `dev-api` · `dev\.mindbreeze` · `mindbreeze-dev` · `18\.183\.86\.88` 검색 → 허용 목록(테스트·`vite.config.ts` 개발 프록시) 외 **0건**. CI 게이트로 자동화되어 있고 **의도적으로 dev 주소를 넣은 시험 빌드가 실패**함(게이트 유효성)
- [ ] V-2.2 프론트 prod 산출물에 역할 시뮬레이션 패널 코드·`VITE_ENABLE_ROLE_SIM` 참조 없음, `VITE_USE_MOCK_EEG` 미설정
- [ ] V-2.3 prod 서버 `GET /api/v1/dev/auth/users` · `POST /api/v1/dev/auth/login` → **404** (`environment=production` 이라 라우터 미포함)
- [ ] V-2.4 prod 서버 환경 키 목록에 `ENABLE_DEV_ROLE_SIMULATION` 이 없거나 `false`, `ENVIRONMENT=production`(명시), `DEBUG=false`
- [ ] V-2.5 `production_config_problems` 확장 단위 테스트: 다음 각각 입력에서 **기동 중단** — `s3_bucket=mindbreeze-dev`, CORS 에 dev 도메인, `resend_from_email` 에 DEV, `livekit_host=ws://localhost…`/`devkey`, `fcm_project_id` 미설정(푸시 사용 시), `aws_access_key_id` 비어있지 않음, `research_id_key_v1` 비어있음, `ENVIRONMENT` 미명시. 정상 prod 값은 통과
- [ ] V-2.6 prod 서버 CORS: `Origin: https://mindbreeze.looxidlabs.com` 허용 + `X-MB-Refresh-Token` 노출 헤더 확인, `Origin: https://dev.mindbreeze.looxidlabs.com` 은 **차단**, Socket.IO 도 동일(`*` 아님), 앱 WebView 오리진(`capacitor://localhost`, `https://localhost`) 허용 정책 확인
- [ ] V-2.7 메일 시험(본인 주소): 링크 호스트 = `mindbreeze.looxidlabs.com`, 발신 = 운영 발신 주소, 리포트 열람 링크가 prod 로 열림
- [ ] V-2.8 prod 업로드 객체가 `mindbreeze-prod` 에만 생성되고 `mindbreeze-dev` 에는 0건 (업로드 후 양쪽 목록 비교)
- [ ] V-2.9 prod 서버 `livekit.yaml` `node_ip`·coturn `external-ip` = prod EIP, `realm` = 운영 도메인; dev IP(18.183.86.88) 0건
- [ ] V-2.10 dev 서버는 컷오버 후에도 `ENVIRONMENT=development` 이고 **어떤 prod 비밀값·prod 버킷 권한도 없음**
- [ ] V-2.11 앱 prod 빌드(`cap:android:prod`/`cap:ios:prod`) 산출물에서 V-2.1 동일 검사 0건, `google-services.json`/`GoogleService-Info.plist` 가 운영 Firebase 프로젝트를 가리킴(B-3 완료 시), prod 빌드에서 Firebase 설정 누락 시 빌드 실패
- [ ] V-2.12 저장소에 추적된 과거 번들(`frontend/ios/App/App/public/assets/*`, `frontend/android/app/src/main/assets/public/assets/*`)의 dev 주소가 정리됨(또는 검사에서 제외된 이유 문서화)
- [ ] V-2.13 모드 없는 `cap:ios`·`cap:android` 로 prod 빌드가 만들어질 수 없음(스크립트 제거/실패 처리)

## 3. 배포·롤백 리허설 (T-4~T-5, T-15~T-16)

### 3-A. 승인 게이트
- [ ] V-3.1 `deploy-prod` 실행 시 `production` 환경 승인 대기에서 멈춤 — Brian 승인 전 서버 변경 0건(서버 `current` 링크·서비스 상태 불변)
- [ ] V-3.2 Brian 이 아닌 사용자/에이전트가 승인할 수 없음(필수 승인자=Brian, 본인 승인 방지 설정 확인). 승인 없이 OIDC 역할을 맡으려는 시도(다른 워크플로·브랜치) → 실패
- [ ] V-3.3 `deploy-dev` 에는 prod 접근 권한 없음(워크플로 권한·역할 신뢰 조건 점검)
- [ ] V-3.4 승인 입력(릴리스 ID·사유)이 실행 기록에 남음, 동시 실행 시 두 번째는 대기/거부(직렬화)

### 3-B. build-once
- [ ] V-3.5 같은 릴리스 ID 를 staging(리허설)과 prod 에 배포했을 때 서버의 산출물 체크섬이 **동일**
- [ ] V-3.6 체크섬 불일치 산출물은 설치 단계에서 거부됨(변조 시험)
- [ ] V-3.7 prod 배포는 서버에서 **재빌드하지 않음**(프론트 `npm`·백엔드 의존성 외 소스 빌드 없음), 서버 `.env` 를 sed 로 수정하는 단계 **없음**
- [ ] V-3.8 파괴적 마이그레이션(`drop_`·파괴적 UPDATE/DELETE) 포함 릴리스는 릴리스 노트에 경고가 붙고 별도 확인 입력 없이는 배포 안 됨(시험 마이그레이션 포함 릴리스로 확인)

### 3-C. 배포 동작
- [ ] V-3.9 빈 DB(`mindbreeze-prod-empty`)에 `alembic upgrade head` 가 85개 체인을 오류 없이 적용, 소요 시간 기록, `alembic current` = `e036a0000051`(또는 릴리스 후보 head)
- [ ] V-3.10 배포 중 새 릴리스 디렉터리 준비 → 링크 원자 전환 → 서비스 재시작 → `/health/ready` 200 → 공개 스모크 → 관찰(≥N분) 후에만 "성공" 표시
- [ ] V-3.11 14개 주기 작업이 timer 로 등록되어 `list-timers` 에 14개, 각 서비스가 `flock` 중복 실행을 막음(동시에 2회 시작 시 1회만 실행), 실패 시 알림
- [ ] V-3.12 `ENVIRONMENT=production` 첫 기동 경로 확인: 쿠키 `Secure`·`SameSite=Lax`, 업로드 실패 시 로컬 폴백 없이 오류, 로그인→세션→업로드→리포트 end-to-end 성공
- [ ] V-3.13 의도적 실패 배포(헬스 실패 주입)에서 **자동으로 직전 릴리스 복귀** + 서비스 정상 + 실패 알림

### 3-D. 롤백
- [ ] V-3.14 릴리스 A→B 배포 후 `rollback-prod` 로 A 복귀: 링크·systemd 유닛·timer 정의·프론트 모두 A 상태, 소요 ≤ 2분, 공개 스모크 통과
- [ ] V-3.15 롤백은 Brian 승인 게이트를 거치되(`production` 환경) 긴급 시 절차(승인 대기 시간 목표)가 런북에 명시
- [ ] V-3.16 마이그레이션이 포함된 B 에서 A 로 롤백 시 **DB 를 자동으로 되돌리지 않으며**, 호환 스키마 원칙(expand 전용 릴리스)이면 A 코드가 정상 동작함을 확인(호환 안 되는 변경은 롤백 불가로 표시)
- [ ] V-3.17 롤백 후 `rollback-prod` 이력이 릴리스 노트/기록에 남음

## 4. 컷오버 리허설 (T-17) — 복제본으로 실제와 동일 절차

- [ ] V-4.1 dev 스냅샷 → **암호화 사본** → 임시 RDS 복원 성공, 복원본 `StorageEncrypted=true`
- [ ] V-4.2 복원본 `alembic current` = `e036a0000051`, 앱이 복원본에 연결되어 `/health/ready` 200
- [ ] V-4.3 복원본에서 `auth_provider='dev'` 계정 3개 비활성(로그인 불가 확인), 역할 시뮬레이션 라우터 부재(V-2.3)
- [ ] V-4.4 `refresh_tokens`·기기 토큰 정리 후 기존 refresh 토큰으로 갱신 시 실패, 새 로그인으로 정상
- [ ] V-4.5 S3 sync 후 객체 수·총 바이트 일치, 무작위 샘플 10건 다운로드 성공 + 체크섬(ETag/크기) 일치, DB 의 객체 키가 prod 버킷에서 모두 해석됨(키 누락 0건 — DB 의 키 목록 대 S3 목록 대조)
- [ ] V-4.6 리허설 중 점검 모드(503) 전환·해제 시간 측정, 전체 소요 시간 실측이 **60분 이내** (초과 시 단계별 병목 보고 후 점검창 재산정)
- [ ] V-4.7 알림 이중 발송 방지 시험: dev 워커/timer 가 중지된 상태에서만 prod timer 가 켜지는 순서를 리허설에서 지키고, 두 환경이 **동시에** `notification_outbox` 를 처리한 흔적(같은 건의 이중 발송 로그)이 0건
- [ ] V-4.8 리허설 후 임시 리소스(RDS·S3 접두사) 정리 확인, dev 데이터 불변

## 5. 컷오버 스모크 및 전후 데이터 정합 (T-20, 리허설에서도 동일 항목 사전 수행)

### 5-A. 스모크 (prod 공개 주소)
- [ ] V-5.1 `https://mindbreeze.looxidlabs.com/` 200, `https://api.mindbreeze.looxidlabs.com/health/ready` 200(DB·Redis ok)
- [ ] V-5.2 이메일 계정 로그인 / Google 로그인(운영 도메인 승인 오리진) 성공, 로그아웃 후 재로그인
- [ ] V-5.3 상담사: 클래스(세션) 생성 → 4자리 입장 코드 → 참가자 입장
- [ ] V-5.4 실시간 EEG 스트림 연결(밴드 없음 경로 포함) — WebSocket 이 운영 오리진에서 성립
- [ ] V-5.5 화상: LiveKit 시그널링(`/livekit`) 연결 + TURN 경유 연결(방화벽 환경 모사) 성공
- [ ] V-5.6 음성 업로드 → STT/요약 → 리포트 생성 완료, 리포트 열람 링크(메일 → 열람) 성공
- [ ] V-5.7 메일: 본인 주소로 초대/리포트 메일 수신, 링크·발신이 운영 값(V-2.7)
- [ ] V-5.8 푸시: B-3 완료 시에만 실기기 1건 수신, 미완료면 "푸시 비활성"이 의도된 상태임을 기록
- [ ] V-5.9 지원 브라우저 외(Safari/Firefox) 밴드 연결 안내 표시 유지
- [ ] V-5.10 Brian 본인이 prod 에서 `platform_admin` 로 로그인해 관리자 화면 접근 성공(관리자 접근 확보 확인)

### 5-B. 전후 데이터 정합 (컷오버 직전 dev 집계 vs 직후 prod 집계, 파일로 보존)
- [ ] V-5.11 테이블별 행 수 일치(전 63 테이블): 특히 users(18 → 정리 3 비활성 제외 활성 15 확인)·sessions(134)·session_records(74)·reports(146)·eeg_feature_windows(46,131)·eeg_raw_chunks·video_chunks·audio_chunks·notifications·notification_outbox 미발송 건수
- [ ] V-5.12 핵심 합계/체크섬: 세션 상태별 건수, 리포트 건수, 클래스 코드 유일성 제약 위반 0건, 외래키 고아 행 0건
- [ ] V-5.13 S3: 객체 수 2,873(점검 시점 최종분 기준) 및 총 바이트 일치, `_server-archive-*` 미복사 확인
- [ ] V-5.14 구(6자리) 코드 보유 진행/예정 세션의 입장 동작이 정책대로(T-1 집계 결과에 맞춰 정의)
- [ ] V-5.15 컷오버 후 신규 가입·세션이 prod DB 에만 쌓이고 dev DB 행 수는 컷오버 직전 값에서 **증가하지 않음**(dev 쓰기 차단 확인)

### 5-C. 컷오버 롤백 가능성
- [ ] V-5.16 DNS 전환 전 단계 롤백 리허설: 점검 해제 + dev 워커/cron 재가동만으로 dev 가 정상 복귀(리허설에서 1회 실제 수행)
- [ ] V-5.17 점검 해제 이후에는 단순 복귀 금지 규칙이 런북 첫 장에 명시되어 있고, 해당 시점 이후 복귀가 필요할 때의 승인 절차가 기재됨

## 6. 복구 훈련 (T-18, 컷오버 전 1회)

- [ ] V-6.1 prod RDS PITR 로 임시 인스턴스 복원(복원 시점 = 현재−15분 이내) → 암호화·SG 확인 → `/health/ready` 가 가리키는 임시 앱(또는 psql 접속)으로 행 수 확인 → 삭제
- [ ] V-6.2 전체 소요를 측정해 RTO 2시간 이내 가능함을 문서화, RPO 15분(마지막 복원 가능 시각 격차 ≤ 15분) 확인
- [ ] V-6.3 수동 스냅샷 → 암호화 복사 → 복원 절차도 1회 수행 (삭제 사고·리전 이슈 대비)
- [ ] V-6.4 서버 전체 손실 시나리오: 새 인스턴스를 T-3 템플릿 + SSM 비밀값 + 릴리스 산출물로 재구성해 `/health/ready` 200 까지 걸리는 시간 측정(≤ 2시간 목표). 저장소에 없는 서버 전용 설정(livekit·coturn·nginx)이 템플릿으로 재현됨을 확인
- [ ] V-6.5 연구 가명 키 백업 복구 확인(백업 위치에서 읽어 서버 비밀값과 일치 — 해시 비교)

## 7. 개인정보처리방침 게이트 (N-6)

- [ ] V-7.1 방침에 다음 4가지가 포함되어 **게시**됨: ① 기록(원본) N일 후 삭제 ② 연구 활용 동의 ③ 무기한 보관(대상·범위) ④ 재식별 위험 안내 — 문구 승인자 = Brian
- [ ] V-7.2 방침 게시 위치(회원가입 동의 UI `ConsentCheckList`, 방침 페이지) 에서 prod 빌드가 새 문구를 표시, 동의 버전/시각이 기록됨
- [ ] V-7.3 SDD-209 의 `RETENTION_SWEEP_ENABLED`·`RESEARCH_EXPORT_ENABLED` 가 prod 에서 **false** (키 존재/값 확인) — 방침 반영 + 별도 승인 전 활성화 금지
- [ ] V-7.4 이 항목 PASS 증빙(게시 URL·캡처)이 없으면 컷오버 승인 요청 자체를 하지 않음

## 8. 보안 점검

- [ ] V-8.1 외부 스캔: 열린 포트가 V-1.4 허용 목록과 정확히 일치
- [ ] V-8.2 TLS: 최소 TLS 1.2, 약한 암호군 비활성
- [ ] V-8.3 IAM 최소 권한: 인스턴스 역할은 prod 버킷·SSM 경로·CloudWatch·(DNS-01 사용 시) 해당 존 TXT 변경 외 권한 없음; 배포 역할은 해당 인스턴스 SSM 명령·릴리스 버킷만. `*:*` 정책 0건
- [ ] V-8.4 prod 서버에 장기 AWS 액세스 키·SSH 개인키 파일·`.env.dev` 잔재 없음
- [ ] V-8.5 로그에 개인정보 바인드 파라미터(SQL echo)·입장 코드 노출 없음(`DEBUG=false`, log_redaction 적용)
- [ ] V-8.6 `/health/ready` 오류 응답에 내부 상세(예외 문자열·호스트명) 미노출
- [ ] V-8.7 prod 관리자(platform_admin) 계정 비밀번호 정책·2차 인증 상태 점검 결과 보고(없으면 후속 과제로 기록)
- [ ] V-8.8 공개 저장소에 prod 값·SSM 경로 외 비밀이 커밋되지 않음(커밋 diff 에서 키 패턴·토큰 접두사 스캔)

## 9. Edge Cases

- [ ] V-9.1 컷오버 중 `in_progress` 세션이 1건이라도 있으면 점검 진입 거부 또는 연기 규칙이 있고, 예정 세션의 사전 알림이 점검 시간대에 걸쳐 있을 때 처리(보류 후 prod 에서 발송 or 누락 방지) 확인
- [ ] V-9.2 DNS 캐시: TTL 60 이지만 일부 사용자는 이전 주소 유지 → dev 점검/안내 페이지가 새 주소를 보여줌(V-5.15 와 함께)
- [ ] V-9.3 인증서 발급 실패 시 대비(HTTP-01↔DNS-01 대체)가 리허설에서 한 번 시도됨
- [ ] V-9.4 EC2 재부팅 후 모든 유닛(backend·워커 3·livekit·coturn·nginx·redis)·timer 자동 기동, `current` 링크 유지
- [ ] V-9.5 디스크 80% 경보 시험(임시 파일로 사용률 상승) → 알림 도착 후 정리
- [ ] V-9.6 SSM 파라미터 값 변경 → `render-env` + 서비스 재시작으로 반영, 구 값이 서버에 남지 않음
- [ ] V-9.7 앱 구버전(dev 빌드)이 `dev-api` 로 계속 통신 가능(D11) — 컷오버 후 dev 환경 응답 확인, 단 **운영 데이터와 분리**됨을 사용자 공지/앱 안내로 명시
- [ ] V-9.8 같은 이메일로 dev 와 prod 에 모두 로그인 시도 시 데이터가 섞이지 않음(prod JWT 로 dev API 접근 불가 — 키 상이)

## 10. 완료 기준 (Stage ⑤→⑥)
- 위 항목 전부 PASS 또는 Brian 이 명시적으로 수용한 예외, 증빙은 summary.md 에 기록
- 컷오버 후 48시간 관찰에서 P1/P2 경보 0건(또는 원인·조치 기록)
- T-21(dev 비식별화)은 prod 안정 확인 후 실행, 실행 후 dev 에 실개인정보·음성·전사·뇌파 Raw 0건 확인(집계로만)

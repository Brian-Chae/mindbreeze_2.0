# [SDD-210] 운영(prod) 환경 구축 · 운영 배포 워크플로우 · 컷오버 — Spec

- 작성일: 2026-10-17 / 상태: **Stage ①~③ 작성 완료, Brian 승인 대기** (구현 착수 금지)
- 기준 문서: `docs/개발운영_환경분리_기획.md` v1.2 (Phase 2·3 = 본 SDD), `specs/sdd-197-env-split-phase0/summary.md`, `specs/sdd-209-class-flow-redesign/summary.md`
- 이 SDD의 위치: 기획서 SDD 분할안의 199(환경 주입)·200(prod 인프라)·201(배포 파이프라인)·202(컷오버)를 **하나의 SDD로 묶고 Task로 분해**한다(실사용자가 이미 dev 에 있어 단계별로 쪼개도 사용자 가치가 없고 의존이 강함).
- 표기: `[검증]` 이번에 직접 확인(읽기 전용) / `[추정]` 근거 있는 추정 / `[제안]` 설계 제안 / `[미확인]`

---

## 1. Goal

실사용자를 받고 있는 개발(dev) 서버에서 **운영(prod) 환경으로 서비스를 옮기고**, 이후 운영 반영은 **테스트 통과 산출물 → Brian 승인 → 배포 → 필요 시 롤백**의 정해진 경로로만 하도록 만든다. 야간 점검 1회로 컷오버한다.

## 2. Context

- 지금 dev 가 곧 운영이다. 실사용 계정 15개(+개발용 로그인 계정 3개), 세션 134건(최근 30일 103건), DB 54MB, S3 2,873개·2.4GB `[검증 2026-10-17]`. 규모가 작아 **컷오버 데이터 이관 자체는 쉽다**(핵심 위험은 이관량이 아니라 설정·알림·외부 서비스 도메인 의존).
- Phase 0(SDD-197)이 끝나 즉시 방어(역할 시뮬레이션 차단, RDS 삭제방지·백업 14일, 알림 5종, 헬스체크, 운영 설정 fail-fast)는 반영됨 `[검증]`. 운영 환경 자체는 아직 없다.
- 아키텍처·Phase 로드맵·결정 D3(서버 1대+단일 AZ DB, 암호화·PITR·삭제방지 필수)·D4(운영 최종 게이트=Brian)·D2(야간 30~60분 점검)·D6(앱 구버전 30일)·D7~D14 추천안은 **확정**이며 본 SDD 에서 재논의하지 않는다.
- SDD-209 N-6: **개인정보처리방침 갱신은 운영 배포 전 완료 조건**. SDD-209 의 삭제 스위프(`RETENTION_SWEEP_ENABLED`)·연구 내보내기(`RESEARCH_EXPORT_ENABLED`)는 dev 에서 비활성이며 prod 에서도 **비활성으로 시작**한다.
- 실제 사실: 현재 실사용자가 방침 갱신 없이 dev 를 쓰고 있다 → 컷오버 일정이 방침 갱신 일정에 종속된다(§6 게이트).

## 3. 범위 (In-scope)

### 3-1. 인프라 6종 (AWS 계정 187768779388, ap-northeast-1, 프로파일 looxid-las)
| # | 항목 | 요지 |
|---|---|---|
| I-1 | **EC2** | `mindbreeze-prod` t4g.medium 1대, 암호화 gp3 40GB, IMDSv2 필수, Elastic IP, IAM 인스턴스 역할(서버에 AWS 액세스 키를 두지 않음), 22번 포트 비개방(SSM 세션) |
| I-2 | **RDS** | `mindbreeze-prod` PostgreSQL 16 db.t4g.small **단일 AZ**, **저장소 암호화(KMS)**, 자동백업 14일 + PITR, **삭제방지**, 퍼블릭 접근 없음, SSL 강제, 최종 스냅샷 필수 |
| I-3 | **S3** | `mindbreeze-prod` 단일 버킷(prod 객체 전용): 퍼블릭 차단, 기본 암호화, 버전 관리, 수명주기(음성·영상 90일 삭제 정책과 정합, 뇌파 원본은 무기한 — 저비용 등급 이동은 선택), CORS=운영 오리진만. dev 버킷과 IAM 분리 |
| I-4 | **도메인·인증서** | 운영 `mindbreeze.looxidlabs.com`(웹) · `api.mindbreeze.looxidlabs.com`(API·LiveKit 프록시). Route53 호스티드존 `looxidlabs.com`(같은 AWS 계정) 에 레코드 추가, nginx 에 Let's Encrypt 인증서(dev 와 동일 방식, 자동 갱신) |
| I-5 | **SSM 비밀값** | Parameter Store SecureString `/mindbreeze/prod/*`. 서버는 인스턴스 역할로 읽어 `/etc/mindbreeze/prod.env`(0600) 생성. GitHub Secrets 에는 prod 비밀값을 두지 않는다 |
| I-6 | **모니터링** | CloudWatch 경보(EC2 상태·CPU·디스크·메모리, RDS 저장공간·CPU·연결수), SNS `mindbreeze-alerts` 재사용, Telegram 전달, 외부 업타임 감시, `/health/ready` 사용 |

### 3-2. 환경 주입 분리
- 백엔드: 하드코딩된 dev 주소(CORS 허용 목록·Socket.IO `cors_allowed_origins="*"`·`report_email_base_url`·`frontend_base_url`·`s3_bucket` 기본값)를 **환경 변수 필수 주입**으로 전환하고, `production_config_problems` 를 확장(S3 버킷·CORS·발신 주소·LiveKit·FCM 프로젝트·AWS 키 존재·비어있는 연구 가명 키 등).
- 프론트: 공개 설정(API·LiveKit·소켓·Google 로그인 ID·앱 URL)을 `--mode prod` 빌드 환경 변수로 분리. 산출물에 dev 주소·역할 시뮬레이션 코드가 **0건**임을 검사하는 게이트.
- 서버 설정 파일 이름을 `.env.dev` → 환경별 EnvironmentFile 로 분리하고, **배포가 서버 설정 파일을 덮어쓰지 않는다**(현 `deploy-dev.yml` 의 sed 주입 방식을 prod 에 복제 금지).

### 3-3. 배포 워크플로우
- **build-once 릴리스**: `release-build`(수동/태그) 가 프론트 `dist`·백엔드 소스·마이그레이션·systemd 유닛·timer 정의를 하나의 산출물로 묶어 체크섬과 함께 S3 릴리스 저장소에 보관.
- **`deploy-prod.yml`** (`workflow_dispatch`: 릴리스 ID·사유 입력) — GitHub **environment `production`**, 필수 승인자 = Brian(D4). 승인 후 SSM Run Command 로 서버에 릴리스 설치 → 마이그레이션 → 원자적 전환 → 공개 스모크 → 관찰 → 성공 확정.
- **`rollback-prod.yml`** — 직전(또는 지정) 릴리스로 전환(코드·유닛·timer). DB 는 자동 되돌리지 않는다(§plan 롤백 정책).
- 배포 전 게이트: CI 통과 커밋만, 마이그레이션 head 1개, 파괴적 마이그레이션 감지 시 별도 승인, dev 주소 0건 검사.
- GitHub 인증: OIDC 로 AWS 역할을 맡는다(장기 액세스 키 미사용). 역할은 해당 인스턴스에 대한 SSM 명령·릴리스 버킷 읽기/쓰기만 허용.

### 3-4. cron 이관
- dev 의 cron 14개를 **단일 목록 + systemd timer/service** 로 일원화(공통 환경 주입·중복 실행 잠금·로그 표준화·logrotate). 컷오버 때 실행 주체를 한 번에 전환하여 dev 와 prod 가 같은 알림 대기열을 동시에 처리하지 않게 한다.

### 3-5. 데이터 컷오버 (D2: 야간 점검 1회)
- 점검 모드(쓰기 차단) → dev RDS 스냅샷 → **암호화 사본 생성** → prod RDS 로 복원 → `alembic current` 검증 → S3 객체 복사 → 개발용 로그인 계정 정리 → 외부 서비스 토큰 정리 → 도메인 전환 → 스모크 → 점검 해제.
- 컷오버 후 **dev DB 비식별화**(D9): 음성·전사·뇌파 Raw 삭제, 개인정보 마스킹, 외부 발송 차단, dev 자동배포 재개.
- 롤백 기준과 한계(쓰기 발생 후 단순 복귀 금지)를 런북에 명문화.

### 3-6. 앱 운영 빌드 주소
- Capacitor 앱은 `webDir` 번들 + 빌드 시점 `VITE_API_BASE_URL` 에 고정된다 `[검증]`(`capacitor.config.ts` 에 `server.url` 없음). 운영 앱 빌드는 `npm run cap:{android,ios}:prod`(`--mode prod`) → `frontend/.env.prod` 의 `https://api.mindbreeze.looxidlabs.com/api/v1` 사용 `[검증]`.
- 본 SDD 에서는 **운영 앱 빌드가 운영 주소·운영 Firebase 를 가리키고 dev 값이 0건**임을 보장하는 설정·검사까지 포함하고, **스토어 제출·심사는 포함하지 않는다**(Phase 5).

### 3-7. 개인정보처리방침 게이트
- N-6 조건(기록 N일 삭제·연구 동의·무기한 보관·재식별 위험 문구)이 반영·게시된 것을 **컷오버 진행 필수 조건**으로 둔다. 문구 작성·법무 검토는 Brian 담당(결정 B-6), 에이전트는 게시 위치(동의 UI·방침 페이지)와 반영 확인 절차를 맡는다.

## 4. 비범위 (Out-of-scope)

- 코드 구현·AWS 리소스 생성·서버 변경(이번 단계는 **문서만**, 조사는 읽기 전용).
- 스토어 제출·심사, iOS 서명·TestFlight(Phase 5), Android 서명키 관리 변경.
- 무중단 이중 쓰기, 서버 2대 이상 분리, 로드밸런서, Multi-AZ(Phase 6/확장 임계 도달 시).
- Sentry, 열람 감사 로그, 키 정기 로테이션, DR 훈련 정례화(Phase 4 — 단 컷오버 전 **1회 복구 훈련**은 본 SDD 범위, verify §6).
- dev 환경의 로컬 서버 이전(기획서 §7, Phase 3 이후 별도 판단).
- 삭제 스위프·연구 내보내기 **활성화**(SDD-209 후속 별도 승인).
- CI 검사 복구(프론트 기존 실패 16건 정리 등, 기획서 Phase 1) — 단 **운영 배포 게이트에 필요한 최소 검사**(dev 주소 0건, 마이그레이션 head 1개)는 본 SDD 에서 추가.
- 서비스 기능 변경, 디자인 변경.

## 5. Acceptance Criteria

- [ ] 운영 인프라 6종이 Brian 승인된 사양대로 존재하고 verify.md §1 을 전부 통과
- [ ] prod 서버·빌드 산출물·SSM 설정에 dev 도메인·dev 자격증명·역할 시뮬레이션이 0건 (verify §2)
- [ ] `deploy-prod` 가 Brian 승인 없이는 실행되지 않고, 승인 후 같은 산출물로 배포·스모크·관찰까지 자동 수행 (verify §3)
- [ ] `rollback-prod` 가 리허설에서 2분 이내 코드 복귀 + 공개 스모크 통과 (verify §3)
- [ ] 컷오버 리허설(스냅샷 복원본)에서 행 수·합계·S3 객체 수가 일치하고 스모크 통과 (verify §4~5)
- [ ] 복구 훈련(PITR 복원 → 헬스체크)을 컷오버 전 1회 수행해 RPO 15분/RTO 2시간 내 확인 (verify §6)
- [ ] N-6(개인정보처리방침) 게시 확인 후에만 컷오버 승인 요청 (verify §7)
- [ ] 컷오버 후 dev 에서 외부 발송(메일·푸시)이 불가능하고, 같은 알림이 두 환경에서 발송되지 않음

## 6. Dependencies

| 의존 | 상태 |
|---|---|
| AWS 권한 | `brian.chae` ← 그룹 `developer`(AdministratorAccess) `[검증]`. 정책 시뮬레이션에서 EC2·RDS·S3·SSM·IAM·Route53·ACM·CloudWatch·SNS·KMS 생성 권한 허용 확인 — **블로커 아님** |
| DNS | `looxidlabs.com` 호스티드존이 같은 AWS 계정 Route53 에 있음 `[검증]` — 자체 변경 가능, **블로커 아님** |
| GitHub 환경 승인 | 저장소 `Brian-Chae/mindbreeze_2.0` 은 개인 계정 소유 **공개(public)** 저장소 `[검증]` → 필수 승인자 설정 가능(공개 저장소는 무료 요금제에서도 제공). 환경 `production` 은 아직 없음 `[검증]` |
| Resend | `mindbreeze.looxidlabs.com` 용 DKIM·SPF(send.) DNS 레코드는 이미 존재 `[검증]`. Resend 콘솔 내 도메인 인증 상태는 **[미확인]**(API 키 없이 확인 불가 — 구현 Task 에서 확인) |
| Google 로그인 | 웹 클라이언트 ID 재사용 + 운영 도메인을 승인된 오리진에 추가(Google Cloud 콘솔 작업) `[추정]` |
| Firebase | 현재 단일 프로젝트(`mind-breeze`)에 dev/prod 패키지 모두 등록 `[검증]` → 운영 전용 프로젝트 신설(D10) 필요. 신설은 Brian 계정 작업 |
| 개인정보처리방침 | N-6 문구 — Brian 담당 |
| SDD-209 | dev 배포 완료(마이그레이션 `e036a0000051`) `[검증]` |

## 7. Risks (요약 — 상세는 plan.md §8)

| 위험 | 대응 |
|---|---|
| 컷오버 중 알림이 두 환경에서 이중 발송 | 실행 주체 전환 순서 고정 + dev 외부 발송 차단 + 대기열 이관 확인 |
| 도메인 전환 후 CORS/쿠키/LiveKit 이 dev 주소를 계속 가리킴 | 환경 주입 필수화 + prod 빌드 0건 검사 + 스모크에 CORS·WebSocket·화상 포함 |
| 개발용 로그인 계정이 prod 로 복사되어 우회로 남음 | 복원 직후 `auth_provider='dev'` 계정 정리 + 역할 시뮬레이션 라우터 부재 확인 |
| 컷오버 후 쓰기가 생긴 뒤 dev 로 단순 복귀하여 데이터 분기 | 복귀 가능 시점 명시(점검 해제 전까지만), 이후는 수정 배포/PITR |
| 방침 갱신 지연으로 컷오버 지연 | Brian 결정 B-6 로 일정 고정 |
| 운영 단일 서버 장애 | 경보 + 14일 PITR + 복구 훈련, 확장 임계 모니터링 |

## 8. Brian 결정 필요 항목

→ plan.md §10 (비즈니스 결정만 8개, 각 기본값 포함). 기술 결정은 plan.md §9 에 기본값으로 적용·기록.

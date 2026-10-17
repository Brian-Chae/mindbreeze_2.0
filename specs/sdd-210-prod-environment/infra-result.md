# [SDD-210] Phase B 인프라 생성 결과 (T-7 ~ T-13)

- 실행일: 2026-10-17 (KST) / 계정 187768779388 / 리전 ap-northeast-1 / 프로파일 looxid-las (사용자 brian.chae)
- 스크립트: `deploy/aws/` (전부 멱등 — 재실행 시 존재 확인 후 건너뜀). 식별자 캐시 `deploy/aws/.state/` 는 gitignore.
- 표기: 값(비밀)은 어디에도 기록하지 않음. 이 문서는 식별자·ARN·엔드포인트만 담는다.
- 공통 태그: `project=mindbreeze, env=prod` (전 리소스). 이름 규칙 `mb-prod-*` / `mindbreeze-prod*`.
- dev 리소스(EC2 `i-00fd62ca8876bec8f`, RDS `mindbreeze-dev`, 버킷 `mindbreeze-dev*`, `mindbreeze-dev-sg`)는 **읽기 조회만** 수행, 변경 0건 (§5).

## 1. 생성 리소스

### T-7 네트워크 · KMS · IAM (`t07-network-iam.sh`, 검증 `verify-t07.sh`)
| 리소스 | 식별자 |
|---|---|
| VPC `mb-prod-vpc` (10.20.0.0/16, 기본 VPC 아님) | `vpc-00262cf2ea601b3b5` |
| 서브넷 퍼블릭 1c `mb-prod-public-1c` (10.20.0.0/24) | `subnet-0ff6bf40dceb54b13` |
| 서브넷 사설 1c `mb-prod-private-1c` (10.20.10.0/24) | `subnet-0ec6f48e617136776` |
| 서브넷 사설 1a `mb-prod-private-1a` (10.20.11.0/24) | `subnet-035276b082e360b32` |
| IGW `mb-prod-igw` | `igw-0df1551c459cc62cf` |
| 라우트 테이블 퍼블릭 / 사설(기본경로 없음) | `rtb-000ff367c8e8d4494` / `rtb-0f214c66d6a5de372` |
| SG `mb-prod-ec2` | `sg-0a80ad0025eda1b31` |
| SG `mb-prod-rds` | `sg-0bfde585138899b64` |
| KMS 고객 관리형 키 `alias/mindbreeze-prod` (자동 회전 ON) | `f840f2d5-0b7e-437d-ba61-66a00ba68ce8` (`arn:aws:kms:ap-northeast-1:187768779388:key/f840f2d5-0b7e-437d-ba61-66a00ba68ce8`) |
| IAM 역할 `mb-prod-ec2-role` + 프로필 `mb-prod-ec2-profile` | `arn:aws:iam::187768779388:role/mb-prod-ec2-role` |
| IAM 역할 `mb-prod-github-deploy` | `arn:aws:iam::187768779388:role/mb-prod-github-deploy` |
| GitHub OIDC 공급자 | `arn:aws:iam::187768779388:oidc-provider/token.actions.githubusercontent.com` — **계정에 이미 존재하던 공용 공급자를 재사용(수정 안 함)** |

- `mb-prod-ec2` 인바운드(전부 0.0.0.0/0): TCP 80, 443, 7881, 3478, 5349 / UDP 3478, 49152–49200. **22·8000·7880·5432 없음**.
- `mb-prod-rds` 인바운드: TCP 5432, 출처 = `sg-0a80ad0025eda1b31`(EC2 SG) 단 1건.
- 배포 역할 신뢰 정책 조건: `aud=sts.amazonaws.com` AND `sub=repo:Brian-Chae/mindbreeze_2.0:environment:production` (정확 일치 `StringEquals`, 와일드카드 없음).
- 배포 역할 권한: SSM SendCommand(태그 `env=prod,project=mindbreeze` 인스턴스 + `AWS-RunShellScript` 문서), 명령 결과 조회, `ec2:DescribeInstances`, `mindbreeze-prod-releases` 객체 읽기/쓰기·목록. `Action:"*"` 없음.
- EC2 역할 권한: prod 버킷 객체, releases 읽기, `/mindbreeze/prod*` SSM 읽기, KMS Decrypt(해당 키만), certbot DNS-01 용 Route53 TXT(`_acme-challenge.*mindbreeze.looxidlabs.com` 한정, 해당 호스티드존 한정), 관리형 `AmazonSSMManagedInstanceCore`·`CloudWatchAgentServerPolicy`.

### T-8 S3 (`t08-s3.sh`, `verify-t08.sh`)
| 버킷 | 설정 |
|---|---|
| `mindbreeze-prod` (`arn:aws:s3:::mindbreeze-prod`) | 퍼블릭 차단 4종 ON · AES256+BucketKey · 버저닝 Enabled · CORS = `https://mindbreeze.looxidlabs.com` 단독 · 수명주기 3규칙 · 버킷 정책(TLS 강제, 객체 접근은 prod 역할+brian.chae 외 명시 거부) |
| `mindbreeze-prod-releases` (`arn:aws:s3:::mindbreeze-prod-releases`) | 퍼블릭 차단 4종 ON · AES256 · 버저닝 Enabled · 수명주기(구버전 180일) · 정책(prod 역할·배포 역할만) |

### T-9 RDS (`t09-rds.sh`, `verify-t09.sh`)
| 리소스 | 식별자 |
|---|---|
| 인스턴스 `mindbreeze-prod-empty` (리허설용 빈 DB) | `arn:aws:rds:ap-northeast-1:187768779388:db:mindbreeze-prod-empty` |
| 엔드포인트 | `mindbreeze-prod-empty.cqiucz9c6j63.ap-northeast-1.rds.amazonaws.com:5432` (사설 IP 10.20.10.117) |
| 서브넷 그룹 / 파라미터 그룹 | `mb-prod-db-subnets` (사설 1c·1a) / `mb-prod-pg16` (`rds.force_ssl=1`) |
- 실제 `mindbreeze-prod` 는 만들지 않음(컷오버 C-2 에서 암호화 스냅샷 복원). 마스터 계정/비밀번호는 SSM(`DB_USER`·`DB_PASSWORD`)에만 있음.

### T-10 EC2 (`t10-ec2.sh`, `userdata-base.sh`, `verify-t10.sh`, `verify-t10-server.sh`)
| 리소스 | 식별자 |
|---|---|
| 인스턴스 `mindbreeze-prod` | `i-0487c67fb0db7dcba` (t4g.medium, Ubuntu 24.04 arm64 AMI `ami-0f7bc6bc412bef0ae`, 사설 IP 10.20.0.87) |
| 루트 볼륨 | `vol-03dfa1be9a9522c45` (gp3 40GB, 암호화) |
| Elastic IP `mb-prod-eip` | `eipalloc-0cd68b66fc9e19493` / `13.193.100.27` |
- 키페어 없음, API 종료 방지 ON. userdata 는 기본 패키지만 설치(nginx 는 설치 후 **비활성**, redis 활성, certbot+route53 플러그인, python3-venv, libpq-dev, cairo/pango, 한글 폰트). 서비스·nginx·livekit·coturn 구성은 하지 않음(Phase C).

### T-11 DNS (`t11-dns.sh`, `verify-t11-certbot.sh`)
| 레코드 (looxidlabs.com 존 `Z061081436L4M61L2W9NR`) | 값 |
|---|---|
| `prod-check.mindbreeze.looxidlabs.com` A | 13.193.100.27 (TTL 60) |
| `prod-api-check.mindbreeze.looxidlabs.com` A | 13.193.100.27 (TTL 60) |
- 공개 운영 레코드 `mindbreeze.` / `api.mindbreeze.` 는 **생성하지 않음**(컷오버 T-20).
- 존 전체 레코드 전후 비교: 변경/삭제 0건, 추가 2건(위 2개) — V-1.24 PASS.

### T-12 SSM Parameter Store (`t12-ssm.sh`, `secrets_helper.py`, `verify-t12.sh`)
- `/mindbreeze/prod/*` 34개, **전부 SecureString**, 고객 관리형 키 사용 34/34.
- 신규 난수 생성(값 비노출, boto3 직접 저장): `JWT_SECRET_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`(P-256 키쌍), `RESEARCH_ID_KEY_V1`, `RESEARCH_EXPORT_ACK_TOKEN`, `TURN_STATIC_AUTH_SECRET`, `DB_PASSWORD`.
- 설정값: `ENVIRONMENT=production`, `DEBUG=false`, `ENABLE_DEV_ROLE_SIMULATION=false`, `S3_BUCKET=mindbreeze-prod`, `S3_REGION`, `S3_USE_INSTANCE_ROLE=true`, `CORS_ALLOWED_ORIGINS`(운영 도메인 + 앱 WebView 2종, dev 도메인 없음), `FRONTEND_BASE_URL`, `REPORT_EMAIL_BASE_URL`, `RESEND_FROM_EMAIL`, `LIVEKIT_HOST`, `REDIS_URL`, `VAPID_SUBJECT`, `RETENTION_SWEEP_ENABLED=false`, `RESEARCH_EXPORT_ENABLED=false`, `DB_USER`, `DB_NAME`, `DB_HOST_EMPTY`.
- **자리표시(값 `PLACEHOLDER-FILL-ME`, 채울 사람 필요) 7개**: `RESEND_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GOOGLE_CLIENT_ID`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`.
  - 서버 `render-env`(T-3/T-14)는 이 값을 **미설정으로 취급**해 env 에 쓰지 않아야 한다(특히 FCM 두 개는 둘 다 비면 푸시 비활성으로 허용, 한쪽만 채우면 fail-fast).
  - 채우는 법(Brian): `aws ssm put-parameter --name /mindbreeze/prod/<이름> --type SecureString --key-id alias/mindbreeze-prod --overwrite --value file://<파일>` 처럼 **파일/표준입력**으로 (명령줄 원문·셸 히스토리 노출 금지).
- 미생성(의도): `DATABASE_URL`·`DATABASE_URL_SYNC` — 서버 render-env 가 `DB_HOST[_EMPTY]`+`DB_USER`+`DB_PASSWORD`+`DB_NAME` 으로 조립(컷오버 때 호스트·비밀번호가 바뀜). `AWS_ACCESS_KEY_ID/SECRET`(인스턴스 역할 사용), `GOOGLE_EXTRA_CLIENT_IDS`(선택).

### T-13 모니터링 (`t13-monitoring.sh`, `cloudwatch-agent.json`)
- 경보 13개 (모두 SNS `arn:aws:sns:ap-northeast-1:187768779388:mindbreeze-alerts`, 알림·복구 양쪽):
  - EC2(`i-0487c67fb0db7dcba`): `mb-prod-ec2-status-instance`, `mb-prod-ec2-status-system`(+EC2 자동 복구 액션), `mb-prod-ec2-cpu-high`(>80%/15분), `mb-prod-ec2-mem-high`(>85%), `mb-prod-ec2-disk-high`(>80%, `/`)
  - RDS 4종 × 2인스턴스(`mindbreeze-prod-empty`, 컷오버 후 `mindbreeze-prod` 선생성): CPU>80%, FreeStorageSpace<4GB(20%), 연결수>80, FreeableMemory<200MB
- 로그 그룹 `/mindbreeze/prod/{app,nginx,system}` 보관 90일.

## 2. 사양 검증 결과 (describe-* 실측)

### 인프라 (verify.md §1)
| 항목 | 결과 | 증빙 요약 |
|---|---|---|
| V-1.1 EC2 타입·암호화·IMDSv2·프로필 | PASS | t4g.medium, 볼륨 Encrypted=True, HttpTokens=required, 프로필 `mb-prod-ec2-profile` |
| V-1.2 IMDS 토큰 없이 401 | PASS | 서버 내부 시험: 토큰 없음 401 / 토큰 있음 200 |
| V-1.3 기본 VPC 아님·RDS 서브넷 퍼블릭 IP 자동할당 없음 | PASS | IsDefault=False, 사설 2개 MapPublicIpOnLaunch=False |
| V-1.4 SG 규칙 대조 | PASS | 22·8000·7880·5432 없음, 허용 목록 외 규칙 0건 |
| V-1.5 외부 22/8000/7880 접속 불가 | PASS | 로컬(Mac)에서 `nc` 22·8000·7880·5432 모두 타임아웃. (80/443 은 SG 개방이나 아직 리스너 없음 — Phase C 후 재확인) |
| V-1.6 SSM Online, SSH 키 없이 운영 | PASS | PingStatus=Online, KeyName=None, SSM Run Command 로 모든 서버 시험 수행 |
| V-1.7 EIP 연결·재시작 후 유지 | 부분 | 연결 확인(13.193.100.27). **재시작 후 유지는 미시험** (재부팅 안 함) |
| V-1.8 prod.env 권한/키 없음 | 해당 없음(Phase C) | 파일 미생성 |
| V-1.9 서버 sts = 인스턴스 역할 | PASS | assumed-role `mb-prod-ec2-role` |
| V-1.10 RDS 암호화·CMK | PASS | StorageEncrypted=true, KmsKeyId = 고객 관리형 키 ARN 일치 |
| V-1.11 백업 14일·PITR | PASS(부분) | BackupRetentionPeriod=14, LatestRestorableTime 생성 직후 2분 이내. 지속 5분 이내 여부는 T-18 |
| V-1.12 삭제방지 거부 | PASS | `delete-db-instance`(empty) → "Cannot delete protected DB Instance" (최종 스냅샷 지정, 삭제 안 됨) |
| V-1.13 퍼블릭 false·SG 단독·EC2 SG 5432만 | PASS | PubliclyAccessible=false, SG `sg-0bfde585138899b64` 단독, 인터넷 5432 타임아웃 |
| V-1.14 MultiAZ=false·PG16·force_ssl=1·SSL | PASS | MultiAZ=false, 16.14, `rds.force_ssl=1` (in-sync), EC2→5432 TCP OK + TLS1.3 핸드셰이크 |
| V-1.15 복원본 재충족 | 컷오버 때 확인 | `t09` 옵션을 C-2 복원 시 재적용 |
| V-1.16 dev RDS 불변 | PASS | `mindbreeze-dev` db.t4g.micro·암호화 False·삭제방지 True·백업 14 (생성 전 조사값과 동일, 변경 호출 0건) |
| V-1.17 prod 버킷 | PASS | 퍼블릭차단 4종, AES256, Versioning Enabled, 수명주기 3규칙, CORS=운영 도메인 단독, 정책상 IsPublic=False |
| V-1.18 releases 버킷 | PASS | 버저닝 Enabled, 퍼블릭 차단 |
| V-1.19 dev IAM 사용자의 prod 버킷 접근 거부 | 미시험 | dev 자격증명 사용 금지라 실접속 시험 불가. 버킷 정책 명시 Deny(허용 주체 외) + 허용 정책 없음으로 설계 |
| V-1.20 prod 서버의 dev 버킷 접근 거부 | PASS | 서버에서 `aws s3 ls s3://mindbreeze-dev/` → 거부 |
| V-1.21 A 레코드 = prod EIP, TTL≤60 | 부분 | 임시 호스트 2개만(TTL 60). 공개 레코드는 컷오버 때 |
| V-1.22 인증서 | 부분 | 임시 호스트 2개 SAN 으로 certbot DNS-01 **dry-run 성공**(인스턴스 역할로 TXT 추가·삭제). 실제 발급·만료일·`renew --dry-run` 은 Phase C/컷오버 |
| V-1.23 HTTPS 리다이렉트·보안 헤더 | Phase C | |
| V-1.24 기존 DNS 레코드 불변 | PASS | 존 전체 diff: 변경/삭제 0, 추가 2 |
| V-1.25 SSM 전부 SecureString | PASS | 34/34 SecureString, 34/34 CMK. 서버 역할로 34개 전부 읽기 가능 |
| V-1.26 dev 와 값 다름 | 설계상 보장 | 모두 `secrets.*` 신규 난수. dev 값 열람이 금지라 해시 대조는 하지 않음 |
| V-1.27 RESEARCH_ID_KEY_V1 존재 + 백업 | 존재 PASS / **백업 미완(Brian)** | §4 절차 |
| V-1.28 GitHub Secrets 에 prod 비밀 0개 | 미시험 | 이번에 GitHub 변경 없음 |
| V-1.29 로그에 비밀 0건 | PASS(범위: 이번 실행) | 값을 파일·명령줄·출력 어디에도 사용하지 않음. 비밀 생성은 boto3 직접 호출 |
| V-1.30 경보 존재·SNS 연결 | PASS(CWAgent 2종은 데이터 대기) | 13개 존재, 전부 SNS 연결. mem/disk 는 에이전트 설치(Phase C) 전까지 INSUFFICIENT_DATA |
| V-1.31 경보 시험 발화→Telegram | 미시험 | 공용 토픽이라 실제 알림이 나가므로 보류. 시험 명령: `aws cloudwatch set-alarm-state --alarm-name mb-prod-ec2-cpu-high --state-value ALARM --state-reason test` |
| V-1.32 업타임 감시 | 미생성 | 서비스 기동(T-15) 후 생성해야 상시 오경보가 없음 |
| V-1.33~V-1.34 | Phase C | `/health/ready`·journald/logrotate |
| V-1.35 태그·비용 | 태그 PASS / 실측은 컷오버 후 | |

### 보안 (verify.md §8 일부)
- V-8.3 IAM: 인라인 정책에 `Action:"*"` 0건, 관리형은 SSM Core·CloudWatchAgent 두 개뿐. 배포 역할은 prod 태그 인스턴스·releases 버킷만.
- V-2.9(시작 전 확인): livekit/coturn 설정은 Phase C 에서 EIP `13.193.100.27` 로 렌더.

## 3. 비용 재산정 (월, 도쿄 온디맨드, 요금 API 미조회 `[추정]`)
| 항목 | 월 |
|---|---|
| EC2 t4g.medium | 약 $31 |
| EBS gp3 40GB(암호화) | 약 $4 |
| EIP IPv4 1개 | 약 $4 |
| RDS db.t4g.small 단일 AZ (현재 `-empty` 1대) | 약 $38 |
| RDS gp3 20GB | 약 $3 |
| KMS 키 1개 | $1 (+ 요청 극소) |
| S3 / SSM(Standard) / Route53 레코드 | $1~3 / $0 / $0 |
| CloudWatch 경보 13개($0.10) + 로그 | 약 $2~4 |
| 아웃바운드 전송 | 약 $2~5 |
| **합계** | **약 $86~96** (plan §7 범위 $85~95 와 동일 수준) |
- **주의(중복 기간)**: 컷오버에서 `mindbreeze-prod` 가 생기면 `-empty` 와 동시에 RDS 2대($41×2) 상태가 된다. 안정 확인 후 `-empty` 삭제(삭제방지 해제 필요)까지 약 +$41/월 비례.
- 신규 일회성: 없음(NAT 게이트웨이·로드밸런서·Secrets Manager 미사용).

## 4. 연구 가명 키 오프라인 백업 절차 (Brian 작업)
분실 시 동일인 매핑이 영구 단절되므로 컷오버 전 필수. 키는 화면·셸 변수·히스토리·평문 파일에 나타나지 않는다.
1. Brian 의 맥(AWS 프로파일 `looxid-las`, `gpg` 설치됨)에서 오프라인 매체(USB 등)를 꽂고 실행:
   `deploy/aws/research-key-backup.sh /Volumes/<USB>/mb-research-key-v1.gpg`
   - SSM → 파이프 → `gpg --symmetric --cipher-algo AES256` 로 바로 암호화. **암호구문은 gpg 가 직접 묻는 프롬프트**에 입력(채팅·명령줄에 쓰지 않음).
   - 끝에 **지문 12자**(키의 SHA-256 앞 12자)가 출력된다 — 암호구문과 **다른 곳**(비밀번호 관리자 vs 종이)에 보관.
2. 복원 확인: `deploy/aws/research-key-backup-verify.sh /Volumes/<USB>/mb-research-key-v1.gpg` → "일치 (지문 …)" 이어야 함(키 값은 출력되지 않고 지문만 비교). V-1.27·V-6.5 증빙.
3. USB 는 서버·클라우드와 분리된 장소에 보관(가능하면 사본 2개). 확인 후 에이전트에 "백업 완료"만 알리면 됨.
- 대안: 오프라인 매체 대신 비밀번호 관리자 보안 노트에 저장하려면 `aws ssm get-parameter … --with-decryption --query Parameter.Value --output text | pbcopy` 후 즉시 붙여넣고 `pbcopy < /dev/null` 로 클립보드 삭제(화면 노출은 없으나 USB+gpg 방식이 권장).
- 에이전트는 이 키를 읽거나 출력한 적이 없다(지문 비교도 Brian 이 수행).

## 5. dev 불변 확인
- dev EC2 `i-00fd62ca8876bec8f`: running / t4g.medium / IMDSv2 required (조사 시점과 동일).
- dev RDS `mindbreeze-dev`: 위 V-1.16.
- `mindbreeze-dev-sg`: 인바운드 규칙 11건 (조사 시점과 동일, 수정 호출 없음).
- Route53 dev 레코드·Resend 레코드: 전후 diff 변경 0.
- 이 작업에서 dev 에 대해 호출한 API 는 전부 `describe/get/list` 계열.

## 6. 실패 · 미해결 · 후속
1. **GitHub environment `production` 미생성** — OIDC 신뢰 조건이 이 환경에 묶여 있어 환경(필수 승인자 Brian) 생성 전에는 아무 워크플로도 역할을 못 맡음(의도된 잠금). 생성은 Brian/별도 단계.
2. **외부 키 7개 자리표시** (§1 T-12) — Resend/Gemini/OpenAI/DeepSeek/Google 클라이언트 ID/FCM 2종.
3. **연구 가명 키 오프라인 백업 미완** (§4, Brian).
4. **LiveKit UDP 미디어 포트 미개방**: dev 와 동일하게 TCP 7881 + TURN(3478/5349/49152–49200 UDP)만 열었음. `livekit.yaml` 확정(T-3/T-14) 결과 UDP RTC 포트가 필요하면 `mb-prod-ec2` 에 추가.
5. **S3 수명주기에 기간 삭제 규칙을 넣지 않음**(plan/spec 의 "90일 삭제 정합"과 차이): 보관·삭제는 앱 `retention_sweep`(연구 게이트·DB 행 정합)가 담당하고 아직 비활성이라, S3 가 먼저 지우면 DB 행이 고아가 되고 연구 보류 대상이 유실됨. 현재 규칙은 멀티파트 7일 정리·구버전 30일(prod)/180일(releases)·삭제 마커 정리. 변경하려면 Brian 결정.
6. **CWAgent(메모리·디스크) 미설치** — 경보는 있으나 `deploy/aws/cloudwatch-agent.json` 적용은 서버 구성(Phase C T-14). 업타임 감시(V-1.32)는 T-15 이후 생성. 경보 시험 발화(V-1.31)·EIP 재부팅 유지(V-1.7)·certbot 실발급 미시험.
7. `LIVEKIT_HOST` 값 `wss://api.mindbreeze.looxidlabs.com/livekit` 은 fail-fast 통과용 잠정값 — Phase C 에서 nginx 경로와 실제 서버 SDK 접속 방식을 확인해 조정.
8. certbot dry-run 때 서버에 Let's Encrypt 스테이징 계정 디렉터리가 생김(`/etc/letsencrypt/accounts`) — 무해, 설정 파일은 삭제함.
9. 공용 SNS `mindbreeze-alerts` 를 dev 와 같이 사용 — 알림 문구로 `mb-prod-` 접두사로 구분.
10. 사전 조사 상 `gpg` 첫 실행으로 맥에 `~/.gnupg` 디렉터리가 생성됨(더미 테스트, 키 없음).

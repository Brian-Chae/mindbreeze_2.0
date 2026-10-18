# [SDD-210] Phase C 후반 리허설 결과 (T-15 ~ T-18) · 컷오버 준비 상태

- 실행일: 2026-10-18 (KST) · 계정 187768779388 / ap-northeast-1 · 운영 EC2 `i-0487c67fb0db7dcba`(임시 호스트 `prod-check`/`prod-api-check`)
- 표기: 값(비밀)은 기록하지 않음. 실제 컷오버(T-19 공지, T-20 점검·데이터 전환·DNS 공개)는 **수행하지 않음**.
- dev 서버·dev DB·dev 버킷은 읽기 + 스냅샷 생성만. MIND BREEZE 1.0(Firebase `mind-breeze`, 1.0 서버/DB/S3/OAuth)은 접촉하지 않음.

## 1. 외부 키 (SSM `/mindbreeze/prod/`)

| 키 | 상태 | 출처 |
|---|---|---|
| GEMINI_API_KEY · OPENAI_API_KEY · DEEPSEEK_API_KEY | 채움 | dev `.env.dev` 기존 키를 서버→로컬 파이프로 복사(SecureString·prod KMS, 값 비노출) |
| RESEND_API_KEY | 채움 | Resend API 로 발신 도메인 확인 후 **신규 발급**: `mindbreeze.looxidlabs.com`(ap-northeast-1) 상태 `verified` → 해당 도메인 전용 `sending_access` 키 `mindbreeze-prod-send` 생성(dev 키는 전체 권한이라 복사하지 않음). `RESEND_FROM_EMAIL`=`MIND BREEZE <noreply@mindbreeze.looxidlabs.com>`(기존 값 유지). 본인 주소(brian.chae@looxidlabs.com)로 발송 시험 1통 HTTP 200 |
| GOOGLE_CLIENT_ID | **미채움(사용자 조치)** | Aside 가 Google Cloud Console 에서 `brian.chae@looxidlabs.com` 비밀번호 재인증 화면에 막혀 중단(로그인 시도 안 함). dev 클라이언트(프로젝트 6903890908)가 2.0 전용인지 판별 불가 → 규칙대로 **수정하지 않음**. 1.0 과 공유 여부 확인 불가이므로 2.0 운영 전용 새 클라이언트 생성이 안전 |
| FCM_PROJECT_ID · FCM_SERVICE_ACCOUNT_JSON | 비움(의도) | 푸시 없이 컷오버. Firebase 미접촉 |

- 서버 `prod.env` 재렌더(SSM Run Command, `--allow-placeholders`): 31개 키, **필수 키 누락 = `GOOGLE_CLIENT_ID` 1개**. 백엔드는 이 값이 비어도 기동하며 Google 로그인만 차단됨(`auth.py:756`). 이메일 로그인은 정상.

## 2. T-15 첫 배포 리허설 — 통과 (3회차)

| 시도 | run | 결과 | 원인 · 조치 |
|---|---|---|---|
| 1 | 39077484296 | 실패 | SSM RunShellScript 기본 셸이 dash → `set -o pipefail` 오류. `deploy/ci/ssm-install-cmd.sh` 본문 상단에서 bash 재실행하도록 수정(develop `13fc1e0d`, Deploy Dev 39077743389 성공) |
| 2 | 39079034212 | 실패(롤백 트랩 정상 동작: 서버 변경 0) | 빈 DB 에 85개 체인 적용 시 `30c1bfbc724f`(자동 생성 드리프트 마이그레이션)가 `chat_room_participants` 중복 생성·없는 인덱스 삭제·기존 컬럼 추가로 실패. 로컬 PG16 에서 재현 후 `IF NOT EXISTS` 성격의 보호 추가(이미 적용된 dev 에는 영향 없음). 빈 DB 체인 → head `e036a0000051` 통과 확인 |
| 3 | 39080421825 | **성공** | 릴리스 `20261017-232954-494c682`(빌드 run 39079232663). 설치 전 과정(체크섬·venv 재사용·alembic 85개·전환·헬스) **21초**, 헬스 6초. 공개 스모크 9항목 전부 OK(프론트 200·`/health/ready` 200·SPA 폴백·역할 시뮬레이션 404 ×2·CORS 허용/dev 차단/임의 차단·HSTS) |

- `ENVIRONMENT=production` 기동, backend·worker·email-worker·export-worker·nginx·redis·livekit·coturn 모두 active, job timer 14개 설치·0개 활성(컷오버 전 의도), 오류 로그 0건.
- 리허설용 임시 설정(컷오버 시 원복 필요): GitHub 저장소 변수 `PROD_WEB_HOST`/`PROD_API_HOST`=임시 호스트, SSM `CORS_ALLOWED_ORIGINS` 에 `https://prod-check.mindbreeze.looxidlabs.com` 추가(스모크의 CORS 항목이 운영 오리진을 요구). 코드·이력에는 값 기록 없음.
- 발견(후속): 빈 DB 체인 결과와 현행 모델 사이 autogenerate 차이 12건(인덱스·nullable 등 경미). 컷오버는 dev 스냅샷 복원이라 영향 없으나 신규 환경 재구축 시 정리 필요.

## 3. T-16 롤백 리허설 — 통과

- 릴리스 2개 연속 배포: A `…232954-494c682`(run 39080421825) → B `20261017-235235-494c682`(빌드 run 39080666865, 배포 run 39082024140, 2분 0초).
- `rollback-prod.yml`(run 39082159177, **1분 4초**): current→A, previous→B, 4개 서비스 active, timer 0 활성, 스모크 통과, venv 링크 복귀.
- 마이그레이션 실패 주입(`alembic_version` 을 존재하지 않는 리비전으로 변경 후 B 재배포, run 39082258294): `Can't locate revision` → **종료 코드 20, "전환하지 않음(코드·서비스 변경 없음)"**, current/previous 링크 불변, 서비스 active 유지. 주입값 원복 확인.

## 4. T-17 컷오버 리허설(복제본) — 통과, 소요 실측

| 단계 | 실측 |
|---|---|
| dev RDS 수동 스냅샷 `mb-rehearsal-dev-…` | 생성 시작 23:29:53 → available ≤ 5.5분 |
| KMS(`alias/mindbreeze-prod`) 암호화 복사 | ≤ 5분(시작 23:35:32, 복사 스냅샷 생성시각 23:37:40) |
| 임시 RDS `mb-rehearsal-restore` 복원(db.t4g.small·`mb-prod-db-subnets`·`mb-prod-rds` SG·`mb-prod-pg16`·단일 AZ) | 요청 23:40:58 → 복원 완료 23:43:58(**3분**) + 파라미터 그룹 적용 재시작 23:47(**복원 후 재시작 1회 필요**, V-1.15) |
| 접속·집계 | TLS(`ssl=on`), 63개 테이블 합계 60,999행, 집계 0.4초. 복원본은 `alembic_version=e036a0000051`(= 릴리스 head) |
| 행 수 대조 | dev 라이브 집계(스냅샷 이후)와의 차이 6개 테이블 모두 **dev 쪽이 더 큼**(refresh_tokens·sessions 등, 스냅샷 이후 dev 사용분). 컷오버는 쓰기 차단 후 스냅샷이라 0 차이 예상 |
| dev 계정 정리 SQL | `auth_provider='dev'` 3계정 `status='suspended'`, `refresh_tokens` 6,305행 삭제, `device_tokens` 활성 4건 `revoked_at` 설정 — 0.02초, 잔여 활성 dev 계정 0 |
| DB 이름 | 복원본 DB 이름은 dev 의 `mindbreeze_dev` → SSM `DB_NAME=mindbreeze_prod` 와 불일치(`render_env` 의 dev 흔적 검사도 차단). **`ALTER DATABASE … RENAME` 필요**(시험 0.01초, 이후 접속·버전 정상). 컷오버 C-2 에 반영 |
| 마스터 비밀번호 | 복원본은 dev 비밀번호 상속 → 복원 직후 SSM `DB_PASSWORD` 로 `modify-db-instance` 재설정(boto3, 값 비노출) 필요. 마스터 사용자명 `mindbreeze` = SSM `DB_USER` 일치 |
| S3 복사 `eeg-raw/`+`video/` → prod 버킷 임시 접두사 | 2,866개 / 2,187,037,108B **dev와 정확히 일치**, 소요 **약 40초**, 샘플 5건 해시 일치. 접두사·버전 2,866건 삭제 완료 |
| 앱 스모크(복원본 연결, 운영 모드) | 로그인 200(0.42s) · 세션 목록 65건 · 리포트 목록 112건 · 대시보드 200 · 리포트 상세 200 · **리포트 PDF 200(5.0s, %PDF 확인)** · EEG 롤업 200 ×2(0.1s) · 무효 refresh 401 · 본인 주소 메일 발송 200. (`/auth/me` 는 경로 오기로 404 — 기능 문제 아님) |
| 미완 | 정지된 dev 계정 로그인 차단은 요청이 422(이메일 형식 검증)로 끝나 **403 확인 못 함**(코드는 `status=='suspended'` 403). 컷오버 C-8 에서 재확인. 영상 업로드→리포트 신규 생성·LiveKit 화상·실시간 WebSocket 스모크는 이번에 미수행 |

- 시험 후 앱 환경 파일은 SSM 에서 재렌더해 빈 DB(`mindbreeze-prod-empty`)로 복귀, 백엔드 헬스 OK.
- **서버 로컬 청크(C-4b 신설, plan.md 반영)**: dev `audio_chunks` 1,405행 전부 `/tmp/mindbreeze_audio/…` — 파일 **1,072건(84.2MB) 존재 / 333건 유실**. `video_chunks` 로컬 경로 982행은 **파일 0건**(1,295행은 S3 키). `/tmp` 휘발성이므로 이관 또는 청크 행 정리 방식을 Brian 결정.
- 임시 리소스 삭제: RDS `mb-rehearsal-restore`·`mb-pitr-drill`(삭제 요청, 최종 스냅샷 없음·자동 백업 삭제), 스냅샷 2개, S3 `_rehearsal/` 전부.

## 5. T-18 복구 훈련 (PITR)

- `mindbreeze-prod-empty` → `mb-pitr-drill`(최신 복원 시점 00:02:44Z, 요청 00:05:03Z).
- **RPO ≈ 2분 19초**(요청 시각 − LatestRestorableTime, 목표 5분 이내 충족).
- **RTO ≈ 9~10분**(요청 → "Restored" 이벤트 00:14:23, 재시작 00:14:49 → 연결 가능). 복원본 `alembic_version=e036a0000051`, 63 테이블, `pg_is_in_recovery=False`, TLS 접속 성공.
- 삭제 요청 완료. 비용 $0 수준(수십 분 단위).

## 6. 점검창 산정 (plan §6, 실측 반영)

| 구간 | 예상 |
|---|---|
| C-0~C-1 기록·점검 모드·워커 중지 | 5~7분 |
| C-2 최종 스냅샷(증분·쓰기 차단 상태) + 암호화 복사 + 복원 + 재시작 + 비밀번호·이름 정리 | 15~20분 (스냅샷 ≤5.5 + 복사 ≤5 + 복원 3 + 재시작 1~2) |
| C-3 dev 계정·토큰 정리, 집계 대조 | 3분 |
| C-4/C-4b S3 동기화(40초) + 오디오 청크 이관 | 3분 |
| C-5 `deploy-prod` + 승인 + 관찰(실측 설치 21초, 워크플로 2분) | 5~8분 |
| C-6~C-7 timer 활성·DNS 전환·인증서 신규 발급 | 7~10분 |
| C-8~C-9 스모크·점검 해제 | 10분 |
| **합계** | **약 50~60분 → 점검창 60분 확보, 한도 60분 초과 시 롤백 판단**(사전에 스냅샷·암호화 복사를 점검 시작 전 1회 선행하면 C-2 가 더 짧아지지만 최종 증분분 반영이 필요해 비권장) |

## 7. 컷오버 전 남은 차단 요소

1. **Google OAuth 클라이언트 ID** 미채움 — Brian 이 Google Cloud Console 재인증 후 2.0 운영 전용 새 클라이언트 생성(운영 오리진 `https://mindbreeze.looxidlabs.com`, 리디렉트 URI) → SSM `GOOGLE_CLIENT_ID` 등록 → 환경 재렌더. 또는 재인증 후 Aside 재실행.
2. 개인정보처리방침(N-6) 게시 확인 · 법무 검토.
3. 연구 가명 키 `RESEARCH_ID_KEY_V1` 오프라인 백업(`deploy/aws/research-key-backup.sh`) 및 복원 검증.
4. 사용자 공지(D-3·D-1)·점검 페이지·공지문 승인(B-7).
5. 6자리 코드 진행 중 세션 5건 정리, dev `in_progress` 0건.
6. 리허설 임시 설정 원복(저장소 변수 `PROD_WEB_HOST`/`PROD_API_HOST` 삭제, SSM `CORS_ALLOWED_ORIGINS` 의 `prod-check` 제거) — C-5 직전.
7. C-4b 오디오 청크(존재 1,072·유실 333, 영상 로컬 경로 982행) 처리 방식 결정.
8. C-2 절차 보강: 복원 후 `ALTER DATABASE mindbreeze_dev RENAME TO mindbreeze_prod`, 마스터 비밀번호 재설정, 파라미터 그룹 적용 재시작, `mindbreeze-prod` 경보 4종 연결 확인.
9. 업타임 감시(V-1.32) 생성 · 경보 시험 발화(V-1.31) · EIP 재부팅 유지(V-1.7) · 운영 도메인 인증서 실발급(컷오버 C-7, DNS-01).

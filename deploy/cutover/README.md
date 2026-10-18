# deploy/cutover — SDD-210 컷오버 실행 세트

정본: `specs/sdd-210-prod-environment/plan.md` §6(시간표·롤백 기준) · `rehearsal-result.md` · `infra-result.md`. **준비 코드 — 이번 작업에서 실제 실행한 것은 없다**(dev 데이터 변경·운영 공개·공지 발송 없음).

## 한눈에

```bash
bash deploy/cutover/cutover.sh --dry-run      # 전체 단계: AWS·SSH·SSM·gh 호출 없이 명령·전제조건만 출력
bash deploy/cutover/cutover.sh --list         # 단계 목록
bash deploy/cutover/cutover.sh                # 실제 실행(프롬프트 없음, 중단 조건에서만 멈춤)
bash deploy/cutover/cutover.sh --from C-5     # 재개(같은 RUN_ID)
bash deploy/cutover/rollback.sh               # 롤백(사람이 판단 후 실행. 점검 해제 후에는 거부)
```

필수 환경변수(비밀 아님): `MB_ADMIN_IPS`(점검 중 우회 IP, 운영자 로컬 포함. 미지정 시 `admin-ips.txt` 목록 사용 — 한 줄에 하나, IP 추가는 이 파일에 한 줄 추가) · `MB_RELEASE_ID` · `MB_ACK_RESEARCH_KEY_BACKUP=1` · `MB_ACK_PRIVACY_POLICY=1` · `MB_ACK_NOTICE_D1=1`.
선택: `MB_SMOKE_EMAIL`+`MB_SMOKE_PASSWORD_FILE`(C-8 API 스모크 계정), `MB_OBSERVE_MIN`(C-5 관찰, 기본 2분), `MB_MAINT_LIMIT_MIN`(60), `MB_DNS_DEADLINE_MIN`(48), `MB_ALLOW_OVERRUN=1`, `MB_ALLOW_AUDIO_COUNT_DRIFT=1`, `MB_WORKFLOW_REF`(기본 develop).
AWS: `looxid-las`/ap-northeast-1, `MB_AWS_PY`(기본 `backend/venv/bin/python -m awscli`). 시크릿 값은 어디에도 출력·저장하지 않는다(DB 비밀번호는 SSM→boto3).

## 파일

| 파일 | 단계 | 요약 |
|---|---|---|
| `c00-record.sh` | C-0 | 전제(SSM 필수 키·릴리스·prod RDS 부재·DNS 부재)·dev 기록(alembic·행 수·precheck)·게이트(진행 세션 0, 6자리 비종료 0) |
| `c01-maintenance-on.sh` | C-1 | dev nginx 503(관리자 IP 우회)·cron 백업/비움·워커 중지·동결 확인(행 수 2회 동일) |
| `c02-db-restore.sh` | C-2 | 스냅샷→KMS 복사→`mindbreeze-prod` 복원→비밀번호 재설정→재시작→백업14·삭제방지→DB_HOST→RENAME |
| `c03-db-cleanup.sh` | C-3 | 리비전·행 수 대조 → dev 계정 정지·refresh 폐기·기기 토큰 비활성 |
| `c04-s3-sync.sh` | C-4 | `eeg-raw/`·`video/` sync, 객체 수·바이트·샘플 해시 |
| `c04b-audio-migrate.sh` | C-4b | 오디오 존재분 이관(`--pack-only` 사전 복사 가능)·유실 행 정리·영상 행 보고 |
| `c05-deploy.sh` | C-5 | `deploy-prod` 실행·환경 승인 대기·서버 상태 확인(리허설 임시 호스트 설정 유지) |
| `c06-activate.sh` | C-6 | 운영 호스트 재구성(인증서 DNS-01)·timer 14개 활성·prod 점검 ON |
| `c07-dns.sh` | C-7 | Route53 A CREATE×2(TTL 60)·존 전후 비교·전파 확인(시간 가드 T+48) |
| `c08-smoke.sh` / `smoke-api.sh` | C-8 | 공개 스모크 9항목·인증서·계정 API·정지 계정 차단·LiveKit/TURN·오류 로그 |
| `c09-release.sh` | C-9 | 임시 설정 원복·점검 해제·dev 안내 페이지·업타임 감시 |
| `c10-observe.sh` | C-10 | 관찰 30분(헬스·경보·실패 유닛) 후 완료 선언 |
| `revert-rehearsal.sh` | (C-9 내부) | `PROD_WEB_HOST`/`PROD_API_HOST` 저장소 변수 삭제·SSM CORS 임시 오리진 제거·재렌더·재시작 |
| `rollback.sh` | RB | 구간 A/B 롤백(timer 중지→DNS 삭제→dev 복귀). 구간 C 는 거부 |
| `uptime-monitor.sh` | C-9 | Route53 health check + us-east-1 경보/SNS (`create\|status\|test-alarm\|delete`) |
| `maintenance/` | C-1·C-6·C-9 | `nginx-maint.sh`(on/moved/off/status), `index.html`(점검), `moved.html`(새 주소 안내) |
| `ops/` | D-1~점검 직전 | `cancel-legacy-sessions.sh list\|cancel [--execute]` — 6자리 코드 5건 절차(미실행) |
| `lib.sh`, `lib/` | 공통 | 실행/드라이런 래퍼, `awsx.py`(boto3), `pgrun.py`(원격 DB 질의), `audio_pack.py` |

실행 기록은 `deploy/cutover/.run/<RUN_ID>/`(gitignore): `timeline.tsv`(단계별 T+분·소요 초), `C*-*.txt`(전후 비교 증빙), `cutover.log`.

## 설계 메모 (리허설 대비 변경점)
- 동결 기준: C-0 값 대신 **C-1 동결 후 행 수**를 C-3 대조 기준으로 사용(그 사이 정상 사용분 반영).
- 리허설 임시 호스트 설정 원복은 `C-5 직전`이 아니라 **C-9**(deploy-prod 스모크가 DNS 전환 전 임시 호스트로 동작해야 함).
- prod 점검 모드는 C-6 에서 켜고 C-9 에서 끈다(DNS 전환 순간부터 공개되므로 사용자 차단 필요).
- nginx 점검 적용은 reload 가 아니라 **restart**(기존 WebSocket 연결 유지 방지).
- 검증 한계: nginx -t·SSM·RDS·Route53 실행 경로는 이 환경에서 실행하지 않았다(dry-run·구문·단위 시험만).

## 운영 Google 클라이언트 ID 반영 절차 (Brian 이 ID 를 준비한 뒤)
Google OAuth 클라이언트 ID 는 공개 값이지만 프론트 번들(빌드 시점)과 백엔드(SSM) 양쪽에 필요하다. 번들에는 dev 용 `secrets.VITE_GOOGLE_CLIENT_ID` 가 아니라 저장소 변수 `GOOGLE_CLIENT_ID_PROD` 만 주입된다(비어 있으면 빈 값으로 빌드 + 경고).
1. Google Cloud 콘솔에서 운영용 웹 클라이언트 생성 — 승인된 JavaScript 원본 `https://mindbreeze.looxidlabs.com`, (리허설 확인용 `https://prod-check.mindbreeze.looxidlabs.com`).
2. 저장소 변수: `gh variable set GOOGLE_CLIENT_ID_PROD --body "<클라이언트 ID>"`
3. SSM: `deploy/aws/t12-ssm.sh` 의 키 목록과 동일하게 `GOOGLE_CLIENT_ID` 를 운영 SSM 경로에 입력(값은 화면·로그에 출력하지 않는다. 입력 방법은 `deploy/aws/t12-ssm.sh` 주석 참조).
4. 재빌드: `gh workflow run release-build.yml --ref main -f ref=develop -f base_release_sha=<직전 운영 릴리스 SHA>` → 새 릴리스 ID 확인(요약에 Google 경고가 없어야 함).
5. 새 릴리스 ID 로 `MB_RELEASE_ID` 갱신 후 C-0 부터 진행(deploy-prod 는 C-5 에서 승인 후 실행).

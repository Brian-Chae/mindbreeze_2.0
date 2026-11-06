# SDD-282 복구 실행 런북 (감독용)

- 대상 회차: `1a74e4c9-a54e-4454-8505-22840922811c` / 대상 참여행(앞 6자리): `de8312`, `6a2172`, `518675`, `ac1a78`
- 작성자는 운영에 실행하지 않았다. 아래는 감독이 실행 직전 순서대로 수행하는 절차다.
- 코드 위치: 공통 변환 `backend/app/services/feature_artifact_reconcile.py`, CLI 3종 `scripts/sdd282-recovery-load.py` · `sdd282-report-overwrite.py` · `sdd282-recovery-rollback.py`. 시험 `backend/tests/sdd282/` (24건).
- 공통 실행 환경(서버, SSM `i-0487c67fb0db7dcba`):
  ```
  cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
  PY=/opt/mindbreeze/venv/bin/python ; S=../scripts
  ```
- 출력은 건수·접두사(6자)만 나온다. 백업·드라이런 JSON 은 **저장소 밖 보호 경로**(예: `/var/lib/mindbreeze-recovery/`, 0700)에 둔다. 커밋 금지.
- 모든 CLI 의 기본 모드는 `--dry-run`(쓰기 없음, `SET TRANSACTION READ ONLY`)이다. `--apply` 를 명시해야만 쓴다.

## 0. 사전 확인 (쓰기 없음)
1. 배포본에 위 4개 파일이 있는지 확인(운영 배포 전이면 파일만 서버에 복사해도 동작: 모듈은 `app` 패키지를 import 하므로 `current/backend` 아래에 `app/services/feature_artifact_reconcile.py` 가 있어야 한다).
2. **신규 RDS 스냅샷** 생성 → ID 기록 → 상태 `available` 확인. 중단 조건: 스냅샷 미완료.
3. 보호 경로 생성: `install -d -m 0700 /var/lib/mindbreeze-recovery`
4. 이 회차의 라이브 경로 쓰기가 없음을 확인(회차 종료됨 `sessions.ended_at` 있음). 표식 구분이 `ingest_path` 하나뿐이라, 대상 4명에게 다른 경로 행이 새로 생기면 롤백이 분리되지 않는다.

## 1. 드라이런 (쓰기 없음)
```
$PY $S/sdd282-recovery-load.py --dry-run --out /var/lib/mindbreeze-recovery/dryrun-$(date +%H%M).json
```
- 기본값으로 `518675` 의 업로드 대기 산출물 포함(체크섬·크기·행 수·순번 검증 통과분만).
- **기대(11/4 19시대 드라이런 기준, 기기가 계속 올리면 늘 수 있음)**: de8312 2,940 / 6a2172 4,200 / 518675 2,580(+대기 60 포함 시 2,640) / ac1a78 4,200 → 합계 13,920(대기 포함 13,980). 모두 `already_in_db=0`, `conflicts=0`, `convert_fail=0`, `dup_in_file=0`.
- 증가는 정상(미전송 파일 업로드 중). 감소·충돌·변환실패·`files_pending_excluded>0` 는 **중단**하고 원인 확인.
- 종료코드 0=적재 가능, 1=제외·충돌·변환실패 있음.

## 2. 적재 (INSERT 만, 한 트랜잭션)
**리포트 백업(§4)보다 먼저 적재한다. 적재 후 파일이 더 늘었으면 §1 을 다시 돌려 새 결과 파일로 진행한다.**
```
$PY $S/sdd282-recovery-load.py --apply --dryrun-result /var/lib/mindbreeze-recovery/dryrun-HHMM.json
```
- `--apply` 는 대상 4개 지정 + 직전 드라이런과 행 수(총합·참가자별) 일치 + 충돌 0 일 때만 진행한다. 불일치 시 종료코드 4 로 중단(쓰기 0) → §1 재실행.
- 적재는 `eeg_feature_windows` 직접 INSERT + `ON CONFLICT DO NOTHING`, `ingest_path='recover'`. `participant.band_connected` 변경·방송 없음.
- 성공 출력: `적재 완료: 총 N행 {...} (표식 recover 행 0→N)`. 계획과 실제 삽입 수가 다르면 자동 롤백(종료코드 5).
- 재실행하면 새로 생긴 순번만 추가된다(멱등).

## 3. 적재 검증 쿼리 (읽기 전용 트랜잭션)
```sql
SET TRANSACTION READ ONLY;
-- (a) 표식 행 수 = 적재 건수
SELECT substr(participant_id::text,1,6), count(*) FROM eeg_feature_windows
 WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c' AND ingest_path='recover' GROUP BY 1 ORDER BY 1;
-- (b) 이 회차 총합 = 이전 27,416 + 적재 건수 (전체는 48,254 기준 + 증가분)
SELECT count(*) FROM eeg_feature_windows WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c';
-- (c) 대상 밖 참가자 행 불변: ingest_path<>'recover' 행 수가 적재 전과 같다
SELECT count(*) FROM eeg_feature_windows WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c' AND ingest_path<>'recover';
-- (d) 구간 밖 행 0 (late 표식)
SELECT late, count(*) FROM eeg_feature_windows WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c' AND ingest_path='recover' GROUP BY 1;
```
- 기대: (a) 드라이런 숫자와 참가자별 동일, (b) 27,416 + 적재 건수, (c) 27,416, (d) `late=false` 만.
- 하나라도 다르면 **§7 롤백**.

## 4. 리포트 백업 + 덮어쓰기
먼저 대상 목록 확인(쓰기 없음):
```
$PY $S/sdd282-report-overwrite.py --dry-run
```
- 기대: 5건 — client 4(`pending_review`, 본문 343자) + counselor 1(`completed`). counselor 가 2건 이상이면 중단.
- client 만 먼저 하려면 `--no-counselor`. (대표 결정: counselor 1건도 덮어쓴다 → 기본값 포함.)
```
$PY $S/sdd282-report-overwrite.py --apply --backup-dir /var/lib/mindbreeze-recovery
```
- 동작: ① 본문·상태 JSON 백업(경로 출력, 0600) → ② 메일 예약·AI 서사 예약·진행 방송 무력화 → ③ `generate_report_inline` 만 호출 → ④ 리포트마다 상태 불변 검증.
- **백업 파일 경로를 기록한다**(롤백에 필요). 백업 건수가 5(또는 4)인지 확인.
- 검증 항목(자동): `status`·`sent_at`·`approved_*`·`approval_source`·`delivery_*`·`pdf_url`·`is_read` 불변, `participant.report_email_sent_at` 불변, `notification_outbox` 건수 불변, 생성 결과 `error` 아님. 어긋나면 그 리포트를 백업으로 복원하고 종료코드 6 으로 중단.
- 성공 출력 끝: `덮어쓰기 완료 N건 — 승인·발송 없음`, 그리고 `무력화한 부수 효과 호출 시도(실제 실행 0): {...}`.
- **승인·발송은 하지 않는다**(별도 결정). 복구 후 `generate_report`(API)·`generate_client_reports_for_session` 호출 금지 — 호스트 자동 승인으로 메일이 나간다.

## 5. 리포트 검증 (읽기 전용)
```sql
SET TRANSACTION READ ONLY;
SELECT type, status, generation_status, data_credibility, length(content::text), sent_at IS NOT NULL AS sent,
       approved_at IS NOT NULL AS approved, delivery_status
  FROM reports WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c'
   AND (participant_id::text ~ '^(de8312|6a2172|518675|ac1a78)' OR type='counselor');
SELECT status, count(*) FROM reports WHERE session_id='1a74e4c9-a54e-4454-8505-22840922811c' AND type='client' GROUP BY 1;
```
- 기대: client 4건 모두 `pending_review`, 본문 343자 아님, `sent=false`, `approved=false`, `delivery_status` NULL / counselor `completed` 유지·`counselor_comment` 없음(원래 없음).
- 회차 client 분포는 적용 전과 같다(completed 9 / pending_review 22). 메일 발송 큐(`mindbreeze-email-worker`)에 새 작업이 없는지 확인.
- 커버리지가 낮은 구간의 "부분 구간" 표기(verify C4)는 리포트 화면에서 별도 확인.

## 6. 정산 태스크(SDD-285 S1) — 이번 복구와 별개
- 파일: `backend/app/tasks/feature_reconcile_task.py`. 기본 `FEATURE_RECONCILE_APPLY=false`(쓰기 없음, 로그만). 켜려면 환경변수 `true` + 워커 재시작.
- **워커가 이 태스크를 인식하려면 `backend/app/core/celery_app.py` 의 `include` 에 `"app.tasks.feature_reconcile_task"` 추가와 트리거(종료 N분 뒤 `reconcile_session_features.apply_async(countdown=…)` 또는 cron 으로 `sweep_ended_sessions_for_reconcile` 호출) 배선이 필요하다. 이 작업 담당 경로 밖이라 하지 않았다.**
- 운영 최초 실행은 드라이런 로그의 `would_insert` 확인 후 적재 모드 전환(대표 별도 승인).

## 7. 롤백
적재 롤백(표식 행만 삭제, 먼저 예정 건수 확인):
```
$PY $S/sdd282-recovery-rollback.py --dry-run
$PY $S/sdd282-recovery-rollback.py --apply --expect-rows <적재 건수> [--report-backup <§4 백업 JSON>]
```
- `--expect-rows` 와 삭제 예정이 다르면 중단(종료코드 4). 삭제 수 ≠ 예정이면 자동 롤백(5).
- 리포트까지 되돌리려면 `--report-backup` 지정(본문·상태 전체 복원). 리포트만 복원하고 행은 남기려면 `--skip-rows`.
- 기대: 적재 전 상태와 동일(대상 4명 기존 행 0 → 표식 행 삭제로 완전 원상). 롤백 뒤 §3 (b),(c) 로 확인.
- 되돌릴 수 없는 것: 이미 나간 메일·푸시(방어로 0건이어야 함). 이를 감지하면 즉시 중단·보고.
- 최후 수단: §0-2 의 RDS 스냅샷.

## 중단 조건 요약
| 단계 | 중단 조건 |
|---|---|
| 0 | 스냅샷 미완료 |
| 1 | 충돌·변환실패·제외 ≠ 0, 행 수 감소 |
| 2 | 종료코드 4(드라이런과 불일치)·5(삽입 수 불일치) |
| 3 | (a)~(d) 기대와 불일치 |
| 4 | 대상 리포트 5건이 아님, 종료코드 6 |
| 5 | 상태가 `pending_review`/미발송이 아님, 메일 큐 증가 |

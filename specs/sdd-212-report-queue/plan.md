# SDD-212 — Plan (Stage ②)

- 전제: spec.md 의 결정 D-1~D-7 은 추천안 기준. Brian 답변에 따라 해당 Task 만 조정.
- 코드 위치는 `path:line` (develop `234d99d2` 기준, 조사 시점 읽기 전용)

## 1. 현황 조사 (읽기 전용)

### 1.1 워커 구성
- 일꾼 서비스 3종 (`deploy/templates/systemd/`)
  - `mindbreeze-worker.service.tpl:13` — `celery worker --prefetch-multiplier=1` 만 지정. **`-Q`·`--concurrency` 없음** → 기본 큐(`celery`)만 소비, 동시 처리 수 = 서버 CPU 수(t4g.medium 2 vCPU → 2, `deploy/aws/t10-ec2.sh:12`)
  - `mindbreeze-export-worker.service.tpl:13` — `-Q exports --concurrency=1` (내보내기 전용)
  - `mindbreeze-email-worker.service.tpl:13` — 별도 Celery 앱 `-Q email --concurrency=2`
- 큐 라우팅: `backend/app/core/celery_app.py:41-44` — `exports` 2종만 분리. 나머지는 전부 기본 큐
- 이 기본 큐 하나에 STT·요약·리포트·영상 병합이 같이 들어감 (`celery_app.py:20-32`)
- 주기 작업은 Celery beat 가 아니라 OS cron (`celery_app.py:34-37`, `deploy/jobs.tsv`)
- 일꾼 유닛 목록 등록 위치: `scripts/ec2-setup.sh:52` (유닛 추가 시 함께 수정 필요)

### 1.2 종료 → 리포트 사슬
- `session_service.py:983-994` 세션 종료 → `audio_service.finalize_on_session_end` (`audio_service.py:234`)
- 발행 의도를 DB 에 먼저 기록(`PipelineOutbox`, `audio_service.py:276-295`) 후 사슬 적재 (`:298`)
- 사슬 구성: `[영상 병합] → [STT → 요약] → generate_reports_for_session` (`audio_service.py:204-230`)
  - 영상 병합: `video_task.py:76-84`, STT: `stt_task.py:617-625`, 요약: `summary_task.py:337-345`
- `generate_reports_for_session` (`report_task.py:704-737`): 상담사 리포트 1건 + 참가자별 회원 리포트를 **한 태스크 안에서 순차 생성** (`report_service.py:376-460`, 참가자 루프 `:417`). 자동 승인 상담사는 참가자마다 AI 코멘트 초안(외부 AI 1회, 타임아웃 15초: `report_comment_service.py:23`, `:226-266`)을 추가 호출

### 1.3 동시성·재시도·타임아웃 (현행)
| 태스크 | 재시도 | 시간 상한 | 근거 |
|---|---|---|---|
| 영상 병합 | 오류 시 3회, 지수 대기 | soft 10분 / hard 15분 | `video_task.py:76-84` |
| STT | 3회 + 외부 호출 자체 3회 재시도 후 Whisper 폴백 | soft 25분 / hard 30분 | `stt_task.py:45-46`, `:69-95`, `:617-625` |
| 요약 | 3회, 지수 대기 | soft 9분 / hard 10분 | `summary_task.py:32-33`, `:337-345` |
| **리포트 생성** | 모든 예외 3회 재시도 | **시간 상한 없음** | `report_task.py:704-709` |
- 확인 응답(acks_late) 미설정 → 일꾼 강제 종료 시 해당 태스크 유실. 보완책은 아웃박스 재발행(1.5)
- 동시 처리 수·큐 길이·우선순위·상한 설정 어디에도 없음

### 1.4 대기가 길어질 때 오동작 (이번 조사의 핵심 발견)
1. **중복 사슬 재발행**: 아웃박스 감시 작업이 "발행 후 30분 경과 + 리포트 행 0건" 이면 사슬을 다시 발행 (`audio_service.py:27`, `:303`; `pipeline_outbox_task.py:23-35`, `:96-133`). 리포트 행은 **리포트 생성 단계가 시작돼야** 생기므로, STT 앞 대기가 30분을 넘기면 정상 대기 건이 "미완료"로 오판 → STT 중복 실행(비용 2배 + 줄 더 길어짐). 최대 5회 (`pipeline_outbox_task.py:20`)
2. **정상 대기 건을 실패 처리**: 정체 스윕이 "녹음 종료 후 30분 경과 + 기록 상태 processing" 이면 `failed` 로 마감하고 리포트도 `error` (`report_progress_service.py:83`, `:372-392`, 5분마다 `deploy/jobs.tsv:4`). 시각 기준이 큐 진입 시각이라 **대기 시간이 처리 시간으로 계산됨**
3. 리포트 단계 시간 기준은 `generation_started_at`(처리 시작 시각, `report_task.py:500-509`) 이라 대기와 무관 → 이쪽은 안전
- 위 1·2 때문에 줄 분리만으로는 부족. 대기 보정(T4)이 필수

### 1.5 외부 AI(Gemini) 호출 제한
- 키 1개 공유: `config.py:124` — STT(`stt_task.py:238`, `:284-286`), 요약(`summary_task.py:36-66`), 코멘트 초안(`report_comment_service.py:226-266`), AI 비서(`agent_llm.py:170`)
- 모델 `gemini-2.5-flash` (`config.py:132`). 호출 수 상한·초당 제한 코드는 **없음** (일꾼 슬롯 수가 사실상 동시 호출 상한)
- 429·5xx 는 STT/요약에서 재시도 대상으로 분류 (`stt_task.py:41`, `summary_task.py:62-66`), 코멘트 초안은 실패 시 규칙 템플릿 폴백
- 실제 공급자 한도(분당 요청/토큰)는 코드로 알 수 없음 → 운영 계정 한도 확인 필요 (D-6, 결정 대기)

### 1.6 몰림 시나리오 (추정 — 실측 아님)
- 시나리오: 정시에 클래스 10개 동시 종료, 전부 녹음 있음, STT 평균 8분 가정, 일꾼 슬롯 2개
  - 슬롯 2개가 STT 를 처리 → 10건 완료까지 약 40분. 요약·리포트 생성은 같은 줄 뒤쪽 → 마지막 클래스 리포트는 약 50분 후
  - 위 1.4-①로 30분 시점에 미완료 건(약 6건)의 사슬이 재발행 → STT 중복 6건 추가 → 최악 약 70분+
  - 위 1.4-②로 30분 지난 대기 건이 `failed`/`error` 로 마감 → 상담사에게 생성 실패 알림(U3 유지 대상) + 회원 `리뷰 중` 고착
- 단일 클래스 인원이 많은 경우: 리포트 생성이 참가자 순차 처리 (N명 × 건당 시간). 자동 승인 시 코멘트 초안 N회 외부 호출
- 수치는 가정. 실측은 구현 전 운영 로그(STT 소요, 종료 시각 분포) 확인으로 보정 (T0)

### 1.7 적체 지표 후보
| 지표 | 산출 | 비고 |
|---|---|---|
| 줄별 대기 건수 | Redis 리스트 길이(큐 이름 = 키) | 이미 `redis_url` 사용 (`config.py:37`) |
| 처리 중(미확인) 건수 | Redis 미확인 해시 길이 | |
| **최장 대기 시간** | `PipelineOutbox` published 이후 리포트 행 없음/생성 미완료 건의 경과 시간 | 핵심 경보 지표 |
| 생성 중 리포트 수 | `Report.generation_status in (pending, processing)` | `report_progress_service` 상수 사용 |
| 단계별 정체 후보 | `SessionRecord.status=processing` 경과 | 스윕 기준 보정과 연동 |
| 재발행 횟수 | `PipelineOutbox.attempts` | 급증 시 이상 징후 |
| 일꾼 생존 | `celery inspect ping` 대신 줄별 소비자 수 | 일꾼 다운 감지 |
- 기존 알림 경로: CloudWatch 경보 → SNS (`deploy/aws/t13-monitoring.sh:12-26`). 현재 서버 CPU·메모리·디스크·DB 경보만 있고 파이프라인 경보 없음

## 2. 설계 결정 (기술 — plan 확정)

### TD1. 줄(큐) 3분할
| 줄 | 태스크 (name) | 일꾼 | 초기 동시 처리 수 |
|---|---|---|---|
| `stt` | `tasks.stt`, `tasks.merge_video_chunks` | 신규 `mindbreeze-stt-worker` | 2 |
| `report` | `tasks.summary`, `tasks.generate_reports_for_session`, `tasks.report` | 신규 `mindbreeze-report-worker` | 2 |
| `celery` (기존) | 그 외(아웃박스·알림·예약 등) | 기존 `mindbreeze-worker`, `-Q celery --concurrency=1` | 1 |
- 근거: 긴 작업(STT 최대 30분)과 짧은 작업(요약 ≤10분, 리포트)이 서로 굶기지 않게 분리. 요약은 외부 AI 호출 위주라 리포트 줄에 합침
- 라우팅은 `celery_app.py:41` task_routes 에 추가. 사슬(`chain`)은 태스크별 라우팅을 따르므로 사슬 코드 변경 없음
- 초기값은 가정(서버 2 vCPU·메모리 4GB, 일꾼 5프로세스 합계). T0 실측 후 조정. 값은 systemd 유닛 인자(코드 아님)
- 영상 병합은 CPU 점유가 있어 `stt` 줄에 함께 두되 동시 2 가 서버에 과하면 T0 결과로 별도 줄 분리 재검토

### TD2. 처리 순서 (D-2 추천안 A = 선착순)
- 줄 안은 FIFO 유지. 우선순위 기능 불필요 (Redis 우선순위는 단계가 거칠고 공정성 보장 약함)
- D-2 가 B(1:1 우선)로 바뀌면: `report_priority` 줄 + 전용 소비 슬롯 1개로 구현 (같은 일꾼에서 두 줄을 소비하면 엄격 우선이 아님 → 전용 프로세스)

### TD3. 리포트 생성 시간 상한 추가
- `generate_reports_for_session` 에 soft 25분 / hard 28분 (`report_task.py:704`). 정체 스윕 기준 30분(`report_progress_service.py:83`) 안쪽
- 참가자 대규모 클래스에서 상한 초과 시 재시도가 이미 생성된 회원 리포트를 건너뛰는지(멱등: `report_service.py:430-446`) 테스트로 확인 — 못 건너뛰면 참가자 청크 처리 추가 (T5)

### TD4. 대기 보정 (1.4 해결 — 스키마 변경 없이)
- 정체 스윕 2번 항목(기록 `processing` 마감): 기준을 `recording_ended_at + 30분` → `recording_ended_at + 30분 + 대기 유예(PIPELINE_QUEUE_GRACE_SECONDS, 기본 60분)` 로 완화 (`report_progress_service.py:372-392`)
  - 대안(기록에 처리 시작 시각 컬럼 추가)은 마이그레이션·배포 위험 대비 이득이 작아 보류. 지표에서 유예가 모자라면 재검토
- 아웃박스 재발행: 재발행 지연을 30분 → `PIPELINE_REDRIVE_DELAY_SECONDS` 상향(기본 90분 = D-3 몰림 목표의 2배) + **적체 모드 보류**: 최장 대기 시간이 임계 이상이면 이번 회차 재발행을 건너뛰고 경보 (`pipeline_outbox_task.py:96-133`)
- 두 값은 환경 설정(`app/config.py`, `deploy/env-manifest.tsv` 등록)으로 두고 기본값은 위와 같음

### TD5. 외부 AI 동시 호출 제한 — 조건부 (Phase B)
- Phase A(줄 분리·동시 처리 수 상한)만으로 최대 동시 호출 ≈ 2(stt) + 2(report) + AI 비서. 한도 초과(429) 징후가 측정되면 Phase B: Redis 기반 동시 호출 허용 수 제한(획득 실패 시 `RetryableTaskError` 로 기존 재시도 경로, `celery_app.py:7-13`)
- 착수 조건: T0 한도 확인 + 운영 429 로그 확인. 없으면 구현하지 않음 (범위 최소화)

### TD6. 적체 지표 수집·경보
- `backend/app/services/pipeline_backlog_service.py`(신규): `snapshot(db, redis) -> dict` — 1.7 지표 산출 (읽기 전용)
- cron 작업 `report_backlog_probe` (`deploy/jobs.tsv` 에 1분 주기 행 추가, 기존 `*_cron.py` 패턴): snapshot 을 구조화 로그로 출력 + CloudWatch 사용자 지정 지표(네임스페이스 `MindBreeze/Pipeline`)로 게시
- 경보: `deploy/aws/t13-monitoring.sh` 패턴으로 2종 — 최장 대기 시간 초과, 줄별 대기 건수 초과 (임계는 D-3/D-4)
- **AWS 권한(PutMetricData)·경보 생성은 AWS 변경이므로 구현 단계에서 Brian 별도 승인**. 승인 전까지는 로그 출력만으로 동작 (코드는 게시 실패 시 로그만 남기고 계속)
- 조회 API: `GET /api/v1/admin/pipeline/backlog` (platform_admin 전용, `admin.py:56` 가드 재사용). 화면은 후속 (D-7)

### TD7. 회원 안내 연결 (D-1 = B 가정)
- 서버: 회원용 리포트 마스킹 응답(`report_service.py:218`, 목록 적용 `:719`)에 가산 필드 `in_review_delayed: bool` (기본 false, `schemas/report.py:89` 옆)
  - true 조건: 리포트 생성이 아직 끝나지 않았고(`generation_status` pending/processing) 세션 종료 후 경과가 지연 임계(D-3 평상시 목표) 초과. **상담사 확인 대기 중인 건은 false**
- 화면: `frontend/src/lib/report-review-copy.ts` 에 보조 문구 상수 1종 추가, `ClientReportListPage.tsx` 및 상세에서 `in_review_delayed` 일 때만 표시. 기본 문구·배지 불변
- 문구는 용어 가드 통과 필요 (큐·적체·서버 금지). 제안: `평소보다 조금 늦어지고 있어요.` (D-1 확정 전 가안)
- 구 클라이언트 호환: 필드 가산만, 기존 키 보존 (SDD-211 CS-11 키 보존 검사 재사용)

### TD8. 배포 순서·롤백
- 줄에 쌓인 메시지는 Redis 에 보존되므로 **순서 위반 시 유실이 아니라 지연**만 발생
- 순서: ① 신규 일꾼 유닛 설치·기동(빈 줄 소비 대기) → ② 라우팅 코드 배포 → ③ 기존 일꾼을 `-Q celery --concurrency=1` 로 변경(변경 직전 기본 큐 잔량 확인)
- 롤백: task_routes 항목 제거 배포 + 기존 일꾼 인자 원복(`-Q` 제거) 후 신규 줄 잔량을 임시로 소비(`-Q stt,report`)해 비운 뒤 신규 유닛 중지
- 배포 스크립트/템플릿: `deploy/templates/systemd/` 유닛 2종 신설, `scripts/ec2-setup.sh:52` 유닛 목록, 설치 스크립트(`deploy/install-release.sh`)의 재시작 대상 확인

## 3. 변경 범위 (파일)
| 영역 | 파일 | 구분 |
|---|---|---|
| 라우팅 | `backend/app/core/celery_app.py` | 수정 |
| 시간 상한 | `backend/app/tasks/report_task.py` | 수정 |
| 대기 보정 | `backend/app/services/report_progress_service.py`, `backend/app/tasks/pipeline_outbox_task.py`, `backend/app/services/audio_service.py`(상수), `backend/app/config.py` | 수정 |
| 지표 | `backend/app/services/pipeline_backlog_service.py`, `backend/report_backlog_probe_cron.py`, `deploy/jobs.tsv`, `backend/app/api/v1/admin.py` | 신규/수정 |
| 회원 안내 | `backend/app/services/report_service.py`, `backend/app/schemas/report.py`, `frontend/src/lib/report-review-copy.ts`, `frontend/src/pages/client/ClientReportListPage.tsx`(+상세), `frontend/src/stores/reportStore.ts` | 수정 |
| 배포 | `deploy/templates/systemd/mindbreeze-{stt,report}-worker.service.tpl`, 기존 worker 템플릿, `scripts/ec2-setup.sh`, `deploy/env-manifest.tsv`, `deploy/aws/t13-monitoring.sh` | 신규/수정 |
| 문서 | `deploy/README.md` 운영 절 | 수정 |
- 리포트 생성 로직·AI 프롬프트·승인 흐름 파일은 수정하지 않음

## 4. Task (구현 승인 후 실행 — TDD: 테스트 먼저)
- **T0 실측 보정(읽기)**: 운영 로그/DB 로 STT·요약·리포트 소요 분포, 정시 종료 몰림 빈도, 공급자 한도 확인 → TD1 초기값·TD4 기본값 확정. *운영 DB·AWS 접근은 별도 승인*
- **T1** 라우팅 테스트 → `celery_app.py` task_routes (태스크명→줄 매핑 검증, 사슬 각 단계 라우팅 검증)
- **T2** 일꾼 유닛 템플릿·설치 스크립트·매니페스트 (렌더링 테스트: `deploy/render.py`)
- **T3** 리포트 생성 시간 상한 + 재시도 멱등 테스트 (TD3)
- **T4** 대기 보정: 스윕 기준·재발행 지연·적체 모드 보류 (테스트: 대기 40분/80분 건이 마감·중복 발행되지 않음, 진짜 정체 건은 여전히 마감)
- **T5** (조건부) 대규모 클래스 청크 처리
- **T6** `pipeline_backlog_service` + 관리자 조회 API (가짜 Redis·시간 고정 테스트)
- **T7** `report_backlog_probe` cron + jobs.tsv + (승인 시) CloudWatch 게시·경보 스크립트
- **T8** 회원 안내 가산 필드 + 화면 보조 문구 (용어 가드·키 보존·상담사 대기 건 미표시 테스트)
- **T9** 부하 재현 테스트: 동시 N세션 종료 시뮬레이션(Celery 가짜 일꾼/주입 시계)으로 줄별 동시성·순서·보정 검증
- **T10** (조건부) Phase B 외부 AI 동시 호출 제한
- **T11** 운영 문서·롤백 절차, summary 작성

## 5. 위험·완화
| 위험 | 완화 |
|---|---|
| 일꾼 5프로세스 메모리 초과 | T0 에서 프로세스당 메모리 측정, 동시 처리 수 조정, 서버 메모리 경보(`t13-monitoring.sh:25`) 존재 |
| 보정 후 진짜 정체가 늦게 감지 | 적체 경보(최장 대기)가 보정 구간 동안 대신 감지, 한도 초과 시 재발행 |
| 줄 분리 후 한쪽 일꾼만 다운 | 줄별 소비자 수 지표 + 경보 |
| 라우팅 배포 전후 사슬 혼재 | 사슬은 태스크 단위로 라우팅되어 혼재해도 각 단계는 어느 줄에서든 소비됨 (기본 일꾼이 `-Q` 변경 전까지 기본 큐 소비) |
| 회원 안내 지연 판정 오탐 | 임계는 설정값, 상담사 대기 건 제외 조건 테스트 |

## 6. 범위 밖 / 후속
- 서버 증설·오토스케일, 지표 화면(D-7), 상담사 지연 알림(D-5), Phase B(조건부)

# SDD-237 — 클래스 종료 후 상담사 화면 흐름 재설계 · Stage ② Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans. 체크박스(`- [ ]`)로 진행을 추적한다. **BE 워커와 FE 워커는 별도 워크트리에서 동시에 일한다(§3 파일 소유권 준수, 겹치는 경로 수정 금지).**

- 상태: **Stage ② Plan 완료 / Stage ③ Verify는 [verify.md](verify.md) (구현 전 필수 게이트)**. 이 문서와 verify.md가 커밋된 뒤에만 구현한다.
- 작성: 2026-10-23 · 브랜치 `sdd/237-class-end-host-flow` (구현 트랙: `sdd/237-be`, `sdd/237-fe` → `sdd/237-integrate`에서 합쳐 **PR 1개**, `branch-management.md` §1)
- 근거 문서: [spec.md](spec.md) §11 결정 1~10, [class-narrative.md](class-narrative.md), [counselor-class-report.md](counselor-class-report.md), [auto-approve-policy.md](auto-approve-policy.md), 확정 시안 `designs/class-end-host-flow/`(8c2c8501, narrative-v2.*)
- **Goal:** 명상 클래스 회차가 끝나면 상담사가 서사형 **회차 요약**(S0·S1·S2·S6)과 **상담사 클래스 리포트**(S1~S5)를 보고, AI(또는 규칙) 서사 문장을 **직접 수정·저장**할 수 있게 한다.
- **Architecture:** 기존 `Report(type="counselor")`의 `content.class_report`(JSONB, **필드 추가만, 마이그레이션 없음**)에 서버가 계산한 6지표 통계 + 서사 문장 필드를 저장한다. 통계는 종료 후 리포트 체인에서 결정론으로 계산, AI 서사는 별도 Celery 태스크가 초안만 채우고, 상담사 수정본은 별도 필드로 보존한다. 신규 읽기 API 2개(요약·리포트) + 수정 PATCH 1개 + 안내 상태 API.
- **Tech Stack:** FastAPI/Pydantic v2/SQLAlchemy/Celery, PostgreSQL JSONB, React 18 + TS + TanStack Query + Recharts, vitest, pytest(SQLite + `backend/tests/pg/`).

## Global Constraints

- 범위는 **명상 클래스 회차**(`session.class_id` 있음, `report_domain(session)=="meditation"`)만. 상담(1:1) 화면·리포트·API 응답은 변경 전과 동일(회귀 금지).
- 종합점수·합산점수·순위·좋음/나쁨 판정·방향 우열색 **없음**(P1·P7). 없는 값은 0으로 채우지 않고 `—` + 사유(P3).
- 클래스 평균·범위·변화량은 지표별 **측정 2명 이상일 때만**(결정 1). 1명이면 ‘측정 1명 — 참여자별 결과에서 확인’.
- 모든 숫자는 서버 계산값. **AI는 숫자·이름·상태 문구를 쓰지 않는다.** AI 호출은 Celery 태스크에서만, 회차당 1회, 입력은 이름 없는 집계뿐, **비공개 메모(`counselor_notes`)·상담사 수정문장 전송 금지**.
- `any` 금지, 불변 갱신, 파일명 kebab-case(FE)/snake_case(BE), 주석 한글(why 위주), 커밋 `feat(sdd-237): …`.
- 테스트에서 **실제 AI/외부 네트워크 호출 금지**(mock). 실제 서버·DB·`.env`·메일·배포 접근 금지.
- 마이그레이션은 **BE 워커 1명만** 만든다. `python3 scripts/check-alembic-heads.py`로 헤드 1개 확인.
- 면책(`WELLNESS_DISCLAIMER`) 모든 화면 유지. 사용자 문구는 관찰 어조(‘~해요’), 금지어: 종합·순위·상위·하위·우수·부족·양호·불량·좋아졌·나빠졌·주의가 필요·개선·악화·회복·호전·치료·진단·효과.

---

## 1. 범위 판단

### 1.1 이번 SDD에 포함

| # | 항목 | 비고 |
|---|---|---|
| 1 | 명상 클래스 종료 후 **회차 요약**(`/sessions/:id/summary`)으로 ‘기록 보기’ 동선 교체 | 명상(class_id 있음)만. 상담은 기존 EndingScene→/record 유지 |
| 2 | **상담사 클래스 리포트** = `content.class_report` 확장(S1~S5 + 참여자별), 6지표 통계 서비스, 상태 코드 | 마이그레이션 없음 |
| 3 | **AI 서사**(규칙 문장으로 먼저 완결, `ai_features_enabled`로 켬) + 검증·필드별 폴백·회차당 1회 | 별도 Celery 태스크 |
| 3-1 | **상담사 서사 수정·저장·되돌리기**(10/23 결정 10) | §4.5. 재생성 버튼은 제외 |
| 4 | 클래스 일괄 승인·승인 현황·자동 승인 집계 **type=client만** | §4.8 |
| 5 | 자동 승인 **부분 포함**: 명상 한정 ‘무데이터 리포트 자동 승인 제외’ + ‘자동 초안 비공개 메모 제외’ | §1.2 |
| 6 | 진행 기록 선택 + **회차당 1회 안내**(서버 저장) + **전체 안내 끄기**(설정) | §4.7 |
| 7 | 개인정보 안내 한 줄(이름 없는 수업 통계를 외부 AI(Gemini)로 전송) | `frontend/src/lib/privacy-policy.ts` |

### 1.2 자동 승인 C안 — 판단: **본체는 별도 SDD로 분리, 작은 두 조각만 포함**

근거:
1. C안 본체(상담/명상 영역별 모드, 유예 0/5/10/30, 이번 회차 보류, 예약·실행 worker/outbox, 정책 snapshot, 감사 이력, 구 `enabled` API 호환)는 **DB 컬럼·영속 예약 실행**이 필요하다(`auto-approve-policy.md` §4.3). 현재 코드는 `User.auto_approve_report` 단일 bool이고, 생성 경로 3곳(`report_service.py:411–425,454,500–505`)에 판정이 흩어져 있다. 이를 하나의 resolver로 통합하고 예약 worker를 도입하는 일은 이 SDD(요약·리포트 화면)와 독립적으로 검증해야 하며, 상담 도메인에도 영향을 준다. 같은 PR에 넣으면 리스크가 합쳐진다.
2. 유예 기본값이 **0분(= 현행과 동일한 즉시 승인)**이므로, 본체가 없어도 회차 요약은 ‘자동 승인 즉시 적용’(켬) / ‘검토 대기 N명’(끔)만 정확히 표시하면 된다. 보류 버튼·예정 시각은 유예>0에서만 의미가 있어 이번에 필요 없다.
3. 포함하는 두 조각은 **예약·컬럼 없이** 코드 몇 줄과 테스트로 끝나고(결정 4), 명상 한정이라 상담 회귀가 없다.
   - (a) **무데이터 리포트 자동 승인 제외**: 명상 회차의 `type=client` 리포트가 `content.eeg.status` 없음/`not_measured`이면 자동 승인하지 않고 `pending_review`로 둔다(수동 승인 가능). 품질 경고(degraded/invalid/lost)까지 넓히는 것은 본체 SDD.
   - (b) **자동 초안에서 비공개 메모 제외**: 명상(그룹)은 이미 초안 입력에서 `counselor_notes`를 쓰지 않으므로(`report_comment_service.py:139–173`) 명시 파라미터 `include_private_notes=False`를 자동 승인 경로(명상)에 고정하고 **입력 spy 테스트**로 못 박는다. 상담(비그룹) 자동 초안 변경은 본체 SDD.
4. 위 (a)로 인해 ‘자동 승인 켬’ 상담사의 **LINK BAND 없이 진행한 명상 클래스 리포트는 더 이상 자동 발송되지 않는다**(대표님 결정 4). 요약 S6에 ‘측정·기록이 없어 자동 승인에서 제외된 리포트 N건’을 표시해 알린다.

### 1.3 범위 밖 (별도 SDD로 미룸)

| 항목 | 이유 |
|---|---|
| 자동 승인 C안 본체(영역별 모드 컬럼·유예 0/5/10/30·보류·예약 worker·정책 snapshot·상담 영역 변경·품질 경고 수동 검토) | 위 §1.2. **별도 SDD 제안: ‘자동 승인 정책 C안’** (번호는 TASK BOX가 `scripts/sdd new`로 발급) |
| 상담(1:1) 회차 요약·6지표 카드·회차 추이 스파크라인 | 상담 화면 제외 지시 |
| 진행 기록 편집 개선(조건부 저장 revision/409, dirty 이탈 가드, 저장 시각 표기, 수정 이력 권한 점검 — spec §3·§5.C) | 기록 편집기 별도 개선건. 이번에는 기존 `/sessions/:id/record`를 그대로 연다 |
| AI 서사 **재생성 버튼**·일/기관 호출 상한·클래스 서사 캐시(`cls:`) | 결정 10(재생성 제외). 필요 시 제안만 |
| 클래스 전체·기간 합산 리포트, 회차 간 비교, 방향 분포 외 개인 순위류 | 기획 비범위 |
| 설정 화면의 자동 승인 영역별 UI | 본체 SDD (이번엔 안내 끄기 토글 1개만) |
| 참여자 리포트 일괄 승인/재발송 UI를 요약에 신설 | 요약은 단건 상세 승인 재사용(spec §5.B) |
| STT 재활성화, 리포트 발행 파이프라인 재작성, 새 메시징 엔진 | 비범위 |

---

## 2. 아키텍처

```
[종료] session completed
  → generate_reports_for_session (report_task)             ─ 기존 체인
       counselor 리포트 생성(generate_report_inline)
         └ meditation 분기: class_report_stats_service.compute()  ─ 결정론, 규칙 문장 포함
              → content.class_report 저장 (narrative.fields[*].rule_text, source="rule")
       client 리포트들 생성 (기존)
  → enqueue tasks.class_report_narrative(session_id)        ─ 별도 큐(report)
       AI 켜짐 & 상태가 호출 대상 → Gemini 1회 → 필드별 검증 → ai_draft 채움(수정본은 건드리지 않음)
[화면]
  GET  /sessions/{id}/class-summary   → 요약(S0·S1·S2·S6)
  GET  /sessions/{id}/class-report    → 리포트(R1~R5, 참여자 행은 실시간 상태 결합)
  PATCH /sessions/{id}/class-report/narrative → 서사 문장 수정/되돌리기
  POST /sessions/{id}/note-prompt/{claim|dismiss}, GET/PATCH /users/me/session-note-prompt
```

핵심 결정:
- **통계 정본은 `class_report` 블록 하나.** 요약과 리포트가 같은 블록을 읽어 숫자 불일치가 없다.
- **정규화 후 개인 평균 → 참여자 동등 가중 평균.** 정규화는 `eeg_metrics.normalize_*` + 활성 `NormalizationModel`(`report_task._build_eeg_content`와 동일 규칙)을 쓰고, 정규화 버전이 다르면 평균하지 않는다. 기존 `content.eeg`(혼합 집계)는 **삭제하지 않는다**.
- **서사는 필드 단위 상태 기계**(§4.5). 표시 문장 = `edited_text`(source=edited) → 없으면 `ai_draft`(source=ai) → 없으면 `rule_text`(source=rule).
- 안내 상태 저장은 **서버, 마이그레이션 1건(additive 3컬럼)** — §4.7 근거.

### 2.1 통계 서비스 확정 정의 (구현 모호성 제거)

| 항목 | 정의 |
|---|---|
| 대상 | `report_scope.scope_for_session`의 `included_ids` 참여자 중 출석(excused/withdrawn/removed 제외). 제외자는 어떤 집계에도 기여 0 |
| 표본 | `EEGFeatureWindow`, 구간 필터는 `_build_eeg_content`와 동일(`device_timestamp_ms` 우선, 없으면 `created_at`; started_at~ended_at) |
| 마음 3지표 | 윈도우 `quality in (valid, degraded)`이고 세션 상태 valid/degraded인 것만. 윈도우별 정규화 후 개인 평균. 단위 `%`, 전후 차이 `%p` |
| 몸 3지표 | `heart_rate`(bpm)·`respiratory_rate`(회/분)·`sdnn`(ms) non-null 윈도우(EEG 품질과 독립). 전후 차이는 원 단위 |
| 측정자 | 지표별 **개인 유효 초 ≥ `MIN_VALID_SEC=60`** 이고 전·후반 각 `≥30초`면 ‘비교 가능’, 전체만 ≥60초면 ‘측정’ |
| 유효 초 | 개인·지표별 유효 윈도우의 `floor(device_timestamp_ms/1000)` **고유 초 개수**(중복·재시작 중복 제거). 초 단위 구간이 세션 길이를 넘지 않게 cap |
| 유효 시간/비율 | `valid_min = 개인 유효 초/60`의 참여자 평균, `valid_ratio = 개인 유효 초/세션 초`의 참여자 평균. 기존 `coverage_ratio`를 쓰지 않는다 |
| 전·후반 | 개인별 **실행 세그먼트(`play_group_id`)마다 중간점**으로 나눠 세그먼트 평균 후 동일 가중(`report_narrative.build_metrics_summary`와 같은 규칙) → 개인 early/late/Δ → 클래스 early/late는 개인 값의 동등 가중 평균 |
| 방향 | `report_narrative`의 임계 재사용: 호흡 1회/분, 심박 3bpm, HRV 5ms, 마음 3지표 변화율 5% 미만이면 stable. 비교 인원 2명 미만이면 방향 없음 |
| 평균/범위 | `mean` = 개인 회차 평균의 동등 가중 평균, `min/max` = 개인 회차 평균의 최소/최대(전체 표본 극값 아님) |
| 시계열 | 버킷 `bucket_min = 5`(세션 30분 미만이면 2). 버킷별 개인 평균 → 측정 `n≥2`인 버킷만 클래스 값(동등 가중), 나머지 `v=null`(선을 잇지 않음) |
| 방향 분포 | 비교 가능 인원 **3명 이상**일 때만 `agreement{up,stable,down}`, 아니면 `null` |
| 상태 코드 | 우선순위 `zero`(출석 0) > `pending`(생성 미완) > `error`(계산 예외) > `unworn`(측정자 0 & 유실 0) > `lost`(측정자 0 & 유실만) > `single`(측정자 1) > `poor_signal`(측정자≥2인데 일부 지표 측정<2) > `partial`(출석·대상 중 일부 미측정) > `measured`. 해당되는 보조 사유는 `flags[]`(`partial|lost|poor_signal`)로 중복 표기 |
| 참여자 상태 | `measured | unworn | poor_signal | lost | excluded` (정상 종료 후 연결 해제를 lost로 세지 않는다 — 기존 `_measurement_intent` 재사용) |

---

## 3. 파일 소유권 (겹침 금지)

> 공통 계약 파일: **FE가 `frontend/src/lib/class-report/fixtures/*.json`을 §4의 예시대로 먼저 만든다(Task F0). BE는 그 파일을 읽기 전용으로 Pydantic에 검증**해 계약 드리프트를 막는다. 다른 상대 경로는 수정 금지.

### 3.1 BE 워커 (`sdd/237-be`) 소유

| 경로 | 구분 |
|---|---|
| `backend/app/services/class_report_stats_service.py` | 신규 — 6지표 통계·시계열·상태 코드·규칙 서사 입력 |
| `backend/app/services/class_report_narrative.py` | 신규 — 규칙 문장 사전, 프롬프트 `CLASS_NARRATIVE_PROMPT_V1`, 입력 빌더, 검증, 필드 상태 기계(§4.5) |
| `backend/app/services/class_summary_service.py` | 신규 — 요약/리포트 조회 DTO 조립, 승인 현황, 참여자 행, 권한 |
| `backend/app/tasks/class_report_task.py` | 신규 — `tasks.class_report_narrative` |
| `backend/app/schemas/class_report.py` | 신규 — Pydantic v2 블록·응답·PATCH 스키마 |
| `backend/app/api/v1/class_summary.py` | 신규 — 신규 엔드포인트 5종 |
| `backend/app/api/v1/__init__.py` | 변경 — 라우터 등록 1줄 |
| `backend/app/api/v1/account.py` | 변경 — `GET/PATCH /users/me/session-note-prompt` |
| `backend/app/tasks/report_task.py` | 변경 — counselor 분기에서 class_report 저장(수정본 보존), 체인 끝 enqueue |
| `backend/app/core/celery_app.py` | 변경 — include/큐 등록 |
| `backend/app/services/class_report_job_service.py` | 변경 — `classify_target` type 가드, 대상 쿼리 type 필터 |
| `backend/app/services/report_service.py` | 변경 — `approve_all_reports` 클래스 회차 counselor 제외, 자동 승인 무데이터 제외(명상), 초안 `include_private_notes`, 회원 직렬화에서 `class_report` 제거 |
| `backend/app/services/report_comment_service.py` | 변경 — `include_private_notes` 파라미터(기본 현행 유지) |
| `backend/app/services/dashboard_service.py` | 변경 — 클래스 회차의 counselor 리포트를 승인 대기 집계에서 제외 |
| `backend/app/models/user.py`, `backend/app/models/session.py` | 변경 — 컬럼 추가(§4.7) |
| `backend/alembic/versions/<rev>_sdd237_note_prompt.py` | 신규 — **BE 워커만** |
| `backend/tests/**` (신규 파일 `test_class_report_*.py`, `pg/test_sdd237_*.py`) | 신규 |

### 3.2 FE 워커 (`sdd/237-fe`) 소유

| 경로 | 구분 |
|---|---|
| `frontend/src/lib/class-report/**` (`types.ts`, `state-copy.ts`, `narrative-fields.ts`, `format.ts`, `fixtures/*.json`, `mocks.ts`) | 신규 |
| `frontend/src/lib/api/class-summary.ts` | 신규 — API 클라이언트(mock 스위치 포함) |
| `frontend/src/components/class-report/**` (`ClassNarrativeReport.tsx`, `MetricStoryCard.tsx`, `FlowChart.tsx`, `ParticipantTable.tsx`, `NarrativeText.tsx`(수정 UI), `class-report.css`) | 신규 |
| `frontend/src/components/session-summary/**` (`SummaryHeader`, `HeadcountStrip`, `TodoSection`, `NotePromptCard`, `session-summary.css`) | 신규 |
| `frontend/src/pages/sessions/session-summary-page.tsx`, `frontend/src/pages/sessions/class-report-page.tsx` | 신규 |
| `frontend/src/App.tsx` | 변경 — 라우트 2개 |
| `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 변경 — 명상 종료 후/재접속 진입을 요약으로(상담 분기 불변) |
| `frontend/src/components/class/flow/host/EndingScreen.tsx`, `frontend/src/lib/class/flow/host-ending-model.ts` | 변경 — 명상 CTA ‘회차 요약 보기’ |
| `frontend/src/components/reports/ReportDetailView.tsx` | 변경 — `counselor && content.class_report`이면 클래스 리포트 렌더 |
| `frontend/src/components/class/structure/class-report-manage.tsx`, `use-session-report-rows.ts` | 변경 — 승인 현황 `type==='client'`만 집계 |
| `frontend/src/pages/sessions/SessionDetailPage.tsx`, `frontend/src/pages/records/SessionRecordPage.tsx` | 변경 — 완료 명상 회차에 ‘회차 요약으로’ 링크만 |
| `frontend/src/pages/SettingsPage.tsx` + `frontend/src/components/settings/session-note-prompt-toggle.tsx` | 변경/신규 — 전체 안내 끄기 토글 |
| `frontend/src/lib/privacy-policy.ts` | 변경 — 외부 AI 전송 안내 한 줄 |
| `frontend/tests/class-report-*.test.ts(x)`, `frontend/tests/session-summary-*.test.tsx`, `frontend/e2e/**`(있으면) | 신규 |

### 3.3 건드리지 않는 것
`designs/**`, `specs/**`(plan·verify·summary 외), `docs/**`, 상담 화면(`/counseling/**`), `SessionRecordPage`의 편집 로직·`CounselorNotesTab.tsx`, `.github/**`, `.env*`.

---

## 4. BE↔FE API 계약 (FE는 mock으로 먼저 개발)

공통: `Authorization: Bearer`(기존), 경로 접두 `/api/v1`. 시각은 ISO8601(UTC `Z`). 지표 키 고정: `respiration, bpm, hrv`(몸) / `focus, relaxation, emotional`(마음). UI 라벨·단위·색은 `PLAYER_METRICS`(spec §5.E.1)와 일치(FE 소유). 모든 응답에 `fetched_at`.
**권한**(요약·리포트 조회): 진행 상담사(host) / `class_team_read_enabled` 충족 시 lead·assistant(`can_read_team_material`) / 같은 기관 org_admin(`admin_can_read_meditation_report`, 결정 A 현행 유지, 원본 자료 마스킹 `_RAW_FIELDS` 유지). 회원·타 기관·비참여자는 403(`report_read_forbidden`) 또는 404. 세션이 명상 클래스가 아니면 `400 not_class_session`(FE는 기존 흐름으로 폴백), 미종료면 `409 not_completed`.
**편집 권한(`capabilities.can_edit_narrative`)**: 해당 회차 진행 상담사(`session.host_id`) 또는 클래스 lead 강사만 true. assistant·org_admin·회원은 false(PATCH 403 `narrative_edit_forbidden`).

### 4.1 `GET /sessions/{session_id}/class-summary` — 회차 요약

```json
{
  "session": {
    "id": "5b0a…", "class_id": "c91f…", "class_name": "아침 호흡 명상", "seq": 3,
    "started_at": "2026-10-23T09:00:04Z", "ended_at": "2026-10-23T09:45:10Z", "duration_min": 45,
    "domain": "meditation"
  },
  "headcount": { "attended": 6, "measured": 4, "report_targets": 5, "excluded": 1 },
  "report": { "id": "r_cls_1", "generation_status": "ready", "state": "ready", "narrative_pending": false },
  "class_report": {
    "available": true,
    "status": "measured",
    "flags": ["partial"],
    "scope": { "attended": 6, "measured": 4, "included": 5, "duration_min": 45, "bucket_min": 5 },
    "headline": { "text": "45분 수업 동안 측정한 4명의 호흡과 심박이 …", "source": "ai", "edited_by_name": null, "edited_at": null },
    "chips": {
      "body": [
        { "key": "respiration", "direction": "down", "state": "ok" },
        { "key": "bpm", "direction": "down", "state": "ok" },
        { "key": "hrv", "direction": null, "state": "missing" }
      ],
      "mind": [
        { "key": "focus", "direction": "up", "state": "ok" },
        { "key": "relaxation", "direction": "up", "state": "ok" },
        { "key": "emotional", "direction": "stable", "state": "ok" }
      ]
    }
  },
  "approval": {
    "auto_approve": { "enabled": true, "grace_minutes": 0 },
    "counts": { "generating": 0, "pending_review": 1, "approved": 3, "error": 0, "no_data_manual": 1 },
    "participants_total": 5
  },
  "note_prompt": { "eligible": true, "has_note": false, "seen": false, "dismissed": false, "user_enabled": true },
  "next_session": { "id": "7c11…", "seq": 4, "scheduled_at": "2026-10-30T09:00:00Z" },
  "capabilities": { "can_edit_narrative": true, "can_write_note": true, "can_approve": true },
  "fetched_at": "2026-10-23T09:47:00Z"
}
```

- `class_report.available=false`(리포트 행 없음/생성 중)이면 `status:"pending"`, `headline:null`, `chips:{body:[],mind:[]}`.
- `status`는 §2.1 코드(`zero|pending|error|unworn|lost|single|poor_signal|partial|measured`). `chips[].state ∈ ok|single|missing|poor_signal`. `direction ∈ up|down|stable|null`.
- `headline.source ∈ rule|ai|edited`. `edited`이면 `edited_by_name`·`edited_at` 채움.
- `approval.counts`는 **`type=client`만** 센다(§4.8). `no_data_manual` = 무데이터로 자동 승인 제외되어 `pending_review`에 남은 건. `grace_minutes`는 이번 SDD에서 항상 `0`(필드는 본체 SDD용 자리).
- `next_session=null` 가능. `note_prompt.eligible`은 서버가 계산(host·기록 없음·미안내·`user_enabled`). 호출자가 host가 아니면 `eligible:false`.
- 분석 중이면 `status:"pending"`, `headcount.measured:null`(‘확인 중’).

### 4.2 `GET /sessions/{session_id}/class-report` — 상담사 클래스 리포트

```json
{
  "session": { "id": "5b0a…", "class_name": "아침 호흡 명상", "seq": 3, "ended_at": "2026-10-23T09:45:10Z", "duration_min": 45 },
  "report": { "id": "r_cls_1", "generation_status": "ready", "state": "ready", "narrative_pending": false },
  "block": {
    "schema_version": 1,
    "status": "measured",
    "flags": ["partial"],
    "normalization_version": "v3",
    "scope": { "attended": 6, "measured": 4, "included": 5, "duration_min": 45, "bucket_min": 5, "split_min": 22.5 },
    "metrics": {
      "focus": {
        "unit": "%", "state": "ok", "measured": 4, "compared": 4,
        "mean": 57.0, "min": 44.0, "max": 68.0, "early": 52.0, "late": 61.0, "delta": 9.0, "direction": "up",
        "valid_min": 36.0, "valid_ratio": 0.8,
        "agreement": { "up": 3, "stable": 1, "down": 0 },
        "missing_reason": null,
        "series": [ { "t_min": 0, "v": 49.2, "n": 4 }, { "t_min": 5, "v": 50.8, "n": 4 }, { "t_min": 10, "v": null, "n": 1 } ]
      },
      "hrv": {
        "unit": "ms", "state": "poor_signal", "measured": 1, "compared": 0,
        "mean": null, "min": null, "max": null, "early": null, "late": null, "delta": null, "direction": null,
        "valid_min": null, "valid_ratio": null, "agreement": null,
        "missing_reason": "signal_insufficient", "series": []
      }
    },
    "narrative": {
      "prompt_version": "cr-1", "model": "gemini-2.5-flash", "input_hash": "9f2c…",
      "generated_at": "2026-10-23T09:47:30Z",
      "ai_attempt": { "hash": "9f2c…", "outcome": "ok", "at": "2026-10-23T09:47:30Z" },
      "fields": {
        "headline":      { "text": "…", "source": "ai", "ai_draft": "…", "rule_text": "…", "edited_text": null, "edited_by": null, "edited_by_name": null, "edited_at": null, "stale": false, "max_len": 200 },
        "flow":          { "text": "집중도는 전반 52%에서 후반 61%로 올랐어요.", "source": "rule", "ai_draft": null, "rule_text": "…", "edited_text": null, "edited_by": null, "edited_by_name": null, "edited_at": null, "stale": false, "max_len": 150 },
        "body_subtitle": { "text": "…", "source": "edited", "ai_draft": "…", "rule_text": "…", "edited_text": "…", "edited_by": "u_1", "edited_by_name": "채 상담사", "edited_at": "2026-10-23T10:02:11Z", "stale": false, "max_len": 150 },
        "mind_subtitle": { "…": "동일 형태" },
        "metric.respiration": { "…": "동일 형태, max_len 100" },
        "participant.p_1": { "…": "동일 형태, 참여자 한 줄, max_len 100" }
      },
      "fallback_fields": ["mind_subtitle"]
    },
    "participants": [
      { "participant_id": "p_1", "state": "measured",
        "metrics": { "focus": { "mean": 61.0, "early": 55.0, "late": 66.0, "delta": 11.0, "direction": "up", "valid_min": 38.0, "valid_ratio": 0.84 } } }
    ]
  },
  "participants": [
    {
      "participant_id": "p_1", "display_name": "김하늘", "kind": "member", "order": 1,
      "included": true, "exclusion": null, "measurement": "measured",
      "report": { "id": "r_p1", "generation": "ready", "approval": "pending_review", "delivery": "not_requested" },
      "narrative_field": "participant.p_1"
    }
  ],
  "capabilities": { "can_edit_narrative": true },
  "fetched_at": "2026-10-23T09:47:00Z"
}
```

- `block=null`이면 리포트 생성 전/분석 중(`report.state:"processing"`). 오류는 HTTP 500이 아니라 `block.status:"error"`로 표현 가능한 경우 그렇게, 조회 자체 실패는 5xx → FE ‘다시 불러오기’.
- `metrics.*.state ∈ ok|single|missing|poor_signal|lost|unworn`. `state!="ok"`이면 수치 필드는 모두 `null`, `series:[]`(0 치환 금지). `single`이면 평균·범위·변화·시계열 `null`.
- `narrative.fields`는 §4.5 상태 기계. 모든 `text`는 서버가 합성한 **표시 문장**(편집본 > AI > 규칙). FE는 `source`로 라벨(‘AI 요약’ / ‘상담사 수정 · 이름 · 시각’ / 없음)만 정한다. `stale=true`는 수정 이후 통계 입력(`input_hash`)이 바뀐 경우.
- 참여자 행의 이름은 **이 응답에만** 있고(`display_name`: 회원=users.name, 게스트=guest_name) 블록(JSONB)에는 저장하지 않는다. 이름으로 조인하지 않는다.
- `participants[].report.generation ∈ pending|processing|ready|failed|none`, `approval ∈ pending_analysis|pending_review|completed|error|none`, `delivery ∈ not_requested|waiting|sent|failed|no_address|unknown`(`participant.report_email_status` 기반; **`sent_at`만으로 sent 금지**). `exclusion ∈ null|not_included|absent`. 제외 행은 `report.id:null`.
- 개인 한 줄 초안은 기존 개인 리포트 `content.eeg.narrative` 앞 문장을 **규칙 사전 문장으로 재조립**(판정어 혼입 방지; counselor-class-report §8 추천안). 수정 가능 필드 `participant.<participant_id>`.

### 4.3 `GET /sessions/{session_id}/class-report` 오류
`400 not_class_session` · `403 report_read_forbidden` · `404 session_not_found` · `409 not_completed`.

### 4.4 (예약) 리포트 상세 호환
`GET /reports/{id}`(기존)는 변경 없이 `content.class_report`(블록 전체, `participants[].metrics` 포함, **이름 없음**)를 돌려준다. FE는 신규 `class-report` 엔드포인트를 주로 쓰고 `ReportDetailView`는 `class_report` 존재 여부 판단에만 쓴다. 회원 직렬화 경로는 `class_report` 키를 제거한다(이중 방어).

### 4.5 서사 문장 수정·저장 — `PATCH /sessions/{session_id}/class-report/narrative`

요청(필드 1개씩):
```json
{ "field": "headline", "text": "오늘은 호흡이 느려지는 쪽으로 …", "base_edited_at": null }
```
되돌리기:
```json
{ "field": "headline", "revert": true }
```
응답 `200`: 변경된 필드 하나와 시각.
```json
{
  "field": "headline",
  "value": { "text": "…", "source": "edited", "ai_draft": "…", "rule_text": "…", "edited_text": "…", "edited_by": "u_1", "edited_by_name": "채 상담사", "edited_at": "2026-10-23T10:02:11Z", "stale": false, "max_len": 200 },
  "fetched_at": "2026-10-23T10:02:11Z"
}
```
규칙:
- **편집 가능 키**: `headline`(S1 한 줄), `flow`(S3 수업 흐름 문장), `body_subtitle`·`mind_subtitle`(S4 소제목), `metric.<key>`(지표 문장 6개), `participant.<participant_id>`(S5 한 줄). 그 밖의 키·수치·그래프·상태 문구(S2)·면책은 `422 field_not_editable`.
- 검증: `text`는 앞뒤 공백 제거 후 **1자 이상**, 필드별 `max_len`(headline 200 / flow 150 / subtitle 150 / metric 100 / participant 100) 이하, 제어문자 불가. 빈 문자열/공백만 → `422 empty_text`(비우려면 `revert`). 초과 → `422 text_too_long`. AI용 금지어 필터는 **상담사 입력에는 적용하지 않는다**(책임은 수정자 기록으로).
- 저장: `edited_text`, `edited_by`(user id), `edited_at` 기록, `source="edited"`. **`ai_draft`와 `rule_text`는 보존**한다. `revert:true`는 `edited_text/edited_by/edited_at`을 비우고 `source`를 `ai_draft`가 있으면 `ai`, 없으면 `rule`로 되돌린다(수정 이력 로그에는 키·사용자·시각만 남기고 **문장 원문은 남기지 않는다**).
- 동시성: `SELECT … FOR UPDATE`로 리포트 행 잠금. `base_edited_at`이 오고 현재 `edited_at`과 다르면 `409 edit_conflict`(응답에 최신 `value`).
- 권한: `capabilities.can_edit_narrative`만. 그 외 `403 narrative_edit_forbidden`. 미종료 `409 not_completed`, 블록 없음 `409 report_not_ready`.
- **수정본 보호 규칙(BE 필수)**: ① AI 태스크는 `source=="edited"`인 필드의 `text`/`source`를 바꾸지 않는다(초안만 `ai_draft`에 갱신 가능) ② 리포트 재생성(`generate_report_inline`)은 통계를 다시 계산하되 기존 `edited_*`·`source=="edited"`를 그대로 이월한다 ③ 통계 입력이 바뀌면 수정본은 유지하고 `stale=true`로 표시 ④ 수정 문장은 **AI 입력에 절대 포함하지 않는다**.
- ‘올리기’ = 리포트에 저장(상담사·기관관리자 열람). **회원 발송·자동 승인과 무관**(알림·메일·AI 대화 훅 호출 0).
- 응답 `edited_by_name`은 users.name 조회(저장은 id만).

### 4.6 서사 필드 상태 기계 (BE `class_report_narrative.py`)

```
field = { rule_text (항상 있음, 결정론), ai_draft (없을 수 있음), edited_text (없을 수 있음),
          source ∈ rule|ai|edited, edited_by, edited_at, edited_input_hash }
text 해석: source==edited → edited_text / source==ai → ai_draft / 아니면 rule_text
통계 계산: rule_text 갱신(항상). source==edited면 text 유지, edited_input_hash != 현재 hash → stale
AI 태스크: 필드별 검증 통과 시 ai_draft 갱신 + (source!=edited이면) source="ai". 실패 필드는 rule 유지(+fallback_fields)
수정(PATCH): edited_* 기록 + source=edited
되돌리기(PATCH revert): edited_* 비움 + source=(ai_draft?ai:rule)
```

### 4.7 안내 상태 · 전체 끄기

- **저장 결정(마이그레이션 최소화)**: 브라우저 저장은 기기 전환·삭제에 취약해 제외. `notification_preferences` JSONB 재사용은 `notification_service.py`가 `email/in_app/push` 3키만 재구성해 저장하므로 **추가 키가 지워진다** → 부적합. 리포트 `content`에 넣으면 재생성 시 덮어씌워질 수 있음 → 부적합. 따라서 **additive nullable 컬럼 3개, 마이그레이션 1건**:
  - `users.show_session_note_prompt BOOLEAN NOT NULL DEFAULT true`(server_default `true`)
  - `sessions.note_prompt_seen_at TIMESTAMPTZ NULL`, `sessions.note_prompt_dismissed_at TIMESTAMPTZ NULL`
  - 안내 대상은 회차의 진행 상담사(host) 1명이므로 `session` 컬럼이 `(session, counselor)` 키와 동치다. 호스트 교정 시 상태는 이어받는다(드문 경우, 허용). 메모 내용·개인정보 저장 없음. 기존 행은 NULL=미안내.
- `POST /sessions/{id}/note-prompt/claim` → `{ "show": true }`. **원자적**: `UPDATE sessions SET note_prompt_seen_at=now() WHERE id=:id AND note_prompt_seen_at IS NULL AND host_id=:me` 의 rowcount==1일 때만 `show:true`. 이미 seen/기록 존재/`user_enabled=false`/host 아님 → `show:false`. FE는 요약 로드 후 `note_prompt.eligible`일 때만 1회 호출, **실패·불명이면 카드를 표시하지 않고 조용한 작성 버튼만**.
- `POST /sessions/{id}/note-prompt/dismiss` → `{ "dismissed_at": "…" }` 멱등(이미 있으면 기존 시각 반환). seen만 있어도 재노출 없음. 기록을 지워도 초기화 안 함.
- `GET /users/me/session-note-prompt` → `{ "enabled": true }`, `PATCH` body `{ "enabled": false }` → 동일 형태. 자동 승인·기존 기록 영향 없음. 다시 켜면 아직 안내하지 않은 회차에만 적용.
- 권한: counselor/org_admin 본인 계정만.

### 4.8 승인 집계 type=client 수정 (BE)

| 지점 | 변경 |
|---|---|
| `class_report_job_service.classify_target` | `report.type != "client"` → `("excluded","not_target")` (권한 검사보다 앞) |
| `class_report_job_service` 대상 수집 쿼리(`accept_job` 경로) | `Report.type == "client"` 조건 |
| `report_service.approve_all_reports` | 쿼리에 `NOT (Report.type=="counselor" AND Session.class_id IS NOT NULL)`. **상담 도메인 동작 불변** |
| `dashboard_service.py:91` | 클래스 회차(`class_id`)의 counselor 리포트는 `pending_review_count`에서 제외 |
| `class_summary_service` 승인 카운트 | `type=client`만 |
| FE `class-report-manage.tsx`, `use-session-report-rows.ts` | 표시 집계 `type==='client'`만 |
| `agent_policy.py:772` (루시 승인 대기 목록) | 변경하지 않음(범위 밖) — 리스크 §6 |
상담사용 리포트의 기존 자동 승인 동작(`report_service.py:411–425`) 자체는 건드리지 않는다.

### 4.9 FE mock 규칙
`frontend/src/lib/class-report/fixtures/`: `summary-{normal,partial,single,poor,lost,unworn,pending,error,zero}.json`, `report-{동일 9종}.json`, `report-edited.json`(편집본 포함), `patch-*.json`. `class-summary.ts`는 `VITE_CLASS_REPORT_MOCK=1`(또는 쿼리 `?mock=<state>`)에서 이 fixture를 반환한다. 이 fixture가 계약의 단일 사본이며 BE 계약 테스트가 Pydantic으로 검증한다.

---

## 5. Task 목록 (순서·의존)

표기: **B**=BE 워커, **F**=FE 워커. `→`는 선행 의존. B와 F는 §4 계약만 공유하고 병렬 진행한다. 통합은 마지막(I1~I3).

| # | Task | 담당 | 선행 | 산출 |
|---|---|---|---|---|
| F0 | 계약 타입·fixture 9+종·mock 클라이언트 | F | – | `lib/class-report/**`, `lib/api/class-summary.ts` |
| B1 | 마이그레이션(3컬럼)+모델+설정 토글 API+안내 claim/dismiss API | B | – | alembic 1건, `account.py`, `class_summary.py` 일부 |
| B2 | 통계 서비스(6지표·시계열·상태 코드) | B | – | `class_report_stats_service.py` |
| B3 | 규칙 서사 사전 + 필드 상태 기계 + `class_report` 저장 훅(수정본 이월) | B | B2 | `class_report_narrative.py`, `report_task.py` |
| B4 | 요약/리포트 조회 DTO·권한·승인 현황·참여자 행 | B | B2,B3 | `class_summary_service.py`, 엔드포인트 2종 |
| B5 | 서사 수정/되돌리기 PATCH | B | B3,B4 | PATCH API, 감사 로그 |
| B6 | type=client 집계 수정 + 무데이터 자동 승인 제외 + 초안 비공개 메모 제외 + 회원 직렬화 방어 | B | – | §4.8, §1.2 |
| B7 | AI 서사 Celery 태스크(입력 빌더·검증·폴백·회차 1회·수정본 보호) | B | B3 | `class_report_task.py` |
| B8 | 계약 테스트(FE fixture ↔ Pydantic) + 상담 회귀 | B | B4,B5,F0 | `test_class_report_contract.py` |
| F1 | 라우트·요약 페이지 골격 + S0/S2/S6(승인·다음 회차) + 상태 9종 | F | F0 | `session-summary-page`, `session-summary/**` |
| F2 | 진행 기록 1회 안내 카드 + 조용한 작성 버튼 + 설정 토글 | F | F0 | `NotePromptCard`, `session-notes-toggle` |
| F3 | 클래스 리포트 페이지: S1·S2·S3(Recharts 흐름)·S4(지표 카드 6)·S5(표) + 상태 9종 | F | F0 | `class-report/**` |
| F4 | 서사 문장 수정 UI(수정/저장/취소/되돌리기, 출처 라벨, 409·403 처리) | F | F3 | `NarrativeText.tsx` |
| F5 | 종료 동선 교체(ClassPlayerPage·EndingScreen·재접속 리다이렉트·링크들) | F | F1 | 명상만, 상담 불변 |
| F6 | 승인 현황 type=client 표시 + ReportDetailView 분기 | F | F3 | |
| F7 | 개인정보 안내 한 줄 + 설정 문구 | F | – | `privacy-policy.ts` |
| F8 | vitest 전체 + 390/1440 스냅샷·검증 스크립트 | F | F1~F7 | |
| I1 | `sdd/237-integrate`에서 BE+FE 병합, mock 해제, 실제 API 연동 | 감독 | B8,F8 | |
| I2 | verify.md 시나리오 실행(§ verify 10장), 독립 검증 스크립트 | 감독 | I1 | |
| I3 | summary.md 작성, PR 1개 | 감독 | I2 | |

### 5.1 BE 상세

#### Task B1: 마이그레이션 + 안내 상태 + 설정 토글
**Files:** Create `backend/alembic/versions/<rev>_sdd237_note_prompt.py`, `backend/tests/test_sdd237_note_prompt.py`, `backend/tests/pg/test_sdd237_note_prompt_claim.py`; Modify `models/user.py`, `models/session.py`, `api/v1/account.py`, `api/v1/__init__.py`, create `api/v1/class_summary.py`(claim/dismiss 라우트), `schemas/class_report.py`.
**Produces:** `claim_note_prompt(db, session, user) -> bool`, `dismiss_note_prompt(...) -> datetime`, `get/set_show_session_note_prompt(db, user, enabled)`.
- [ ] Step 1: 실패 테스트 — 동일 회차 claim 2회 → 첫 `show:true`, 둘째 `false`; 다른 계정 claim `false`; `user_enabled=false`면 `false`; dismiss 멱등; 기록 있으면 `false`. PG 동시 claim 2개 스레드 → 정확히 1회 true.
- [ ] Step 2: `pytest backend/tests/test_sdd237_note_prompt.py -v` → FAIL 확인
- [ ] Step 3: 모델 3컬럼 + 마이그레이션(`server_default`), 서비스·라우트 구현(원자 UPDATE)
- [ ] Step 4: SQLite·PG 테스트 통과, `python3 scripts/check-alembic-heads.py` 헤드 1개
- [ ] Step 5: 커밋 `feat(sdd-237): 진행 기록 안내 상태·전체 끄기 API`

#### Task B2: 통계 서비스
**Files:** Create `services/class_report_stats_service.py`, `tests/test_class_report_stats.py`, `tests/pg/test_sdd237_class_stats_pg.py`.
**Produces:** `compute_class_stats(db, session) -> dict`(블록의 `status/flags/scope/metrics/participants` 부분, §4.2 스키마), `METRIC_KEYS`, `MIN_VALID_SEC=60`, `direction_for(metric_key, early, late) -> Literal["up","down","stable"]`.
- [ ] Step 1: 순수 함수 단위 테스트 먼저 — 합성 윈도우로 정규화 후 평균·동등 가중(한 사람 오래 측정해도 평균 지배 안 함)·`min/max`가 개인 평균 극값·전후 세그먼트 동일 가중·유효 초 중복 제거(같은 초 윈도우 100개=1초)·`measured<2`면 평균 null(`single`)·결측 0 치환 없음·정규화 버전 불일치 시 평균 금지
- [ ] Step 2: 상태 코드 표 테스트(§2.1 우선순위) 9종 + `flags`
- [ ] Step 3: 구현. 기존 임계/전후 계산은 `report_narrative`의 상수·헬퍼를 **재사용**(복사 금지). `report_task._build_eeg_content`는 수정하지 않는다
- [ ] Step 4: **독립 재계산 스크립트 테스트**(테스트 안에서 numpy 없이 순수 파이썬으로 같은 입력 재계산 후 일치 확인)
- [ ] Step 5: PG 테스트 — 실제 `eeg_feature` 행·`play_group_id`·`device_timestamp_ms` 중복. 커밋

#### Task B3: 규칙 서사 + 필드 상태 기계 + 저장 훅
**Files:** Create `services/class_report_narrative.py`, `tests/test_class_report_narrative_rules.py`; Modify `tasks/report_task.py`.
**Interfaces — Produces:** `build_rule_fields(block) -> dict[str, FieldDraft]`(headline/flow/body_subtitle/mind_subtitle/metric.*/participant.* 규칙 문장, class-narrative §2·§4.2 사전), `merge_fields(previous_fields, new_rule_fields, input_hash) -> dict`(수정본 이월·`stale` 계산), `resolve_text(field) -> str`.
- [ ] Step 1: 실패 테스트 — 방향 사전 문구, 측정 1명/결측 지표 문장 생략, 금지어 부재(전수 표 기반), 60/100자 제한, `merge_fields`: 수정본 `edited_text`가 재계산 후에도 유지·`input_hash` 바뀌면 `stale=true`·`ai_draft` 보존
- [ ] Step 2: 구현. 개인 한 줄은 `content.eeg.narrative` 앞 문장을 **쓰지 않고 방향 사전으로 재조립**
- [ ] Step 3: `report_task.generate_report_inline` counselor 분기에서 `report_domain(session)=="meditation"`일 때만 `class_report` 저장(`flag_modified`), 상담 분기 **무변경**. 예외는 `status:"error"` 블록으로 처리하고 리포트 상태는 바꾸지 않음
- [ ] Step 4: 재생성 이월 테스트(수정본 존재 상태에서 재생성 → 유지), 상담 세션 content 스냅샷 불변 테스트. 커밋

#### Task B4: 조회 DTO
**Files:** Create `services/class_summary_service.py`, `tests/test_class_summary_api.py`; Modify `api/v1/class_summary.py`.
**Produces:** `build_summary(db, session_id, viewer) -> ClassSummaryResponse`, `build_class_report(...) -> ClassReportResponse`, `can_edit_narrative(db, viewer, session) -> bool`.
- [ ] Step 1: 권한 표 테스트(host 200 / lead·assistant 팀 열람 조건 / org_admin 같은 기관 200·타 기관 403 / 회원 403 / 상담 세션 400 / 미종료 409)
- [ ] Step 2: 참여자 행 테스트(포함/제외/결석, 이름은 회원=users.name 게스트=guest_name, 이름으로 조인하지 않음, `delivery`는 `report_email_status` 기반이며 `sent_at`만이면 `unknown/waiting`)
- [ ] Step 3: 승인 카운트 type=client만·`no_data_manual`·`grace_minutes=0`·자동 승인 켬/끔 표시 데이터. 구현 후 커밋
- [ ] Step 4: 조회가 **쓰기·승인·메일·AI를 호출하지 않음** 확인(spy)

#### Task B5: 서사 수정 PATCH
**Files:** Modify `services/class_report_narrative.py`(`apply_edit`, `revert_edit`), `api/v1/class_summary.py`; Create `tests/test_class_report_narrative_edit.py`.
- [ ] Step 1: 실패 테스트 — 수정 저장(source edited, `ai_draft/rule_text` 보존, `edited_by/at` 기록) / 되돌리기 / 빈 문자열 422 `empty_text` / 길이 초과 422 / 편집 불가 키 422 / assistant·org_admin·회원 403 / host·lead 200 / `base_edited_at` 불일치 409 / 알림·메일·AI 호출 0(spy) / 로그에 문장 원문 없음
- [ ] Step 2: 구현(`FOR UPDATE`, `flag_modified`), 커밋

#### Task B6: type=client 집계 + 자동 승인 두 조각
**Files:** Modify `class_report_job_service.py`, `report_service.py`, `report_comment_service.py`, `dashboard_service.py`; Create `tests/test_class_report_job_type_guard.py`, `tests/test_sdd237_auto_approve_guard.py`.
- [ ] Step 1: 테스트 — 클래스 회차 counselor 리포트가 job 대상에서 `excluded/not_target`, `approve_all_reports`가 클래스 counselor를 승인하지 않고 **상담 counselor는 종전대로 승인**, 대시보드 대기 수에서 제외
- [ ] Step 2: 테스트 — 자동 승인 켬 + 명상 + `content.eeg.status` 없음/`not_measured`면 `pending_review` 유지·승인/알림/메일 0, `valid` 리포트는 종전대로 즉시 승인, 상담은 종전 동작
- [ ] Step 3: 테스트 — 명상 자동 초안 입력 spy에 `counselor_notes` 없음, `include_private_notes` 기본값은 현행 유지(상담 불변)
- [ ] Step 4: 회원 직렬화 방어(`class_report` 키 제거) 테스트·구현. 커밋

#### Task B7: AI 서사 태스크
**Files:** Create `tasks/class_report_task.py`, `tests/test_class_report_narrative_guard.py`, `tests/test_class_report_task.py`; Modify `services/class_report_narrative.py`, `core/celery_app.py`, `tasks/report_task.py`(enqueue).
**Produces:** `build_ai_input(block) -> dict`(이름 없는 집계), `validate_fields(raw, ai_input) -> (accepted: dict, rejected: list[str])`, 태스크 `tasks.class_report_narrative(session_id)`.
- [ ] Step 1: 입력 빌더 **스냅샷 테스트** — 이름·이메일·ID·클래스명·기관명·`counselor_notes`·전사·개인 값·**수정 문장**이 없고, 측정 1명 지표는 `missing`, 상태 `unworn/pending/error/zero`면 호출 0
- [ ] Step 2: 검증 표 테스트 — 금지어(클래스 전용 목록)·허용 집합 밖 숫자·방향 모순·결측 지표 언급·이름 의심 각각 필드 단위 폐기, 스키마 불일치면 전 필드 규칙
- [ ] Step 3: 태스크 테스트(모든 AI는 mock, 실제 호출 시 실패하도록 `httpx`/`_call_gemini_text` 패치) — AI 꺼짐 호출 0, 타임아웃/HTTP 오류/JSON 불일치 → 규칙 유지·리포트 `status` 불변, 같은 `input_hash` 재실행 호출 0(`ai_attempt.hash`), **`source=edited` 필드는 text/source 불변**
- [ ] Step 4: 구현 — `summary_task._call_gemini_text` 재사용(30초, 재시도 없음, 예외는 모두 규칙 확정), 로그에는 사유 코드만. 큐 `_REPORT_QUEUE_TASKS`에 등록. 커밋

#### Task B8: 계약·회귀
**Files:** Create `tests/test_class_report_contract.py`, `tests/test_class_report_visibility.py`, `tests/test_sdd237_counseling_regression.py`.
- [ ] `frontend/src/lib/class-report/fixtures/*.json`을 읽어 `schemas/class_report.py`로 `model_validate`(F0 선행). 회원 403/404·알림/메일/루시 경로 비노출. 상담 세션 리포트 생성 content·API 응답 스냅샷 변경 없음. 전체 `pytest backend/tests -q` + `backend/tests/pg` 통과. 커밋

### 5.2 FE 상세

#### Task F0: 계약 타입·fixture·mock
**Files:** Create `lib/class-report/{types,state-copy,narrative-fields,format,mocks}.ts`, `lib/class-report/fixtures/*.json`, `lib/api/class-summary.ts`, `tests/class-report-types.test.ts`.
**Produces:** `ClassSummaryResponse`, `ClassReportResponse`, `ClassReportBlock`, `NarrativeField`, `MetricKey`, `classSummaryApi.{summary,report,patchNarrative,claimNotePrompt,dismissNotePrompt}`, `sessionNotePromptApi.{get,set}`.
- [ ] fixture는 §4 예시를 9 상태 + 편집본으로 작성(JSON이 단일 사본). 타입은 `any` 없이 판별 유니온. 상태→문구 사전(class-narrative §3)과 ‘AI 요약’/‘상담사 수정’ 라벨 함수 `sourceLabel(field)`. 테스트: 모든 fixture가 타입 가드 통과. 커밋

#### Task F1: 요약 페이지
- [ ] 라우트 `/sessions/:id/summary`(RoleGuard counselor/org_admin). S0 헤더, S1 한 줄(AI/수정 라벨)+6지표 방향 칩, S2 참석·측정·대상, S6 3줄(승인 / 진행 기록 / 다음 회차). 승인 문구: 자동 승인 켬+유예 0 ‘자동 승인 즉시 적용’(보류 버튼 없음), 끔 ‘검토 대기 N명’, `no_data_manual>0` 안내, 생성 중 가짜 진행률 없음. 상태 9종 렌더. 버튼 ‘상담사 클래스 리포트 열기’. 테스트 먼저(vitest + 상태별 fixture). 커밋

#### Task F2: 진행 기록 안내·설정 토글
- [ ] `eligible`일 때만 `claim` 1회 호출 → `show:true`면 비차단 카드(문구는 spec §5.F 그대로), [지금 남기기]→`/sessions/:id/record`, [비워두기]→`dismiss`. claim 실패/불명/`show:false` → 카드 없음, 조용한 ‘진행 기록 남기기’ 버튼만. ‘미완료’ 배지·재촉 없음. `SettingsPage`에 ‘모든 회차에서 안내 끄기’ 토글(낙관적 변경, 실패 시 되돌림). 다중 탭/재방문 테스트. 커밋

#### Task F3: 클래스 리포트 페이지
- [ ] `/sessions/:id/class-report`. 섹션 순서 몸→마음. S3 Recharts LineChart(5분 버킷, `v=null`은 끊김, 전반/후반 점선, 마음 3선 공통 0–100·몸 지표별 축, 정상 범위 띠·목표선 없음), S4 지표 카드 6장(1열 풀폭, 대표값·전후 `%p`·`DualBarChart` 재사용·80px 스파크라인·통계 줄 데스크톱 1줄/모바일 2줄), 측정 1명은 평균·범위·차트 숨김+‘측정 1명 — 참여자별 결과에서 확인’, S5 표(검색·상태 필터, 정렬 없음·순위 없음, 모바일 세로 카드). 면책·‘상담사에게만 보여요’ 하단. 지표 라벨·색·단위는 `PLAYER_METRICS` 재사용. 커밋

#### Task F4: 서사 수정 UI
- [ ] `NarrativeText`: `capabilities.can_edit_narrative`일 때만 [수정] 노출 → textarea(16px, 남은 글자 수, `max_len`) → [저장]/[취소]. 저장 성공 응답으로만 ‘저장됨’ 표기, 실패 시 입력 유지. 출처 라벨: `ai`=‘AI 요약’, `edited`=‘상담사 수정 · {이름} · {M/D HH:mm}’, `rule`=라벨 없음. 수정본이 있으면 [AI 초안으로 되돌리기](확인 후 `revert`). `stale`이면 ‘수치가 바뀐 뒤 수정한 문장이에요’. 빈 입력은 저장 비활성+안내, 409는 최신본 보여주고 내 입력 유지, 403은 읽기 전용으로 전환. 열람 전용(org_admin 등)에는 편집 UI 비노출. 수치·그래프·카드 숫자는 편집 요소 없음. 요약 화면 S1에서도 동일 컴포넌트(수정은 리포트에서 하도록 링크만 둘지 인라인 둘지는 인라인 허용). 커밋

#### Task F5: 종료 동선 교체
- [ ] `ClassPlayerPage`: `session.class_id` 있는 호스트 종료 성공(서버 completed 확인 후) → `navigate('/sessions/:id/summary', {replace:true})`, `leaveTo`가 있으면 기존 의도 유지. 완료된 명상 `/player` 재접속 → 요약. `EndingScreen`(명상): 주 CTA ‘회차 요약 보기’, 완료 안내 문구에서 ‘기록에서’ 제거. **상담 분기(`class_id` 없음)는 기존 ‘기록 보기’ 유지.** `SessionDetailPage`·`SessionRecordPage`에 명상 완료 회차 ‘회차 요약으로’ 링크. 종료 응답 불명 시 성공 화면으로 이동하지 않는 기존 가드 유지. 회귀 테스트(상담 종료 → /record). 커밋

#### Task F6 / F7 / F8
- F6: `class-report-manage.tsx`·`use-session-report-rows.ts` 집계에서 `type==='client'`만. `ReportDetailView`: `type==='counselor' && content.class_report`이면 클래스 리포트 컴포넌트 렌더(상담 도메인 기존 그대로). 커밋
- F7: `privacy-policy.ts` ‘처리 위탁 및 국외 이전’ 절에 한 줄 추가: ‘AI 요약 기능을 사용하는 경우 이름·연락처가 없는 수업 통계(지표 요약)를 외부 AI(Google Gemini)로 전송해 문장으로 정리합니다.’ 같은 절의 ‘AI 기능은 현재 제공하지 않으므로…’ 문구(`:46`, 같은 취지의 `:66`, 개정 이력 `:173`)와 **충돌하지 않게** 문구 정합. `PRIVACY_POLICY_VERSION`/시행일은 **변경하지 않는다**(재동의 유발 가능 — 변경 필요 여부는 TASK BOX/대표님 확인). 설정 토글 옆·‘AI 요약’ 라벨 툴팁에도 동일 한 줄 짧게. 커밋
- F8: 전체 vitest, `npm run build`, `npx tsc --noEmit`, 390/1440 Playwright 캡처 스크립트(§verify 7장), 가로 넘침·최소 13px·조작 44px 자동 검사

### 5.3 통합
- I1: `sdd/237-integrate` — BE→FE 순 병합, `python3 scripts/check-alembic-heads.py`, mock 스위치 off, 실제 API로 요약·리포트 연동. 충돌 파일 없음(소유권 표 준수).
- I2: [verify.md](verify.md) 전 항목 실행, 독립 검증 스크립트(숫자 재계산·금지어 전수·AI 입력 스냅샷). 실제 화면 확인(390/1440).
- I3: `summary.md` 작성 후 PR 생성(`[SDD-237] 클래스 종료 후 상담사 화면 흐름`). 머지·배포는 DEPLOY 창구(별도 승인).

---

## 6. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 통계 산식 오류(정규화 순서·세그먼트·중복 윈도우) | 잘못된 수치 노출 | 독립 재계산 테스트, PG 테스트, 기존 `report_narrative` 상수·헬퍼 재사용, 정규화 버전 혼합 금지 |
| 수정본이 AI/재생성/통계 갱신에 덮어써짐 | 상담사 작업 손실 | `source=edited` 불변 규칙을 B3·B7 양쪽 테스트로 고정, `stale` 표시 |
| 수정 문장에 개인정보가 들어감 | 상담사용 문서라 허용되나 org_admin 열람 | 권한은 기존 규칙 유지(결정 A). 수정 문장은 AI 입력 금지, 로그에 원문 금지 |
| 무데이터 자동 승인 제외로 기존 자동 승인 상담사의 비측정 명상 리포트가 발송 안 됨 | 운영 기대 변화 | S6 안내 문구 + `no_data_manual` 카운트, 변경 사실을 summary·PR에 명시(대표님 결정 4) |
| 통계 계산 지연/예외 | 요약이 비어 보임 | 계산은 리포트 체인에서 결정론·예외 시 `status:"error"` 블록(리포트 상태 불변), FE ‘다시 불러오기’ |
| AI 비용·개인정보 | 외부 전송 | 기본 OFF, 회차당 1회, 이름 없는 집계만, 한 줄 고지(F7), 운영 `ai_features_enabled`/키 존재는 OPS 창구 확인(값 열람 금지) |
| 개인정보처리방침 문구가 ‘AI 미제공’과 충돌 | 법무 | F7에서 문구 정합. 버전/시행일 변경은 미실행(확인 필요 항목) |
| `notification_preferences`처럼 공유 JSONB 덮어쓰기 | 안내 상태 소실 | 사용하지 않고 전용 컬럼(§4.7) |
| 마이그레이션 헤드 충돌 | 배포 실패 | BE 워커 1명만, 병합 후 헤드 1개 확인 |
| 클래스 counselor 리포트의 기존 자동 승인·루시 승인 대기 목록(`agent_policy.py:772`)에 남는 잔여 노출 | 카운트 불일치 | 이번 범위 밖으로 명시. summary에 후속 제안 기재 |
| 동시에 같은 공유 파일 수정 | 머지 충돌 | §3 소유권 표, `report_service.py`·`report_task.py`는 BE 워커 1명만 |
| 요약이 리포트보다 먼저 열려 `block` 없음 | 빈 화면 | `pending` 상태 UI(9종), 완료 시 재조회(포커스/재진입) |
| 짧은 수업·측정 시간 짧음 | 버킷 점 부족 | 30분 미만 2분 버킷, 최소 유효 60초 미만은 측정 제외 |

## 7. 완료 정의
spec + plan + verify + summary 4종 존재, [verify.md](verify.md) 전 항목 통과 기록, `pytest`(PG 포함)·`vitest`·`tsc`·`npm run build` 통과, 390/1440 실제 화면 확인, 상담 회귀 0, 실제 AI 호출 0(테스트).

---

## 8. 계약 변경 · 구현 확정 정의 (BE 워커, 2026-10-23)

> 구현 중 plan 문구가 모호하거나 코드 사실과 어긋나 확정한 항목. FE 응답 계약(§4)의 **필드명·구조는 바꾸지 않았다.** 아래 중 ①만 스키마 허용값이 넓어진 계약 변경이고 나머지는 정의 확정이다.

| # | 구분 | 내용 | 근거 |
|---|---|---|---|
| ① | **계약 변경(허용값 확대)** | `block.participants[].state`가 `excluded`도 허용한다(§2.1 참여자 상태 표에는 있었으나 §4.2 예시에 없었음). BE는 현재 `excluded` 행을 블록에 **내보내지 않고**(제외자는 집계 기여 0, 참여자 표는 응답 `participants[]`가 따로 담당), FE 목 fixture에는 `excluded` 행이 있어 스키마가 허용한다. | FE fixture 계약 테스트 |
| ② | 정의 확정 | 대표 상태 `partial`은 **측정자가 리포트 대상의 절반 이하**(`measured×2 ≤ included`)일 때만이다. 과반이 측정했으면 `status="measured"`이고 미착용은 `flags=["partial"]`로만 알린다(§4.1 예시 `attended 6·included 5·measured 4`가 `measured`+`flags:["partial"]`인 것과 정합). | §2.1 표 ↔ §4.1 예시 충돌 해소 |
| ③ | 정의 확정 | 지표 `state`: 측정 ≥2→`ok`, 측정자 ≥2인 클래스에서 그 지표 <2→`poor_signal`(`missing_reason:"signal_insufficient"`), 클래스 측정자 1명→`single`, 측정자 0→`unworn`/`lost`(사유 `not_worn`/`connection_lost`), 정규화 버전 혼재(마음 지표)→`missing`(`normalization_mismatch`), 출석 0→`missing`(`no_participants`). `ok`인데 비교 인원 <2면 평균·범위는 있고 전후·방향은 `null`(`missing_reason:"compare_insufficient"`). | §2.1 |
| ④ | 정의 확정 | 요약 `chips[].state`: 지표 `ok`+방향 있음→`ok`, `ok`인데 방향 없음·`missing`·`unworn`·`lost`→`missing`, `single`/`poor_signal`은 그대로. | §4.1 |
| ⑤ | 정의 확정 | `report.state`는 `ready｜processing｜error` 3값. 생성 대기/처리 중이거나 리포트 행이 없으면 `processing`, 리포트가 `error`이고 블록도 없으면 `error`, 그 밖은 `ready`(블록 `status:"error"`여도 `ready`). | §4.1 |
| ⑥ | 정의 확정 | `approval.counts`: `generating`=생성 대기/처리 중 또는 `pending_analysis`, `pending_review`=검토 대기 전체, `approved`=`completed`, `error`, `no_data_manual`=자동 승인 **켬**인데 측정 자료 없는 `pending_review`(부분집합). 대상 = 리포트 반영 포함·결석 아님인 참여자의 `type=client` 리포트. | §4.8 |
| ⑦ | 정의 확정 | 열람 오류 순서: 404(회차 없음) → 403 `report_read_forbidden` → 400 `not_class_session` → 409 `not_completed`. 수정 PATCH 순서: 404 → 403 `narrative_edit_forbidden` → 400 → 409 `not_completed` → 422 `field_not_editable`(키 규칙) → 409 `report_not_ready` → 409 `edit_conflict` → 422 `empty_text｜text_too_long｜invalid_text`. 모든 오류 본문은 `{"detail":{"code":…}}`이며 `edit_conflict`는 `detail.value`에 최신 필드를 싣는다. | §4.3·§4.5 |
| ⑧ | 정의 확정 | `base_edited_at` 충돌 검사는 **요청 본문에 키가 있을 때만** 한다(`null`=‘아직 수정본 없음’을 기대). 키가 없으면 검사하지 않는다. `edited_at`은 마이크로초 포함 ISO(`…%f Z`). | §4.5 |
| ⑨ | 정의 확정 | 수정 저장 필드의 AI 초안 보존: 저장 형태에 `ai_draft_input_hash`(AI 초안이 만들어진 통계 해시), `edited_input_hash`를 둔다(응답 `PresentedField`에는 노출하지 않음). 통계가 바뀌면 수정되지 않은 AI 초안은 버리고, 수정된 필드는 `ai_draft`를 보존하되 되돌리기는 해시가 맞을 때만 `ai`로, 아니면 규칙 문장으로 복원한다. | §4.6 |
| ⑩ | 정의 확정 | AI 출력 빈 문자열은 **필드 단위** 폐기(스키마 불일치는 필수 키 누락·타입 오류·`metrics` 비객체일 때만 전 필드 폐기). 지표 문장은 입력 방향과 같은 방향어가 반드시 있어야 채택. 숫자는 `counts.measured·attended` 값만 허용. | §3.5 |
| ⑪ | 구현 위치 | AI 서사 enqueue는 ‘체인 끝’ 대신 `generate_report_inline` 직후(상담사용 클래스 리포트에 한해, AI 켜짐 + 이 입력으로 미시도일 때만)에 둔다 — 체인·HTTP 재생성·일괄 재생성을 한 곳에서 덮고, 같은 입력 해시면 태스크가 호출 0건으로 끝난다. | §2.4 |
| ⑫ | 구현 위치 | 일괄 작업 type 가드는 `classify_target`에만 둔다(`accept_job` 쿼리 필터는 넣지 않음) — 필터를 넣으면 상담사용 대상이 항목 없이 사라져 `excluded/not_target` 이력이 남지 않는다. | §4.8 |
| ⑬ | 소유권 표 밖 파일 | `backend/app/services/report_narrative.py`에 전후 분할·방향 판정 공용 헬퍼(`segment_halves`, `direction_for_change`)를 추출했다(기존 `build_metrics_summary`는 이를 호출하도록만 바꿈 — 무작위 입력 40종으로 원본 구현과 동일 결과 검증). 복사 금지 원칙 이행을 위한 최소 변경. | §2.1 재사용 규칙 |
| ⑭ | 마이그레이션 | `e036a0000061` (users.show_session_note_prompt, sessions.note_prompt_seen_at/dismissed_at), 다운그레이드 포함, 헤드 1개. | §4.7 |

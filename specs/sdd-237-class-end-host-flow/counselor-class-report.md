# SDD-237 — 상담사용 클래스 리포트 (명상 클래스 서사 + AI 문장)

- 상태: **Stage ① 기획 (설계 문서만)**. 제품 코드·마이그레이션·AI 호출·머지·배포 없음.
- 작성: 2026-10-23 · Claude · 브랜치 `sdd/237-class-end-host-flow`
- 결정 근거: 대표님 10/23 — ① 명상 클래스 서사 문장 생성에 **AI(LLM) 사용 허용** ② 서사형 요약은 **리포트 범위**, 이를 포함한 **상담사용 클래스 리포트**를 만든다. 상담(1:1) 화면·리포트는 건드리지 않는다.
- 상위 문서: [spec.md](spec.md) §11(결정 8), [class-narrative.md](class-narrative.md)(S1~S6 서사 구조·문구 사전), [auto-approve-policy.md](auto-approve-policy.md)
- 범위: **명상 클래스 회차(`session.class_id` 있음, `report_domain == "meditation"`)만.** 상담(`counseling`) 도메인은 코드 분기로 제외한다.
- 이 문서의 코드 인용은 모두 읽기 전용 조사 결과다(파일:줄은 10/23 develop 기준).

## 1. 현행 구조 (코드 근거)

### 1.1 `ClassReportJob`은 리포트가 아니라 일괄 작업이다

- `backend/app/models/class_report_job.py:42–67` — `class_report_jobs`: `action ∈ {approve, regenerate, resend_email}`, `status ∈ {accepted, running, completed}`, `(actor_id, operation_key)` 멱등. 건별 결과는 `ClassReportJobItem`(`report_id` FK → `reports.id`, `state ∈ pending/succeeded/failed/excluded`).
- API는 `api/v1/classes`의 `/classes/{id}/report-jobs`(`api/v1/class_reports.py:34–90`). 리포트 내용·서사를 담지 않는다. → **클래스 리포트의 저장소로 쓸 수 없다.** 같은 파일의 `GET /classes/{id}/sessions/{sid}/summary`(`:98–113`)는 출석 요약 + 익명 방향 분포(`class_report_trend_service.session_summary`, 유효 착용 3명 미만 숨김)만 돌려준다.
- 주의: `class_report_job_service.classify_target`(`:72–120`)은 리포트 `type`을 거르지 않는다. 일괄 승인 대상에 상담사용 리포트가 섞이면 승인 처리된다(§4.3에서 제외 규정).

### 1.2 리포트 저장 구조 — `reports` 테이블 (`backend/app/models/record.py:175–241`)

- 컬럼: `session_id`, `user_id`, `participant_id`, `type`(String 20), `content`(JSONB), `status`(`pending_analysis → pending_review → completed / error`), `generation_status`(`pending/processing/ready/partial`), `data_credibility`, `approved_at`, `approved_by_user_id` 등.
- 유일 인덱스: `(session_id, participant_id, type)`(participant NOT NULL) + `(session_id, type)`(participant NULL). 즉 **회차당 `type`별 1건**이 DB로 보장된다.
- `type` 값은 코드상 `counselor`와 `client` 둘뿐이다(`report_service.generate_report`가 그 외는 400, `:343–344`).

### 1.3 회차 종료 시 생성 흐름

- Celery 태스크 `generate_reports_for_session`(`tasks/report_task.py:714–757`)이 **상담사용 리포트 → 참여자별 회원 리포트** 순서로 만든다.
  - `report_service.generate_report(session, host, "counselor")` (`:739`) → `generate_report_inline`(`report_task.py:481–647`)
  - `report_service.generate_client_reports_for_session` (`:740`, `report_service.py:428–510`)
- 즉 **세션당 `type="counselor"` 리포트가 이미 1건 있고**, 회원 리포트와 같은 체인에서 만들어진다. 다만 그룹 클래스에서 그 리포트가 쓸모 있는 서사를 담지 못한다(§1.4).
- 상담사용 리포트는 `participant_id`를 "세션의 첫 참여자"로 고정해 둔다(`report_service.py:371–388`, MB2-ORM-UNQ-12). 유일 인덱스를 지키기 위한 장치이며, 이 참여자의 개인 리포트가 아니다.
- 제외 참여자 처리: `report_scope.scope_for_session`의 `included_ids`만 상담사용 집계에 들어간다(`report_task.py:512–533`, SDD-209 B3). 전원 제외면 안내만.

### 1.4 지금 상담사가 클래스 회차에서 보는 리포트

- `class-operations.ts:15`의 `GET …/sessions/{sid}/reports`가 회차 리포트 목록(`id/type/status/participant_name`)을 준다. 상담사는 이 중 `type=counselor` 행을 열면 `ReportDetailView`(`frontend/src/components/reports/ReportDetailView.tsx:231`의 `isCounselor`)가 상담용 레이아웃으로 보여준다. 거기에는 상담 기록(전사·마커·메모) 중심 섹션 + `content.eeg` 블록이 있다.
- 그런데 `content.eeg`는 **여러 참여자의 윈도우를 한 덩어리로 합쳐** 만든다(`_build_eeg_content(... session_wide=True, participant_ids=…)`, `report_task.py:192–363`).
  - 서사 입력 `build_metrics_summary`는 참여자가 2명 이상이면 `mixed=True`로 **방향을 아예 산출하지 않는다**(`report_narrative.py:73–126`(`mixed`는 `:83`), "여러 참가자를 한 사람의 전후 변화로 해석하지 않도록").
  - 결과: 그룹 클래스의 상담사용 `eeg.narrative`는 "측정 자료가 부족해 몸/마음의 전후 변화를 확인하기 어려워요"(`fallback_narrative`, `report_narrative.py:129–`) 쪽으로 떨어진다.
  - `timeline`도 개인별 정규화 후 동등 가중 평균이 아니라 윈도우를 섞어 다운샘플한 값이다(`TIMELINE_MAX_POINTS`, `_downsample_timeline`). class-narrative.md §2 S3가 "클래스 정본이 될 수 없다"고 한 이유와 같다.
- 정리: **상담사용 클래스 리포트의 그릇(type=counselor 행·생성 체인·권한)은 이미 있고, 내용(클래스 단위 6지표 통계 + 서사)이 비어 있다.**

### 1.5 열람 권한 (코드 근거)

| 주체 | 규칙 | 근거 |
|---|---|---|
| 회차 진행 상담사(host) | 열람 가능. 수정·재생성도 host만(`_can_edit_report`) | `report_service.py:941–972` |
| 주강사·보조강사(lead/assistant) | `class_team_read_enabled` 설정 + 참여자 전원의 `class-team-v1` 고지 동의 시에만 팀 열람 | `class_access_service.py:92–111` |
| 기관관리자(org_admin) | **명상 클래스 회차는 열람 가능**: `session.type=="meditation"` + `class_id` + 클래스의 기관 귀속이 확인되고 해당 기관의 활성 org_admin 멤버십일 때. 원본 자료(전사·음성·영상·URL 등 `_RAW_FIELDS`)는 `project_report_for_viewer`가 가린다 | `class_access_service.py:114–127,130–` , `report_service.py:883` |
| 회원(client) | 상담사용 리포트는 막힘: `get_report`에서 `type=="counselor"`이고 viewer가 client면 403(`:845–846`), 본인 승인 리포트 경로(`require_own_approved_report`)는 `report.type != "client"`면 404(`class_read_service.py:613`). 목록도 `Report.user_id`(상담사용은 host) 기준 | 좌동 |

### 1.6 AI 호출 기반 (현행)

- 회원 리포트 서사: `summary_task._call_narrative_llm`(`tasks/summary_task.py:100–`)가 `_call_gemini_text`(`:36–77`)로 Gemini REST를 호출한다. `settings.gemini_model`(기본 `gemini-2.5-flash`, `config.py:175`), `temperature 0.3`, JSON 응답 모드, 타임아웃 30초. 입력은 **지표별 방향·전후 평균만 든 구조화 dict**(이름·ID 없음). 실패하면 예외 → `fallback_narrative`(규칙) 반환. **6지표 방향 시그니처로 `narrative_cache` 캐시**해 같은 패턴은 재호출하지 않는다. 지표 문장은 `validate_metric_sentence`로 금지 용어·60자·방향 모순을 걸러 폴백한다(`report_narrative.py:190–`).
- 상담사 코멘트 초안: `report_comment_service._call_gemini`(`:226–281`)는 `httpx`로 호출, 타임아웃 15초, 실패 시 `None` → 규칙 템플릿. 이쪽 입력에는 `counselor_notes`가 들어간다(`:139–163` — **클래스 서사에서는 쓰지 않는다**).
- 공통 가드: `core/ai_features.is_ai_enabled()` — `settings.ai_features_enabled`(**기본 False**, `config.py:40`). 꺼져 있으면 호출 0건이고 호출부는 규칙 폴백. `_call_gemini_text`는 `require_ai_enabled()`를 네트워크 직전에 한 번 더 건다.
- 키는 `settings.gemini_api_key`(`.env`)이며 이번 조사에서 값은 열람하지 않았다. **운영/dev의 `ai_features_enabled` 실제 값은 확인하지 않았다** → OPS 창구 확인 항목(§6).
- 비용: 호출 횟수에 비례. 현행은 회원 리포트마다 1회(시그니처 캐시 적중 시 0회). 단가 수치는 확정치가 없어 이 문서에 적지 않는다(호출 횟수·토큰 규모로만 기술).

## 2. 상담사 클래스 리포트 정의

### 2.1 한 줄 정의

**명상 클래스 회차당 1건, 상담사에게만 보이는 "그날 수업 이야기" 리포트.** class-narrative.md의 S1~S5(한 줄·함께한 사람들·흐름·몸과 마음·참여자별)를 담고, 서사 문장은 AI가 쓰되 모든 숫자는 서버가 계산한 값이다. 점수·순위·종합 평가는 없다(P1·P7).

### 2.2 대상·권한

- 단위: **회차(session) 1건**. 클래스 전체·기간 합산 리포트는 이번 범위가 아니다.
- 열람: §1.5의 기존 규칙을 그대로 쓴다(진행 상담사, 팀 열람 조건 충족 시 lead/assistant, 같은 기관 org_admin). **새로 넓히지 않는다.** org_admin이 이 리포트를 보는 것은 기존 "기관관리자는 명상 리포트 열람 가능" 규칙의 연장이므로 코드 변경 없음 — 다만 사람 이름이 들어가는 S5와 AI 문장이 org_admin에게도 보이는지는 대표님 확인 항목(§6, 결정 A).
- 수정·재생성: 진행 상담사만. 상담사가 AI 문장을 직접 편집하는 기능은 1차에 두지 않는다(§6, 결정 C).
- 회원·참여자에게 노출 없음(§4).

### 2.3 구성 (class-narrative.md와의 대응)

| 리포트 섹션 | 내용 | 데이터 | 문장 출처 |
|---|---|---|---|
| R1 오늘 수업 한 줄 | S1: 인용문 1단락 + 몸·마음 요약 칩 + ‘측정 n명 기준’ | 6지표 클래스 통계 | **AI(검증 통과 시)** / 규칙 폴백 |
| R2 함께한 사람들 | S2: 참석·측정·리포트 대상 + 상태 문구 | 인원·상태 코드 | **규칙(결정론)** — AI 미사용 |
| R3 수업이 흘러간 모습 | S3: 5분 버킷 평균 시계열 그래프 + 한 줄 | 신규 집계 | 그래프는 데이터, 한 줄은 규칙 템플릿 |
| R4 몸과 마음의 변화 | S4: 소제목 서사 2개 + 지표 카드 6장 | 6지표 클래스 통계 | 소제목 서사·카드 지표 문장 = **AI** / 규칙 폴백 |
| R5 참여자별로 이어보기 | S5: 참여자 행 + 개인 한 줄 + 상태 | 개인 6지표 평균·Δ, 개인 리포트 서사 | 개인 한 줄 = **기존 개인 리포트 `eeg.narrative`의 앞 문장**(이미 생성됨) / 규칙 폴백. **AI에 이름·개인값을 보내지 않는다** |
| 하단 | 면책(`WELLNESS_DISCLAIMER`) + ‘이 요약은 상담사에게만 보여요’ + ‘AI 요약’ 표기 | — | 고정 |

- S0(헤더)과 S6(상담사가 할 일)은 **리포트가 아니라 회차 요약 화면의 몫**이다(§2.5).
- “참여자별 상세”는 R5의 펼침 표(행=참여자, 열=6지표 평균·Δ·신호 품질)와, 행의 [열기]로 가는 **회원 개인 리포트**(기존 `ReportDetailView`의 client 리포트)다. 상담사용 리포트가 개인 리포트 내용을 복제하지 않는다.

### 2.4 생성 시점

- **회차 종료 후 개인 리포트와 같은 체인.** `generate_reports_for_session`(`report_task.py:739` 직후)에서 상담사용 리포트 행(type=counselor)이 만들어지고, 같은 단계에서 **통계 블록을 결정론적으로 계산해 저장**한다. 사용자는 AI를 기다리지 않는다.
- **AI 서사는 별도 후속 Celery 태스크**로 분리한다(`tasks.class_report_narrative`, 리포트 큐). 이유:
  1. 프로젝트 규칙: STT/LLM은 반드시 Celery 태스크(sdd-workflow.md 5번), `generate_report`는 HTTP 경로(`api/v1/reports.py:70`)에서도 동기로 호출되므로 그 안에 새 AI 호출을 넣으면 규칙 위반이다.
  2. AI 지연·실패가 리포트 준비·자동 승인·회원 발송을 막으면 안 된다.
- 순서: 통계 블록 저장(즉시, 규칙 문장 포함, `narrative.source="rule"`) → AI 태스크가 검증 통과 시 `source="ai"`로 교체. 화면은 `source`가 바뀌면 다음 새로고침/진행 이벤트(`_emit_report_progress`)로 갱신한다(가짜 진행률 없음).
- 재생성: 기존 재생성 경로가 상담사용 리포트를 다시 만들면 통계 블록은 다시 계산하되, **AI는 `input_hash`(입력 JSON의 해시)가 같으면 재호출하지 않는다.** 입력이 바뀐 경우에만 1회 재호출.

### 2.5 저장 구조 — 대안과 추천

| 안 | 내용 | 장점 | 한계 |
|---|---|---|---|
| **A. 기존 `Report(type="counselor")`의 `content.class_report` 확장 (추천)** | 이미 회차당 1건 보장되는 행의 JSONB에 버전 있는 블록을 추가 | **마이그레이션 없음.** 생성 체인·진행 상태(`generation_status`)·워치독·권한(`_can_access_report`, org_admin 규칙)·`project_report_for_viewer` 마스킹·`reports` 조회 API를 그대로 재사용. 회원 차단이 이미 코드로 보장됨(§1.5). 롤백 쉬움(블록만 무시) | JSONB 비대화(6지표×버킷 시계열 수 KB — 허용 범위). 상담사용 리포트의 기존 승인 흐름이 같이 적용됨(§4.3에서 처리). 스키마 검증은 Pydantic으로 코드에서 |
| B. 신규 테이블 `class_session_reports` | 회차 1건·구조화 컬럼 + JSONB | 승인·발송과 분리가 깨끗하고 조회 최적화 쉬움 | **마이그레이션 + 생성·진행·권한·마스킹·목록·삭제(계정 삭제 스윕 `account_deletion_sweep_service`, 데이터 리셋 `dev_data_reset`)·감사 경로를 새로 연결해야 함.** `reports`와 이중 진실원 |
| C. `reports.type`에 `class_counselor` 추가 | 같은 테이블에 새 type | 기존 `counselor` 행(전사·마커 중심)과 구분 | `type` 분기가 `report_service`/FE 곳곳(`type === 'counselor'`)에 퍼져 있어 영향 범위가 넓고, 회차당 상담사용 행이 2개가 되어 혼란. 유일 인덱스는 통과하나 얻는 것이 적음 |

**추천: A.** 근거는 (1) 그릇이 이미 있다는 것(§1.3), (2) 열람·회원 차단·org_admin 마스킹이 새 코드 없이 유지된다는 것, (3) 마이그레이션 없이 시작해 필요하면 B로 승격 가능하다는 것(블록 스키마를 버전 필드와 함께 고정). 기존 `content.eeg`(혼합 집계)는 **삭제하지 않고** 그대로 둔다 — 클래스 회차에서 화면은 `class_report`가 있으면 그것을 우선 표시한다(점진 전환, 롤백 가능).

`content.class_report` 블록 형태(제안):

```jsonc
{
  "schema_version": 1,
  "scope": { "attended": 6, "measured": 4, "included": 5, "duration_min": 45, "bucket_min": 5 },
  "status": "measured|partial|single|poor_signal|lost|unworn|pending|error",   // class-narrative.md §5 상태 코드
  "normalization_version": "…",
  "metrics": {                       // 6지표: focus, relaxation, emotional, bpm, respiration, hrv
    "focus": { "unit": "%", "measured": 4, "compared": 4, "mean": 57, "min": 44, "max": 68,
               "early": 52, "late": 61, "delta": 9, "direction": "up", "valid_min": 36, "valid_ratio": 0.8,
               "series": [{ "t_min": 0, "v": 49, "n": 4 }, …] }   // n<2 인 점은 v=null
  },
  "participants": [ { "participant_id": "…", "state": "measured|unworn|poor_signal|lost",
                      "metrics": { "focus": { "mean": …, "delta": …, "direction": … } } } ],
  "narrative": {
    "source": "rule|ai", "model": "gemini-2.5-flash", "prompt_version": "cr-1",
    "input_hash": "…", "generated_at": "…",
    "headline": "…", "body_subtitle": "…", "mind_subtitle": "…",
    "metric_sentences": { "focus": "…", … },          // 필드별 source 를 따로 남길 수도 있음(§3.5)
    "fallback_fields": ["body_subtitle"]               // 검증 실패로 규칙 문장이 들어간 필드
  }
}
```

### 2.6 회차 요약 화면과의 관계

- **요약 화면(`session-summary-page`)은 리포트의 앞부분 + 상담사가 할 일**: S0 헤더, R1 한 줄(AI/규칙), R2 인원, 지표 6개의 **한 줄 방향 칩**, S6(승인·진행 기록·다음 회차). 그 아래 **[클래스 리포트 전체 보기]** 버튼 1개.
- **리포트 화면**은 R1~R5 + 하단 면책. S6 같은 "할 일"은 두지 않는다(리포트는 읽는 문서, 요약은 업무 화면).
- 같은 `class_report` 블록을 두 화면이 읽는다 — 요약에서 별도 집계를 하지 않는다(숫자 불일치 방지).
- class-narrative.md §2의 "한 화면 7섹션"은 **요약(S0·S1·S2·S6) + 리포트(S1~S5)로 분할**되는 것으로 정정한다(디자인 시안 수정은 Astra 담당, 이 문서는 기획만).

## 3. AI 서사 생성 설계

### 3.1 AI가 쓰는 것 / 쓰지 않는 것

| AI가 쓴다 (3종, 필드 8개) | AI가 쓰지 않는다 |
|---|---|
| R1 `headline` 1단락 / R4 몸 소제목 서사 1~2줄 / R4 마음 소제목 서사 1~2줄 / R4 지표 문장 6개(각 60자 이내) | 모든 숫자(평균·전후·Δ·인원·분)·그래프·상태 문구(R2)·승인 문구·참여자 개인 한 줄·면책·이름 |

숫자는 항상 서버 값을 **카드·템플릿에 치환**해 보여준다. AI 문장에는 숫자를 기본적으로 넣지 않게 하고(§3.3), 들어간 숫자는 검증으로 입력과 대조한다.

### 3.2 입력 (개인정보 최소화)

LLM에 보내는 JSON은 **클래스 단위 집계 + 상태 코드뿐**이다.

```json
{
  "session_kind": "meditation_class",
  "duration_min": 45,
  "counts": { "measured": 4, "attended": 6 },
  "state": "measured",
  "metrics": {
    "respiration": { "unit": "회/분", "compared": 4, "early": 14.2, "late": 12.8, "direction": "down" },
    "bpm": { "...": "..." }, "hrv": { "...": "..." },
    "focus": { "unit": "%", "compared": 4, "early": 52, "late": 61, "direction": "up" },
    "relaxation": { "...": "..." }, "emotional": { "...": "..." }
  },
  "missing": ["hrv"],
  "agreement": { "focus": { "up": 3, "stable": 1, "down": 0 } }
}
```

| 포함 | 제외 (절대 전송 금지) |
|---|---|
| 수업 길이(분), 측정/참석 인원 수, 지표별 단위·비교 인원·전후 평균·방향·결측 목록, 방향 분포 건수(비교 3명 이상일 때만) | 참여자 이름·이메일·ID·생년월일·성별, 클래스명·기관명·상담사명, 회차 번호/날짜, **비공개 상담사 메모(`counselor_notes`)**, 전사·AI 요약·마커·`ai_record`, 공개 코멘트, 개인 단위 값 전체 |

- 가명: 개인 값을 보내지 않으므로 가명도 필요 없다. 이후 개인 단위 입력이 필요해지면 `p1…pn`(참여 순서, 결과와 무관) 순번만 쓰고 매핑표는 서버에만 둔다.
- 측정 2명 미만인 지표는 **입력에 넣지 않고** `missing`/`single` 상태로만 전달한다(P2). 그러면 AI는 평균·변화를 쓸 수 없다.
- 상태가 `unworn`/`pending`/`error`/참여자 0명이면 **AI를 호출하지 않는다**(규칙 문구, 호출 0).
- 외부 전송이므로 호출 직전 `is_ai_enabled()` 가드를 그대로 쓴다(꺼짐 = 호출 0건, 규칙 폴백).

### 3.3 출력 제약

- 형식: JSON 객체 `{headline, body_subtitle, mind_subtitle, metrics:{focus,relaxation,emotional,bpm,respiration,hrv}}`. `responseMimeType=application/json`, `temperature 0.3` 이하.
- **금지(내용)**: 점수·등급·순위·좋음/나쁨 판정, 의학적 판단(진단·증상·질환·치료·효과·호전·완화·회복·개선/악화), 원인 단정(“~해서 ~했다”), 참여자 개인 추정, 이전 회차·다른 클래스와의 비교, 칭찬·훈계·권유(“잘하셨어요”, “~하세요”), 입력에 없는 지표·수치.
- **허용**: 변화 방향과 관찰 서사(“후반으로 갈수록 집중 신호가 높아졌어요”, “호흡이 느려지는 쪽으로 움직였고…”), class-narrative.md §4.2 어휘 사전의 방향 표현, 약한 맥락어(“차분해지는 쪽으로 움직였어요”는 S1·소제목에서만).
- 길이: `headline` ≤ 120자(2~3줄), 소제목 서사 ≤ 100자, 지표 문장 ≤ 60자(`MAX_METRIC_SENTENCE_LEN` 재사용).
- 결측 지표는 문장에서 언급하지 않는다(P3). 측정 인원이 적으면 “측정한 n명 기준” 어구를 `headline`이 포함하도록 요구한다.

### 3.4 프롬프트 초안 (`cr-1`)

```text
당신은 명상 수업을 관찰한 내용을 상담사에게 전달하는 기록 보조입니다.
아래 JSON은 한 회차 수업의 집계 결과입니다. 이 값만 근거로 한국어로 짧게 서술하세요.

규칙
1. 변화의 방향과 흐름만 말합니다. "높아졌어요 / 낮아졌어요 / 비슷했어요 / 빨라졌어요 / 느려졌어요" 같은 관찰 표현을 쓰세요.
2. 점수, 등급, 순위, 좋다/나쁘다, 잘했다/부족하다, 개선/악화/회복, 효과, 치료, 진단, 증상 같은 평가·의학 표현을 쓰지 마세요.
3. 원인을 단정하지 마세요. 입력에 없는 지표, 사람, 수치를 만들지 마세요.
4. 숫자를 쓰지 마세요. 단, 측정 인원은 "측정한 N명"처럼 입력의 counts 값 그대로만 쓸 수 있습니다.
5. 입력의 missing 에 있는 지표는 언급하지 마세요.
6. direction 이 up 이면 높아짐/빨라짐, down 이면 낮아짐/느려짐, stable 이면 비슷함만 쓰고 반대로 쓰지 마세요.
7. "SDNN, RMSSD, PPG, 정규화, 점수, 스코어" 같은 전문 용어는 쓰지 말고 HRV는 "심박 간격의 변화"라고 쓰세요.
8. 독자는 상담사입니다. 참여자에게 말하듯 "당신/여러분"을 쓰지 말고 관찰 문장으로 쓰세요.

반환 형식(JSON만):
{"headline": "...", "body_subtitle": "...", "mind_subtitle": "...",
 "metrics": {"focus":"...","relaxation":"...","emotional":"...","bpm":"...","respiration":"...","hrv":"..."}}
- headline: 수업 전체를 이어서 읽히는 1단락(2~3문장 이내, 120자 이내)
- body_subtitle: 호흡·심박·심박 간격의 변화를 잇는 1~2문장(100자 이내)
- mind_subtitle: 집중·이완·감정균형을 잇는 1~2문장(100자 이내)
- metrics 각 값: 해당 지표 하나의 방향을 말하는 60자 이내 한 문장

자료:
{입력 JSON}
```

- 현행 회원 서사 프롬프트(`summary_task.py` 인라인 프롬프트)와 같은 계열의 안전 문구를 가져오되, **회원 2인칭 위로 어조를 제거하고 숫자 금지를 강화**했다. 별도 상수 `CLASS_NARRATIVE_PROMPT_V1`로 두고 `prompt_version`을 저장한다.

### 3.5 검증 (후처리) — 통과한 필드만 채택

필드 단위로 검사하고, 실패한 필드만 규칙 문장으로 바꾼다(`narrative.fallback_fields`에 기록). 한 필드 실패가 다른 필드를 버리지 않는다.

1. **스키마**: JSON 파싱, 필수 키·문자열·비어 있지 않음·길이 상한. 불일치면 AI 결과 전체 폐기(전 필드 규칙).
2. **금지어 필터**: 기존 `FORBIDDEN_TERMS`(`report_narrative.py:179–`) + 클래스 전용 목록 — `종합`, `순위`, `상위`, `하위`, `우수`, `부족`, `양호`, `불량`, `좋아졌`, `나빠졌`, `주의가 필요`, `개선`, `악화`, `회복`, `호전`, `완화`, `치료`, `진단`, `증상`, `효과`, `질환`, `우울`, `불안 장애`, `잘하`, `당신`, `여러분`. 하나라도 있으면 해당 필드 폐기. (class-narrative.md §4.3 금지 목록과 동일 출처로 유지.)
3. **수치 대조**: 문장에서 숫자 토큰을 모두 추출해(정규식 `\d+([.,]\d+)?`) 허용 집합과 비교한다. 허용 집합 = 입력의 `counts` 값(`측정한 N명`)뿐. 그 밖의 숫자가 나오면 폐기. “입력에 없는 수치 금지”를 숫자 자체를 막는 방식으로 단순하게 보장한다(숫자는 카드가 보여주므로 AI에 쓰게 할 이유가 없다).
4. **방향 대조**: 지표별로 입력 `direction`과 문장의 방향어 사전(상승어 ‘높아/빨라/커/늘/올랐’, 하락어 ‘낮아/느려/작아/줄/내려’, 유지어 ‘비슷/유지/일정/고르게’)을 대조한다. 반대 방향어가 들어가거나(up인데 하락어, down인데 상승어), stable인데 변화어가 들어가면 폐기. 기존 `validate_metric_sentence`(`:190–`)를 확장해 재사용한다.
5. **결측 대조**: `missing`/측정 1명 지표 이름이 문장에 나오면 폐기.
6. **개인 식별 대조**: 문장에 입력에 없는 고유명사/이름 형태가 의심되면(참여자 이름 목록과 부분 일치 검사 — 서버 내부에서만) 폐기. 이름 목록은 LLM으로 가지 않고 서버에서만 비교한다.
7. 통과 필드는 `source="ai"`, 폐기 필드는 규칙 문장 + `fallback_fields`. 전 필드가 폐기되면 `narrative.source="rule"`.

### 3.6 실패·타임아웃 → 규칙 문장

- 대체 문장 = **class-narrative.md §2 S1·S4 템플릿과 §4.2 어휘 사전**(결정론적). 예: 방향이 있으면 “{N}분 수업 동안 측정한 {n}명의 호흡과 심박이 …, 집중과 이완 신호는 후반으로 갈수록 높아졌어요.”
- 대체가 일어나는 경우: AI 꺼짐(`ai_features_enabled=False`)·키 없음·타임아웃(30초, 재시도 없음)·HTTP 오류·JSON 불일치·검증 실패·입력 상태가 AI 호출 대상이 아님.
- 429/5xx는 `_call_gemini_text`가 `RetryableTaskError`를 던지는 현행 동작을 **이 태스크에서는 재시도하지 않고 규칙 문장으로 확정**한다(상담사 화면이 AI 때문에 비는 일이 없도록, 최대 1회 재호출 옵션은 verify 단계에서 판단). 리포트 `status`·`generation_status`·`generation_error`는 AI 실패로 바꾸지 않는다(리포트는 정상, 문장만 규칙).
- 로그에는 실패 사유 코드만 남기고 **입력 JSON·출력 문장 원문은 로그에 남기지 않는다.**

### 3.7 표기·비용·호출 횟수

- 화면 표기: AI가 채택된 필드(또는 그 섹션 머리)에 **‘AI 요약’** 라벨 + 보조 문구 “수업 통계를 바탕으로 AI가 정리한 문장이에요. 수치는 아래 카드의 값을 확인하세요.” 규칙 문장만 있을 때는 라벨을 달지 않는다(‘자동 정리’ 정도의 중립 표기는 디자인 판단). 모든 화면에 `WELLNESS_DISCLAIMER` 유지.
- 호출 횟수: **회차당 AI 1회**(통계 확정 후 8개 필드를 한 번의 JSON 응답으로). 참여자 수와 무관. 재생성 시 `input_hash` 동일하면 0회. 회원 리포트의 개인 서사 호출(시그니처 캐시)과 합쳐 회차당 최대 “참여자 수(캐시 미적중분) + 1”.
- 토큰 규모: 입력 약 0.5~1KB, 출력 약 400~600 토큰, `gemini-2.5-flash` 단일 호출. 단가는 확정치를 이 문서에 적지 않는다. 월 상한이 필요하면 `ai_features_enabled`와 별개로 **상담사/기관 단위 일일 호출 상한 설정**을 후속 plan에서 정한다.
- 캐시: 수치가 서사에 들어가지 않으므로(숫자 금지) 문장 자체를 6지표 시그니처 + 인원 구간(2, 3~5, 6+)으로 `narrative_cache`에 재사용하는 방안도 가능하다. 단, 클래스 서사가 회원 서사와 어휘(판정어 유무)가 달라 **캐시 키를 분리**(`cls:` 접두사)해야 한다. 1차는 캐시 없이 회차당 1회로 두고 호출량을 본 뒤 결정(verify 열린 항목).

## 4. 회원 개인 리포트와의 관계

### 4.1 서사 일관성

- **같은 판정 규칙**: 방향 임계(호흡 1회/분, 심박 3bpm, HRV 5ms, 마음 3지표 5%)와 6지표 순서는 개인 리포트(`build_metrics_summary`)와 동일하다. 차이는 입력이 “개인 전·후반”이 아니라 “**개인 전·후반을 먼저 구한 뒤 참여자 동등 가중으로 평균한 클래스 값**”이라는 점뿐이다(class-narrative.md §4.1; 혼합 집계 방향 비산출 문제를 이 순서로 해소).
- **어휘는 의도적으로 다르다**: 개인 리포트 문구는 “차분해졌어요/깊어졌어요/기복이 있었어요” 같은 해석어를 쓰지만(`SENTENCE_TEMPLATES`), 클래스 리포트는 방향어 사전만 쓴다(P1). 같은 사람이 두 문서를 보면 표현이 다를 수 있으나 **방향은 모순되지 않아야** 한다. 클래스 문장은 “모두/전원/대부분” 같은 전칭 표현을 쓰지 않는다(개인과 어긋나기 쉬움). 대신 방향 분포(“비교 4명 중 3명 증가”, 3명 이상일 때만)로 개인과의 차이를 숫자로 보여 준다.
- 상담사가 R5에서 한 사람을 열면 개인 리포트의 서사(회원이 받는 것)를 그대로 본다. 클래스 문장과 개인 문장의 방향이 달라 보이면 R5 행에 방향 칩(↑↓→)이 있어 한눈에 확인된다.

### 4.2 클래스 리포트는 회원에게 보이지 않는다 (코드로 확인됨)

- `get_report`: `type=="counselor"`이고 viewer 역할이 `client`면 403(`report_service.py:845–846`). 클래스 회원 본인 경로는 `require_own_approved_report`에서 `report.type != "client"`면 404(`class_read_service.py:613`). 상담사용 리포트의 `user_id`는 host이므로 회원 `reports` 목록에도 나오지 않는다.
- **새로 추가하는 규칙(구현 시)**: 회원 대상 경로(알림 딥링크·루시 `agent_report_chat`·`GET /reports` 회원 응답·메일)에 클래스 리포트가 섞이지 않는지 테스트로 고정한다(§7 수용 기준 7번).
- 리포트 `content.class_report.participants`에는 다른 참여자의 값이 들어 있으므로, 상담사용 리포트가 어떤 경로로든 회원에게 직렬화되면 타인 정보 노출이다 → **회원 직렬화 경로에서 `class_report` 키를 제거하는 방어(`without_raw_material` 계열)도 이중으로 둔다.**

### 4.3 자동 승인 C안과의 관계 — 발송 대상이 아니다

- 상담사용 리포트는 **발송 대상이 아니다.** 메일 예약은 `report.type != "client"`면 즉시 반환한다(`_enqueue_client_email_on_approval`, `report_service.py:1063`), 회원 알림 `report_ready`는 `report.user_id`(= host)에게만 간다(자기 알림). 루시 대화 훅은 client 리포트 조건부 동작이다(`agent_report_chat.py`, 호출은 `report_service.py:1166–1171`).
- 다만 현행 코드는 상담사용 리포트도 **같은 승인 게이트**(`pending_review → completed`)에 태우고, 자동 승인 상담사의 경우 생성 직후 `approve_report`까지 호출한다(`report_service.py:411–425`). 자동 승인 C안의 “승인 대기 N명 / 생성 중 / 승인됨” 숫자와 **일괄 작업 대상**(`class_report_job_service.accept_job`은 type 필터 없음, `:178–181`)에 상담사용 행이 섞이지 않게 해야 한다.
  - 규정: ① 승인 현황·일괄 승인·자동 승인 집계는 **`type=="client"`만** 센다. ② 상담사용 클래스 리포트는 승인 여부와 무관하게 host에게 즉시 열람 가능(승인은 “발송 허가”가 아니라 상담사용 문서에서는 의미가 없다). ③ `classify_target`에 `type != "client"` → `excluded/not_target` 가드를 추가한다(상담사용 행의 `participant_id`가 ‘첫 참여자’이므로 결석 판정 등으로 엉뚱한 사유가 붙는 것을 막음).
  - 현행의 “상담사용도 승인한다” 동작 자체를 바꾸는 것은 **상담 도메인 리포트에 영향**이 있으므로 이번 범위에서 건드리지 않는다. 분기는 `report_domain == "meditation"`에서만 적용한다(자동 승인 문서의 영역 분리 원칙과 동일).
- 유예 시간·이번 회차 보류와 **무관**하다(클래스 리포트는 대기하지 않는다). 설정 문구에도 “상담사용 리포트는 승인과 관계없이 바로 볼 수 있어요”를 한 줄 넣는다.

## 5. 구현 범위 추정 (승인 후 별도 plan/verify)

본 작업에서는 아래 제품 파일을 수정하지 않는다. 파일 단위 예상이다.

### 5.1 BE

| 구분 | 파일 | 내용 | 규모 |
|---|---|---|---|
| 신규 | `backend/app/services/class_report_stats_service.py` | 개인 6지표 → 클래스 동등 가중 통계, 5분 버킷 시계열, 상태 코드, 방향 분포. class-narrative.md §5 “신규 집계”와 **같은 서비스**(요약·리포트 공용) | 큼 (핵심) |
| 신규 | `backend/app/services/class_report_narrative.py` | 규칙 서사(문구 사전), 프롬프트 상수, AI 호출 어댑터(`_call_gemini_text` 재사용), 검증(§3.5), 입력 빌더(§3.2) | 중 |
| 신규 | `backend/app/tasks/class_report_task.py` | `tasks.class_report_narrative` Celery 태스크(리포트 큐 등록: `core/celery_app.py:44`의 `_REPORT_QUEUE_TASKS`에 추가), `input_hash` 멱등 | 소 |
| 신규 | `backend/app/schemas/class_report.py` | `ClassReportBlock` Pydantic v2 (`schema_version`), 응답 스키마 | 소 |
| 변경 | `backend/app/tasks/report_task.py` (`generate_report_inline`의 counselor 분기, `generate_reports_for_session`) | `class_report` 블록 저장 호출, 체인 끝에 AI 태스크 enqueue. 상담 도메인은 분기로 제외 | 소 |
| 변경 | `backend/app/services/class_report_job_service.py` | `classify_target`에 type 가드 | 소 |
| 변경 | `backend/app/services/report_service.py` | 승인 현황 집계의 type 필터, 회원 직렬화 방어(`class_report` 제거) | 소 |
| 변경 | `backend/app/services/class_access_service.py` | `project_report_for_viewer`에서 org_admin 허용 필드(S5 이름 포함 여부 — 결정 A에 따라) | 소 |
| 변경 | `backend/app/api/v1/reports.py` 또는 `class_reports.py` | 별도 endpoint 불필요(기존 `GET /reports/{id}`로 `content.class_report` 제공). 요약용으로 `…/sessions/{sid}/summary` 확장 시 이 블록의 앞부분 필드를 포함 | 소 |
| 마이그레이션 | **없음 (추천안 A)** — JSONB 키 추가뿐. 방안 B 선택 시에만 alembic 1건(SDD당 담당 1명 규칙) | — | — |
| 테스트 | `tests/test_class_report_stats.py`, `test_class_report_narrative_guard.py`(금지어·수치·방향·결측 대조 표 기반), `test_class_report_visibility.py`(회원 403/404·org_admin 마스킹), `test_class_report_job_type_guard.py`, AI 꺼짐/타임아웃 폴백 | 중 |

### 5.2 FE

| 구분 | 파일 | 내용 |
|---|---|---|
| 신규 | `frontend/src/components/class-report/ClassNarrativeReport.tsx` + `class-report.css` | R1~R5 + 하단. 지표 카드는 `MetricChangeCard`/`DualBarChart`/`TrendLineChart` 재사용 가능 범위를 구현 시 확정 |
| 신규 | `frontend/src/lib/class-report/{types,resolve-class-report,state-copy}.ts` | 블록 타입(`any` 금지), 상태 코드 → 문구(§3 표), 'AI 요약' 라벨 분기, 숫자 포맷 |
| 변경 | `frontend/src/components/reports/ReportDetailView.tsx` | `report.type==='counselor' && content.class_report`이면 위 컴포넌트 렌더(기존 `eeg` 블록은 클래스 회차에서 대체), 상담 도메인은 기존 그대로 |
| 변경 | `frontend/src/pages/sessions/session-summary-page.tsx`(SDD-237 신규 계획 파일) | 요약에 R1·R2·지표 칩 + [클래스 리포트 전체 보기] |
| 변경 | `frontend/src/lib/api/class-operations.ts`, `reports.ts` | 응답 타입 확장 |
| 테스트 | vitest: 상태 9종 렌더, 측정 1명 숨김, ‘AI 요약’ 표기, 금지 요소 부재(점수·순위·방향색) / Playwright: 390·1440 가로 넘침·13px·44px |

### 5.3 의존·순서

1. 통계 서비스(`class_report_stats_service`)가 선행 — 요약(S1·S2·S4·S5)과 리포트가 공용. 이것이 class-narrative.md §5 “신규 집계 우선순위 1~3”이다.
2. 규칙 서사(AI 없이도 완결) → 3. AI 태스크·검증 → 4. FE. 규칙 서사만으로 먼저 배포해도 제품이 완결되도록 한다(AI는 켜는 스위치).
3. `ai_features_enabled`는 서버 전역 스위치(기본 False)이므로 **AI 문장은 운영에서 별도로 켜야 실제로 쓰인다.** 꺼져 있어도 화면은 규칙 문장으로 동일하게 동작한다.

## 6. 수용 기준 (verify.md 입력)

1. 명상 클래스 회차 종료 후 상담사 리포트 1건이 생성되고(회차당 1건, 재생성해도 1건), 6지표 클래스 통계가 개인 값의 동등 가중 평균과 일치한다(독립 재계산).
2. 측정 2명 미만 지표는 평균·범위·변화 숨김 + ‘측정 1명 — 참여자별 결과에서 확인’. 서사 문장·AI 입력에서도 해당 지표 제외.
3. AI 입력 JSON에 이름·이메일·ID·클래스명·기관명·`counselor_notes`·전사·개인 값이 **없음**을 테스트로 고정(입력 빌더 스냅샷 테스트).
4. AI 출력 검증: 금지어·입력에 없는 숫자·방향 모순·결측 지표 언급 각각 입력으로 폐기되고 규칙 문장으로 대체된다(필드 단위). AI 꺼짐·키 없음·타임아웃·HTTP 오류·JSON 불일치에서 리포트는 정상이고 문장만 규칙.
5. AI 호출은 Celery 태스크에서만, 회차당 1회. 동일 입력 재생성 시 0회. HTTP 요청 경로에서 AI 호출 0건.
6. 화면: AI가 채택된 문장에만 ‘AI 요약’ 표기, 면책 항상 노출, 종합점수·순위·좋음/나쁨·방향 우열 색 없음. 상태 9종(`narr-*`)별 문구.
7. 회원/참여자/비참여 회원이 클래스 리포트를 어떤 경로(리포트 상세·목록·알림 딥링크·루시 대화·메일)로도 받지 못한다. 상담사용 리포트는 발송·알림 대상이 아니다.
8. org_admin 열람 시 원본 자료(전사·음성·영상·URL)가 가려진다(기존 `_RAW_FIELDS`). S5 이름 노출 범위는 결정 A대로.
9. 일괄 승인·자동 승인·승인 대기 집계에 상담사용 리포트가 포함되지 않는다.
10. 상담(`counseling`) 세션의 리포트 생성·화면·API 응답이 변경 전과 동일(회귀 테스트).
11. 요약 화면과 리포트 화면의 숫자가 같은 `class_report` 블록에서 나와 일치한다.

## 7. Brian 결정 필요 항목 (비즈니스 결정만)

기술 세부(저장 방식=A, 비동기 분리, 검증 규칙, 캐시)는 위 추천대로 진행하며 별도 승인 항목으로 올리지 않는다.

| # | 결정 | 추천 | 비고 |
|---|---|---|---|
| A | **기관관리자가 클래스 리포트(참여자 이름이 있는 S5 포함)를 볼 수 있는가** | 현행 규칙 유지 — 같은 기관 명상 클래스는 열람 가능, 원본 자료는 가림 | 현행 코드는 이미 org_admin이 명상 리포트를 열람 가능(`admin_can_read_meditation_report`). 이름 노출을 더 줄이고 싶으면 “통계만, 참여자 이름은 가림” 선택지 |
| B | **외부 AI(Gemini)로 클래스 집계 통계를 보내는 것에 대한 고지** | 개인정보처리방침/상담사 안내에 “수업 통계(이름 없음)를 AI로 정리” 한 줄 추가 | 개인 리포트 서사도 이미 이름 없는 6지표 요약을 보내는 중이라 새 종류의 전송은 아니다. 법무 판단 필요 시 대표님 확인 |
| C | **상담사가 AI 문장을 직접 고치거나 다시 생성할 수 있는가** | 1차 없음(규칙 문장 대체만). 재생성은 입력이 바뀔 때만 | 편집을 열면 수정본의 책임·저장·감사 규칙이 추가로 필요 |

운영 확인(결정 아님, OPS 창구): 운영/dev 서버의 `ai_features_enabled`·`gemini_api_key` 설정 여부(값 열람 없이 존재/ON-OFF만). 꺼져 있으면 클래스 리포트 AI 문장은 켜질 때까지 규칙 문장으로만 나간다.

## 8. 열린 항목 (구현 전 verify에서 확정)

- AI 호출 1회 재시도 허용 여부(지연 vs 성공률).
- 일/기관 단위 호출 상한 설정 필요 여부와 값.
- 클래스 서사 캐시(`cls:` 접두사) 도입 여부 — 호출량을 본 뒤.
- 회원 리포트 `eeg.narrative` 앞 문장을 S5 한 줄로 쓸 때 판정어(“좋았어요/긴장 상태”)가 섞여 상담사 화면의 P1과 충돌하는 경우의 처리: 규칙 사전 문장으로 재조립(추천) vs 그대로 인용.
- 요약 화면의 지표 칩에 쓸 문구 길이(모바일).

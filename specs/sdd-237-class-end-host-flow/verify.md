# SDD-237 — Stage ③ Verify (구현 전 QA 체크리스트)

> **구현 전에만 작성한다. 사후 수정 금지**(추가 시나리오는 하단 ‘구현 중 추가’에 날짜와 이유를 적는다). 구현 워커는 이 문서의 모든 항목을 통과시켜야 한다.
> 기준: [plan.md](plan.md) · [spec.md](spec.md) §9·§11 · [counselor-class-report.md](counselor-class-report.md) §6 · [class-narrative.md](class-narrative.md) §3·§4.
> 표기: **[U]**=pytest/vitest 단위, **[PG]**=`backend/tests/pg/`, **[API]**=API 통합 테스트, **[E2E]**=브라우저 확인, **[SCR]**=독립 검증 스크립트, **[MAN]**=사람이 직접 확인.
> 모든 AI 관련 테스트는 mock이며 **실제 Gemini/외부 HTTP 호출 0**(호출 시 테스트 실패하도록 `httpx`·`summary_task._call_gemini_text` 패치).

## 1. 기능 시나리오 (상태별 · 요약 화면과 클래스 리포트 양쪽)

공통 기대: 상태 문구는 ‘~가 없어서 ~는 보여드리지 못해요’ 형태의 사실 서술(평가어 없음). 항상 다음 행동 버튼 1개. 요약의 숫자·방향은 리포트와 **같은 `class_report` 블록**에서 나온다.

| # | 시나리오 | 입력 조건 | 기대 결과 | 종류 |
|---|---|---|---|---|
| S1 | **측정 2명 이상(정상)** | 출석 6·대상 5·측정 4, 6지표 충분 | `status=measured`. 6지표 카드 모두 평균·범위·전후·Δ·`측정 n명`·`비교 m명`·유효 시간/비율. S3 평균선(버킷 n≥2), 칩 방향 6개. 요약 S2 ‘참석 6 · 측정 4 · 리포트 대상 5’ | U/API/E2E |
| S2 | **측정 1명** | 측정자 1 | `status=single`. 평균·범위·변화량·시계열·막대/추이 차트 **숨김**, 대표값 자리 ‘측정 1명’, 보조 ‘참여자별 결과에서 확인’. 6장 카드 유지. S3는 그래프 대신 빈 상태 카드. 서사에 해당 지표 변화 문장 없음 | U/API/E2E |
| S3 | **일부 착용** | 대상 4·측정 2 | `flags∋partial`. ‘측정한 2명 기준… 전체 참석자를 대표하지는 않아요’. 미착용 행 ‘측정 없이 참여’. 평균은 측정 2명만(미착용을 0으로 넣지 않음) | U/API/E2E |
| S4 | **지표별 일부만 2명 미만(신호 불량)** | 측정자 3, PPG 3지표는 1명만 유효 | `status=poor_signal`. 해당 지표 카드 `—` + ‘신호가 고르지 않아 계산하지 못했어요’, EEG 3지표 정상. 서사는 신호 있는 지표만. 명상 성과 평가 표현 없음 | U/API/E2E |
| S5 | **연결 유실** | 일부 참여자 윈도우 공백/중단 | `flags∋lost`. 끊긴 구간 시계열 `v=null`(선 잇지 않음), 유효 시간·비율에 반영. **종료 후 정상 연결 해제는 lost로 세지 않음** | U/PG/E2E |
| S6 | **전원 미착용** | 측정자 0, 유실 0 | `status=unworn`. 6지표 `—`, 측정 0명, S3 접힘 ‘측정 데이터가 없어 흐름 그래프는 생략돼요’, S4는 ‘측정 없음’ 1장. 요약에 ‘데이터 없는 리포트는 자동 승인에서 제외’ 안내. 기록/리포트 검토 가능 | U/API/E2E |
| S7 | **전원 유실** | 연결했으나 윈도우 0 | `status=lost`(미착용과 구분), 0점·실패 표기 아님 | U/API |
| S8 | **분석 중** | 클래스 리포트 `generation_status` pending/processing | `status=pending`, `headcount.measured=null` ‘확인 중’, 6지표 스켈레톤 `—`, 완료 시각 추정·가짜 % 없음. 참여자 행 ‘분석 중’+[열기] 비활성. 기록·목록 이동 가능. 완료 후 포커스/재진입 시 자동 갱신 | U/E2E |
| S9 | **계산/조회 실패** | 통계 예외 / 5xx | 블록 `status=error`(리포트 `status`·`generation_status` 불변) 또는 FE ‘요약을 불러오지 못했어요’ + [다시 불러오기]. 원인 과다 노출 없음. 참여자 목록은 별도 조회로 유지 | U/API/E2E |
| S10 | **참여자 0명** | 출석 0 | `status=zero`. ‘이번 수업에는 참석 기록이 없어요’, S3~S5 숨김, 다음 회차·목록만. 생성 실패로 표시하지 않음 | U/E2E |
| S11 | **AI 꺼짐** | `ai_features_enabled=False` | AI 호출 0건, 모든 서사 `source=rule`, 화면에 ‘AI 요약’ 라벨 없음, 리포트·요약 정상 | U/API |
| S12 | **AI 성공** | mock 응답 정상 | 검증 통과 필드만 `source=ai`·‘AI 요약’ 라벨(해당 필드/섹션만), `fallback_fields` 비어 있음, 면책 유지 | U/API/E2E |
| S13 | **AI 실패(타임아웃·HTTP 429/5xx·키 없음·JSON 불일치)** | mock 예외 | 재시도 없이 규칙 문장 확정, `ai_attempt.outcome` 기록, 리포트 `status`/`generation_status`/`generation_error` 불변, 로그에 사유 코드만(입력·출력 원문 없음) | U |
| S14 | **AI 검증 실패(필드별)** | 응답에 금지어 / 허용 밖 숫자 / 방향 모순 / 결측 지표 언급 / 이름 형태 | 해당 필드만 폐기→규칙 문장+`fallback_fields`, 다른 필드는 채택. 스키마 불일치는 전 필드 규칙. 전 필드 폐기면 `source=rule` | U(표 기반) |
| S15 | **AI 회차당 1회** | 같은 `input_hash`로 태스크 재실행/리포트 재생성 | 두 번째 호출 0건. 입력이 바뀐 경우에만 재호출 | U |
| S16 | **상태 복합** | 일부 착용+연결 유실+지표 일부 신호 불량 | `status`는 우선순위 표 결과 1개 + `flags` 중복 표기, 문구가 서로 모순되지 않음 | U |
| S17 | **리포트 제외 참여자** | `report_included=false` | 모든 집계 기여 0, 참여자 행 ‘리포트 미반영’ 그룹, 승인/발송 대상 제외 | U/API |
| S18 | **통계 경계값** | 유효 59초 / 60초, 후반 29초 / 30초, 같은 초 윈도우 다수, 세그먼트(pause/resume) 2개, 30분 미만 수업 | 59초는 측정 제외·60초 포함, 후반 29초면 비교 불가, 같은 초는 1초로, 세그먼트 동일 가중, 버킷 2분 | U/PG |
| S19 | **진행 기록 1회 안내** | host, 기록 없음, 미안내 | claim 성공 시에만 카드 표시. [지금 남기기]→`/sessions/:id/record`, [비워두기]→dismiss. 재방문/새로고침/다른 기기/다중 탭 **재노출 없음**. ‘미완료’ 배지·재촉 없음, 조용한 ‘진행 기록 남기기’ 버튼 유지 | PG/U/E2E |
| S20 | **안내 예외** | 이미 기록 있음 / `user_enabled=false` / host 아님 / claim 실패·네트워크 불명 | 카드 없음(조용한 버튼만). 기록을 나중에 지워도 seen 초기화 없음. 설정 토글 off→on 후 **미안내 회차에만** 적용 | U/API |
| S21 | **안내 동시 claim** | 같은 회차 2요청 동시 | 정확히 1건만 `show:true` (PG 원자 UPDATE) | PG |
| S22 | **종료 동선(명상)** | 호스트가 명상 클래스 종료 | 서버 completed 확인 후 `/sessions/:id/summary`로 replace 이동. `leaveTo`가 있으면 그 목적지 유지. 완료된 `/player` 재접속 → 요약. 종료 응답 불명이면 성공 화면으로 이동 안 함 | U/E2E |
| S23 | **승인 현황** | 자동 승인 켬/끔, client 5건·counselor 1건 | 요약·일괄 승인·승인 현황 숫자에 **counselor 미포함**(client 5 기준). 자동 승인 켬+유예 0: ‘자동 승인 즉시 적용’만(보류 버튼·예정 시각 없음). 끔: ‘검토 대기 N명’ | U/API/E2E |
| S24 | **무데이터 자동 승인 제외(명상)** | 자동 승인 켬, 미착용 client 리포트 | `pending_review` 유지, 승인·알림·메일·AI 훅 0, `no_data_manual` 집계·S6 안내. `valid` 리포트는 종전대로 즉시 승인. 수동 승인은 가능 | U/API |
| S25 | **자동 초안 비공개 메모 제외** | 명상 자동 승인 초안 생성 | LLM/초안 입력 spy에 `counselor_notes` 없음, 다른 참여자 데이터 없음 | U |
| S26 | **개인정보 안내** | 정책/설정/라벨 | 문구 ‘이름·연락처 없는 수업 통계를 외부 AI(Google Gemini)로 전송’이 방침 ‘처리 위탁 및 국외 이전’에 존재, ‘AI 기능은 현재 제공하지 않으므로…’ 와 충돌 없음 | U/MAN |

## 2. 서사 문장 수정·저장 (결정 10)

| # | 시나리오 | 기대 결과 | 종류 |
|---|---|---|---|
| E1 | **수정 저장** (headline/flow/body_subtitle/mind_subtitle/metric.*/participant.*) | `edited_text`·`edited_by`·`edited_at` 저장, `source=edited`, **`ai_draft`·`rule_text` 원문 보존**. 요약 S1과 리포트 R1에 동일 수정본 표시 | API/E2E |
| E2 | **출처 표시 전환** | AI 초안: ‘AI 요약’ → 저장 후: ‘상담사 수정 · 이름 · M/D HH:mm’ → 되돌린 뒤: 다시 ‘AI 요약’(ai_draft 있을 때) 또는 라벨 없음(rule) | U/E2E |
| E3 | **되돌리기** | `revert:true`가 `edited_*`를 비우고 초안 표시 복원. 확인 절차 후 실행. 이력 로그에 키·사용자·시각만(문장 원문 없음) | API/U |
| E4 | **빈 문자열/공백만** | 422 `empty_text`, 저장 안 됨, FE 저장 버튼 비활성+안내(비우려면 되돌리기) | API/U |
| E5 | **길이 제한** | headline 200 / flow·subtitle 150 / metric·participant 100 자 초과 422 `text_too_long`, 경계값(정확히 상한) 통과, FE 남은 글자 수 표시 | API/U |
| E6 | **수정 불가 대상** | 수치·평균·그래프·S2 상태 문구·면책·지정 외 키 → 422 `field_not_editable`. FE에 숫자/그래프 편집 UI 없음 | API/U |
| E7 | **권한** | 진행 상담사(host)·클래스 lead만 200. assistant·org_admin·회원·타 기관·미인증 → 403 `narrative_edit_forbidden`/401. org_admin 화면엔 [수정] 비노출(읽기 전용) | API/E2E |
| E8 | **AI 재실행 시 수정본 유지** | 수정 후 `tasks.class_report_narrative` 재실행 및 새 `input_hash` → `edited_text`·`source=edited` 불변(ai_draft만 갱신 가능), AI 입력에 수정 문장 없음 | U |
| E9 | **통계 재계산/리포트 재생성 시 수정본 이월** | 수정본 유지, 입력 해시가 바뀌면 `stale=true`(‘수치가 바뀐 뒤 수정한 문장이에요’) | U |
| E10 | **동시 수정** | `base_edited_at` 불일치 409 `edit_conflict` + 최신 값 반환, FE는 내 입력 유지+최신본 표시. 동시 PATCH 2개는 행 잠금으로 직렬화(PG) | PG/U |
| E11 | **발송·승인 무관** | 수정 저장이 알림/메일/AI 대화 훅/승인/재생성을 호출하지 않음(spy 0). 회원 개인 리포트·자동 승인에 영향 없음 | U |
| E12 | **저장 실패 처리** | 네트워크 오류 시 입력 유지, ‘저장됨’ 미표기, 재시도 가능. 성공 응답에서만 ‘저장됨’ | U/E2E |
| E13 | **개인 한 줄(S5) 수정** | `participant.<id>` 키로 저장·되돌리기, 이름은 블록(JSONB)에 저장되지 않음 | API |
| E14 | **감사/로그** | 서버 로그에 `field`·`user_id`·시각만. 문장 원문·이름 없음 | U |

## 3. 금지 규칙 (전수 검사)

| # | 규칙 | 검증 |
|---|---|---|
| P1 | 종합점수·합산점수·순위·상위/하위·좋음/나쁨 판정·‘우수/부족/양호/불량’·‘좋아졌어요/주의가 필요해요’·‘개선/악화/회복’ 표기 **없음** (요약·리포트·규칙 문장·AI 문장·상태 문구) | [SCR] 규칙 문장 사전 전수 + 모든 fixture 렌더 텍스트에 금지어 목록 grep, 0건. DOM에 ‘점수’ ‘순위’ 칸 없음 [U/E2E] |
| P2 | 지표별 측정 2명 미만에서 평균·범위·변화량·시계열·방향·막대 차트 비노출 | [U] 데이터·렌더 양쪽 |
| P3 | 결측·미착용·유실을 0으로 채우지 않음(`null`/‘—’+사유), 시계열 `v=null`은 선 끊김 | [U/E2E] 차트 path 단절 검사 |
| P4 | 우열 색 없음(빨강/초록 방향색), 정상 범위 띠·목표선 없음, 지표 식별색만 사용. 라벨·단위·색이 `PLAYER_METRICS`와 일치 | [U] 스타일 토큰 비교, [E2E] |
| P5 | 개인 선 한 그래프 겹쳐 보기 없음, 참여자 정렬·순위 UI 없음(참여 순서 고정) | [E2E] |
| P6 | **회원·참여자·비참여 회원에게 클래스 리포트 비노출**: `GET /reports`(회원), `GET /reports/{id}`, 알림 딥링크, 루시 대화 훅, 메일, `class-summary`/`class-report` 엔드포인트 모두 403/404. 회원 직렬화에서 `class_report` 키 제거 | [API] 경로별 |
| P7 | **비공개 메모 AI 미전송**: AI 입력 빌더 스냅샷에 `counselor_notes`·전사·AI 요약·마커·공개 코멘트·상담사 수정 문장·이름·이메일·ID·클래스명·기관명·회차 번호/날짜·개인 값 없음 | [U] 스냅샷 + 키 화이트리스트 테스트 |
| P8 | **일괄 승인에 counselor 미포함**: `class_report_job_service` 대상·`classify_target`(`excluded/not_target`), `approve_all_reports`(클래스 회차 counselor 제외·**상담 도메인 불변**), 대시보드 대기 수, 요약 승인 현황, FE 집계 | [U/API] |
| P9 | 요약 화면 **진입·조회가 승인·메일·알림·AI·재생성을 실행하지 않음**(GET은 읽기 전용, claim만 안내 상태 쓰기) | [U] spy |
| P10 | AI 문장에 숫자는 `측정한 N명`(counts) 외 금지, AI가 쓰지 않는 것: 수치·그래프·S2·S3 데이터·승인 문구·면책·이름 | [U] 검증 표 |
| P11 | ‘진단/치료 목적 아님’ 면책(`WELLNESS_DISCLAIMER`)과 ‘이 요약은 상담사에게만 보여요’가 모든 상태에서 노출 | [U/E2E] |
| P12 | 명상 요약 어디에도 이전 회차 비교·효과 단정·권유·칭찬/훈계 문구 없음 | [SCR] |

## 4. 계산 정확성 (독립 재계산)

| # | 항목 | 검증 |
|---|---|---|
| C1 | 클래스 평균 = 개인 회차 평균의 동등 가중 평균(오래 측정한 1명이 지배하지 않음) | [SCR] 순수 파이썬 재계산 vs 서비스 결과 일치(허용오차 1e-6) |
| C2 | 범위 = 개인 회차 평균의 min/max (전체 표본 극값 아님) | [U] |
| C3 | 정규화 후 개인 평균 → 클래스 평균(평균 후 정규화 아님). 정규화 버전이 섞이면 평균 안 함 | [U] |
| C4 | early/late/Δ: 세그먼트별 중간점·동일 가중, 클래스 early/late는 개인 값의 동등 가중 평균, `비교 m명`이 `측정 n명`과 다를 때 분모 구분 표시 | [U] |
| C5 | EEG Δ는 `%p`, 호흡 회/분·심박 bpm·HRV ms. 방향 임계(호흡 1, 심박 3, HRV 5, 마음 변화율 5%) | [U] 경계값(임계−ε/임계/임계+ε) |
| C6 | 유효 시간 = 고유 초 기반(중복 제거), 비율 = 개인 유효 초/세션 초의 평균. 기존 `coverage_ratio`를 시간으로 쓰지 않음 | [U/PG] |
| C7 | 시계열 버킷: 5분(30분 미만 2분), 버킷 n<2 → `v=null`, 전반/후반 경계가 변화량 계산 기준과 일치 | [U] |
| C8 | 방향 분포는 비교 3명 이상일 때만, 그 외 `null` | [U] |
| C9 | 요약과 리포트의 모든 숫자가 같은 블록에서 일치 | [API] 두 응답 대조 |
| C10 | `content.eeg`(기존 혼합 집계) 및 개인 client 리포트 content는 변경 없음 | [U] 스냅샷 |

## 5. 권한·프라이버시

| # | 시나리오 | 기대 |
|---|---|---|
| A1 | host / lead·assistant(팀 열람 조건 충족) / 같은 기관 org_admin 조회 | 200 |
| A2 | 팀 열람 조건 미충족 강사, 타 기관 org_admin, 회원, 게스트, 미인증 | 403/404/401 |
| A3 | org_admin 조회 시 원본 자료(`_RAW_FIELDS`) 마스킹 유지, 참여자 이름 노출은 현행 규칙(결정 A), 편집·안내 claim 불가 | 
| A4 | 안내 claim/dismiss·설정 토글은 본인 계정만. 다른 상담사의 안내 상태를 바꿀 수 없음 |
| A5 | 응답 DTO에 이메일 원문·토큰·내부 메모 없음 |
| A6 | 서버 로그·Sentry 필드에 AI 입력/출력 원문, 수정 문장 원문, 참여자 이름 없음 |

(모두 [API]/[U])

## 6. 상담(1:1) 회귀 — 변경 없음

| # | 항목 | 검증 |
|---|---|---|
| R1 | 상담 세션 종료 → 기존 EndingScene ‘기록 보기’ → `/sessions/:id/record` (FE) | [U/E2E] 기존 테스트 통과 + 신규 분기 테스트 |
| R2 | 상담 세션 리포트 생성: `content`(counselor/client) 키·값 스냅샷이 변경 전과 동일, `class_report` 키 없음 | [U] |
| R3 | 상담 도메인 `approve_all_reports` 동작 동일(counselor 포함), 자동 승인 상담 동작 동일(무데이터 제외 미적용), 초안 입력 동일 | [U] |
| R4 | `/sessions/:id/class-summary|class-report` 상담 세션 → 400 `not_class_session`, FE는 기존 흐름 | [API/U] |
| R5 | 기존 리포트 상세·목록·기록지·`class_report_job_service`(client) 동작 불변, 상담 화면(`/counseling/**`) 변경 없음 | [U] 전체 회귀 |
| R6 | 기존 백엔드 전체 `pytest backend/tests -q` · `backend/tests/pg` · 프런트 `vitest run` 통과 | [CI] |

## 7. 화면 확인 (390 / 1440)

대상: 요약 9상태, 리포트 9상태, 편집 상태(편집 중·저장 중·저장됨·실패·충돌·읽기 전용), 안내 카드, 설정 토글. 방법: Playwright 캡처 + 자동 검사 스크립트(디자인 시안 `capture-narrative.cjs`와 같은 방식, 외부 HTTP 차단).

- [ ] 가로 넘침 0 (390, 1440)
- [ ] 최소 글자 13px 이상, 입력 16px, 본문 16/26
- [ ] 일반 조작 44px+, 주요 CTA 48px+
- [ ] 6지표 카드: 지표당 1장·1열 풀폭, 통계 줄 데스크톱 1줄/모바일 2줄
- [ ] 라벨·단위·식별색이 `PLAYER_METRICS`와 일치, 방향/우열색 없음
- [ ] 차트: 축·단위 표기, 마음 0–100 공통 축, 몸 지표별 축, 전반/후반 점선, 결측 선 끊김
- [ ] AI 라벨/상담사 수정 라벨 위치·문구, 면책·‘상담사에게만’ 하단
- [ ] 키보드 포커스 표시, 저장 알림 `aria-live`, 색만으로 상태 전달 안 함
- [ ] 확정 시안(`designs/class-end-host-flow/screenshots/narrative-*`)과 구조·문구 차이를 summary에 기록(의도한 차이 명시)

## 8. 테스트 목록 (신규 파일 — 구현 시 이름 고정)

**pytest (SQLite)**: `test_class_report_stats.py` · `test_class_report_narrative_rules.py` · `test_class_report_narrative_guard.py`(금지어·숫자·방향·결측·이름 표) · `test_class_report_task.py`(AI 꺼짐/성공/타임아웃/HTTP 오류/JSON 불일치/1회/수정본 보호) · `test_class_report_narrative_edit.py` · `test_class_summary_api.py` · `test_class_report_visibility.py` · `test_class_report_job_type_guard.py` · `test_sdd237_auto_approve_guard.py` · `test_sdd237_note_prompt.py` · `test_class_report_contract.py`(FE fixture↔Pydantic) · `test_sdd237_counseling_regression.py`
**pytest PG (`backend/tests/pg/`)**: `test_sdd237_class_stats_pg.py`(실제 `eeg_feature` 행·중복 초·세그먼트) · `test_sdd237_note_prompt_claim.py`(동시 claim 원자성) · `test_sdd237_narrative_edit_lock.py`(행 잠금·409)
**vitest**: `class-report-types.test.ts` · `class-report-states.test.tsx`(요약/리포트 9상태) · `class-report-single-hidden.test.tsx` · `class-report-forbidden-ui.test.tsx`(점수·순위·우열색 부재) · `class-report-narrative-edit.test.tsx`(수정/저장/되돌리기/빈 입력/길이/409/403/라벨 전환) · `session-summary-approval.test.tsx`(즉시 적용·검토 대기·client만) · `session-summary-note-prompt.test.tsx`(1회·비워두기·재방문·claim 실패) · `class-player-end-redirect.test.tsx`(명상 요약 이동, 상담 /record 유지) · `privacy-policy-ai-line.test.ts` · `settings-note-prompt-toggle.test.tsx`
**빌드**: `cd frontend && npx tsc --noEmit && npm run build`, `python3 scripts/check-alembic-heads.py`(헤드 1개)

## 9. 실사용 확인 (감독/대표님 — 통합 후 dev에서)

- [ ] 실제 명상 클래스 1회 진행(밴드 착용 2명 이상 + 1명 미착용) → 종료 → 요약 자동 진입 → 숫자 확인(수동 계산 1지표와 대조)
- [ ] ‘상담사 클래스 리포트 열기’ → 6지표·흐름 그래프·참여자 표, 참여자 [열기]가 각자의 올바른 리포트(report ID)로 이동하고 돌아오기
- [ ] AI 꺼짐 상태에서 규칙 문장으로 완결되는지, `ai_features_enabled` 켠 뒤(OPS 창구가 값 열람 없이 ON/OFF 확인·전환) AI 문장이 ‘AI 요약’으로 표시되는지
- [ ] 문장 [수정]→[저장]→새로고침 유지→[AI 초안으로 되돌리기]→다른 계정(org_admin) 열람 시 읽기 전용
- [ ] 진행 기록 안내가 한 번만 뜨는지(새로고침·다른 브라우저), 설정에서 끄기/켜기
- [ ] 자동 승인 켠 계정의 미착용 명상 리포트가 승인되지 않고 요약에 안내되는지
- [ ] 상담 1:1 종료 흐름이 변경 전과 같은지
- [ ] 운영 데이터·실제 메일 발송 없이 dev 테스터 계정으로만 수행

## 10. 실행·완료 게이트

1. 이 문서가 커밋된 **이후에만** 구현 시작(`git log`로 verify.md 커밋이 구현 커밋보다 앞임을 확인).
2. BE·FE 각 트랙: 해당 Task의 실패 테스트 먼저(RED) → 구현(GREEN) → 커밋. 트랙별 `scripts/test-changed`.
3. 통합(`sdd/237-integrate`) 후 §1~§8 전부 실행, 결과를 `summary.md`에 표로 기록(통과/실패/제외 사유).
4. 독립 검증 스크립트([SCR]) 실행 로그 첨부: 숫자 재계산, 금지어 전수, AI 입력 스냅샷, 수정본 보호.
5. PR은 생성까지만(머지·develop 푸시·배포는 DEPLOY 창구, 대표님 승인 후).

### 구현 중 추가
(비어 있음 — 추가 시 날짜·이유·추가 항목을 이 아래에만 기록. 위 항목 삭제·완화 금지.)

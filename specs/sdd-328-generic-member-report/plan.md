# SDD-328 Plan — 범용 회원 명상 리포트

- Stage ② Plan · 2026-11-17 · spec: `spec.md`
- 규칙 정본: 시안 `~/.hermes/share/report-generic-real-v3-1117/build.py` (구간·편안한 5분·그룹 평균±SD·문장 선택)

## 1. 현황 (바꿀 대상)

| 영역 | 파일 | 바뀌는 점 |
|---|---|---|
| BE 계약 | `backend/app/schemas/member_report.py` (`member_report.v1`) | v1 유지, v2 스키마 **신설**(새 파일) |
| BE 빌더 | `services/member_report_builder.py` (`_REF_SEGMENTS` 82행, `resolve_segments`, `_stable5`, `_hero`) | v2 빌더 신설. v1 빌더는 건드리지 않음 |
| BE 집계 | `member_report_metrics.py`(B5 `pick_stable_window`), `member_report_group.py`(중앙+50/80% 띠) | v2는 신규 모듈에서 평균±SD·처음/마지막 5분·편안한 5분 구현. 공용 입력 로더(`PersonMinutes`)만 재사용 |
| BE 문장 | `member_report_wording.py`, `member_report_narrative.py` | v2 문장 틀 신규(`..._v2`). 금지어 검사 `assert_report_clean`은 재사용 |
| BE 책 | `member_report_book.py`, `member_report_svg.py`, `templates/member_report_book/book.css` | v2 분기 렌더러 신설, v1 코드 경로 불변 |
| BE 연결 | `tasks/report_task.py` `_attach_member_report`(681행), `api/v1/me_reports.py`, `api/v1/reports.py` | 버전 디스패치(빌드는 v2, 읽기·PDF는 `schema_version`으로 분기) |
| FE | `components/member-report/**`, `lib/member-report/{types.ts,__fixtures__/}`, `components/reports/{MemberReportViewer,MemberReportBookView}.tsx`, `lib/api/member-report.ts`, `components/ui-v2/ui-v2-report-body.tsx` | v2 컴포넌트 신설 + 버전 디스패치 |

## 2. 핵심 결정과 이유

### D1. 하위호환 = 스키마 `member_report.v2` 신설 + FE·PDF가 v1/v2 모두 렌더
- 이유: v2는 `meta.segments`·`hero.pairs(before/after)`·`stable5`·`GroupBand(p10~p90)`·`SegmentCompareRow`를 **의미 자체**가 바꾼다(구간 제거, 평균±SD). v1 모델을 확장(옵셔널화)하면 `extra="forbid"` 계약·골든 픽스처·`expected_book_pages` 가 모두 흐려지고 v1 회귀 위험이 크다.
- 방식: 저장 JSON의 `schema_version` 으로 분기. v1 저장분은 **재산출 전까지 v1 렌더러** 그대로(마이그레이션 0). 새로 생성·재산출되는 리포트만 v2 로 **덮어쓰기**.
- `extractMemberReport`(FE `lib/api/member-report.ts`)는 v1/v2 판별 유니온 반환. 알 수 없는 버전은 null(구 화면 폴백, 현행 동작 유지).
- 재산출 실패 시 이전 `member_report`(v1 포함) 이월 — `_attach_member_report` 기존 동작 유지.
- 새 PDF 책 렌더러 `render_member_report_book` 는 입구에서 버전으로 `_v1`/`_v2` 분기.

### D2. HRV(RMSSD·SDNN) 표시 정책 = **상대 변화(%)만, 절대값(ms)·참고범위 미표시**
- 이유: 이마 PPG 기반 PRV 는 ECG HRV 와 같지 않아(v11 각주에도 명시) 절대값·연령 규준 비교(`_REF_SCALES` Voss 25–49세 여성)가 근거가 약하다. 시안도 %만 사용. 10/27 이전 데이터는 결측 처리(#314) 중이라 값 정책 단순화가 안전.
- 처음 5분 대비 마지막 5분 %, 그래프 세로축도 본인 처음 5분=0% 상대 변화. 그룹 띠·분포도 **회원 처음 5분 기준값으로 같은 변환**(시안 방식, 다른 사람 자신 시작 대비 아님을 각주로 명시).
- 기준값(처음 5분 중앙값) 결측·0 이하 → 해당 쪽 `missing(poor_signal)`.
- 안정된 5분 쪽(참고 띠 3종)은 v2에서 **폐기**하고 "가장 편안했던 5분" 쪽으로 대체(시안 7쪽). v1 에는 남음.
- 재산출 데이터가 충분히 쌓여 절대값을 병기할지는 후속 판단(보류 항목, 대표 결정 필요 아님 — 요구 시 v2.1).

### D3. LF/HF = `log1p` 흐름 방향만(현행 유지), 문구 "긴장과 휴식의 균형", 그룹 비교·세로 숫자 없음.

### D4. AI 호출 0
- v2 경로에서 `ai_text`·`build_ai_prompt` 미사용. `narrative.source` 는 항상 `"rule"`. 코드에서 v2 패키지가 AI 클라이언트를 import 하지 않음을 검증으로 고정(verify V-AI).

### D5. 신규 모듈은 v2 전용 파일로 격리 (v1 파일 무수정 원칙)
- 병렬 개발에서 BE/FE 파일 충돌 방지 + v1 회귀 0. 공용 보조(금지어 검사·`PersonMinutes` 로더·`make_mind_normalizer`·레거시 HRV 컷오프)는 import 로 재사용(수정 금지, 필요 시 별도 PR).

## 3. 계약 개요 (`member_report.v2`) — Task 0 에서 확정·동결

v1 대비 변경 요지(필드 상세는 T0 산출 `schemas/member_report_v2.py` 가 정본):

- `meta`: `segments` 제거 → `settle_minutes=2`, `first_window:{start,end}`(처음 5분 표기 분), `last_window`, `valid_minutes`, `short_measure` 유지, `group_n`(그룹 인원, 본인 제외).
- `hero.pairs`: 4쌍(1분 동안 뛴 횟수·이완도·몸이 움직인 정도·집중도) `before/after/change_text/direction`, `quiet_highlight{text,note}`(가장 편안했던 5분 요약), `other_directions`.
- `quiet5`: `{start_min,end_min,when_label,hr_median,deltas{heart_rate,rmssd_pct,sdnn_pct},note}` (v1 `stable5` 대체, 후보 문구).
- `metrics[key].body`: `first/last/quiet` 중앙값, `change{kind: abs|pct|flow}`, `series{minutes,values,transform(linear|log1p|pct_vs_first5),axis_*,settle_shade:true}`, `group{band:{mean[],sd[],n[]}(n<10 분은 None), distribution{…KDE·hist·mean_me·mean_group·sd_group}}`, 문장 5종(`conclusion`,`bridge`,`interpret`,`reading`,`footnote`).
- 제거: `segments`, `my_segments`, `SegmentCompareRow`, `GroupBand(p10~p90)`, `stable5.scales`, 구간 비교표.
- 보존: 쪽 구성·`PageKey`(`stable5` → `quiet5`), 결측 규칙(`not_worn`, `poor_signal`, `no_raw` 등), `forbidden_words_checked`.

## 4. Task 분할 (BE 트랙 / FE 트랙 — 파일 겹침 없음)

### Task 0 — 계약·골든 픽스처 동결 (선행, 공통 · 직렬)
- 산출:
  - `backend/app/schemas/member_report_v2.py` (pydantic, `extra="forbid"`, `SCHEMA_VERSION="member_report.v2"`)
  - `frontend/src/lib/member-report/types-v2.ts` (수동 동기화 사본)
  - 골든 픽스처 2종: `backend/tests/fixtures/member_report_v2/{bodycare,mindcare}.json` (+ FE 복사 `frontend/src/lib/member-report/__fixtures__/v2/*.json`). 시안 `summary.json`·`bodycare/mindcare.html` 과 **같은 형태**의 **합성·익명 값**(실데이터·private 백업 복사 금지, 66분/30명·53분/14명 형태만 모사).
  - 계약 테스트 `backend/tests/test_member_report_v2_contract.py`(픽스처 ↔ pydantic) + FE 타입 드리프트 테스트(JSON Schema 대조, 현 v1 방식 동일).
- 완료 기준: 두 트랙이 이 파일만 읽고 독립 개발 가능. 동결 후 변경은 감독 승인.
- 담당: BE 1명(스키마+픽스처), FE는 리뷰만. **이 Task 가 끝난 뒤 트랙 병렬 시작.**

### BE 트랙 (담당 경로: `backend/app/**`, `backend/tests/**` 만)

| Task | 내용 | 신규/수정 파일 |
|---|---|---|
| B1 | 집계 코어: 안착 제외, 처음/마지막 5분 중앙값, 편안한 5분 선정(움직임→심박→이른순), 상대 변화(%), 그룹 평균·모집단 SD·n(≥10) , KDE/히스토그램. 순수 함수 | 신규 `services/member_report_v2_core.py` |
| B2 | 문장 틀: 히어로·종합 의견 3가지·지표별 5종 문장·편안한 5분 쪽·다음 걸음·방법·각주(용어 대응표 적용). 규칙 분기(방향·동률·결측), 금지어 검사 연동 | 신규 `services/member_report_v2_wording.py` |
| B3 | 빌더: DB 로드(기존 `_load_roster/_load_windows/_to_person_minutes` import 재사용) → B1·B2 조립 → `MemberReportV2`. short_measure·not_worn·결측 규칙, 1/f 쪽 유지 | 신규 `services/member_report_v2_builder.py` |
| B4 | SVG·책: v2 차트(안착 회색·평균±SD 띠·평균 점선·분포), 18쪽 템플릿, 쪽수 규칙 `expected_book_pages_v2`. v1 분기 입구 | 신규 `services/member_report_v2_svg.py`, `services/member_report_v2_book.py`, `templates/member_report_book/book_v2.css`; 수정(분기 한 줄) `member_report_book.py` `render_member_report_book` |
| B5 | 연결: `_attach_member_report` 가 v2 빌더 호출(환경 플래그 `MEMBER_REPORT_SCHEMA=v2` 기본 on, 롤백용 v1), API 는 저장 JSON 그대로 반환·PDF 분기 | 수정 `tasks/report_task.py`, `api/v1/me_reports.py`, `api/v1/reports.py`(필요 시 분기만) |
| B6 | 테스트: 코어 단위(독립 검산 포함), 빌더(합성 DB 입력), 책 PDF(쪽수·빈 쪽·금지어), 계약·마이그레이션 0 확인 | 신규 `backend/tests/test_member_report_v2_*.py` |

### FE 트랙 (담당 경로: `frontend/src/**` 만)

| Task | 내용 | 신규/수정 파일 |
|---|---|---|
| F1 | v2 컴포넌트: 히어로·요약 카드·종합 의견·수업 여정·편안한 5분·지표 쪽(시간 그래프 평균±SD 띠·분포)·결측·방법. 모바일(390)·데스크톱(1440) | 신규 `components/member-report-v2/**`(+css) |
| F2 | 디스패치: `extractMemberReport` 가 v1/v2 유니온 반환, 뷰어·책 뷰가 버전별 컴포넌트 선택. v1 컴포넌트·fixtures 무수정 | 수정 `lib/api/member-report.ts`, `components/reports/{MemberReportViewer,MemberReportBookView}.tsx`, `components/ui-v2/ui-v2-report-body.tsx`; 신규 `lib/member-report/types-v2.ts` 소비 |
| F3 | 테스트(vitest): v2 골든 픽스처 렌더, v1 픽스처 8종 회귀, 큰 글씨 전문용어 0·금지어 0, 가로 넘침(390/1440) | 신규 `frontend/src/**/__tests__/member-report-v2*.test.tsx` |

### 통합·검증 트랙 (구현자와 분리)
- V1: 독립 검산 스크립트(시안 `independent-check.py` 이식 — 합성 픽스처 대상)로 그룹 평균·SD, 편안한 5분, 상대 변화 재계산 대조.
- V2: `verify.md` 전 항목 실행 → 결과를 `summary.md` 에 기록.
- 담당: 구현자와 다른 워커(Gemini 교차). 감독이 diff·테스트로 직접 재검증.

## 5. 실행 순서·병렬

1. T0 (직렬) → 감독 확인(계약 동결).
2. 병렬: BE B1·B2·(B3 대기→B1·B2 후)·B4(픽스처 기반 독립 시작 가능) / FE F1·F2 (픽스처 기반). 워커 3개 이내: BE-코어(B1→B3), BE-문장·책(B2→B4), FE(F1→F2→F3).
3. B5·B6 → 통합 → V1·V2.
4. 브랜치 `sdd/328-generic-member-report` 에서 PR(`[SDD-328] 범용 회원 명상 리포트`) → develop. 푸시·배포는 대표 승인 후.

## 6. 성능·운영

- 1건 생성 시간 ≤ 기존 v1(목표: 중앙 +50/80% 분위수 계산 대신 평균·SD 라 동등 이하). KDE 격자 81점(시안) 사용.
- 비용 증가 없음(AI 0). 재산출은 기존 리포트 재생성 경로로 덮어쓰기, 일괄 재산출은 별도 승인.
- 롤백: 플래그를 v1 로 되돌리면 신규 생성이 v1. 저장된 v2 는 FE·PDF 가 계속 렌더 가능해야 하므로 v2 렌더러는 유지.

## 7. 열린 항목

- (비즈니스) 없음 — 대표 시안 확정 완료. 후속 판단: 운영 재산출 후 HRV 절대값 병기 여부, "가장 편안했던" 명칭의 경험 확인 방식(시안 index.html "남은 판단 항목").

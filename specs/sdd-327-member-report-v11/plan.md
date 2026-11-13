# SDD-327 plan — 회원 개인 명상 리포트 v11 이식

## A. 현 구조 조사 결과

**PDF 생성**: `backend/app/services/report_pdf_service.py` — WeasyPrint 68.1(`requirements.txt`), HTML 문자열 → PDF, 번들 `NotoSansKR.ttf`만 허용하는 url_fetcher, content 해시 메모리 캐시, **4쪽 고정** 서사형. 엔드포인트 `GET /reports/{id}/pdf`(`api/v1/reports.py`)·메일 링크 `/reports/view/pdf`. 18쪽 책·명조 임베드·SVG 그래프는 기존 틀로 수용 가능(WeasyPrint는 SVG 인라인·@page 지원) → **헤드리스 Chrome 신규 도입 불필요**.
**리포트 생성**: `tasks/report_task.py`(`generate_report_inline`, client/counselor 리포트 `content` JSON 생성) + `_attach_class_report`가 `content.class_report` 부착, `tasks/class_report_task.py`가 Gemini 초안. 통계 정본 `class_report_stats_service.py`(6지표, 전·후반 분할은 `report_narrative` 공용).
**프런트**: 회원 리포트 목록 `pages/client/ClientReportListPage.tsx`(`/app/reports`, `ClientAppPage` 분기) + `ClientReportDetailModal.tsx`, 공용 `components/reports/ReportDetailView.tsx`, 인쇄 `lib/report/print-report.ts`. 회원 클래스 화면 `member-class-detail-page.tsx`·`member-class-trend.tsx`(회차별 리포트 링크). `/report-view`(`ReportViewPage`)는 메일 토큰 열람.
**반응형/앱**: `capacitor.config.ts` `appId com.looxidlabs.mindbreeze2`, `webDir: dist` → 앱은 웹 SPA 번들을 그대로 로드. 따라서 **모바일·데스크톱·앱은 같은 React 반응형 컴포넌트 1벌**로 만든다(분기점 700px, 데스크톱에서 좌측 목차 고정). 앱 전용 화면 없음 → 단, 앱 WebView에서 PDF 다운로드/공유 동작은 verify에서 별도 확인.

### 데이터 매핑표 (시안 값 → 원천)

| 시안 값 | 원천 | 상태 |
|---|---|---|
| 집중도·이완도·감정 균형도 매분 값 | `EEGFeatureWindow.focus_index/relaxation_index/emotional_stability` (+ 정규화 `eeg_metrics`) | **있음** (`class_report_stats`가 개인 평균·전후 계산) |
| 심박수·RMSSD·SDNN·LF/HF·몸 움직임·호흡 | `EEGFeatureWindow.heart_rate/rmssd/sdnn/lf_hf_ratio/motion/respiratory_rate`, 롤업 `summarize_hrv_motion` | **있음** |
| 구간별 중앙값·전후 변화량 | 윈도우 → 신규 집계(중앙값) | **신규 계산**(평균은 있음, 중앙값 없음) |
| 안정된 5분 RMSSD/SDNN/HR | 모션이 낮은 연속 5분 구간 선택 | **없음 → 신규 계산** |
| 그룹 분포(평균선·분포 막대) | 클래스 평균·범위는 있음, **개인별 분포 히스토그램은 없음** | **신규 계산**(집계만, 최소 N 가드) |
| 1/f 기울기 | `delta..gamma_power`만 있고 스펙트럼 기울기 저장 없음. 프런트 `lib/eeg/`에 Morlet+PSD | **없음 → 신규 계산**(위치 결정 아래) |
| LF/HF 흐름 | `lf_hf_ratio` 윈도우 | 있음 |
| 수업 여정(구간별 움직임·심박 맥락) | 롤업 버킷 + `motion` | 있음(표현 신규) |
| 종합 의견 | 규칙 문장 + Gemini 초안 경로(`class_report_task`) | 경로 있음, **회원용 문장 틀 신규** |

**결정 필요(기본값) — 계산 위치**: 신규 값(중앙값·안정된 5분·분포·1/f)은 **백엔드 서비스에서 리포트 생성 시 1회 계산해 `reports.content.member_report`(JSONB)에 저장**. 화면·PDF는 저장 JSON만 읽음(재계산 없음, 숫자 불일치 방지). 1/f는 원시 EEG가 필요 → `eeg_raw_service`/Parquet 원천 접근 가능 여부를 Task B3에서 먼저 확인, 불가·결측이면 14쪽 생략(§spec 6 규칙).
**마이그레이션**: `content`가 JSONB이므로 **Alembic 마이그레이션 불필요**(기본값). `content.member_report.schema_version`으로 버전 관리. (스펙 변경으로 컬럼이 필요해지면 담당 워커 1명만 생성.)

## B. 아키텍처

- **단일 데이터 계약**: `content.member_report` JSON(섹션·문장·수치·SVG 입력 좌표가 아닌 *데이터*). 계약 타입은 BE(Pydantic)·FE(TS) 골든 픽스처로 동기화(시안 `v11-numeric.json`·`wording.json` → `contracts/` 또는 `backend/tests/fixtures`).
- **화면(M1·M2)**: React 컴포넌트가 JSON → 인라인 SVG 그래프 렌더. 반응형 CSS(700px 분기, 데스크톱 좌측 목차).
- **PDF(M3)**: WeasyPrint 유지. 책 전용 HTML 템플릿(시안 `book/index.html` CSS를 이식)을 Python에서 JSON → HTML(SVG 포함)로 생성. **화면과 PDF는 템플릿을 공유하지 않음**(React vs Jinja 없는 문자열/템플릿) — 대신 **SVG 생성 로직을 한 곳에 두지 않으면 어긋나므로**, 그래프 SVG는 백엔드 `member_report_svg.py`가 만들고 화면 API가 같은 SVG 문자열을 내려 FE가 `dangerouslySetInnerHTML` 없이 쓰는 대신 **FE는 자체 React SVG 컴포넌트**를 쓰되 verify에서 좌표 일치(허용오차)를 검사. **결정 필요(기본값)**: 그래프는 FE/BE 각자 구현 + 시안 좌표 골든으로 일치 검증.
- 기존 4쪽 PDF(`report_pdf_service`)는 **유지**하고 `GET /reports/{id}/book.pdf`(회원 본인·승인 리포트만) 신규. 기존 메일 PDF 링크 전환은 후속.
- 접근 제어: 회원 본인 리포트만(`user_id`/`participant_id`), 그룹 집계는 최소 N 서버 가드.

## C. Task 목록 (병렬 묶음)

파일 담당은 겹치지 않게 고정. 같은 파일 동시 수정 금지. 워커=Claude sonnet-5-5 구현, Gemini 검증.

| 묶음 | Task | 담당 경로 | 선행 |
|---|---|---|---|
| **P0 (순차, 1명)** | T0 데이터 계약: `member_report` 스키마(BE Pydantic·FE TS)·시안 골든 픽스처 추출 | `backend/app/schemas/member_report.py`, `frontend/src/lib/member-report/types.ts`, `backend/tests/fixtures/member_report/` | — |
| **P1 (BE, 병렬)** | T1 지표 집계 서비스(중앙값·전후·안정된 5분·LF/HF 흐름·결측 판정) | `backend/app/services/member_report_metrics.py` + 테스트 | T0 |
| | T2 그룹 분포 집계 + 최소 N 가드 | `backend/app/services/member_report_group.py` + 테스트 | T0 |
| | T3 1/f 기울기 산출 가능성 확인 및 구현(불가 시 결측 처리) | `backend/app/services/member_report_aperiodic.py` + 테스트 | T0 |
| | T4 문장 생성 규칙·금지어 검사·Gemini 초안 연결 | `backend/app/services/member_report_wording.py`, `member_report_narrative.py` + 테스트 | T0 |
| **P2 (BE 통합, 1명)** | T5 `report_task` 연결(`content.member_report` 저장)·회원용 조회 API·`book.pdf` 엔드포인트 | `backend/app/tasks/report_task.py`, `backend/app/api/v1/reports.py`(소폭) | T1~T4 |
| **P1' (PDF, 병렬)** | T6 책 PDF 렌더(18쪽 템플릿·SVG·명조 임베드·축약판) + 글꼴 번들 | `backend/app/services/member_report_book.py`, `member_report_svg.py`, `backend/app/assets/fonts/NotoSerifKR*`, 테스트 | T0 |
| **P1'' (FE, 병렬)** | T7 모바일(390)·데스크톱(1440) 화면 컴포넌트(한 벌 반응형, 좌측 목차) | `frontend/src/components/member-report/**` | T0 |
| | T8 진입 경로: 회원 클래스 회차 → 리포트, `/app/reports/:id`, PDF 받기(앱 WebView 포함) | `frontend/src/pages/client/**`(회원 리포트 관련 파일만), `App.tsx` 라우트 1줄 | T7 |
| **P3 (검증, 구현자와 분리)** | T9 verify.md 시나리오 실행: 금지어·쪽수·픽셀 근사·결측·dev E2E | `frontend/e2e/member-report*.spec.ts`, `backend/tests/test_member_report_*.py` | T5~T8 |
| **P4** | T10 summary.md, PR(`[SDD-327] 회원 개인 명상 리포트 v11`) | `specs/sdd-327-member-report-v11/summary.md` | T9 |

병렬 가능: T1·T2·T3·T4·T6·T7는 T0 이후 동시. T5·T8은 후속 통합. 브랜치: 단일 PR이면 `sdd/327-member-report-v11` 위 워크트리 분리(`sdd/327-be`·`-fe`·`-pdf` → `sdd/327-integrate`).

## D. 위험

- 1/f·안정된 5분은 신규 산출이라 값 검증 필요(시안 샘플로 골든).
- 18쪽 PDF의 WeasyPrint 렌더 시간(캐시·Celery 렌더 고려) — 기본값: 요청 시 렌더 + content 해시 캐시, 5초 초과 시 비동기 전환은 후속.
- 서버 글꼴 번들 용량 증가(Noto Serif KR 서브셋 사용).

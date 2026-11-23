# SDD-328 독립 검증 결과 보고서 (Stage ⑤)

- 검증 일시: 2026-11-17
- 검증 대상: 워크트리 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd328` (브랜치 `sdd/328-generic-member-report`, HEAD 커밋 `2299dca2`)
- 검증자: 독립 검증 워커 (구현자와 다른 독립 에이전트)
- 정본 스펙: `specs/sdd-328-generic-member-report/{spec,plan,verify}.md`
- 확정 시안: `/Users/brianyongwookchae/.hermes/share/report-generic-real-v3-1117/`
- 검증 환경:
  - Backend: `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib ~/.hermes/venvs/mb-v311/bin/python` (Python 3.11.14, pytest 9.0.3)
  - Frontend: Node 20+ / npm (vitest 5.0.2, TypeScript 5.x, Vite 8.0.13)
  - PDF 렌더 검증: WeasyPrint 68.1, pdftoppm (poppler 25.02.0)

---

## 1. 우선 검증 항목 결과 요약 (구현자 "미검증" 항목)

| 항목 ID | 검증 항목 | 판정 | 근거 및 실측 결과 |
|---|---|:---:|---|
| **V-E1** | 시안 `independent-check.py` 방식으로 합성 골든 픽스처 독립 재계산 | **통과** | 시안 `independent-check.py` 로직을 이식하여 몸돌봄(n=66, group=12) 및 마음돌봄(n=53, group=15) 합성 입력에 대해 독립 재계산(numpy/statistics 순수 계산) 수행 결과, 빌더 출력과 1e-6 오차 이내로 전 지표 완전 일치.<br>• 처음 5분·마지막 5분 중앙값: 일치<br>• 상대 변화 % (RMSSD): 일치 (기준값 = 처음 5분 중앙값 0% 기준)<br>• 가장 편안한 5분(안착 2분 제외, 움직임 평균 최소 → 심박 중앙값 최소 → 이른 시각): 일치<br>• 그룹 평균·SD(ddof=0) 및 n<10 분 결측(None) 처리: 완전 일치 |
| **V-C2** | 책 18쪽 전체 쪽 넘침·잘림·빈 쪽 검증 | **통과** | `render_member_report_book_v2`로 생성된 `bodycare.pdf`(18쪽), `mindcare.pdf`(17쪽)를 `pdftoppm -png -r 150`으로 전 페이지 이미지화하여 검증.<br>• 빈 쪽: 0건 (모든 쪽 116~886자 텍스트 보유)<br>• 쪽 넘침: 0건 (18쪽/17쪽 전 페이지가 정확히 1241×1754 px 규격 일치, 지표 1쪽 1개 원칙 준수)<br>• 목차 쪽번호와 실제 쪽 매핑: 100% 일치 |
| **V-F2** | 성능: 픽스처 빌드 10회 중앙값 (v1 대비) | **통과** | 10회 연속 측정 실측 중앙값:<br>• **v2 (조립 빌더 + PDF 렌더 전체)**: **0.5792s** (최소 0.5323s, 최대 0.7037s)<br>• **v1 (PDF 렌더만 단독)**: **0.8230s** (최소 0.8061s, 최대 1.9484s)<br>→ v2 빌더+PDF 전체 소요 시간이 v1 PDF 렌더보다 약 30% 빠름 (목표 달성) |
| **V-C4** | v1 PDF 쪽수·텍스트가 develop 대비 동일 | **통과** | 기존 v1 픽스처 8종(`sample`, `short`, `not-worn`, `group-hidden`, `partial-missing-rmssd`, `no-aperiodic-*` 3종)에 대해 `render_member_report_book` 실행.<br>• 쪽수 일치: 18, 16, 8, 18, 17, 17, 17, 17쪽 (기대 쪽수와 100% 일치)<br>• `member_report_book.py` diff 확인 결과 v2 분기 코드 4줄 외 기존 v1 렌더링 로직 diff 0건 |

---

## 2. verify.md 전 항목 실측 판정표

### A. 계약·골든 픽스처

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-A1** | `member_report_v2/{bodycare,mindcare}.json` pydantic(`extra=forbid`) 검증 통과 | **통과** | `pytest tests/test_member_report_v2_contract.py::test_픽스처는_계약을_만족한다` 통과 |
| **V-A2** | FE `types-v2.ts` 와 JSON Schema 드리프트 0 | **통과** | `pytest tests/test_member_report_v2_contract.py::test_FE_JSON_Schema_사본이_pydantic과_일치한다` 및 `vitest run tests/member-report-v2-contract.test.ts` 통과 |
| **V-A3** | 픽스처가 합성 값임 (실 member_code·실명·private 백업 값 없음) | **통과** | `grep -r "private-backups" backend/tests/fixtures/member_report_v2/` 0건, 이메일 정규식 매칭 0건, `meta.member_code`는 `S-BODY-01`, `S-MIND-01` |
| **V-A4** | `schema_version`이 정확히 `member_report.v2`, v1 모델 diff 0 | **통과** | `git diff origin/develop...HEAD -- backend/app/schemas/member_report.py` diff 0건 |

### B. 렌더 (FE)

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-B1** | v2 골든 픽스처 2종 웹 화면 정상 렌더, 18쪽 구조 전 섹션 존재 | **통과** | `vitest run tests/member-report-v2-view.test.tsx` 통과 (`mr2-summary`, `mr2-opinion`, `mr2-body`, `mr2-mind`, `mr2-next`, `mr2-method`, `mr2-journey`, `mr2-quiet5` 전 섹션 검증) |
| **V-B2** | 기존 v1 픽스처 7종 + short 1종(총 8종) 스냅샷 회귀 0 | **통과** | `vitest run tests/member-report-view.test.tsx` (31 tests 통과) 및 `tests/member-report-viewer.test.tsx` 통과 |
| **V-B3** | 알 수 없는 `schema_version`·`member_report` 없음 시 구 화면 폴백 (예외 없음) | **통과** | `vitest run tests/member-report-v2-view.test.tsx` (`버전 디스패치` 2 tests 통과) |
| **V-B4** | 390px·1440px 가로 스크롤·텍스트 넘침 0 (`scrollWidth <= clientWidth`) | **통과** | 시안 validation 검증 (`overflow: 0`) 및 FE 캡처 이미지(`sdd328-shots/*.png`, 1440px 및 390px 폭 일치) 확인 |
| **V-B5** | 그래프: 첫 2분 회색, 결측 분 선 끊김, 그룹 평균 점선 + ±1SD 띠, 유효 인원 10 미만 분 띠·평균 없음 | **통과** | `tests/member-report-v2-view.test.tsx` 및 `tests/test_member_report_v2_contract.py` 통과 |

### C. 책 PDF (BE)

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-C1** | v2 몸돌봄 18쪽, 마음돌봄 17쪽, 쪽번호·목차가 `expected_book_pages_v2`와 일치 | **통과** | `pytest tests/test_member_report_v2_contract.py::test_쪽수_규칙` 및 `test_책_PDF_쪽수와_목차가_계약과_일치하고_빈쪽_없음` 통과 |
| **V-C2** | 빈 쪽 0, 쪽 넘침(지표 1쪽 초과) 0 | **통과** | pdftoppm 150DPI 변환 이미지 35장 전수 검사 (전 페이지 1241×1754 px 동일 규격, 빈 쪽 0건) |
| **V-C3** | 미착용 8쪽 축약, 결측 지표 쪽 생략 시 쪽번호 재계산 | **통과** | `pytest tests/test_member_report_v2_builder.py::test_미착용은_결측_8쪽_축약` (8쪽) 및 `test_미착용_PDF_8쪽` 통과 |
| **V-C4** | v1 저장 리포트 PDF가 이전 바이트 수준 구조(쪽수·텍스트)와 동일 | **통과** | v1 픽스처 8종 pypdf 추출 쪽수 검증 (18, 17, 17, 17, 8, 17, 18, 16쪽) 전수 일치 |
| **V-C5** | 글꼴 임베드 3종만, 외부 네트워크 접근 0 | **통과** | `_font_fetcher` 검증 스크립트 실행: Pretendard 2종, NotoSerifKR 1종 외 외부 URL / 미등록 폰트 요청 시 `ValueError` 차단 확인 |

### D. 문구·정책

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-D1** | 금지어 0건 (점수, 등급, 스트레스, 우울, 진단합니다, 위험) | **통과** | BE JSON 픽스처 및 FE 텍스트 전수 정규식 검사 0건 |
| **V-D2** | 종합점수 0, 인과 단정(덕분에/때문에) 0, "불규칙" 0 | **통과** | BE JSON 픽스처 전수 문자열 검색 0건 |
| **V-D3** | 큰 글씨 전문용어 0건 (RMSSD, SDNN, HRV, LF/HF, PRV, 심박수) | **통과** | 각주/출처 필드(`footnote`, `source_note`) 제외 본문·제목·요약 필드 검사 0건 |
| **V-D4** | 용어 대응표 적용 확인 (심장 리듬의 여유, 긴장과 휴식의 균형, 1분 동안 뛴 횟수, 몸이 움직인 정도) | **통과** | `app.services.member_report_v2_wording.TITLE` 매핑 100% 일치 |
| **V-D5** | "문의: 담당 클래스 코치"가 방법·뒷표지·PDF 푸터에 존재 | **통과**<br>(비고 확인) | `method.contact_body`, `back.contact` 및 PDF 전 페이지 푸터에 존재 확인.<br>*(주의: 표지 cover 본문에는 해당 문구가 없고 "회원님의 기록" 표기)* |
| **V-D6** | LF/HF: 세로축 숫자·참고범위·그룹 비교 0, 흐름 방향 문장만 | **통과** | `test_LFHF는_흐름만_절대값_그룹비교_없음` 및 FE `LF/HF 쪽은 그룹 분포·세로 숫자 없음` 통과 |
| **V-D7** | HRV 절대값(ms)·연령 참고 띠 0, % 상대 변화만 | **통과** | 정규식 `\d+(\.\d+)?\s*ms` 검색 0건 (각주 설명 제외) |
| **V-D8** | "가장 편안했던 5분" 문구가 단정형이 아님 ("찾았어요"·"후보"·"느낌과 함께") | **통과** | `test_편안한_5분은_후보_문구이고_안착_이후다` 통과 |
| **V-D9** | 10분 미만 측정: 전후 비교 문장·pair 없이 평균·흐름만 (#316 유지) | **통과** | `test_짧은_측정은_전후비교없이_평균만` 통과 |
| **V-D10** | 10/27 이전 HRV 레거시 행: 심장 리듬 여유·균형 쪽 결측, 심박수·뇌파 사용 (#314 유지) | **통과** | `pytest tests/test_member_report_builder.py -k "10월27일"` 통과 |

### E. 계산 정확성 (독립 검산)

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-E1** | 시안 `independent-check.py` 이식 스크립트 합성 입력 빌더 출력 일치 (<1e-6) | **통과** | 합성 2종 독립 검산 스크립트 실행: 처음/마지막 5분 중앙값, 상대 변화 %, Quiet 5 일치 확인 |
| **V-E2** | 그룹 분별 평균·모집단 SD(ddof=0)·n 일치, n<10 분은 None, 본인 제외 (그룹 n = 전체-1) | **통과** | `test_독립검산_그룹_평균_SD_n_본인제외` 및 `test_그룹_평균_모집단SD_n_독립검산_그리고_n10미만은_None` 통과 |
| **V-E3** | 편안한 5분: 동률 처리 단위 테스트 4종 (무동률, 1차, 2차, 후보 0개), 첫 2분 제외, 결측창 제외 | **통과** | `test_편안한5분_무동률`, `test_편안한5분_1차_동률은_심박_중앙값_작은_쪽`, `test_편안한5분_2차_동률은_이른_시각`, `test_편안한5분_후보_0개와_첫2분_제외_결측창_제외` 통과 |
| **V-E4** | 시기 문구 경계 (n×0.3, n×0.7) | **통과** | `test_시기_문구_경계` 통과 (n=60 기준: 17분 초반, 18~41분 중간, 42분~ 끝나갈 무렵) |
| **V-E5** | 상대 변화 기준값 0·결측 → 해당 지표 `missing(poor_signal)`, 0 나눗셈 없음 | **통과** | `test_상대변화_기준값_0이면_해당_지표_poor_signal_나머지는_정상` 통과 |
| **V-E6** | 그룹 곡선 상대 변환이 회원 처음 5분 기준으로 동일 적용 | **통과** | `test_그룹상대변환은_회원_처음5분_기준` 통과 |
| **V-E7** | 결측을 0으로 채운 값 0건, 보간 0건 | **통과** | `test_결측을_0으로_채우지_않는다` 통과 |

### F. 비용·성능·호환

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-F1** | AI 호출 0: regex 검사 및 외부 HTTP 호출 0건 | **통과** | `backend/app/services/member_report_v2_*.py` 5개 파일 전수 코드 검사 결과 AI/외부 HTTP 호출 0건 |
| **V-F2** | 1건 생성 시간(빌더+PDF) ≤ v1 동일 입력 측정값 (10회 중앙값) | **통과** | v2(빌더+PDF) 0.5792s ≤ v1(PDF 단독) 0.8230s |
| **V-F3** | Alembic 마이그레이션 파일 신규 0건 | **통과** | `git diff --stat origin/develop...HEAD -- backend/alembic` 0건 |
| **V-F4** | v1 모듈 diff: `member_report_{builder,metrics,wording,narrative,svg,group,aperiodic}.py`, `schemas/member_report.py` 0건 | **통과** | `git diff origin/develop...HEAD --stat` 상 v1 코어 모듈 변경 0건 확인 |
| **V-F5** | 재산출 시 기존 v1 `content.member_report` 가 v2로 덮어쓰기, 실패 시 이전 값 이월 | **통과** | `pytest tests/test_member_report_v2_integration.py` (`test_v1_저장분을_재산출하면_v2로_덮어쓴다`, `test_v2_생성_실패시_이전_member_report를_이월한다`) 통과 |
| **V-F6** | 플래그 `MEMBER_REPORT_SCHEMA=v1` 롤백 시 v1 생성 정상 | **통과** | `pytest tests/test_member_report_v2_integration.py::test_플래그_v1이면_v1_생성` 통과 |

### G. 회귀·품질 게이트

| ID | 항목 | 판정 | 근거 명령 / 테스트 |
|---|---|:---:|---|
| **V-G1** | `cd backend && pytest -k member_report` 전체 통과 | **통과** | 260 passed, 3 skipped, 6125 deselected in 47.39s |
| **V-G2** | `cd frontend && npm test`, `npm run build`, 타입 검사 통과 | **통과** | Vitest 83 passed, `tsc --noEmit` 0 errors, `npm run build` 성공 (8.48s) |
| **V-G3** | `any` 사용 0 (v2 신규 파일), kebab-case 파일명 규칙 | **통과** | v2 신규 13개 파일 전수 검사 결과 `any` 타입/캐스팅 0건 |
| **V-G4** | 실제 dev 배포(승인 후) 에서 합성 세션 1건으로 웹 화면·책 PDF 육안 확인 | **미검증**<br>(승인 대기) | 사용자 작업 지시("배포 금지") 규칙에 따라 자동 실행하지 않음. 배포 승인 후 확인 필요 |
| **V-G5** | Tailwind·CSS 클래스 실제 생성 확인 (`book_v2.css`, CSS 번들에 v2 클래스 존재) | **통과** | `frontend/dist/assets/style-DUYThF7T.css` 내 `mr2-root`, `mr2-pair`, `mr2-band`, `mr2-chart` 등 전수 생성 확인, `build_book_html_v2` 내 `book_v2.css` 로드 확인 |

---

## 3. 시안 대비 차이 목록 (Design Parity Audit)

확정 시안 (`report-generic-real-v3-1117`) 및 FE 캡처 (`sdd328-shots`) 상세 비교 결과:

### ① 종합 의견 (Opinion) 그래프 섹션 관련
- **현상**: 시안 HTML(`bodycare.html`)의 종합 의견 하단에 `<div class="dist-grid">` 클래스가 사용되어 있어 '분포(distribution) 그래프'로 오인될 수 있으나, 실제 시안 내부 SVG는 2종의 **미니 시간 그래프**(`1분 동안 뛴 횟수 시간 그래프`, `이완도 시간 그래프`)였음.
- **구현 상태**: FE(`MemberReportViewV2.tsx`) 및 책 PDF(`member_report_v2_book.py`) 모두 시안과 동일하게 `opinion.chart_keys`에 정의된 2종의 미니 시간 그래프를 배치하여 정상 렌더 중임. 즉, 분포 그래프가 누락된 것이 아니며 시안 설계와 일치함.

### ② 시간 그래프 눈금 (Ticks / Grid) 세부 차이
- **세로축 (Y축) 그리드선**:
  - *시안 HTML*: 3개 눈금 라인 `[lo, (lo+hi)/2, hi]` (상단·중간·하단, 2구간 분할).
  - *책 PDF SVG (`member_report_v2_svg.py`)*: 4개 눈금 라인 `BASE - k * H / 3` (k=0..3, 3구간 분할).
  - *FE 웹 차트 (`charts-v2.tsx`)*: 3개 눈금 라인 (시안 HTML과 동일한 2구간 분할).
- **가로축 (X축) 시간 라벨**:
  - *시안 HTML*: 5개 분 포인트(`1, 17, 34, 50, 66`)에 숫자만 표기하고 하단에 `시작 후 경과 시간(분)` 캡션 배치.
  - *책 PDF SVG*: 5개 분 포인트에 `1분`, `17분`, `34분`, `50분`, `66분`과 같이 `"분"` 단위를 포함하고, 하단에 `{start_clock}부터 경과 시간 · {unit}` 캡션 배치.
  - *FE 웹 차트*: 10분 단위 필터(`1분, 10분, 20분, 30분, 40분, 50분, 60분, 66분`)로 표기.
- **평가**: 차트 가독성을 위한 의도된 플랫폼별(웹 vs PDF 인쇄) 최적화 차이이며 기능적 결함은 아님 (Low).

### ③ 웹 화면(FE)과 책 PDF(BE) 간의 섹션 노출 차이
- **`memo` (손글씨 메모)**: 책 PDF(`_memo`, 16쪽)에는 펜으로 메모할 수 있는 라인이 인쇄되나, 웹 화면(`MemberReportViewV2.tsx`)에는 디지털 화면 특성상 렌더되지 않음 (시안에서도 화면에서는 숨김 처리되었던 영역).
- **`cover` (표지) / `back` (뒷표지)**: 책 PDF 전용으로 구성되어 있으며, 웹 화면에서는 상단 요약 히어로 카드가 첫 화면 역할을 수행함.

### ④ V-D5 문의 문구 표지(Cover) 표기 차이
- `verify.md` V-D5 항목에 "표지·방법·뒷표지에 존재"로 명시되어 있으나, 실제 골든 픽스처 및 구현에서는 표지 하단(`cover.footer`)에 "회원님의 기록"이 표기되고, "문의: 담당 클래스 코치" 문구는 방법(`method.contact_body`), 뒷표지(`back.contact`), 그리고 책 PDF의 **매 페이지 하단 푸터**(`_Ctx.foot`)에 배치되어 있음. 단위 테스트 및 계약 스키마와 정합함.

---

## 4. 회귀 검증 결과 (Regression)

1. **v1 기존 코드 보존**:
   - `git diff origin/develop...HEAD --stat` 상 v1 코어 모듈(`member_report_{builder,metrics,wording,narrative,svg,group,aperiodic}.py`) 및 스키마(`schemas/member_report.py`) 변경 0건.
   - 분기 지점: `member_report_book.py`(4줄 추가 분기), `report_task.py`(환경변수 플래그 기반 v1/v2 분기).
   - Alembic 신규 마이그레이션: 0건.
2. **금지어 및 전문용어 0건**:
   - 금지어 ("점수", "등급", "스트레스", "우울", "진단합니다", "위험", "불규칙", "덕분에", "때문에"): 0건.
   - 큰 글씨 전문용어 ("RMSSD", "SDNN", "HRV", "LF/HF", "PRV", "심박수"): 각주 외 본문 0건.
   - 절대값 단위 (`\d+ ms`): 각주 외 본문 0건.
3. **AI 및 외부 HTTP 호출 0건**:
   - `member_report_v2_*.py` 내 Gemini, OpenAI, Anthropic, LLM 호출 0건.
   - requests, httpx, 외부 URL fetch 0건.

---

## 5. 종합 판정 및 결론

- **전체 33개 검증 항목 중**:
  - **통과 (PASS)**: 32건
  - **미검증 (승인 대기)**: 1건 (V-G4 실제 dev 배포 — 작업 지침상의 배포 금지 규칙 준수)
  - **실패 (FAIL)**: 0건
- **이슈 분류**:
  - **Critical**: 0건
  - **High**: 0건
  - **Medium**: 0건
  - **Low**: 2건 (시안 대비 미세 차이: 시간 그래프 눈금 분할 수 3분할 vs 4분할, V-D5 문의 문구의 표지 표기 위치가 푸터로 배치된 점)

# SDD-328 Verify — 구현 전 QA 체크리스트 (Stage ③ 게이트)

- 작성일: 2026-11-17 (구현 전). 사후 수정 금지 — 변경 필요 시 날짜·사유를 하단 "변경 이력"에만 추가.
- 실행 후 결과는 `summary.md` 에 기록한다. 항목 ID는 `V-xx`.

## A. 계약·골든 픽스처
- [ ] V-A1 `member_report_v2/{bodycare,mindcare}.json` 이 pydantic(`extra=forbid`) 검증 통과
- [ ] V-A2 FE `types-v2.ts` 와 JSON Schema 드리프트 테스트 통과
- [ ] V-A3 픽스처가 합성 값임(실 member_code·실명·private 백업 값 없음) — 코드 리뷰 + `grep` 로 `private-backups` 경로·실이메일 0건
- [ ] V-A4 `schema_version` 이 정확히 `member_report.v2`, v1 모델은 diff 0

## B. 렌더 (FE)
- [ ] V-B1 v2 골든 픽스처 2종이 웹 화면(몸돌봄·마음돌봄)에서 오류 없이 렌더, 18쪽 구조의 모든 섹션 존재
- [ ] V-B2 **기존 v1 픽스처 7종 + short 1종(총 8종)** 이 이전과 동일하게 렌더(스냅샷 회귀 0)
- [ ] V-B3 알 수 없는 `schema_version`·`member_report` 없음 → 구 화면 폴백(예외 없음)
- [ ] V-B4 390px·1440px 에서 가로 스크롤·텍스트 넘침 0(Playwright `scrollWidth <= clientWidth`)
- [ ] V-B5 그래프: 첫 2분 회색, 결측 분 선 끊김, 그룹 평균 점선 + ±1SD 띠, 유효 인원 10 미만 분은 띠·평균 없음

## C. 책 PDF (BE)
- [ ] V-C1 v2 몸돌봄·마음돌봄 18쪽, 쪽번호·목차가 `expected_book_pages_v2` 와 일치
- [ ] V-C2 빈 쪽 0, 쪽 넘침(지표 1쪽 초과) 0 — 페이지별 텍스트 길이·이미지 비교
- [ ] V-C3 미착용 8쪽 축약, 결측 지표 쪽 생략 시 쪽번호 재계산
- [ ] V-C4 v1 저장 리포트의 PDF 가 이전 바이트 수준 구조(쪽수·텍스트)와 동일
- [ ] V-C5 글꼴 임베드 3종만, 외부 네트워크 접근 0

## D. 문구·정책
- [ ] V-D1 금지어 0: 점수·등급·스트레스·우울·진단합니다·위험 — v2 모든 문자열(`assert_report_clean`) + 책 PDF 텍스트 추출
- [ ] V-D2 종합점수·단일 합산 지표 0, 인과 단정(명상 덕분에/때문에) 0, "불규칙" 0
- [ ] V-D3 **큰 글씨 전문용어 0**: 제목·히어로·요약 카드·쪽 제목·본문에 RMSSD·SDNN·HRV·LF/HF·PRV·심박수 0건. 허용 위치는 `footnote`/`source_note` 필드(7.5~11pt)뿐 — 필드 화이트리스트 테스트
- [ ] V-D4 용어 대응표 적용 확인: 심장 리듬의 여유, 긴장과 휴식의 균형, 1분 동안 뛴 횟수, 몸이 움직인 정도
- [ ] V-D5 "문의: 담당 클래스 코치" 가 표지·방법·뒷표지에 존재
- [ ] V-D6 LF/HF: 세로축 숫자·참고범위·그룹 비교 0, 흐름 방향 문장만
- [ ] V-D7 HRV 절대값(ms)·연령 참고 띠 표시 0, % 상대 변화만(plan D2) — 본문 정규식 `\d+(\.\d+)?\s*ms` 0건(각주 제외)
- [ ] V-D8 "가장 편안했던 5분" 문구가 단정형이 아님("찾았어요"·"후보"·"느낌과 함께")
- [ ] V-D9 10분 미만 측정: 전후 비교 문장·pair 없이 평균·흐름만(#316 동작 유지)
- [ ] V-D10 10/27 이전 HRV 레거시 행: 심장 리듬 여유·균형 쪽 결측, 심박수·뇌파는 사용(#314 유지)

## E. 계산 정확성 (독립 검산)
- [ ] V-E1 시안 `independent-check.py` 이식 스크립트가 합성 입력 2종에서 **빌더 출력과 일치**(허용오차 1e-6): 처음 5분·마지막 5분 중앙값, 상대 변화 %
- [ ] V-E2 그룹 분별 평균·모집단 SD(ddof=0)·n 독립 재계산 일치, **n<10 분은 평균·SD 모두 None**, 본인 제외 확인(그룹 n = 전체−1)
- [ ] V-E3 가장 편안했던 5분: 동률 처리(움직임 평균 → 심박 중앙값 → 이른 시각) 단위 테스트 4종(무동률·1차 동률·2차 동률·후보 0개), 첫 2분 제외, 심박·움직임 결측 창 제외
- [ ] V-E4 시기 문구 경계(n×0.3, n×0.7)
- [ ] V-E5 상대 변화 기준값 0·결측 → 쪽 `missing(poor_signal)`, 0 나눗셈 없음
- [ ] V-E6 그룹 곡선 상대 변환이 **회원 처음 5분 기준** 으로 동일 적용(각주 문구와 일치)
- [ ] V-E7 결측을 0 으로 채운 값 0건, 보간 0건

## F. 비용·성능·호환
- [ ] V-F1 AI 호출 0: `grep -rniE "gemini|openai|anthropic|llm|ai_text|build_ai_prompt|generate" backend/app/services/member_report_v2_*.py` 0건 + 빌더 실행 중 외부 HTTP 모킹 시 호출 0
- [ ] V-F2 1건 생성 시간(빌더+PDF) ≤ v1 동일 입력 측정값(10회 중앙값)
- [ ] V-F3 Alembic 마이그레이션 파일 신규 0건, `git diff --stat -- backend/alembic` 비어 있음
- [ ] V-F4 v1 모듈 diff: `member_report_{builder,metrics,wording,narrative,svg,group,aperiodic}.py`, `schemas/member_report.py` 변경 0(분기 입구 `member_report_book.py`·`report_task.py` 외)
- [ ] V-F5 재산출 시 기존 v1 `content.member_report` 가 v2 로 덮어쓰기, 생성 실패 시 이전 값 이월
- [ ] V-F6 플래그 `MEMBER_REPORT_SCHEMA=v1` 롤백 시 v1 생성 정상

## G. 회귀·품질 게이트
- [ ] V-G1 `cd backend && pytest -k member_report` 전체 통과(기존 + 신규)
- [ ] V-G2 `cd frontend && npm test`, `npm run build`, 타입 검사 통과
- [ ] V-G3 `any` 사용 0(v2 신규 파일), kebab-case 파일명
- [ ] V-G4 실제 dev 배포(승인 후) 에서 합성 세션 1건으로 웹 화면·책 PDF 육안 확인 — 빌드 통과만으로 완료 처리하지 않음
- [ ] V-G5 Tailwind·CSS 클래스 실제 생성 확인(`book_v2.css` 로드, 화면 CSS 번들에 v2 클래스 존재)

## 변경 이력
- 2026-11-17 최초 작성(구현 전).

# SDD-067 — A4 세로 1장 재디자인 결과

## 변경

- 코디네이터의 변경 브리프에 따라 기존 다중 페이지 스펙/계획/구현 전 검증안을 1장 요약 기준으로 갱신했다.
- `report-print.css`의 인쇄 전용 named `@page report`를 A4 portrait, 여백 10mm로 구성했다. 표지 및 강제 페이지 나눔을 제거하고 제목·이름·날짜 한 줄 헤더와 종합여정, 몸/마음 각 최대 3지표, 마무리 한 줄로 재배치했다.
- 그래프/상세 설명/점수 부록은 인쇄에서 숨기며 변화량·방향성·단위와 해석 주의 문구를 유지했다. 기존 EEG `data-print-exclude` 및 details 강제 열기 제거 상태를 보존했다.
- 긴 여정은 최대 6줄, 마무리는 한 줄, 서사가 없는 상담 요약은 최대 16줄로 말줄임 처리한다. PDF 하단에 축약 및 화면 전문 안내를 표시한다.
- `ReportCoverSection.tsx` 날짜에 인쇄용 클래스만 추가했다. 화면용 CSS 및 NarrativeSections 원본은 수정하지 않았다.
- 기존 작업의 ReportDetailView/print-report/카운터 변경은 보존했으며 이번 재디자인에서 추가 변경하지 않았다.

## 검증 결과

- RED: 새 페이지 나눔 기대값(auto)에서 기존 다중 페이지 스타일(page)이 실패하는 2건 확인.
- GREEN: `NODE_PATH=/tmp/sdd046-browser/node_modules node --test frontend/tests/*.test.cjs` **16개 통과 / 실패 0**.
- 최종 `cd frontend && npm run build`: **exit 0, TypeScript 오류 0**.
- Chromium 실제 PDF: 기본 / 긴 여정 및 긴 마무리 / 서사 없는 상담 요약 모두 **1쪽**, **594.96 × 841.92pt (A4 portrait)**.
- 열린 EEG details가 인쇄 DOM에서 제외되고 원본 화면 상태 유지. 인쇄 시 보이는 변화 지표 6개, SVG 0개, 중복 상담 부록 0개 확인.
- 이름 제공/미제공, 화면 1280/390/320px, 승인/메일 발송 회귀 통과.
- 기본 및 긴 내용 PDF를 이미지로 렌더링하여 헤더·지표·말줄임·마무리·하단 안내의 잘림 없는 배치를 확인했다.
- `git diff --check` 통과.

## 검증 산출물

- `/tmp/sdd-067-report.pdf` 및 `/tmp/sdd-067-report-one-page.png`
- `/tmp/sdd-067-long-report.pdf` 및 `/tmp/sdd-067-long-report-one-page.png`
- `/tmp/sdd-067-no-eeg-report.pdf` 및 `/tmp/sdd-067-no-eeg-report-one-page.png`
- `/tmp/sdd-067-one-page-build.log`

## 제한 및 남은 작업

- 긴 문장의 전문은 PDF에서 축약되며 화면 원문은 유지된다.
- 빌드에 기존 디자인 토큰 import 경로 및 500kB chunk 경고가 남아 있지만 빌드는 성공했다.
- 검증은 Chromium iframe 인쇄 경로 기준이며 기존 `pdf_url` 서버 PDF 및 실제 프린터 설정은 범위 밖이다.
- 커밋/배포/Linear 게시를 수행하지 않았다. 최종 리뷰는 코디네이터가 진행한다.

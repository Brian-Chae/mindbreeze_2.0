# SDD-327 — 요약 (Stage ⑥)

## 범위
- 회원 개인 명상 리포트 v11 이식: 모바일 390·데스크톱 1440 반응형 화면(C1), 명상 기록 책 PDF(C3, A4 18쪽, WeasyPrint).
- 리포트 다른 메일로 보내기: 회원 `POST /me/reports/{id}/share-email`, 이력 `GET /me/reports/{id}/share-history`, 상담사 `resend-email` 서비스 위임, 수신자별 7일 토큰, 메일 템플릿·PDF 첨부(8MB 초과 시 링크만), 앱 기기 공유(@capacitor/share·filesystem).
- 뇌파 1/f 기울기: 리포트 생성 시 원시 EEG에서 Welch+specparam(numpy·scipy·specparam 의존성 추가).

## 대표 결정 (11/13)
- 상담사·기관관리자 300통/일, 회원 10통/일, 같은 주소 1분 간격.
- 메일 발신 표기는 앱 표시 이름만(실명·이메일 노출 금지). **User 모델에 표시 이름 컬럼이 없어 현재는 전원 "MIND BREEZE 회원"** — 입력 방식(A/B/C) 대표 결정 대기.
- 1/f 이번 범위 포함.

## 커밋
f7a7ab35 T0 계약·픽스처 7종 / 2ca38e2d T11 공유 테이블 / 0f00127e T15 보내기 시트 / 3ede7e63 T12+T14 공유 서비스·토큰 열람 / 5e87e061 T3 1/f / 3123a394 T7 화면 / f345f5f8 T13 메일 태스크 / 3e4d3b5e T6 책 PDF / 4c028e3c T1+T2 집계 / f8586bb3 T8+T16 화면 연결 / 061a4245 T4 문장 / 821c8973 T5 생성·조회 API / 974f942e 검증 반영.

## 검증
- 독립 검증(Gemini, `verify-result.md`): Critical 0, High 2·Medium 2·Low 1 → 974f942e에서 수정.
- 감독 재실행(Python 3.11 venv): 리셋·탈퇴 가드 + 리포트·공유·기존 리포트/메일 테스트 285 통과·1 skip. frontend tsc 0, 리포트 관련 vitest 9파일 115 통과.
- 1/f: 시안 53명 대조 — 값 있는 36명 차이 0.0, 공란 17명 결측 일치.
- 책 PDF: 샘플 18쪽 약 1.2초·250KB, 글꼴 2종(서브셋), 표지 장식 잘림 감독 수정.

## 기존 실패(이번 변경과 무관, develop에서도 실패 확인)
- `test_sdd070_pdf_metrics.py::test_real_pdf_metric_pages`
- `frontend/tests/font-scale.test.ts`의 업로드 화면 11px 위반(브랜치 미변경 파일)

## 미검증 / dev에서 할 일
- `report-modal-pdf.test.cjs`(Vite 504로 로컬 실행 불가), 실기기 안전 영역·기기 공유 시트, dev E2E.
- 실데이터 리포트 생성 시간(S3 원시 다운로드 포함, soft 300s 안인지), 첨부 메일 실발송(대표 본인 주소 1회).
- 시안에 없던 방향(심박 상승 등) 문장 검토.

## 남은 결정·후속
- 표시 이름 입력 방식(A/B/C).
- 수업 단계 시각 기록 부재 → 구간은 세션 길이 비례(기록 생기면 `resolve_segments`만 교체).
- 그룹 1/f 분포 미산출(후속), 공유 링크 회수 버튼(후속), 회차 누적 책(후속).
- 앱 재빌드 시 `npx cap sync` 필요(새 플러그인).

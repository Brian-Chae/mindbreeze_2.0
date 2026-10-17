# SDD-211 프론트 기준선 (FE-1 워커, worktree `mindbreeze_2.0-sdd211-fe1`)

> 측정: 2026-10-18, 기준 커밋 `d43e53cc`(develop) 위 브랜치 `sdd/211-fe1`, 코드 변경 없음(테스트 파일 추가 전). 명령은 `frontend/` 에서 실행.

| 항목 | 명령 | 결과 |
|---|---|---|
| vitest 전체 | `npx vitest run` | Test Files **6 failed \| 110 passed (116)**, Tests **11 failed \| 1611 passed (1622)**, 84.41s |
| tsc | `npx tsc -p tsconfig.app.json --noEmit` | 오류 0 (exit 0) |
| eslint | `npx eslint src/` | 경고·오류 0 (exit 0) |

브리프·plan 은 "기존 실패 16건"으로 적었으나 이번 측정은 **11건 / 6파일**이다(차이 원인 `미확인` — 브라우저 `.cjs` 스위트가 환경·시점에 따라 달라질 수 있음). "신규 실패 0" 은 아래 목록 대비로 판정한다.

## 실패 목록 (11건)

| 파일 | 실패 건수 | 실패 테스트 |
|---|---|---|
| `tests/report-modal-pdf.test.cjs` | 2 | 하단 액션과 본문 전용 PDF (수신 주소: saved@example.com / 없음) |
| `tests/report-server-pdf.test.cjs` | 2 | detail·email: 서버 파일 다운로드와 실패 복구 |
| `tests/org-management-browser.test.cjs` | 2 | 기관 모달: 미저장 보호…, 목록 상태 필터와 저장 후 포커스 복귀 |
| `tests/agent-counselor-page.test.tsx` | 2 | 상담사는 브리핑과 입력창을 보고 CTA로 세션 목록을 연다 / 메시지 전송 성공 후 입력을 비우고… |
| `tests/chat-message-deeplink.test.ts` | 2 | 대상 missing/failure 이면 최근 대화로 돌아갈 수 있다 |
| `tests/org-counselor-management-browser.test.cjs` | 1 | 상담사 보호 대상, 확인 사유, 실패 유지, 역할 변경과 소속 해제 |

이번 작업이 건드리는 파일의 기존 테스트(`client-report-list.test.tsx`, `client-report-modal.test.tsx`, `agent-counselor-sidebar.test.tsx`, `class-flow-shell-terms.test.ts`)는 모두 통과 상태였다.

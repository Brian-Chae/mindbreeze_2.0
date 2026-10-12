# [SDD-134] 프론트 테스트 스위트 정합

## Goal
`npx vitest run`에서 11개 파일이 실패하던 것을 전부 통과시킨다(44 파일/318 테스트 0 실패).

## 원인 분석 (3유형)
| 유형 | 파일 | 원인 | 조치 |
|------|------|------|------|
| 코드 회귀 | useSessionLiveSocket.ts | sendSignal이 join 확정 전에도 participantId fallback으로 즉시 전송('sent'), 계약은 'queued'(버퍼링) | fallback 제거, onConnect 순서 정정 |
| 코드 회귀 | LoginPage.tsx | 회원 탭 Google 버튼 순서가 이메일 폼보다 뒤로 밀림 | 이메일 폼을 변수로 추출해 역할별 순서 재구성 |
| 테스트 오래됨 | quiet-signal-ui.test.ts | SDD-123 이모지→Lucide 아이콘 교체를 테스트 미반영 | 버튼 조회 문자열에서 이모지 제거 |
| 테스트 오래됨 | login-role.test.cjs | 6627231d access token localStorage→메모리 전환 미반영 | 메모리 tokenStorage 검증으로 교체 |
| 테스트 오래됨 | report-modal-pdf.test.cjs | hrv 라벨 간소화(c17334a6) 미반영 | 새 라벨 매치로 수정 |
| 하네스 불일치 | .cjs 10개 | node:test 스위트를 vitest가 수집 못함("No test suite found") | vitest.config.ts + setup-node-test-shim.mjs 신설 |
| 테스트 버그 | org-management-browser/report-*.test.cjs | react-router 스테일 해시·401 리다이렉트·무한 애니메이션 | liveBrowserHash·API stub 확장·animations:disabled |

## Acceptance Criteria
- [ ] `npx vitest run` → 44 파일 / 318 테스트 전부 통과.
- [ ] `npm run build` 0 errors.

# SDD-262 plan

| # | 작업 | 파일 | 테스트 |
|---|---|---|---|
| T1 | 순수 로직: summary 두 개 → 상태·수치 모델, 금지 문구 없는 라벨, 회차 후보 필터·정렬 | `frontend/src/lib/upload-status/member-view.ts` | `tests/sdd262-member-view.test.ts` |
| T2 | API + 훅: `getMySessionSummaries`(features/biosignal-raw summary 병렬), `useMyUploadStatus`(진행중 5초 폴링, 오류 시 데이터 제거), 회차 목록 로더 | `lib/api/my-upload-status.ts`, `hooks/use-my-upload-status.ts` | `tests/sdd262-member-screen.test.tsx` |
| T3 | 화면: 회차 선택 + 상태 카드 + 오류/오프라인 | `components/client/my-upload-status-screen.tsx`, `pages/client/my-upload-status-page.tsx` | 위 동일 |
| T4 | 설정 Group(client 전용) + 라우트 + 기존 테스트 갱신(client 8그룹) | `settings-content.tsx`, `App.tsx`, `tests/settings-content.test.tsx`, `tests/sdd261-upload-status-entry.test.tsx`(client 그룹 링크) | 설정·SDD-261 회귀 |
| T5 | 검증: tsc -b, eslint, vitest(설정·SDD-261·회원), 필요시 dev API 읽기 전용 curl, impl-notes, summary | `impl-notes.md`, `summary.md` | |

결정 기록: 서버 변경 없음. 상태 4종 중 "미착용"은 summary 로 판별 불가 → "수신 기록 없음(미착용이면 정상)"로 합쳐 표기.

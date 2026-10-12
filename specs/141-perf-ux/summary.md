# SDD-141 — 성능·UX (9건) 요약

## 구현 결과

2개 그룹 병렬 구현 (백엔드 3건 + 프론트 6건).

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | DASH-01 | 정렬 키 타임스탬프화(_activity_sort_key) | `dashboard_service.py` |
| 2 | PERF-02 | 리포트 목록 단일 쿼리 + count() + in_ 일괄(N+1 제거) | `report_service.py` |
| 3 | PERF-04 | 세션 목록 selectinload + limit/offset + count() | `session_service.py` `api/v1/session.py` |
| 4 | UX-02 | 초대 링크 origin 기반 단일 URL | `InviteModal.tsx` |
| 5 | UX-03 | 온보딩 필수 입력 미충족 시 차단 | `CounselorOnboardingPage.tsx` |
| 6 | FE-UI-001 | maxParticipants 10 통일 + 피커 초기화 | `SessionListPage.tsx` |
| 7 | FE-RT-002 | SOCKET_URL 단일 출처 통일 | `socket.ts` `useRecordSocket.ts` `useReportProgress.ts` `useNotificationSocket.ts` |
| 8 | FE-RT-003 | 세션 상세 onParticipantChanged 구독 | `SessionDetailPage.tsx` `useSessionLiveSocket.ts` |
| 9 | FE-VID-001 | blob URL revokeObjectURL 해제 | `VideoPlayer.tsx` |

## 테스트

- 백엔드 `pytest -q` → **1009 passed / 12 skipped / 0 failed**
- 프론트 `vitest run` → **44 files / 318 tests**
- 프론트 `npm run build` → **0 errors**

## 배포

GitHub Actions Deploy Dev.

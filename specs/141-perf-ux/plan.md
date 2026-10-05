# SDD-141 — 구현 계획

9건을 2개 그룹으로 병렬 구현.

| 그룹 | 건 | 방식 |
|---|---|---|
| A. 백엔드 성능 | DASH-01, PERF-02, PERF-04 | 정렬 키 타임스탬프화 · DB where/order/limit/offset + selectinload N+1 제거 |
| B. 프론트 UX·실시간 | UX-02/03, FE-UI-001, FE-RT-002/003, FE-VID-001 | origin 기반 URL · 필수입력 차단 · 리셋 버그 · SOCKET_URL 통일 · 참여자 구독 · revokeObjectURL |

## 건별 설계

1. **DASH-01** — `_activity_sort_key` 타임스탬프(aware 정규화) 정렬.
2. **PERF-02** — 리포트·세션 단일 쿼리 LEFT JOIN + count() 별도 + in_ 일괄 조회.
3. **PERF-04** — selectinload(Session.participants) + limit/offset + count().
4. **UX-02** — `VITE_PUBLIC_APP_URL || window.location.origin` 단일 URL.
5. **UX-03** — 미충족 시 오류 표시 후 return 차단.
6. **FE-UI-001** — maxParticipants 10 통일 + 피커 상태 초기화.
7. **FE-RT-002** — socket.ts SOCKET_URL 단일 export, 전체 import 통일.
8. **FE-RT-003** — onParticipantChanged 구독 + 참여자/대기열 갱신.
9. **FE-VID-001** — blobUrlRef 추적 + cleanup/sessionId 변경 시 revokeObjectURL.

## 검증

- 백엔드 `pytest -q` → 1009 passed / 0 failed
- 프론트 `vitest run` → 44 files / 318 tests
- 프론트 `npm run build` → 0 errors

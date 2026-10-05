# SDD-144 — 실시간·EEG·성능 마이크로 (11건) 요약

## 구현 결과

프론트 11건 1개 그룹 구현.

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | FE-RT-001 | dedup 키 (session_id, participant_id) 확장 | `socket.ts` |
| 2 | FE-PERF-001 | interval mount 1회 + ref 참조 | `EegWaveformPanel.tsx` |
| 3 | FE-PERF-002 | sessionRef 로 setMetrics 직접 호출 | `ClassPlayerPage.tsx` |
| 4 | FE-RT-004 | /record 싱글톤 참조 카운트 승격 | `socket.ts` `useRecordSocket.ts` `useReportProgress.ts` |
| 5 | FE-BAND-001 | 모듈 레벨 소유자 가드 + connect 1건 | `useBand.ts` |
| 6 | FE-EEG-001 | 필드 누락 시 보수 처리(false/idle) | `apply-eeg-feature.ts` |
| 7 | FE-EEG-002 | 초과 청크 dead-letter 제거 + 표면화 | `useEegRawUpload.ts` |
| 8 | FE-PRESENCE-001 | checkin/readiness JSON 키로 deps | `useWaitingRoomPresence.ts` |
| 9 | FE-DETAIL-001 | 부분 성공마다 setSession + 재조회 | `SessionDetailPage.tsx` |
| 10 | FE-RT-005 | lastEvent 디버그 전용 명시 | `useSessionLiveSocket.ts` |
| 11 | SEC-04(FE) | loginPathForRole 기반 리다이렉트 | `client.ts` |

## 테스트

- 프론트 `vitest run` → **44 files / 318 tests**
- 프론트 `npm run build` → **0 errors**

## 배포

GitHub Actions Deploy Dev.

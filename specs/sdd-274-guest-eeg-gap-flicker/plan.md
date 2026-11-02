# SDD-274 — Plan

## 원인 추적(코드) 결과 → summary.md 에 증거 표
후보 (a) 콜백 DataView aliasing, (b) 이중 처리·releaseForNative, (c) 늦은 도착과 tick 계산, (d) MTU/연결 파라미터.
- (a) `parseRawPacket` 은 `new Uint8Array(buf, off, len).slice()` 로 즉시 복사 → 콜백 시점에 안 덮임. `onRaw` 도 `.slice()`.
- (c) 코어 gap 은 **장치 헤더 tick 기준**(`clock.rs` admit) — 도착시각은 영향 없음 → 지연 가설 기각.
- 따라서 유실·순서 뒤바뀜은 BLE 계층(브릿지 드롭, 이중 CCCD, MTU)에서 발생해야 하며 JS 코드 추적만으로 확정 불가 → 계측으로 실기 증거 수집.

## Task
| # | 내용 | 파일 |
|---|---|---|
| T1 | 직전값 유지 순수 함수 `holdMindMetrics` | `src/lib/session-live/hold-last-snapshot.ts`(신규) |
| T2 | MemberClassContainer 연결(게스트+Android 한정) | `MemberClassContainer.tsx` |
| T3 | EEG 진단 `eeg-diag.ts` + 워커 eeg 판정 집계 + `ed` 쿼리 | `measurement-web/eeg-diag.ts`(신규), `core.worker.ts`, `capture-adapter.ts`, `web-measurement-session.ts`, `lib/api/class-flow.ts` |
| T4 | 시험 | `tests/sdd274-hold-last.test.ts`, `tests/sdd274-eeg-diag.test.ts` |
